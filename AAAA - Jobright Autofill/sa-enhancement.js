// === SPEEDYAPPLY WORKFLOW ADD-ON (built on 2.28.2) ===
//
// Workflow layer on top of SpeedyApply's bundled content.js:
//   1. Workday Apply -> Apply Manually, and generic Apply on other ATS job pages.
//   2. Cookie banner dismissal, preferring "Reject".
//   3. Fills empty fields only, from the SpeedyApply profile and Custom Answers.
//   4. Required-field watchdog: blocks Next until required fields are filled and
//      lists whatever still needs the user.
//   5. Resume upload from the SpeedyApply profile on any ATS file input.
//   6. Shadow-DOM-aware field discovery.
//
// Deliberate limits:
//   * No invented answers. If the profile or Custom Answers don't hold it, the
//     field stays blank for the user.
//   * Consent and certification checkboxes are never ticked.
//   * This script never clicks Submit. It stops and tells the user to review.
//   * Subscription data and SpeedyApply's own settings are never touched.

(function () {
  'use strict';
  if (window.__saEnhancementLoaded) return;
  window.__saEnhancementLoaded = true;

  const LOG = (...a) => console.log('[SA+]', ...a);

  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason?.message || String(event.reason || '');
    if (/Could not establish connection|Receiving end does not exist|Extension context invalidated/i.test(msg)) {
      event.preventDefault();
    }
  });

  // ===================== DOM HELPERS =====================
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  }

  // Walks every reachable shadow root.
  function deepQueryAll(selector, root) {
    const out = [];
    const start = root || document;
    const walk = (node) => {
      if (!node) return;
      if (node.querySelectorAll) { try { out.push(...node.querySelectorAll(selector)); } catch (_) { } }
      const children = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const c of children) {
        if (c.shadowRoot && c.shadowRoot !== node) walk(c.shadowRoot);
      }
    };
    walk(start);
    return [...new Set(out)].filter(el => !el.closest('#sa-custom-panel, #sa-status'));
  }

  let _lastScrollAt = 0;
  function smoothEnsureVisible(el) {
    if (!el) return;
    const now = Date.now();
    if (now - _lastScrollAt < 600) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top >= 60 && r.bottom <= vh - 60) return;
    _lastScrollAt = now;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
    catch (_) { try { el.scrollIntoView(true); } catch (__) { } }
  }

  function nativeSet(el, val) {
    if (!el || el.disabled || el.readOnly) return false;
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
        el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) { setter.call(el, ''); setter.call(el, val); } else el.value = val;
    } catch (_) { el.value = val; }
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function realClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }
  function clickWithFocus(el) {
    if (!el) return;
    smoothEnsureVisible(el);
    realClick(el);
  }

  function waitFor(check, ms) {
    return new Promise(resolve => {
      const fn = typeof check === 'function' ? check : () => $(check);
      const found = fn(); if (found) return resolve(found);
      const o = new MutationObserver(() => { const v = fn(); if (v) { o.disconnect(); resolve(v); } });
      o.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { o.disconnect(); resolve(null); }, ms || 8000);
    });
  }

  // ===================== STORAGE =====================
  const st = {
    get: k => new Promise(r => chrome.storage.local.get(k, d => r(typeof k === 'string' ? d[k] : d))),
    set: obj => new Promise(r => chrome.storage.local.set(obj, r)),
  };

  // SpeedyApply's own automation toggles. Read only, never written.
  async function getNativeSettings() {
    try { return (await st.get('settings'))?.autofillSettings || {}; }
    catch (_) { return {}; }
  }

  // Reads SpeedyApply's 2.28 profile shape.
  async function getProfile() {
    try {
      const raw = await st.get('profile');
      if (!raw) return {};
      const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const job = (p.jobData || []).find(j => j.currentlyWorkHere) || null;
      const edu = (p.educationData || [])[0] || {};
      return {
        first_name: p.nameData?.firstName || '',
        last_name: p.nameData?.lastName || '',
        preferred_name: p.nameData?.preferredFirstName || '',
        email: p.contactData?.email || '',
        phone: p.contactData?.phoneNumber || '',
        city: p.addressData?.city || '',
        state: p.addressData?.state || '',
        country: p.addressData?.country || '',
        postal_code: p.addressData?.postalCode || '',
        address: p.addressData?.line1 || '',
        linkedin: p.websiteData?.linkedin || '',
        github: p.websiteData?.github || '',
        twitter: p.websiteData?.twitter || '',
        website: p.websiteData?.personal || (p.websiteData?.websites || [])[0] || '',
        current_title: job?.jobTitle || '',
        current_company: job?.company || '',
        school: edu.school || '',
        degree: edu.degree || '',
        major: edu.fieldOfStudy || '',
        gpa: edu.gpa || '',
        employment: p.employmentData || {},
        resume: p.resumeData || null,
      };
    } catch (e) { return {}; }
  }

  // ===================== CUSTOM ANSWERS BANK =====================
  // User-defined Q&A pairs stored in chrome.storage.local.sa_custom_answers.
  // Each entry: { keywords: ['python','years'], response: '5 years' }.
  let _customAnswers = [];
  async function loadCustomAnswers() {
    _customAnswers = (await st.get('sa_custom_answers')) || [];
  }
  async function saveCustomAnswers() {
    await st.set({ sa_custom_answers: _customAnswers });
  }
  // Every keyword must appear. The most specific entry wins, and a tie between
  // two different answers leaves the field blank.
  function findCustomMatch(text) {
    if (!_customAnswers.length || !text) return '';
    const norm = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = new Set(norm.split(' '));
    const hits = _customAnswers.filter(e => e.keywords?.length && e.response &&
      e.keywords.every(k => k.split(/\s+/).every(w => words.has(w.toLowerCase()))));
    if (!hits.length) return '';
    const top = Math.max(...hits.map(e => e.keywords.length));
    const best = [...new Set(hits.filter(e => e.keywords.length === top).map(e => e.response))];
    return best.length === 1 ? best[0] : '';
  }

  // ===================== PROFILE-BACKED ANSWERS =====================
  const OTHER_COUNTRY = /\b(canada|uk|united kingdom|britain|ireland|europe|eu|germany|france|spain|netherlands|india|australia|singapore|japan|mexico|brazil)\b/;
  const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : '');

  // employmentData answers are US-specific, so they only apply to questions
  // about the US, or to generic questions from someone whose profile is in the US.
  function appliesToUS(l, p) {
    if (/\b(united states|us|usa|u s|america)\b/.test(l)) return true;
    return !OTHER_COUNTRY.test(l) && p.country === 'United States of America';
  }

  function answerFor(label, profile) {
    const l = (label || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!l) return '';
    const p = profile || {};
    const emp = p.employment || {};

    // Never autofill secrets or government IDs, even from Custom Answers.
    if (/password|passport\s*number|social\s*security|\bssn\b|tax\s*id|bank\s*account|\bcvv\b|credit\s*card/.test(l)) return '';

    const custom = findCustomMatch(label);
    if (custom) return custom;

    if (/sponsor/.test(l)) return appliesToUS(l, p) ? yesNo(emp.sponsorship) : '';
    if (/authori[sz]ed.{0,20}work|eligible\s*to\s*work|right\s*to\s*work|legal\s*right.{0,15}work/.test(l)) {
      return appliesToUS(l, p) ? yesNo(emp.eligibilityUS) : '';
    }
    if (/over\s*18|at\s*least\s*18|18\s*years/.test(l)) {
      return typeof emp.age === 'number' ? yesNo(emp.age >= 18) : '';
    }

    // Identity, contact and history fields use short labels. Skip anything that
    // reads like a question, so "Do you consent to phone contact?" gets no number.
    if (l.length > 45 || /^(do|does|did|are|is|have|has|will|would|can|could|may|should|if|please\s*explain)\b/.test(l)) return '';

    if (/^first\s*name|given\s*name|forename/.test(l)) return p.first_name || '';
    if (/^last\s*name|family\s*name|surname/.test(l)) return p.last_name || '';
    if (/^full\s*name|^name$|legal\s*name/.test(l)) return `${p.first_name || ''} ${p.last_name || ''}`.trim();
    if (/preferred\s*name|nickname/.test(l)) return p.preferred_name || p.first_name || '';
    if (/\be\s*mail\b|\bemail\b/.test(l)) return p.email || '';
    if (/\b(phone|mobile|cell|telephone)\b/.test(l)) return p.phone || '';
    if (/linkedin/.test(l)) return p.linkedin || '';
    if (/github/.test(l)) return p.github || '';
    if (/twitter/.test(l)) return p.twitter || '';
    if (/\bwebsite\b|portfolio|personal\s*url/.test(l)) return p.website || '';
    if (/^city$|current\s*city/.test(l)) return p.city || '';
    if (/\b(state|province)\b/.test(l)) return p.state || '';
    if (/^country/.test(l)) return p.country || '';
    if (/\bzip\b|postal\s*code/.test(l)) return p.postal_code || '';
    if (/\baddress\b|\bstreet\b/.test(l)) return p.address || '';
    if (/current\s*location|^location$/.test(l)) return p.city ? `${p.city}, ${p.state || p.country || ''}`.replace(/,\s*$/, '') : '';
    if (/\b(school|university|college|institution)\b/.test(l) && !/high\s*school/.test(l)) return p.school || '';
    if (/^degree|highest\s*degree/.test(l)) return p.degree || '';
    if (/\bmajor\b|field\s*of\s*study/.test(l)) return p.major || '';
    if (/\bgpa\b|grade\s*point/.test(l)) return p.gpa || '';
    if (/current\s*(title|position|role)|^job\s*title/.test(l)) return p.current_title || '';
    if (/current\s*(company|employer)|^company$|^employer$/.test(l)) return p.current_company || '';
    return '';
  }

  // Exact option text, or the answer as the option's first word ("No, I do not...").
  function matchesOption(text, answer) {
    const t = (text || '').trim().toLowerCase();
    const a = (answer || '').trim().toLowerCase();
    return !!a && (t === a || t.startsWith(a + ' ') || t.startsWith(a + ',') || t.startsWith(a + '.'));
  }

  // ===================== COOKIE BANNER DISMISSAL =====================
  function dismissCookieBanners() {
    const reject = $('#onetrust-reject-all-handler,#CybotCookiebotDialogBodyButtonDecline,.truste-button2,#truste-consent-required');
    if (reject && isVisible(reject)) { reject.click(); return; }
    const accept = $('#onetrust-accept-btn-handler,#CybotCookiebotDialogBodyButtonAccept,#truste-consent-button');
    if (accept && isVisible(accept)) { accept.click(); return; }
    // Cookie containers only. A generic "consent" match could hit an application question.
    $$('[class*="cookie" i], [id*="cookie" i]').forEach(banner => {
      if (!isVisible(banner)) return;
      const btns = $$('button', banner);
      const btn = btns.find(b => /^(reject|decline|deny|refuse)/i.test((b.textContent || '').trim())) ||
        btns.find(b => /^(accept|allow|got it|ok)\b/i.test((b.textContent || '').trim()));
      if (btn) btn.click();
    });
  }

  // ===================== ATS DETECTION =====================
  function isWorkday() { return /myworkdayjobs\.com|myworkdaysite\.com|workday\.com\/.*\/job/i.test(location.href); }
  function detectATS() {
    const u = location.href;
    if (isWorkday()) return 'Workday';
    if (/greenhouse\.io|boards\.greenhouse/i.test(u)) return 'Greenhouse';
    if (/jobs\.lever\.co|lever\.co\/.*apply/i.test(u)) return 'Lever';
    if (/jobs\.ashbyhq\.com|ashbyhq\.com/i.test(u)) return 'Ashby';
    if (/smartrecruiters\.com/i.test(u)) return 'SmartRecruiters';
    if (/apply\.workable\.com|workable\.com/i.test(u)) return 'Workable';
    if (/icims\.com/i.test(u)) return 'iCIMS';
    if (/bamboohr\.com.*careers/i.test(u)) return 'BambooHR';
    if (/taleo\.net|oraclecloud\.com.*Candidate/i.test(u)) return 'Taleo';
    if (/jobvite\.com/i.test(u)) return 'Jobvite';
    if (/successfactors\.com|sapsf\.com/i.test(u)) return 'SuccessFactors';
    if (/workforcenow\.adp\.com/i.test(u)) return 'ADP';
    if (/breezy\.hr/i.test(u)) return 'Breezy';
    if (/ats\.rippling\.com/i.test(u)) return 'Rippling';
    if (/eightfold\.ai/i.test(u)) return 'Eightfold';
    if (/applytojob\.com|jazz\.co/i.test(u)) return 'JazzHR';
    if (/joinhandshake\.com/i.test(u)) return 'Handshake';
    if (/usajobs\.gov|governmentjobs\.com/i.test(u)) return 'USAJOBS';
    if (/paylocity\.com.*Recruiting/i.test(u)) return 'Paylocity';
    if (/freshteam\.com/i.test(u)) return 'Freshteam';
    if (/dover\.io|dover\.com/i.test(u)) return 'Dover';
    if (/pinpointhq\.com/i.test(u)) return 'Pinpoint';
    return null;
  }

  // ===================== PAGE-TYPE GATING =====================
  function isAuthOrNonApplicationPage() {
    const u = location.href.toLowerCase();
    const p = location.pathname.toLowerCase();
    if (/sign[_-]?in|sign[_-]?up|log[_-]?in|log[_-]?out|\/login|\/register|\/signup|\/auth\b|\/sso\b|\/oauth|password|\/reset|\/verify|\/confirm|forgot|two[_-]?factor|\/mfa\b|\/otp\b|security[_-]?code|users\/sign|magic[_-]?link/i.test(u)) return true;
    if (/\/search(\/|$|\?)|\/browse|\/explore|\/results|\/saved|\/dashboard|\/account(\/|$)|\/settings(\/|$)|\/profile(\/|$)|\/messages|\/notifications/i.test(p)) return true;
    return false;
  }

  function hasApplicationForm() {
    if ($('[data-automation-id="applyFlowContainer"],[data-automation-id="quickApplyPage"],[data-automation-id="applyFlowMyInfoPage"],[data-automation-id="contactInformationPage"],[data-automation-id="applyFlowAutoFillPage"],[data-automation-id="applyFlowForm"]')) return true;
    const nameField = deepQueryAll('input').some(i => isVisible(i) && /first[_ ]?name|full[_ ]?name|legal[_ ]?name/i.test((i.name || '') + ' ' + (i.id || '') + ' ' + (getLabel(i) || '')));
    const emailField = deepQueryAll('input[type=email],input[name*="email" i],input[id*="email" i]').some(isVisible);
    if (nameField && emailField) return true;
    const resumeUpload = deepQueryAll('input[type=file]').some(f => {
      const meta = (getLabel(f) || '') + ' ' + (f.name || '') + ' ' + (f.id || '') + ' ' + (f.accept || '');
      return /resume|cv|cover|attach|upload/i.test(meta) || /pdf/i.test(f.accept || '');
    });
    if (resumeUpload) return true;
    const heading = $$('h1,h2,h3,legend,[role="heading"]').some(h => /apply for (this )?(job|position|role)|^\s*application\s*$|submit your application/i.test((h.textContent || '').trim()));
    if (heading && $('form input:not([type=hidden]),form textarea,form select')) return true;
    return false;
  }

  async function isAutofillEnabled() {
    try {
      const v = await st.get('autofillEnabled');
      if (v === false || v === 'false' || v === 0) return false;
      return true;
    } catch (_) { return true; }
  }

  // ===================== APPLY-BUTTON CLICKERS =====================
  async function workdayClickApply() {
    if (/\/apply(\/|$)/i.test(location.pathname)) return true;
    if ($('[data-automation-id="quickApplyPage"],[data-automation-id="applyFlowAutoFillPage"],[data-automation-id="contactInformationPage"],[data-automation-id="applyFlowMyInfoPage"]')) return true;
    const sels = ['[data-automation-id="applyButton"]', '[data-automation-id="jobAction-apply"]', 'a[data-automation-id="applyButton"]', 'button[data-automation-id="applyButton"]'];
    for (const sel of sels) {
      const btn = $(sel);
      if (btn && isVisible(btn)) { LOG('Workday Apply'); clickWithFocus(btn); await sleep(1500); return true; }
    }
    const txt = $$('a, button, [role="button"]').find(b =>
      isVisible(b) && /^\s*(apply(?: now| for job)?)\s*$/i.test((b.textContent || '').trim()) &&
      !/easy.?apply|with.?linkedin|with.?indeed/i.test(b.textContent || '')
    );
    if (txt) { clickWithFocus(txt); await sleep(1500); return true; }
    return false;
  }

  async function workdayClickApplyManually(maxMs) {
    const deadline = Date.now() + (maxMs || 12000);
    while (Date.now() < deadline) {
      const am = $('[data-automation-id="applyManually"]');
      if (am && isVisible(am)) { LOG('Workday Apply Manually'); await sleep(300); clickWithFocus(am); await sleep(2000); return true; }
      if (hasApplicationForm()) return true;
      const modal = $('[role="dialog"],[data-automation-id*="modal" i],[class*="modal" i],[class*="dialog" i]') || document;
      const fb = $$('button, a, [role="button"]', modal).find(b => {
        if (!isVisible(b)) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        if (!t || /use\s*my\s*last\s*application|autofill\s*with|with\s*linkedin|use\s*linkedin|with\s*indeed|sign\s*in/.test(t)) return false;
        return /^apply\s*manually$|^manually(\s+apply)?$|^continue\s+manually$/.test(t);
      });
      if (fb) { await sleep(300); clickWithFocus(fb); await sleep(2000); return true; }
      await sleep(300);
    }
    return false;
  }

  async function genericApplyClick(ms) {
    const deadline = Date.now() + (ms || 3000);
    while (Date.now() < deadline) {
      const sels = [
        'a.posting-btn-submit', 'a[data-qa="show-page-apply"]',
        'button[data-test="apply-button"]', 'a[data-test="apply-button"]',
        '.st-apply-button', 'button.js-apply-button',
        '#apply_button', 'a#apply_button',
        '.application--button', '.application-button', '.apply-button',
        'button[aria-label="Apply" i]', 'a[aria-label="Apply" i]',
        'a[href*="/apply"]:not([href*="linkedin"]):not([href*="indeed"])',
        '[data-automation="job-detail-apply"]', '.btn-apply', '.btn-primary-apply',
        '[data-qa="btn-apply"]', '[data-qa="apply"]', 'button.application-action--cta',
      ];
      for (const sel of sels) {
        const btn = $(sel);
        if (btn && isVisible(btn)) {
          const t = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
          if (/easy.?apply|with\s*linkedin|with\s*indeed|sign\s*in/i.test(t)) continue;
          LOG('Generic Apply: ' + sel);
          clickWithFocus(btn); await sleep(2000); return true;
        }
      }
      const txt = $$('a, button, [role="button"]').find(b => {
        if (!isVisible(b)) return false;
        const t = (b.textContent || '').trim();
        if (!t || /easy.?apply|with\s*linkedin|with\s*indeed|sign\s*in|save\s*job|share|view/i.test(t)) return false;
        return /^apply(?:\s+now| for (?:this )?(?:job|position|role))?$/i.test(t);
      });
      if (txt) { clickWithFocus(txt); await sleep(2000); return true; }
      await sleep(300);
    }
    return false;
  }

  // ===================== FIELD HELPERS =====================
  function getLabel(el) {
    if (!el) return '';
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const d = document.getElementById(lb); if (d?.textContent?.trim()) return d.textContent.trim(); }
    if (el.id) { const lbl = $(`label[for="${CSS.escape(el.id)}"]`); if (lbl) return lbl.textContent.trim(); }
    const wrap = el.closest('label');
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    if (el.placeholder) return el.placeholder;
    const fs = el.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg?.textContent?.trim()) return lg.textContent.trim(); }
    const c = el.closest('.form-group,.field,.question,[class*="Field"],[class*="Question"],[class*="form-row"],li,.form-item,[data-automation-id]');
    if (c) {
      const lbl = c.querySelector('label,[class*="label"],[class*="Label"],legend,[class*="prompt"]');
      if (lbl && lbl !== el && !lbl.contains(el)) return lbl.textContent.trim();
    }
    return el.name || el.id || '';
  }

  // The question a radio group asks, not the label of one option.
  function groupQuestion(radio) {
    const group = radio.closest('fieldset,[role="radiogroup"]');
    if (group) {
      const lb = group.getAttribute('aria-labelledby');
      if (lb) { const d = document.getElementById(lb); if (d?.textContent?.trim()) return d.textContent.trim(); }
      if (group.getAttribute('aria-label')) return group.getAttribute('aria-label');
      const lg = group.querySelector('legend');
      if (lg?.textContent?.trim()) return lg.textContent.trim();
    }
    const c = radio.closest('.form-group,.field,.question,[class*="question" i],[class*="field" i]');
    const q = c && $$('label,legend,[class*="label" i],[class*="prompt" i]', c).find(n => !n.querySelector('input') && !n.getAttribute('for'));
    return q?.textContent?.trim() || '';
  }

  function radioLabel(r) {
    return ($(`label[for="${CSS.escape(r.id || '_')}"]`)?.textContent || r.closest('label')?.textContent || r.value || '').trim();
  }

  function isFieldRequired(el) {
    if (!el) return false;
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    if (/\*\s*$|\(required\)/i.test(getLabel(el) || '')) return true;
    const c = el.closest('.field,.question,[class*="field" i],[class*="question" i]');
    return !!(c?.classList.contains('required') || c?.getAttribute('data-required') === 'true');
  }

  function hasFieldValue(el) {
    if (!el) return false;
    if (el.tagName === 'SELECT') {
      if (!el.value?.trim()) return false;
      const t = (el.options[el.selectedIndex]?.textContent || '').trim().toLowerCase();
      return !!t && !/^(select|choose|please|--|—)/.test(t);
    }
    if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked;
    return !!el.value?.trim();
  }

  function getMissingRequired() {
    const required = deepQueryAll('input:not([type=hidden]),textarea,select')
      .filter(el => isVisible(el) && isFieldRequired(el));
    const missing = [];
    for (const el of required) {
      let lbl;
      if (el.type === 'radio') {
        const group = deepQueryAll(`input[type=radio][name="${CSS.escape(el.name || '_')}"]`);
        if (el.checked || group.some(r => r.checked)) continue;
        lbl = groupQuestion(el);
      } else if (hasFieldValue(el)) continue;
      lbl = lbl || getLabel(el) || el.name || el.id || 'Required field';
      if (!missing.some(m => m.label === lbl)) missing.push({ label: lbl, el });
    }
    return missing;
  }

  // Fills blanks only. Anything without a real answer stays blank.
  async function fillFromProfile() {
    const p = await getProfile();
    let filled = 0;

    const inputs = deepQueryAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]):not([type=checkbox]):not([type=radio]),textarea')
      .filter(el => isVisible(el) && !el.value?.trim());
    for (const inp of inputs) {
      const val = answerFor(getLabel(inp), p);
      if (!val) continue;
      nativeSet(inp, val);
      filled++;
      await sleep(70);
    }

    for (const sel of deepQueryAll('select').filter(el => isVisible(el) && !hasFieldValue(el))) {
      const val = answerFor(getLabel(sel), p);
      const opt = val && $$('option', sel).find(o => o.value && matchesOption(o.text, val));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); filled++; }
    }

    const groups = {};
    deepQueryAll('input[type=radio]').filter(isVisible).forEach(r => { (groups[r.name || r.id] ||= []).push(r); });
    for (const radios of Object.values(groups)) {
      if (radios.some(r => r.checked)) continue;
      const val = answerFor(groupQuestion(radios[0]), p);
      const pick = val && radios.find(r => matchesOption(radioLabel(r), val));
      if (pick) { realClick(pick); filled++; await sleep(70); }
    }
    return filled;
  }

  // ===================== GENERIC RESUME UPLOAD =====================
  const _uploadedInputs = new WeakSet();

  // ATS widgets often clear the input after taking a file, so an empty input
  // doesn't prove nothing was uploaded.
  function hasUploadedFile(input) {
    if (input.files?.length || _uploadedInputs.has(input)) return true;
    const c = input.closest('fieldset, section, [class*="upload" i], [class*="resume" i], [class*="attachment" i]') || input.parentElement;
    return !!c?.querySelector('[data-automation-id="delete-file"],[data-automation-id="file-name"],.file-name,.upload-filename,[class*="uploaded" i]');
  }

  async function uploadResumeGeneric() {
    // SpeedyApply replaces the Workday resume itself.
    if (isWorkday()) return false;
    const data = (await getProfile()).resume;
    if (!data?.resumeBase64 || !data?.fileName) return false;
    const inputs = deepQueryAll('input[type="file"]').filter(el => {
      const meta = ((getLabel(el) || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase();
      return !/photo|avatar|profile.?pic|headshot|signature|cover|transcript/.test(meta) && !hasUploadedFile(el);
    });
    const named = inputs.filter(el => /resume|\bcv\b/i.test((getLabel(el) || '') + ' ' + (el.name || '') + ' ' + (el.id || '')));
    // An unnamed input is only safe to use when it's the only one on the page.
    const targets = named.length ? named.slice(0, 1) : inputs.length === 1 ? inputs : [];
    if (!targets.length) return false;
    try {
      const byteString = atob(data.resumeBase64.split(',').pop());
      const bytes = Uint8Array.from(byteString, c => c.charCodeAt(0));
      const type = /\.docx?$/i.test(data.fileName) ? 'application/msword' : 'application/pdf';
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], data.fileName, { type }));
      targets[0].files = dt.files;
      _uploadedInputs.add(targets[0]);
      targets[0].dispatchEvent(new Event('change', { bubbles: true }));
      targets[0].dispatchEvent(new Event('input', { bubbles: true }));
      LOG(`Resume uploaded: ${data.fileName}`);
      await sleep(1200);
      return true;
    } catch (e) { LOG('Resume upload failed: ' + e.message); return false; }
  }

  // ===================== WATCHDOG =====================
  function fieldSnapshot() {
    return deepQueryAll('input,textarea,select').map(el => (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value).join('|');
  }

  // Gives SpeedyApply's own autofill time to finish before we judge the page.
  async function waitForSettle(maxMs) {
    const deadline = Date.now() + (maxMs || 8000);
    let last = fieldSnapshot();
    let stableSince = Date.now();
    while (Date.now() < deadline && Date.now() - stableSince < 2500) {
      await sleep(250);
      const cur = fieldSnapshot();
      if (cur !== last) { last = cur; stableSince = Date.now(); }
    }
  }

  async function requiredFieldWatchdog(maxAttempts) {
    for (let i = 1; i <= (maxAttempts || 3); i++) {
      if (!getMissingRequired().length) return [];
      await fillFromProfile();
      await sleep(400);
    }
    return getMissingRequired();
  }

  const SUBMIT_WORDS = /submit|send|finish|complete|apply|confirm|sign\b|certify/i;

  function buttonText(b) {
    return ((b.textContent || '') + ' ' + (b.value || '') + ' ' + (b.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
  }

  function findSubmitButton() {
    return deepQueryAll('button, a[role="button"], input[type="submit"]').find(b =>
      isVisible(b) && /^(submit|send|finish|complete|apply)\b/i.test(buttonText(b)));
  }

  // Workday reuses its "next" automation id for the final Submit, so every
  // candidate is judged on its text, never on its selector alone.
  function findNextButton() {
    if ($('[data-automation-id="reviewJobApplicationPage"],[data-automation-id="applyFlowReviewPage"]')) return null;
    const nextSels = [
      'button[data-automation-id="bottom-navigation-next-button"]:not([disabled])',
      'button[data-automation-id="pageFooterNextButton"]:not([disabled])',
      'button[data-automation-id="next-button"]:not([disabled])',
      'button[aria-label*="Next" i]:not([disabled])',
      'button[aria-label*="Continue" i]:not([disabled])',
      '[data-testid="next-step"]', '[data-testid="continue"]',
    ];
    for (const sel of nextSels) {
      const btn = $(sel);
      if (btn && isVisible(btn) && !SUBMIT_WORDS.test(buttonText(btn))) return btn;
    }
    return $$('button:not([disabled]), a[role="button"]').find(b => {
      if (!isVisible(b)) return false;
      const t = buttonText(b);
      return /^(next|continue|proceed|save\s+(?:&|and)\s+continue|review)\b/i.test(t) &&
        !/cancel|back|prev|close/i.test(t) && !SUBMIT_WORDS.test(t);
    }) || null;
  }

  function checkSuccess() {
    const url = location.href.toLowerCase();
    if (/\/thanks?|\/success|\/confirmation|\/submitted|\/complete|\/applied/.test(url)) return true;
    const body = document.body?.innerText || '';
    if (/application submitted|thank you for applying|application received|we.?ve received your|successfully submitted|application complete|your application has been/i.test(body)) return true;
    if ($('[data-automation-id="congratulationsMessage"],[data-automation-id="confirmationMessage"],[data-automation-id="applicationSubmittedPage"]')) return true;
    return false;
  }

  // ===================== MAIN FLOW =====================
  let _running = false;

  // Fills and advances until something needs the user. Never clicks Submit.
  async function walkPages(maxPages) {
    if (_running) return;
    _running = true;
    showStatus('Working…');
    try {
      const native = await getNativeSettings();
      for (let page = 1; page <= maxPages; page++) {
        if (checkSuccess()) { hideStatus(); return; }
        dismissCookieBanners();
        await waitForSettle(8000);
        await uploadResumeGeneric();
        await fillFromProfile();
        const missing = await requiredFieldWatchdog(3);
        if (missing.length) { showStatus(`${missing.length} required field${missing.length === 1 ? '' : 's'} need you`, missing); return; }
        const next = findNextButton();
        if (!next) {
          if (!findSubmitButton()) showStatus('Nothing left to do on this page.');
          else if (native.autoSubmit) showStatus('SpeedyApply Auto Submit is on, so it may submit this page without you.');
          else showStatus('Ready. Review everything, then submit it yourself.');
          return;
        }
        const before = fieldSnapshot() + location.href;
        // SpeedyApply's own Auto Next clicks this button too. A second click could
        // skip a page, so with that setting on we only wait for the page to change.
        if (native.autoClickNextPage) {
          showStatus('Waiting for SpeedyApply to go to the next page…');
          const moved = await waitFor(() => fieldSnapshot() + location.href !== before, 20000);
          if (!moved) { showStatus('SpeedyApply did not move on. Check this page, then click Next.'); return; }
          continue;
        }
        clickWithFocus(next);
        await sleep(3000);
        if (fieldSnapshot() + location.href === before) { showStatus('Next did not move on. Check this page for errors.'); return; }
      }
      showStatus('Stopped after the page limit. Check this page.');
    } finally { _running = false; }
  }

  async function runWorkdayFlow() {
    await workdayClickApply();
    await workdayClickApplyManually(12000);
    await waitFor("[data-automation-id='quickApplyPage'],[data-automation-id='applyFlowAutoFillPage'],[data-automation-id='contactInformationPage'],[data-automation-id='applyFlowMyInfoPage'],[data-automation-id='applyFlowContainer'],[data-automation-id='applyFlowForm']", 10000);
    await walkPages(12);
  }

  async function runGenericATSFlow() {
    await walkPages(8);
  }

  // ===================== STATUS BOX =====================
  function hideStatus() { document.getElementById('sa-status')?.remove(); }

  function showStatus(text, missing) {
    if (window.self !== window.top || !document.body) return;
    let box = document.getElementById('sa-status');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sa-status';
      box.style.cssText = 'position:fixed;bottom:78px;left:20px;width:300px;max-height:50vh;overflow:auto;background:#fff;color:#111;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:12px 14px;z-index:2147483646;font:13px system-ui,-apple-system,sans-serif';
      document.body.appendChild(box);
    }
    box.textContent = '';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = text;
    box.appendChild(title);
    (missing || []).forEach(m => {
      const row = document.createElement('button');
      row.type = 'button';
      row.textContent = m.label.replace(/\s+/g, ' ').slice(0, 80);
      row.style.cssText = 'display:block;width:100%;text-align:left;margin-top:6px;padding:0;border:0;background:none;color:#1e40af;cursor:pointer;font:inherit';
      row.onclick = () => { m.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); m.el.focus?.(); };
      box.appendChild(row);
    });
    if (missing?.length) {
      const resume = document.createElement('button');
      resume.type = 'button';
      resume.textContent = 'Continue';
      resume.style.cssText = 'margin-top:10px;padding:6px 12px;background:#2563eb;color:#fff;border:0;border-radius:6px;cursor:pointer;font:600 13px system-ui,-apple-system,sans-serif';
      resume.onclick = () => walkPages(12);
      box.appendChild(resume);
    }
  }

  // ===================== CUSTOM ANSWERS PANEL UI =====================
  function injectCustomAnswersPanel() {
    if (document.getElementById('sa-custom-panel')) return;
    if (window.self !== window.top) return;

    const css = `
      #sa-custom-fab{position:fixed;bottom:20px;right:20px;width:46px;height:46px;border-radius:50%;background:#2563eb;color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25);z-index:2147483646;font-family:system-ui,-apple-system,sans-serif;border:none;transition:transform .15s}
      #sa-custom-fab:hover{transform:scale(1.08)}
      #sa-custom-panel{position:fixed;bottom:78px;right:20px;width:420px;max-width:calc(100vw - 40px);max-height:78vh;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;color:#111;display:none;flex-direction:column;border:1px solid #e5e7eb}
      #sa-custom-panel.show{display:flex}
      #sa-custom-panel header{padding:14px 16px;background:#2563eb;color:#fff;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:14px}
      #sa-custom-panel header .x{cursor:pointer;font-size:18px;line-height:1;border:0;background:transparent;color:#fff;padding:0 4px}
      #sa-custom-panel .body{padding:14px 16px;overflow-y:auto;flex:1;font-size:13px}
      #sa-custom-panel .hint{color:#6b7280;font-size:12px;margin-bottom:10px;line-height:1.4}
      #sa-custom-panel .row{display:flex;gap:8px;margin-bottom:10px;align-items:flex-start}
      #sa-custom-panel input,#sa-custom-panel textarea{flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit;color:#111;background:#fff}
      #sa-custom-panel textarea{resize:vertical;min-height:60px}
      #sa-custom-panel button.add{padding:8px 14px;background:#2563eb;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600}
      #sa-custom-panel button.add:hover{background:#1d4ed8}
      #sa-custom-panel .list{margin-top:8px;border-top:1px solid #e5e7eb;padding-top:10px}
      #sa-custom-panel .item{padding:10px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;background:#f9fafb}
      #sa-custom-panel .item .kw{font-weight:600;color:#1e40af;font-size:12px;margin-bottom:4px;word-break:break-word}
      #sa-custom-panel .item .ans{color:#374151;font-size:12px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
      #sa-custom-panel .item .del{float:right;background:#fee2e2;color:#dc2626;border:0;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600}
      #sa-custom-panel .empty{color:#9ca3af;font-size:12px;text-align:center;padding:14px;font-style:italic}
      #sa-custom-panel .count{color:#6b7280;font-size:11px;margin-top:2px}
      #sa-custom-panel label.lbl{font-size:11px;color:#374151;margin-bottom:4px;display:block;font-weight:600}
    `;
    const style = document.createElement('style');
    style.id = 'sa-custom-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'sa-custom-fab';
    fab.type = 'button';
    fab.title = 'Custom Answers';
    fab.textContent = 'Q&A';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'sa-custom-panel';
    panel.innerHTML = `
      <header>
        <span>Custom Answers</span>
        <button class="x" type="button" aria-label="Close">×</button>
      </header>
      <div class="body">
        <div class="hint">Enter the words a question contains, then your answer. A question must contain all of them (e.g. <em>"years, python"</em> → <em>"7"</em>). Answers are used exactly as written.</div>
        <label class="lbl">Keywords (comma-separated)</label>
        <div class="row"><input id="sa-kw" placeholder="e.g. years, python"></div>
        <label class="lbl">Answer</label>
        <div class="row"><textarea id="sa-ans" placeholder="e.g. 7"></textarea></div>
        <div class="row"><button class="add" id="sa-add" type="button">Add Answer</button></div>
        <div class="list" id="sa-list"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const closeBtn = panel.querySelector('.x');
    fab.onclick = () => { panel.classList.toggle('show'); renderList(); };
    closeBtn.onclick = () => panel.classList.remove('show');

    const addBtn = panel.querySelector('#sa-add');
    addBtn.onclick = async () => {
      const kwInput = panel.querySelector('#sa-kw');
      const ansInput = panel.querySelector('#sa-ans');
      const kws = (kwInput.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const ans = (ansInput.value || '').trim();
      if (!kws.length || !ans) { alert('Both keywords and answer are required.'); return; }
      _customAnswers.push({ keywords: kws, response: ans, createdAt: Date.now() });
      await saveCustomAnswers();
      kwInput.value = ''; ansInput.value = '';
      renderList();
    };

    function renderList() {
      const list = panel.querySelector('#sa-list');
      if (!_customAnswers.length) { list.innerHTML = '<div class="empty">No custom answers yet. Add one above.</div>'; return; }
      list.innerHTML = `<div class="count">${_customAnswers.length} custom answer${_customAnswers.length === 1 ? '' : 's'}</div>` +
        _customAnswers.map((e, i) => `
          <div class="item">
            <button class="del" data-i="${i}" type="button">Delete</button>
            <div class="kw">${e.keywords.map(k => escapeHtml(k)).join(', ')}</div>
            <div class="ans">${escapeHtml(e.response)}</div>
          </div>
        `).join('');
      list.querySelectorAll('.del').forEach(btn => {
        btn.onclick = async () => {
          const i = parseInt(btn.dataset.i);
          _customAnswers.splice(i, 1);
          await saveCustomAnswers();
          renderList();
        };
      });
    }
    function escapeHtml(s) { return (s + '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  }

  // ===================== INIT =====================
  async function init() {
    if (window.self !== window.top) return;

    const ats = detectATS();
    if (!ats) return;
    if (!(await isAutofillEnabled())) { LOG('Autofill disabled by user — standing down'); return; }
    if (isAuthOrNonApplicationPage()) { LOG('ATS domain but non-application page — standing down'); return; }

    await loadCustomAnswers();

    // Workday forms load behind Apply. Elsewhere, a job page with no form gets one
    // Apply click, and a page that already shows a form is left where it is.
    const isWdJob = ats === 'Workday' && /\/job\/|\/details\/|\/apply(\/|$)/i.test(location.pathname);
    if (!isWdJob && !hasApplicationForm()) {
      await sleep(1500);
      if (!hasApplicationForm()) {
        await genericApplyClick(3000);
        const appeared = await waitFor(() => (hasApplicationForm() ? document.body : null), 6000);
        if (!appeared) { LOG(`ATS ${ats} detected but no application form — standing down`); return; }
      }
    }

    LOG(`ATS application page confirmed: ${ats}`);
    dismissCookieBanners();
    setTimeout(injectCustomAnswersPanel, 1200);

    if (ats === 'Workday') await runWorkdayFlow();
    else await runGenericATSFlow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
