/* autofill-coordinator.js — lets LazyApply, Jobright, OptimHire and Job Genie
   fill the same application form without fighting.

   The SAME file is shipped in all four extensions and loaded as each one's
   first content script (document_start, every frame). Every extension's
   content scripts run in their own "isolated world" with their own copy of the
   DOM prototypes, so the wrappers below only change how THAT extension writes
   to the page. The page itself and the other extensions are untouched. The four
   copies talk to each other only through attributes on the page's elements and
   a window event, which every world can see.

   What it does
   1. Turn-taking ("lease"). Only one extension acts on a page at a time. The
      holder keeps the turn for LEASE_MS after its last action. While another
      extension holds it, a write to an EMPTY field is queued and applied once
      the turn is free (only if the field is still empty); scrolling, focus,
      typing commands and clicks on form controls are skipped. No two tools
      scroll the page or move the focus against each other, so there is no
      flicker and no up-down-up-down scrolling.
   2. LazyApply leads. It can always act and its answers win. While it is busy
      (acted in the last LEADER_IDLE_MS; LEADER_RUN_IDLE_MS during a run) the
      others wait; when it goes quiet they fill only the fields it left empty.
      A LazyApply run is started from the lazyapply.com dashboard and works in
      its automation tab(s); its background script injects this file there
      together with the application script. While that run's "Automation In
      Progress" panel (#autoFillTemplate) is up, Next / Submit / Apply clicks
      are left to LazyApply alone.
   3. No overwriting. Once a field is answered by one tool (or by you), the
      others leave it alone (LazyApply excepted). Fields are tagged
      data-afc-by="<tool>".
   4. Job Genie's tailored CV. Job Genie may attach its tailored resume at any
      time, also over a resume another tool attached, and nobody replaces it
      afterwards (TAILORED_RESUME_WINS). Tailoring itself is never blocked.
   5. Consistent answers. Each short answer is shared on the page and saved by
      every extension (chrome.storage.local "afc_bank"). When a tool is about
      to type an answer to a question that a higher-ranked source has already
      answered (you > LazyApply > Jobright > OptimHire > Job Genie), it types
      that answer instead. Free-text / company-specific questions are excluded.
   6. Less jitter for everyone: scrollIntoView on an element that is already
      fully on screen is skipped.

   Debug: in the page's DevTools console, localStorage.afc_debug = '1', reload.
*/
(() => {
  'use strict';
  const G = globalThis;
  if (G.__afcCoordinator) return;
  G.__afcCoordinator = true;
  if (typeof Element === 'undefined' || typeof document === 'undefined') return;

  /* ---------------- settings ---------------- */
  const LEADER = 'lazyapply';
  const RANK = { you: 5, lazyapply: 4, jobright: 3, optimhire: 2, jobgenie: 1, other: 0 };
  const TAILORED_RESUME_WINS = true;
  const LEASE_MS = 2500;
  const LEADER_IDLE_MS = 4000;      // LazyApply quiet this long → others may fill what it left empty
  const LEADER_RUN_IDLE_MS = 12000; // …but during a LazyApply run (it waits on AI answers / uploads)
  const BANK_KEY = 'afc_bank';
  const BANK_MAX = 3000;

  let mName = '';
  try { mName = chrome.runtime.getManifest().name || ''; } catch (_) {}
  const ME = /lazy\s*apply/i.test(mName) ? 'lazyapply'
    : /jobright/i.test(mName) ? 'jobright'
    : /optim\s*hire/i.test(mName) ? 'optimhire'
    : /job\s*genie/i.test(mName) ? 'jobgenie' : 'other';
  const IS_LEADER = ME === LEADER;

  let DEBUG = false;
  try { DEBUG = G.localStorage && G.localStorage.getItem('afc_debug') === '1'; } catch (_) {}
  const log = (...a) => { if (DEBUG) try { console.debug('[AFC:' + ME + ']', ...a); } catch (_) {} };

  /* ---------------- originals ---------------- */
  const desc = (p, k) => { try { return Object.getOwnPropertyDescriptor(p, k); } catch (_) { return null; } };
  const oGetAttr = Element.prototype.getAttribute;
  const oSetAttr = Element.prototype.setAttribute;
  const oDispatch = EventTarget.prototype.dispatchEvent;
  const oClosest = Element.prototype.closest;
  const oMatches = Element.prototype.matches;
  const oRects = Element.prototype.getBoundingClientRect;
  const de = () => document.documentElement;
  const now = () => Date.now();
  const gA = (el, k) => { try { return oGetAttr.call(el, k); } catch (_) { return null; } };
  const sA = (el, k, v) => { try { oSetAttr.call(el, k, v); } catch (_) {} };
  let bypass = 0; // >0 while the coordinator itself is writing

  /* ---------------- own UI (never coordinated) ---------------- */
  const MINE = new WeakSet();
  (function trackOwnNodes() {
    for (const k of ['createElement', 'createElementNS']) {
      const o = Document.prototype[k];
      if (typeof o !== 'function') continue;
      Document.prototype[k] = function () { const el = o.apply(this, arguments); try { MINE.add(el); } catch (_) {} return el; };
    }
    const oShadow = Element.prototype.attachShadow;
    if (oShadow) Element.prototype.attachShadow = function () { const r = oShadow.apply(this, arguments); try { MINE.add(r); MINE.add(this); } catch (_) {} return r; };
    const ih = desc(Element.prototype, 'innerHTML');
    if (ih && ih.set) Object.defineProperty(Element.prototype, 'innerHTML', Object.assign({}, ih, {
      set(v) { ih.set.call(this, v); try { if (isOwn(this)) for (const c of this.children) MINE.add(c); } catch (_) {} },
    }));
    const oIAH = Element.prototype.insertAdjacentHTML;
    if (oIAH) Element.prototype.insertAdjacentHTML = function (pos, html) {
      const outside = /^(beforebegin|afterend)$/i.test(pos);
      const host = outside ? this.parentElement : this;
      const before = host ? new Set(host.children) : null;
      const r = oIAH.apply(this, arguments);
      try { if (host) for (const c of host.children) if (!before.has(c)) MINE.add(c); } catch (_) {}
      return r;
    };
  })();
  const FOREIGN_UI = '[id^="ua-"],[id^="optimhire"],plasmo-csui,[class*="lazyapply"],[id*="lazyapply"],[id^="jg-"],[id*="job-genie" i],[class*="job-genie" i],[id^="afc-"],#autoFillTemplate';
  function isOwn(el) {
    let n = el, i = 0;
    while (n && i++ < 80) {
      if (MINE.has(n)) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  }
  function exempt(el) {
    if (!el || el.nodeType !== 1) return true;
    if (isOwn(el)) return true;
    try { if (oClosest.call(el, FOREIGN_UI)) return true; } catch (_) {}
    return false;
  }

  /* ---------------- lease / turn-taking ---------------- */
  function holder() {
    const r = de() && gA(de(), 'data-afc-lease');
    if (!r) return null;
    const [who, exp] = r.split('|');
    return Number(exp) > now() ? who : null;
  }
  function touch() {
    const d = de(); if (!d) return;
    sA(d, 'data-afc-lease', ME + '|' + (now() + LEASE_MS));
    sA(d, 'data-afc-last-' + ME, String(now()));
  }
  function leaderBusy() {
    if (IS_LEADER) return false;
    const t = Number(de() && gA(de(), 'data-afc-last-' + LEADER)) || 0;
    if (!t) return false;
    return now() - t < (leaderRunning() ? LEADER_RUN_IDLE_MS : LEADER_IDLE_MS);
  }
  let panelAt = 0, panelSeen = false;
  function leaderRunning() {               // LazyApply's "Automation In Progress" panel is up
    if (IS_LEADER) return false;
    if (now() - panelAt < 1000) return panelSeen;
    panelAt = now(); panelSeen = false;
    try {
      const host = document.getElementById('autoFillTemplate');
      if (host && host.getClientRects().length) { panelSeen = true; return true; }
      const r = document.evaluate("//*[contains(normalize-space(text()),'Automation In Progress')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < r.snapshotLength; i++) { const e = r.snapshotItem(i); if (e.getClientRects().length) { panelSeen = true; break; } }
    } catch (_) {}
    return panelSeen;
  }
  function othersTurn() {                  // somebody else is acting right now
    const h = holder();
    if (h && h !== ME && !IS_LEADER) return true;
    return leaderBusy();
  }
  function mayAct(kind) {                  // ask for the turn; takes it when granted
    if (IS_LEADER) { touch(); return true; }
    if (othersTurn()) return false;
    if (kind === 'nav' && leaderRunning()) return false;
    touch();
    return true;
  }

  /* ---------------- field helpers ---------------- */
  const vDesc = {
    input: desc(HTMLInputElement.prototype, 'value'),
    textarea: desc(HTMLTextAreaElement.prototype, 'value'),
    select: desc(HTMLSelectElement.prototype, 'value'),
  };
  const checkedDesc = desc(HTMLInputElement.prototype, 'checked');
  const filesDesc = desc(HTMLInputElement.prototype, 'files');
  const getVal = (el) => {
    try {
      if (el instanceof HTMLInputElement) return vDesc.input.get.call(el);
      if (el instanceof HTMLTextAreaElement) return vDesc.textarea.get.call(el);
      if (el instanceof HTMLSelectElement) return vDesc.select.get.call(el);
    } catch (_) {}
    return '';
  };
  const typeOf = (el) => (el instanceof HTMLInputElement ? (gA(el, 'type') || 'text').toLowerCase() : el.tagName.toLowerCase());
  const SKIP_TYPES = /^(hidden|password|submit|button|reset|image)$/;
  function radioGroup(el) {
    const name = el.name;
    if (!name) return [el];
    const scope = el.form || el.getRootNode() || document;
    try { return Array.from(scope.querySelectorAll('input[type="radio"]')).filter((r) => r.name === name); } catch (_) { return [el]; }
  }
  function claimOf(el) {
    const t = typeOf(el);
    if (t === 'radio') { for (const r of radioGroup(el)) { const c = gA(r, 'data-afc-by'); if (c) return c; } return null; }
    return gA(el, 'data-afc-by');
  }
  function isEmpty(el) {
    const t = typeOf(el);
    if (t === 'radio') return !radioGroup(el).some((r) => checkedDesc.get.call(r));
    if (t === 'checkbox') return !gA(el, 'data-afc-by');
    if (t === 'file') { try { const f = filesDesc.get.call(el); return !f || !f.length; } catch (_) { return true; } }
    if (el instanceof HTMLSelectElement) {
      const v = getVal(el); if (!v) return true;
      const o = el.options[el.selectedIndex];
      return !!o && el.selectedIndex === 0 && /^\s*(select|choose|please|--|—|-)/i.test(o.text || '');
    }
    return !String(getVal(el) || '').trim();
  }
  function claim(el, who) {
    if (typeOf(el) === 'radio') { for (const r of radioGroup(el)) sA(r, 'data-afc-by', who); return; }
    sA(el, 'data-afc-by', who);
  }
  const isResume = (el) => /resume|cv\b|curriculum/i.test([el.name, el.id, gA(el, 'aria-label'), labelOf(el, true)].join(' '));

  /* ---------------- labels / answer bank ---------------- */
  const norm = (s) => String(s || '').toLowerCase().replace(/\*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
  function labelOf(el, raw) {
    let t = '';
    try {
      t = gA(el, 'aria-label') || '';
      if (!t && el.labels && el.labels.length) t = el.labels[0].innerText;
      if (!t) {
        const ids = gA(el, 'aria-labelledby');
        if (ids) t = ids.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.innerText : ''; }).join(' ');
      }
      if (!t && typeOf(el) === 'radio') { const fs = oClosest.call(el, 'fieldset'); const lg = fs && fs.querySelector('legend'); if (lg) t = lg.innerText; }
      if (!t) {
        const box = oClosest.call(el, '[class*="field" i],[class*="question" i],[class*="form-group" i],li,div');
        // only when that box holds this one field, so no other field's label is borrowed
        const l = box && box.querySelectorAll('input:not([type=hidden]),select,textarea').length === 1 && box.querySelector('label,legend,[class*="label" i]');
        if (l && !l.contains(el)) t = l.innerText;
      }
      if (!t) t = gA(el, 'placeholder') || el.name || el.id || '';
    } catch (_) {}
    return raw ? t : norm(t);
  }
  const NO_SHARE = /\b(why|describe|tell us|cover letter|explain|additional|anything else|message|comment|summary|motivat|about yourself|interest|captcha|password|otp|verification|code|signature|today|date signed|sign)\b/;
  function shareable(el, key, val) {
    if (!key || key.length < 3 || NO_SHARE.test(key)) return false;
    const t = typeOf(el);
    if (SKIP_TYPES.test(t) || t === 'file' || t === 'checkbox' || t === 'radio' || el instanceof HTMLTextAreaElement) return false;
    const v = String(val || '').trim();
    return v.length > 0 && v.length <= 120;
  }
  const bank = new Map();
  let bankDirty = false, bankTimer = 0;
  try {
    chrome.storage.local.get(BANK_KEY, (d) => {
      void chrome.runtime.lastError;
      const o = d && d[BANK_KEY];
      if (o && typeof o === 'object') for (const k in o) if (!bank.has(k)) bank.set(k, o[k]);
    });
  } catch (_) {}
  function saveBank() {
    if (!bankDirty) return;
    bankDirty = false;
    try {
      const entries = Array.from(bank.entries()).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, BANK_MAX);
      chrome.storage.local.set({ [BANK_KEY]: Object.fromEntries(entries) }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }
  function remember(key, v, by) {
    if (!key || !v) return;
    const e = bank.get(key);
    if (e && e.v === v && e.by === by) return;
    if (e && (RANK[by] || 0) < (RANK[e.by] || 0)) return;
    bank.set(key, { v, by, t: now() });
    bankDirty = true;
    clearTimeout(bankTimer); bankTimer = setTimeout(saveBank, 1500);
  }
  function answerText(el) {
    if (el instanceof HTMLSelectElement) { const o = el.options[el.selectedIndex]; return o ? (o.text || '').trim() : ''; }
    return String(getVal(el) || '').trim();
  }
  const pubTimers = new WeakMap();
  function publishLater(el, by) {
    clearTimeout(pubTimers.get(el));
    pubTimers.set(el, setTimeout(() => {
      const key = labelOf(el), v = answerText(el);
      if (!shareable(el, key, v)) return;
      remember(key, v, by);
      // payload on the page element (readable from every extension's world), then a bare event
      try { bypass++; sA(de(), 'data-afc-msg', JSON.stringify({ key, v, by })); oDispatch.call(window, new Event('afc:answer')); } catch (_) {} finally { bypass--; }
    }, 700));
  }
  window.addEventListener('afc:answer', (e) => {
    try { const d = JSON.parse(gA(de(), 'data-afc-msg')); if (d && d.by !== ME) remember(d.key, d.v, d.by); } catch (_) {}
  });
  // Your own edits are the best answers of all.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!e.isTrusted || !el || el.nodeType !== 1 || exempt(el)) return;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (SKIP_TYPES.test(typeOf(el))) return;
    if (!claimOf(el)) claim(el, 'you');
    const key = labelOf(el), v = answerText(el);
    if (shareable(el, key, v)) remember(key, v, 'you');
  }, true);

  function consistent(el, v) {
    if (IS_LEADER || v == null || v === '') return v;
    const t = typeOf(el);
    if (SKIP_TYPES.test(t) || t === 'file' || t === 'checkbox' || t === 'radio' || el instanceof HTMLTextAreaElement) return v;
    const key = labelOf(el);
    if (!key || NO_SHARE.test(key)) return v;
    const e = bank.get(key);
    if (!e || (RANK[e.by] || 0) <= (RANK[ME] || 0)) return v;
    if (el instanceof HTMLSelectElement) {
      const want = norm(e.v);
      for (const o of el.options) if (norm(o.text) === want || norm(o.value) === want) { if (o.value !== v) log('consistent', key, '→', e.v, '(from', e.by + ')'); return o.value; }
      return v;
    }
    if (/^(text|email|tel|number|url|search)$/.test(t) && String(v) !== e.v) { log('consistent', key, '→', e.v, '(from', e.by + ')'); return e.v; }
    return v;
  }

  /* ---------------- deferred writes ---------------- */
  const queue = new Map(); // field -> {apply}
  let flushTimer = 0;
  function defer(field, apply) {
    queue.set(field, apply);
    if (!flushTimer) flushTimer = setInterval(flush, 700);
  }
  function fire(el, types) { for (const t of types) try { bypass++; oDispatch.call(el, new Event(t, { bubbles: true })); } catch (_) {} finally { bypass--; } }
  function flush() {
    if (!queue.size) { clearInterval(flushTimer); flushTimer = 0; return; }
    if (othersTurn()) return;
    let n = 0;
    for (const [field, apply] of queue) {
      queue.delete(field);
      if (!field.isConnected || !isEmpty(field)) continue;
      const c = claimOf(field);
      if (c && c !== ME) continue;
      touch();
      try { bypass++; apply(); } catch (_) {} finally { bypass--; }
      claim(field, ME);
      fire(field, ['input', 'change']);
      publishLater(field, ME);
      if (++n >= 40) break;
    }
    if (n) log('filled', n, 'field(s) the others left empty');
  }

  /* ---------------- the write gate ---------------- */
  // returns {ok, v} — ok=false means "do not write now"
  function gate(el, prop, v) {
    if (bypass || exempt(el)) return { ok: true, v };
    const field = el instanceof HTMLOptionElement ? (el.parentElement && oClosest.call(el, 'select')) : el;
    if (!field || exempt(field)) return { ok: true, v };
    const t = typeOf(field);
    if (field instanceof HTMLInputElement && SKIP_TYPES.test(t)) return { ok: true, v };

    if (prop === 'value' && String(v) === String(getVal(field))) return { ok: true, v };
    if (prop === 'checked' && el === field && !!v === !!checkedDesc.get.call(field)) return { ok: true, v };
    const c = claimOf(field);

    if (prop === 'files') {
      const resume = TAILORED_RESUME_WINS && isResume(field);
      if (resume && ME === 'jobgenie') { claim(field, ME); log('tailored resume attached'); return { ok: true, v }; }
      if (resume && c === 'jobgenie') { log('kept Job Genie\'s tailored resume'); return { ok: false }; }
    }
    const empty = isEmpty(field);
    if (!IS_LEADER && c && c !== ME && !empty) { log('left alone (answered by ' + c + '):', labelOf(field)); return { ok: false }; }
    if (!mayAct('write')) {
      if (empty && prop !== 'files') return { ok: false, defer: true, field };
      return { ok: false };
    }
    if (prop === 'value') v = consistent(field, v);
    if (!(prop === 'value' && (v === '' || v == null))) claim(field, ME);
    publishLater(field, ME);
    return { ok: true, v };
  }

  function wrapSetter(proto, prop) {
    const d = desc(proto, prop);
    if (!d || !d.set || d.set.__afc) return;
    const set = function (v) {
      const g = gate(this, prop, v);
      if (g.ok) return d.set.call(this, g.v);
      if (g.defer) { const el = this; defer(g.field, () => d.set.call(el, prop === 'value' ? consistent(g.field, v) : v)); }
    };
    set.__afc = true;
    Object.defineProperty(proto, prop, Object.assign({}, d, { set }));
  }
  wrapSetter(HTMLInputElement.prototype, 'value');
  wrapSetter(HTMLInputElement.prototype, 'checked');
  wrapSetter(HTMLInputElement.prototype, 'files');
  wrapSetter(HTMLTextAreaElement.prototype, 'value');
  wrapSetter(HTMLSelectElement.prototype, 'value');
  wrapSetter(HTMLSelectElement.prototype, 'selectedIndex');
  wrapSetter(HTMLOptionElement.prototype, 'selected');

  /* ---------------- clicks / synthetic events ---------------- */
  const NAV_TXT = /^\s*(next|continue|submit|apply|review|save( and|&)? continue|send|proceed|finish|done)\b/i;
  const FIELD_SEL = 'input,select,textarea,option,[role="option"],[role="radio"],[role="checkbox"],[role="combobox"],[role="listbox"],[role="menuitem"],[role="switch"],[role="menuitemradio"]';
  function classify(el) {
    if (!el || el.nodeType !== 1 || exempt(el)) return null;
    try {
      if (el instanceof HTMLInputElement && /^(submit|button|image)$/i.test(el.type)) return NAV_TXT.test(el.value || '') ? 'nav' : null;
      if (oMatches.call(el, FIELD_SEL) || oClosest.call(el, '[role="listbox"],[role="option"],[role="radiogroup"]')) return 'field';
      const b = oClosest.call(el, 'button,a,[role="button"]');
      if (b && NAV_TXT.test((b.innerText || b.getAttribute('aria-label') || '').slice(0, 60))) return 'nav';
    } catch (_) {}
    return null;
  }
  function clickAllowed(el) {
    if (bypass) return true;
    const k = classify(el);
    if (!k) return true;
    if (k === 'field' && el instanceof HTMLInputElement && /^(radio|checkbox)$/i.test(el.type)) {
      const c = claimOf(el);
      if (!IS_LEADER && c && c !== ME) { log('left alone (answered by ' + c + '):', labelOf(el)); return false; }
      if (!mayAct('write')) return false;
      claim(el, ME);
      return true;
    }
    return mayAct(k);
  }
  const oClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () { if (clickAllowed(this)) return oClick.apply(this, arguments); };
  const INTERACT = /^(click|dblclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|keydown|keypress|keyup)$/;
  EventTarget.prototype.dispatchEvent = function (ev) {
    try {
      if (!bypass && ev && INTERACT.test(ev.type) && this && this.nodeType === 1) {
        const k = classify(this);
        if (k && !(k === 'nav' ? mayAct('nav') : mayAct('write'))) return false;
      }
    } catch (_) {}
    return oDispatch.apply(this, arguments);
  };
  const oExec = Document.prototype.execCommand;
  if (oExec) Document.prototype.execCommand = function (cmd) {
    try {
      if (!bypass && /^(inserttext|inserthtml|delete|forwarddelete|selectall|paste|cut)$/i.test(cmd)) {
        const a = this.activeElement;
        if (a && !exempt(a)) {
          const c = claimOf(a);
          if (!IS_LEADER && c && c !== ME && !isEmpty(a)) return false;
          if (!mayAct('write')) return false;
          if (/^insert/i.test(cmd)) { claim(a, ME); publishLater(a, ME); }
        }
      }
    } catch (_) {}
    return oExec.apply(this, arguments);
  };

  /* ---------------- focus & scrolling ---------------- */
  const scrollBlocked = (el) => !bypass && !(el && exempt(el)) && othersTurn();
  function onScreen(el) {
    try {
      const r = oRects.call(el);
      const h = window.innerHeight || de().clientHeight, w = window.innerWidth || de().clientWidth;
      return r.height > 0 && r.top >= 0 && r.bottom <= h && r.left >= 0 && r.right <= w;
    } catch (_) { return false; }
  }
  const oFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    if (scrollBlocked(this)) return;
    return oFocus.apply(this, arguments);
  };
  for (const k of ['scrollIntoView', 'scrollIntoViewIfNeeded']) {
    const o = Element.prototype[k];
    if (typeof o !== 'function') continue;
    Element.prototype[k] = function () {
      if (scrollBlocked(this)) return;
      if (!exempt(this) && onScreen(this)) return; // already visible: don't jiggle the page
      return o.apply(this, arguments);
    };
  }
  for (const k of ['scrollTo', 'scroll', 'scrollBy']) {
    const ow = window[k];
    if (typeof ow === 'function') window[k] = function () { if (scrollBlocked(null)) return; return ow.apply(window, arguments); };
    const oe = Element.prototype[k];
    if (typeof oe === 'function') Element.prototype[k] = function () { if (scrollBlocked(this)) return; return oe.apply(this, arguments); };
  }
  const st = desc(Element.prototype, 'scrollTop');
  if (st && st.set) Object.defineProperty(Element.prototype, 'scrollTop', Object.assign({}, st, {
    set(v) { if (scrollBlocked(this)) return; st.set.call(this, v); },
  }));

  G.__afc = { me: ME, holder, leaderBusy, bank, queue };
  log('ready in', location.host || location.href);
})();
