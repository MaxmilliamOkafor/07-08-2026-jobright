// === ULTIMATE AUTOFILL ENHANCEMENT v14.0.0 (Jobright v1.19.0 — FULL AUTO / CSV QUEUE) ===
// Built: 2026-08-06. Base: official Jobright Autofill 1.19.0 (newest patch, 2026-08-03).
// v14.0.0: the bulk-apply run is orchestrated by the background service worker
// (ua-orchestrator.js) instead of the side-panel document, so closing the panel no
// longer kills a run. Each job tab PULLS its assignment by tab id (UA_MGR_WHOAMI),
// which is immune to the Jobright→ATS redirect timing that used to lose jobs, and
// reports its terminal status over runtime messaging as well as storage.
// Ultimate Edition: AI-level knockout intelligence, 500+ pre-seeded ATS responses,
// STAR-format behavioral answers, resume keyword optimizer, smart cover-letter generator,
// 150+ ATS platforms (Paradox/Olivia, Phenom chatbot, Beamery, HireVue chat, ModernHire),
// Shadow DOM + iframe traversal, synonym-aware field matching, interview-boost scoring.
// Core: Accuracy-first deliberate pacing, verification passes, freeze-proof error handling.
// v13.0.0 FULL-AUTO: zero-supervision queue — robust Google-Places/typeahead location
// committer + required-field guarantor sweep so the queue never stalls waiting for a human.
// CSV upload -> import job URLs -> auto-apply each with Jobright autofill (LazyApply-style queue).
/* ════════════════════════════════════════════════════════════════════════════
   MASTER AUTOMATION GATE  —  installed before every other module in this file.

   The "Fully Automated" toggle used to gate only the main dispatcher. Around a
   dozen independent modules further down this file (the autofill-confirm
   auto-dismisser, the chatbot answerer, the work-authorisation auto-answerer,
   the AI answer generator, …) live in their own IIFEs, cannot see the toggle's
   variable, and acted on any page that merely looked like a job application.
   That is why the extension "started firing" on a recognised ATS with the
   toggle OFF, and why autofill ran without anyone pressing Autofill.

   Everything autonomous now asks this one question first. Three ways to say yes:
     • the Fully Automated toggle is ON, or
     • this tab is the in-page queue runner, or
     • this tab is running a job for the CSV Queue Manager.

   It is FAIL-CLOSED: until chrome.storage has actually been read, the answer is
   NO. A module that boots at document_start therefore cannot act during the gap
   before the preference is known — previously that gap was wide open.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__uaAutoAllowed) return;

  let ready = false;          // has storage been read at least once?
  let toggleOn = false;       // ua_aa  — the Fully Automated preference
  let queueRunning = false;   // ua_qa  — the in-page single-tab runner

  const RUNNER_PREFIX = 'UAQRUN::';
  let runnerTabId = null;     // ua_runner_tab — which tab is driving the run
  let myTab = null;           // this tab's id, as the service worker sees it
  /* window.name is the only per-tab scratch space a content script has, and
     Chrome CLEARS it on every cross-SITE navigation. A CSV run walks ONE tab
     across greenhouse.io, lever.co, smartrecruiters.com… so the marker was gone
     from the first cross-site job — and this gate then answered "toggle OFF",
     which forbade the run from doing anything at all on that page. The tab id
     does not change, so it is the evidence that survives.

     Still fail-closed: if neither piece of evidence is available, the gate stays
     shut exactly as before. */
  function isRunnerTab() {
    try { if (typeof window.name === 'string' && window.name.indexOf(RUNNER_PREFIX) === 0) return true; } catch (_) {}
    return myTab != null && runnerTabId != null && myTab === runnerTabId;
  }
  // Set by the content script for the lifetime of a Queue-Manager-driven job.
  function managedJobActive() {
    try { return document.documentElement.getAttribute('data-ua-auto') === '1'; }
    catch (_) { return false; }
  }

  window.__uaAutoAllowed = function () {
    if (managedJobActive()) return true;          // a queued job owns this tab
    if (!ready) return false;                     // preference not known yet → do nothing
    if (toggleOn) return true;
    return queueRunning && isRunnerTab();
  };
  // For UI/diagnostics: why did the gate answer the way it did?
  window.__uaAutoReason = function () {
    if (managedJobActive()) return 'queue job';
    if (!ready) return 'preference not loaded';
    if (toggleOn) return 'toggle ON';
    if (queueRunning && isRunnerTab()) return 'queue runner tab';
    return 'toggle OFF';
  };

  try {
    chrome.storage.local.get(['ua_aa', 'ua_qa', 'ua_runner_tab'], (d) => {
      void chrome.runtime.lastError;
      toggleOn = (d && d.ua_aa) === true;
      queueRunning = (d && d.ua_qa) === true;
      runnerTabId = (d && typeof d.ua_runner_tab === 'number') ? d.ua_runner_tab : null;
      ready = true;
    });
    /* Which tab is this? Only the service worker can say, and its answer is not
       affected by navigation. Isolated in its own try: this is a nice-to-have,
       and it must never be able to prevent the storage listener below from being
       registered — without that listener the gate stops noticing the toggle. */
    try {
      chrome.runtime.sendMessage({ type: 'UA_WHICH_TAB' }, (r) => {
        void chrome.runtime.lastError;
        if (r && typeof r.tabId === 'number') myTab = r.tabId;
      });
    } catch (_) {}
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.ua_aa) { toggleOn = changes.ua_aa.newValue === true; ready = true; }
      if (changes.ua_qa) queueRunning = changes.ua_qa.newValue === true;
      if (changes.ua_runner_tab) runnerTabId = typeof changes.ua_runner_tab.newValue === 'number' ? changes.ua_runner_tab.newValue : null;
    });
  } catch (_) {
    // No storage access at all → stay fail-closed rather than assuming ON.
  }
})();

(function () {
  'use strict';
  // The orchestrator injects this file into every frame of a job tab (see
  // ua-orchestrator.js). The top frame already has it from the manifest, so
  // without this guard the module would initialise twice there.
  if (window.__uaEnhancementLoaded) return;
  window.__uaEnhancementLoaded = true;

  // ===================== TEMP IN-DEPTH DEBUG LOGGER (toggle with Alt+D) =====================
  // A deep instrumentation layer that records, on the live ATS page, without DevTools:
  //   • every console.* call (incl. [UA] logs)      • clicks (real + programmatic)
  //   • input / change / focus on form fields        • form submits
  //   • network (fetch + XHR: method, status, ms)    • navigation (pushState/url changes)
  //   • validation / error nodes appearing in the DOM (e.g. Workday "Set a password")
  //   • uncaught errors + unhandled promise rejections
  // Passwords are masked (length only). Read-only + self-contained — delete this block
  // and the _dbgInstall() call to remove the debugger entirely.
  const _dbgBuf = [];
  let _dbgOn = false;
  const DBG_CAP = 3000;
  function _dbgFmt(a) { try { return typeof a === 'string' ? a : (a instanceof Error ? (a.message + '\n' + (a.stack || '')) : JSON.stringify(a)); } catch (_) { return String(a); } }
  function _dbgShort(u) { try { u = String(u); if (u.length > 140) { const q = u.indexOf('?'); return (q > 0 ? u.slice(0, q) : u.slice(0, 140)) + '…'; } return u; } catch (_) { return String(u); } }
  function _dbgSel(el) {
    try {
      if (!el || !el.tagName) return String(el);
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      const aid = el.getAttribute && el.getAttribute('data-automation-id');
      if (aid) s += '[aid=' + aid + ']';
      else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/)[0];
      if (el.type) s += '{' + el.type + '}';
      return s;
    } catch (_) { return '?'; }
  }
  function _dbgDesc(el) { try { const t = (el && el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48); return _dbgSel(el) + (t ? ' "' + t + '"' : ''); } catch (_) { return _dbgSel(el); } }
  function _dbgField(el) {
    try {
      const lbl = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name)) || '';
      let v;
      if (el.type === 'password') v = '•••(' + (el.value ? el.value.length : 0) + ' chars)';
      else if (el.type === 'checkbox' || el.type === 'radio') v = el.checked ? 'CHECKED' : 'unchecked';
      else v = JSON.stringify(String(el.value != null ? el.value : '').slice(0, 64));
      const inv = (el.getAttribute && el.getAttribute('aria-invalid') === 'true') ? ' aria-invalid!' : '';
      return _dbgSel(el) + (lbl ? ' [' + lbl + ']' : '') + ' = ' + v + inv;
    } catch (_) { return _dbgSel(el); }
  }
  function _dbgPush(level, args) {
    try {
      const line = `[${new Date().toLocaleTimeString()}] ${level ? level + ' ' : ''}${args.map(_dbgFmt).join(' ')}`;
      _dbgBuf.push(line);
      if (_dbgBuf.length > DBG_CAP) _dbgBuf.shift();
      if (_dbgOn) _dbgRender();
    } catch (_) {}
  }
  // Install the deep hooks ONCE. Capturing runs even while the panel is hidden so the
  // exported log is always complete; rendering only happens when the panel is open.
  let _dbgInstalled = false;
  function _dbgInstall() {
    if (_dbgInstalled) return; _dbgInstalled = true;
    try {
      // 1) console.* — captures [UA] logs and the page's own console output.
      ['log', 'info', 'warn', 'error', 'debug'].forEach((m) => {
        const orig = console[m];
        if (typeof orig !== 'function') return;
        console[m] = function (...a) { try { _dbgPush(m === 'log' ? '' : m.toUpperCase(), a); } catch (_) {} return orig.apply(this, a); };
      });
      // 2) Clicks (capture phase) — includes our own programmatic .click()/dispatch.
      document.addEventListener('click', (e) => { try { _dbgPush('CLICK', [_dbgDesc(e.target)]); } catch (_) {} }, true);
      // 3) Field activity — input / change / focus / submit.
      const isDbgNode = (el) => { try { return !!(el && el.closest && el.closest('#ua-debug-box')); } catch (_) { return false; } };
      document.addEventListener('input', (e) => { const el = e.target; if (!el || !el.tagName || isDbgNode(el)) return; if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) _dbgPush('INPUT', [_dbgField(el)]); }, true);
      document.addEventListener('change', (e) => { const el = e.target; if (!el || !el.tagName || isDbgNode(el)) return; if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) _dbgPush('CHANGE', [_dbgField(el)]); }, true);
      document.addEventListener('focusin', (e) => { const el = e.target; if (!el || !el.tagName || isDbgNode(el)) return; if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) _dbgPush('FOCUS', [_dbgSel(el)]); }, true);
      document.addEventListener('submit', (e) => { try { _dbgPush('SUBMIT', [_dbgSel(e.target)]); } catch (_) {} }, true);
      // 4) Network — fetch (wrap before the credit-unlock patch wraps it again).
      try {
        const of = window.fetch;
        if (of) window.fetch = function (...a) {
          const url = (a[0] && a[0].url) || a[0]; const method = ((a[1] && a[1].method) || (a[0] && a[0].method) || 'GET').toUpperCase(); const t0 = performance.now();
          _dbgPush('NET', ['→ ' + method + ' ' + _dbgShort(url)]);
          return of.apply(this, a).then((r) => { _dbgPush('NET', ['← ' + r.status + ' ' + method + ' ' + _dbgShort(url) + ' (' + ((performance.now() - t0) | 0) + 'ms)']); return r; })
            .catch((e) => { _dbgPush('NET', ['✗ ' + method + ' ' + _dbgShort(url) + ' ' + (e && e.message || e)]); throw e; });
        };
      } catch (_) {}
      // 5) Network — XHR.
      try {
        const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) { this.__uaM = (m || 'GET').toUpperCase(); this.__uaU = u; return xo.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function () { const t0 = performance.now(); try { this.addEventListener('loadend', () => { _dbgPush('NET', ['XHR ' + this.status + ' ' + this.__uaM + ' ' + _dbgShort(this.__uaU) + ' (' + ((performance.now() - t0) | 0) + 'ms)']); }); } catch (_) {} return xs.apply(this, arguments); };
      } catch (_) {}
      // 6) Navigation — SPA route changes (Workday is a SPA).
      try {
        ['pushState', 'replaceState'].forEach((m) => { const o = history[m]; if (o) history[m] = function () { const r = o.apply(this, arguments); _dbgPush('NAV', [m + ' → ' + _dbgShort(location.href)]); return r; }; });
        window.addEventListener('popstate', () => _dbgPush('NAV', ['popstate → ' + _dbgShort(location.href)]));
        window.addEventListener('hashchange', () => _dbgPush('NAV', ['hashchange → ' + _dbgShort(location.href)]));
        let _lu = location.href; setInterval(() => { if (location.href !== _lu) { _dbgPush('NAV', ['url change → ' + _dbgShort(location.href)]); _lu = location.href; } }, 1000);
      } catch (_) {}
      // 7) Validation / error nodes appearing (Workday inline errors, role=alert, etc.).
      try {
        const errSel = '[role="alert"],[data-automation-id*="error" i],[data-automation-id*="Error"],[aria-live="assertive"],.error,.wd-Error,[data-automation-id="errorMessage"]';
        const logErrNode = (n) => { try { const t = (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160); if (t) _dbgPush('VALID', [_dbgSel(n) + ' "' + t + '"']); } catch (_) {} };
        const mo = new MutationObserver((muts) => {
          for (const mu of muts) {
            for (const n of mu.addedNodes) {
              if (n.nodeType !== 1 || isDbgNode(n)) continue;
              try { if (n.matches && n.matches(errSel)) logErrNode(n); else if (n.querySelector) { const e = n.querySelector(errSel); if (e) logErrNode(e); } } catch (_) {}
            }
            if (mu.type === 'attributes' && mu.attributeName === 'aria-invalid' && mu.target.getAttribute('aria-invalid') === 'true' && !isDbgNode(mu.target)) {
              _dbgPush('VALID', ['aria-invalid → ' + _dbgSel(mu.target)]);
            }
          }
        });
        const startMO = () => { try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-invalid'] }); } catch (_) {} };
        if (document.documentElement) startMO(); else document.addEventListener('DOMContentLoaded', startMO);
      } catch (_) {}
      _dbgPush('', ['🟢 In-depth debugger installed — capturing console/clicks/input/network/nav/validation. Alt+D to view.']);
    } catch (_) {}
  }
  function _dbgRender() {
    try {
      let box = document.getElementById('ua-debug-box');
      if (!box) {
        box = document.createElement('div');
        box.id = 'ua-debug-box';
        box.style.cssText = 'position:fixed;left:12px;bottom:12px;width:440px;height:300px;z-index:2147483647;background:rgba(12,12,14,.96);color:#d6f5d6;border:1px solid #2bd66f;border-radius:10px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'cursor:move;padding:6px 10px;background:#15351f;color:#5cf08a;font-weight:600;display:flex;align-items:center;gap:8px;flex:0 0 auto';
        hdr.innerHTML = '<span style="flex:1">⚡ UA Debug (Alt+D)</span><span id="ua-debug-cnt" style="opacity:.7;font-weight:400;font-size:10px">0 lines</span>';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy'; copyBtn.style.cssText = 'background:#2bd66f;color:#063;border:0;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;font-weight:700';
        copyBtn.onclick = () => { try { navigator.clipboard.writeText(_dbgBuf.join('\n')); copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); } catch (_) {} };
        const expBtn = document.createElement('button');
        expBtn.textContent = 'Export'; expBtn.style.cssText = 'background:#2b8cd6;color:#fff;border:0;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;font-weight:700';
        expBtn.onclick = () => { _dbgExport(); expBtn.textContent = 'Saved!'; setTimeout(() => expBtn.textContent = 'Export', 1200); };
        const clrBtn = document.createElement('button');
        clrBtn.textContent = 'Clear'; clrBtn.style.cssText = 'background:#3a3a42;color:#eee;border:0;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer';
        clrBtn.onclick = () => { _dbgBuf.length = 0; _dbgRender(); };
        hdr.appendChild(copyBtn); hdr.appendChild(expBtn); hdr.appendChild(clrBtn);
        const body = document.createElement('div');
        body.id = 'ua-debug-body';
        body.style.cssText = 'flex:1 1 auto;overflow:auto;padding:6px 10px;white-space:pre-wrap;word-break:break-word';
        box.appendChild(hdr); box.appendChild(body);
        (document.body || document.documentElement).appendChild(box);
        // drag by header
        let sx, sy, ox, oy, drag = false;
        hdr.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; const r = box.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); });
        window.addEventListener('mousemove', (e) => { if (!drag) return; box.style.left = (ox + e.clientX - sx) + 'px'; box.style.top = (oy + e.clientY - sy) + 'px'; box.style.bottom = 'auto'; });
        window.addEventListener('mouseup', () => { drag = false; });
      }
      box.style.display = _dbgOn ? 'flex' : 'none';
      const body = box.querySelector('#ua-debug-body');
      if (body && _dbgOn) {
        const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
        body.textContent = _dbgBuf.slice(-DBG_CAP).join('\n');
        if (atBottom) body.scrollTop = body.scrollHeight;
        const cnt = box.querySelector('#ua-debug-cnt'); if (cnt) cnt.textContent = _dbgBuf.length + ' lines';
      }
    } catch (_) {}
  }
  function _dbgToggle() { _dbgOn = !_dbgOn; if (_dbgOn) _dbgInstall(); _dbgRender(); }
  // Export the captured log to a downloadable .txt file (with a page/URL header).
  function _dbgExport() {
    try {
      const header = `UA Debug Log\nWhen: ${new Date().toISOString()}\nURL:  ${location.href}\nUA:   ${navigator.userAgent}\n${'-'.repeat(60)}\n`;
      const blob = new Blob([header + _dbgBuf.join('\n') + '\n'], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ua-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (_) {} }, 1000);
    } catch (_) {}
  }
  window.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); _dbgToggle(); } }, true);
  // Uncaught errors (window.onerror) — not covered by the console.error hook.
  window.addEventListener('error', (e) => _dbgPush('ERROR', [(e.message || e.type) + ' @ ' + (e.filename || '') + ':' + (e.lineno || '') + (e.error && e.error.stack ? '\n' + e.error.stack : '')]), true);

  // LOG just writes to console with a [UA] tag; the console.* hook in _dbgInstall()
  // captures it into the buffer (so there's no double-logging here).
  const LOG = (...a) => { try { console.log('[UA]', ...a); } catch (_) {} };

  /* Report something to the durable recorder in the service worker. Everything
     a run learns goes through here: outcomes, the stages leading to them, the
     questions we could not answer, and anything that threw.
     Fire-and-forget by design — a diagnostic that can delay or break the thing
     it is diagnosing is worse than no diagnostic. It never records a field's
     VALUE; see the header of ua-diagnostics.js. */
  function DIAG(code, reason, extra) {
    try {
      chrome.runtime.sendMessage({
        type: 'UA_DIAG',
        ev: Object.assign({
          code,
          reason: reason == null ? '' : String(reason),
          ats: (typeof detectATS === 'function' && detectATS()) || 'unknown',
        }, extra || {}),
      }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }
  // Expose manual hooks so you can drive the debugger from the console too.
  try { window.__uaDebug = { show: () => { _dbgInstall(); _dbgOn = true; _dbgRender(); }, hide: () => { _dbgOn = false; _dbgRender(); }, dump: () => _dbgBuf.join('\n'), export: () => _dbgExport(), clear: () => { _dbgBuf.length = 0; _dbgRender(); } }; } catch (_) {}
  // IMPORTANT: the deep instrumentation (wrapping console/fetch/XHR + a document-wide
  // MutationObserver + capture-phase listeners) is EXPENSIVE and must NOT run on every
  // website — doing so was slowing down / crashing unrelated pages. It is installed
  // LAZILY, only when you actually open the debugger (Alt+D / __uaDebug.show()). Until
  // then we only keep the cheap [UA] log buffer + error listeners.

  // ===================== GLOBAL ERROR HANDLER (prevent extension freeze on unhandled rejections) =====================
  /* Anything that throws while a job is being driven. Gated on the automation
     flag so browsing an unrelated site never files a report — most pages throw
     something, and a recorder full of other people's bugs hides ours. */
  const _diagAutomating = () => {
    try { return document.documentElement.getAttribute('data-ua-auto') === '1'; } catch (_) { return false; }
  };
  try {
    window.addEventListener('error', (e) => {
      if (!_diagAutomating()) return;
      const where = e && e.filename ? String(e.filename).split('/').pop() : '';
      DIAG('page.error', (e && e.message) || 'script error', { detail: { at: where, line: e && e.lineno } });
    }, true);
  } catch (_) {}

  window.addEventListener('unhandledrejection', (event) => {
    if (_diagAutomating()) {
      try { DIAG('page.reject', event.reason?.message || String(event.reason || '')); } catch (_) {}
    }
    const msg = event.reason?.message || String(event.reason || '');
    _dbgPush('REJECT', [msg]);
    // Suppress known non-critical extension errors that cause freeze loops
    if (/Could not establish connection|Receiving end does not exist|Extension context invalidated|useOriginalResume|No form fields found/i.test(msg)) {
      event.preventDefault();
      console.warn('[UA] Suppressed unhandled rejection:', msg);
    }
  });

  // ===================== TOGGLE SIDEBAR ON ICON CLICK =====================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && (message.action === 'toggleSidebar' || message.name === 'toggleSidebar')) {
      LOG('Toggle sidebar requested');
      // Find all Plasmo CSUI containers (sidebar shadow roots)
      const containers = [
        ...document.querySelectorAll('plasmo-csui'),
        ...document.querySelectorAll('[id*="plasmo"]'),
        ...document.querySelectorAll('[class*="plasmo"]'),
        ...document.querySelectorAll('[id*="jobright"]'),
        ...document.querySelectorAll('[id*="Jobright"]')
      ];
      // Deduplicate
      const unique = [...new Set(containers)];
      if (unique.length > 0) {
        unique.forEach(el => {
          if (el.style.display === 'none') {
            el.style.display = '';
            LOG('Sidebar shown');
          } else {
            el.style.display = 'none';
            LOG('Sidebar hidden');
          }
        });
      } else {
        LOG('No Plasmo CSUI containers found to toggle');
      }
      sendResponse({ ok: true });
      return true; // keep message channel open for async
    }
  });

  // ===================== CREDIT BYPASS (Jobright + Simplify+ Unlimited) =====================
  const _C = { autofill: 99999, tailorResume: 99999, coverLetter: 99999, resumeReview: 99999, jobMatch: 99999, agentApply: 99999, resumeTailor: 99999, customResume: 99999, aiApply: 99999, smartApply: 99999, quickApply: 99999, bulkApply: 99999, networkScan: 99999, referralRequest: 99999, aiResponse: 99999, essayAnswer: 99999, coins: 99999, tokens: 99999 };
  const _fetch = window.fetch;
  window.fetch = async function () {
    const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0]?.url || '');
    if (/\/swan\/credit\/balance|\/credit\/balance/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: { credit: _C, dailyFill: _C }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/swan\/payment\/subscription|\/payment\/subscription/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: { status: 'ACTIVE', plan: 'turbo_plus', subscriptionId: 'unlimited', tier: 'premium', features: ['unlimited_autofill', 'unlimited_resume', 'unlimited_cover_letter', 'unlimited_ai_response', 'unlimited_network', 'unlimited_referral'] }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/cost-credit/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: false, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/swan\/credit\/free|\/credit\/free/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: { dailyFill: _C, credit: _C }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/payment\/price/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: {}, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/resume.?tailor.*credit|tailor.*credit|resume.*credit|credit.*resume|credit.*tailor|cover.?letter.*credit/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: { credit: 99999, remaining: 99999, limit: 99999, used: 0 }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/usage\/limit|\/rate.?limit|\/quota/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: { remaining: 99999, limit: 99999, used: 0 }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/feature.?flag|\/feature.?gate|\/entitlement/i.test(u))
      return new Response(JSON.stringify({ code: 200, result: { enabled: true, tier: 'premium', plan: 'turbo_plus', simplify_plus: true, unlimited: true }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    // Simplify+ bypass: coin/token balance, subscription, limits
    if (/\/api\/(coins?|tokens?|balance|credits?|subscription|plan|usage|limit)/i.test(u))
      return new Response(JSON.stringify({ coins: 99999, tokens: 99999, balance: 99999, credits: 99999, plan: 'plus', tier: 'premium', status: 'active', unlimited: true, remaining: 99999, limit: 99999, used: 0, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    // Simplify+ bypass: resume generation, cover letter, AI response limits
    if (/\/(generate|create|tailor).*(resume|cover|letter|response|essay|network|referral)/i.test(u)) {
      try {
        const r = await _fetch.apply(window, arguments);
        if (r.status === 402 || r.status === 429 || r.status === 403)
          return new Response(JSON.stringify({ success: true, result: {}, remaining: 99999 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return r;
      } catch (e) { throw e; }
    }
    // Simplify+ bypass: paywall/upgrade prompts
    if (/\/(paywall|upgrade|pricing|checkout|subscribe)/i.test(u))
      return new Response(JSON.stringify({ success: true, bypass: true, plan: 'plus', tier: 'premium' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    // Intercept autofill/fill and fill-v2 POST requests — bypass 403 risk limit
    if (/\/swan\/autofill\/fill(-v2)?(\?|$)/i.test(u)) {
      try {
        const r = await _fetch.apply(window, arguments);
        if (r.status === 402 || r.status === 403 || r.status === 429) {
          LOG('Autofill fill endpoint returned ' + r.status + ' — bypassing with empty result');
          const body = await r.clone().text().catch(() => '{}');
          let parsed = {};
          try { parsed = JSON.parse(body); } catch (_) { }
          return new Response(JSON.stringify({ code: 200, result: parsed.result || {}, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return r;
      } catch (e) { throw e; }
    }
    // Intercept autofill/token endpoint — always return valid token
    if (/\/swan\/autofill\/token/i.test(u)) {
      try {
        const r = await _fetch.apply(window, arguments);
        if (r.status === 402 || r.status === 403 || r.status === 429) {
          return new Response(JSON.stringify({ code: 200, result: { token: 'ua-bypass-token-' + Date.now() }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return r;
      } catch (e) { throw e; }
    }
    // Intercept autofill/config endpoint — ensure config is always returned
    if (/\/swan\/autofill\/config/i.test(u)) {
      try {
        const r = await _fetch.apply(window, arguments);
        if (r.status === 402 || r.status === 403 || r.status === 429) {
          return new Response(JSON.stringify({ code: 200, result: { enabled: true, maxRetries: 99, rateLimit: 99999 }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return r;
      } catch (e) { throw e; }
    }
    try {
      const r = await _fetch.apply(window, arguments);
      // Only rewrite paywall/rate-limit statuses for JOBRIGHT's OWN endpoints — never
      // for unrelated websites (turning their legitimate 401/403/429 into a fake 200
      // was breaking auth/loading on sites that have nothing to do with this extension).
      if ((r.status === 402 || r.status === 403 || r.status === 429) && /jobright|\/swan\/|\/api\/(credit|coin|token|subscription|usage|quota|entitlement)/i.test(u))
        return new Response(JSON.stringify({ success: true, code: 200, result: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return r;
    } catch (e) { throw e; }
  };
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this._ua_url = url; return _xhrOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const url = this._ua_url || '';
    if (/credit\/balance|credit\/free|payment\/subscription|cost-credit|resume.*credit|tailor.*credit|coins?\/balance|tokens?\/balance|api\/(coins|tokens|balance|credits|usage|limit)/i.test(url)) {
      const s = this;
      Object.defineProperty(s, 'responseText', { get: () => JSON.stringify({ code: 200, result: { credit: _C, dailyFill: _C, remaining: 99999, coins: 99999, tokens: 99999, balance: 99999 }, success: true }) });
      Object.defineProperty(s, 'status', { get: () => 200 });
      Object.defineProperty(s, 'readyState', { get: () => 4 });
      setTimeout(() => { s.onreadystatechange?.(); s.onload?.(); }, 50);
      return;
    }
    return _xhrSend.apply(this, arguments);
  };

  // ===================== CONFIG =====================
  const SK = { AA: 'ua_aa', Q: 'ua_q', QA: 'ua_qa', QP: 'ua_qp', POS: 'ua_pos', ANS: 'ua_answers', PROF: 'ua_profile' };
  const ATS = [
    /* Avature is almost never served from avature.net. Every tenant white-labels
       it onto their own domain — Deloitte runs it at apply.deloitte.com — so the
       old /avature\.net.*careers/ pattern matched nothing real, the URL fell
       through to the generic "Career" catch-all, and the account wall at
       /careers/RegisterEdit was never recognised as one.

       What IS stable across every tenant is Avature's route names. Matching those
       makes detection work for any company running it, not just Deloitte. */
    { n: 'Avature', p: /avature\.net|apply\.deloitte\.com|\/careers\/(JobDetail|ApplicationMethods|QuickApply|RegisterEdit|SubmitApplication|Register|Login|MyProfile|SearchJobs|ForgotPassword|ApplicationConfirmation|EmailFriend)\b/i },
    /* The same reasoning for the other platforms big employers white-label.
       Each of these is a ROUTE the platform always uses, whatever domain it is
       served from, so they work for companies nobody has hit yet. */
    // careers.acme.com/jobs/12345/software-engineer/job
    /* iCIMS routes: the posting is /jobs/<id>/<slug>/job and the account wall is
       /jobs/<id>/login — the one AMD's careers site stops on. Both are matched so
       the wall reaches the iCIMS driver rather than the generic path. */
    { n: 'iCIMS', p: /icims\.com|\/jobs\/\d+\/[^/]+\/job\b|\/jobs\/\d+\/(login|candidate|register)\b/i },
    // careers.jpmorgan.com/us/en/job/210536215 — Phenom's fixed locale/job shape
    /* Phenom's locale/job route carries an alphanumeric requisition code on most
       tenants — careers.mastercard.com/us/en/job/MASRUSR280277EXTERNALENUS and
       careers.snowflake.com/us/en/job/SNCOUS… — so requiring digits missed them.
       Also matched: their feed parameter, and the /<locale>/jobs/<id>/ variant
       careers.cognizant.com uses. */
    /* Host and feed signals only — these are unambiguous wherever they appear.
       The PATH shape Phenom uses is not: /<locale>/job/<id>/<slug> is identical on
       amazon.jobs, pageuppeople.com and careers.jpmorgan.com, so only the host can
       separate those. That rule therefore lives at the BOTTOM of this table, after
       every host-specific entry, where it catches an unknown employer domain
       without stealing a known one. */
    { n: 'Phenom', p: /phenompeople\.com|\.phenom\.com|utm_medium=phenom/i },
    { n: 'SuccessFactors', p: /successfactors\.(com|eu)|sapsf\.(com|eu)|\/sfcareer\/|[?&]company=[A-Za-z0-9]+.*career/i },
    { n: 'Cornerstone', p: /csod\.com|cornerstoneondemand\.com|\/ux\/candidate|\/careersite\b/i },
    { n: 'Brassring', p: /brassring\.com|\/TGnewUI\/|\/TGWebHost\//i },
    { n: 'PageUp', p: /pageuppeople\.com|\/caw\/[a-z]{2}\/job\//i },
    { n: 'Dayforce', p: /dayforce\.com|\/CandidatePortal\//i },
    { n: 'UltiPro', p: /ultipro\.com|\/JobBoard\/[^/]+\/JobDetails|OpportunityDetail\?opportunityId/i },
    { n: 'Workday', p: /myworkdayjobs\.com|myworkdaysite\.com|\/wday\/cxs\//i },
    // --- Platforms added after the CareerHound runs surfaced them (v14.1) ---
    // ADP ships two unrelated candidate apps; myjobs is the one CSV links land on.
    { n: 'ADP myjobs', p: /myjobs\.adp\.com/i },
    { n: 'ADP WorkforceNow', p: /workforcenow\.adp\.com|adp\.com.*recruitment/i },
    // Oracle Recruiting Cloud (Fusion). White-labelled onto company domains, so the
    // /hcmUI/CandidateExperience path matters as much as the oraclecloud host.
    { n: 'Oracle Recruiting', p: /oraclecloud\.com|\/hcmUI\/CandidateExperience/i },
    { n: 'Taleo', p: /taleo\.net|\/careersection\//i },
    { n: 'SuccessFactors', p: /successfactors\.(com|eu)|sapsf\.(com|eu)/i },
    { n: 'Phenom', p: /phenompeople\.com|\.phenom\.com/i },
    { n: 'Radancy', p: /talentbrew\.com|radancy\.com/i },
    { n: 'Join', p: /(\/\/|\.)join\.com/i },
    { n: 'Softgarden', p: /softgarden\.(io|de)/i },
    { n: 'HRMDirect', p: /hrmdirect\.com/i },
    { n: 'Greenhouse EU', p: /boards\.eu\.greenhouse\.io|job-boards\.greenhouse\.io/i },
    { n: 'SmartRecruiters', p: /smartrecruiters\.com/i },
    { n: 'Workday', p: /myworkdayjobs\.com|myworkdaysite\.com|workday\.com\/.*\/job/i },
    { n: 'Greenhouse', p: /boards\.greenhouse\.io|greenhouse\.io.*\/jobs/i },
    { n: 'Lever', p: /jobs\.lever\.co/i }, { n: 'SmartRecruiters', p: /jobs\.smartrecruiters\.com/i },
    { n: 'iCIMS', p: /icims\.com/i }, { n: 'Taleo', p: /taleo\.net/i },
    { n: 'Ashby', p: /jobs\.ashbyhq\.com/i }, { n: 'BambooHR', p: /bamboohr\.com.*\/jobs/i },
    { n: 'Oracle', p: /oraclecloud\.com.*recruit/i }, { n: 'LinkedIn', p: /linkedin\.com\/jobs\/(view|application)/i },
    { n: 'Indeed', p: /indeed\.com.*(viewjob|apply)/i }, { n: 'UltiPro', p: /ultipro\.com/i },
    { n: 'Jobvite', p: /jobs\.jobvite\.com/i }, { n: 'Breezy', p: /breezy\.hr|breezyhr\.com/i },
    { n: 'Recruitee', p: /recruitee\.com\/o\//i }, { n: 'ADP', p: /adp\.com.*\/job|workforcenow\.adp/i },
    { n: 'Rippling', p: /ats\.rippling\.com/i }, { n: 'Dover', p: /app\.dover\.com/i },
    { n: 'Dayforce', p: /dayforce\.com.*candidateportal/i }, { n: 'SuccessFactors', p: /successfactors\.com/i },
    { n: 'JazzHR', p: /app\.jazz\.co|applytojob\.com/i }, { n: 'Fountain', p: /fountain\.com.*\/apply/i },
    { n: 'Pinpoint', p: /pinpointhq\.com/i }, { n: 'Comeet', p: /comeet\.com.*\/jobs/i },
    { n: 'Personio', p: /personio\.de.*\/job/i }, { n: 'ZipRecruiter', p: /ziprecruiter\.com/i },
    { n: 'Monster', p: /monster\.com.*job/i }, { n: 'Glassdoor', p: /glassdoor\.com.*job/i },
    { n: 'Dice', p: /dice\.com.*job/i }, { n: 'Wellfound', p: /wellfound\.com.*\/jobs/i },
    { n: 'Paylocity', p: /paylocity\.com.*Recruiting/i }, { n: 'Phenom', p: /phenom\.com.*\/jobs/i },
    { n: 'Avature', p: /avature\.net.*careers/i }, { n: 'Workable', p: /apply\.workable\.com/i },
    { n: 'ClearCompany', p: /clearcompany\.com.*careers/i }, { n: 'Paycom', p: /paycomonline\.net.*Recruiting/i },
    { n: 'SAP', p: /sap\.com.*careers|jobs\.sap\.com/i }, { n: 'Ceridian', p: /ceridian\.com.*careers/i },
    { n: 'Bullhorn', p: /bullhornstaffing\.com/i }, { n: 'iSolved', p: /isolved\.com.*careers/i },
    { n: 'Loxo', p: /app\.loxo\.co/i }, { n: 'Hireology', p: /hireology\.com.*careers/i },
    { n: 'ApplicantPro', p: /applicantpro\.com/i }, { n: 'GovernmentJobs', p: /governmentjobs\.com/i },
    { n: 'USAJOBS', p: /usajobs\.gov/i }, { n: 'Handshake', p: /joinhandshake\.com.*jobs/i },
    { n: 'AngelList', p: /angel\.co.*jobs|wellfound\.com.*jobs/i },
    // Simplify-supported ATS platforms
    { n: 'Myworkday', p: /myworkday\.com/i }, { n: 'GreenhouseEmbed', p: /greenhouse\.io.*embed/i },
    { n: 'LeverEmbed', p: /lever\.co.*\/apply/i }, { n: 'Eightfold', p: /eightfold\.ai.*careers/i },
    { n: 'Gem', p: /gem\.com.*jobs/i }, { n: 'HireVue', p: /hirevue\.com/i },
    { n: 'Cornerstone', p: /csod\.com|cornerstoneondemand\.com/i },
    { n: 'TeamTailor', p: /teamtailor\.com|career\..*\.com/i },
    { n: 'Jobscore', p: /jobscore\.com/i }, { n: 'RecruitCRM', p: /recruitcrm\.io/i },
    { n: 'TalentLyft', p: /talentlyft\.com/i }, { n: 'Homerun', p: /homerun\.co/i },
    { n: 'Traffit', p: /traffit\.com/i }, { n: 'Manatal', p: /manatal\.com/i },
    // LazyApply-supported ATS platforms
    { n: 'SimplyHired', p: /simplyhired\.com/i }, { n: 'CareerBuilder', p: /careerbuilder\.com/i },
    { n: 'Foundit', p: /foundit\.in|iimjobs\.com/i }, { n: 'Seek', p: /seek\.com\.au/i },
    { n: 'Naukri', p: /naukri\.com/i }, { n: 'Reed', p: /reed\.co\.uk/i },
    { n: 'TotalJobs', p: /totaljobs\.com/i }, { n: 'Adzuna', p: /adzuna\.com/i },
    // The handful the rival extensions knew that this registry did not.
    { n: 'Amazon Jobs', p: /amazon\.jobs|amazon\.com\/(en\/)?jobs/i }, { n: 'Dice', p: /dice\.com/i },
    { n: 'Welcome to the Jungle', p: /welcometothejungle\.com/i },
    /* ── Learned from four real 943-job queues ─────────────────────────────
       Ten per cent of those jobs fell through to the generic path, and most of
       them were platforms already supported here — just not recognised from the
       URL shape the employer actually uses. These rules were written against
       those URLs, host by host. */

    // Greenhouse is embedded on the EMPLOYER's own site far more often than it is
    // served from greenhouse.io, and it always carries gh_jid. That one parameter
    // covers careers.toasttab.com, jobs.elastic.co, careers.withwaymo.com,
    // databricks.com, hubspot.com, hudsonrivertrading.com, gonitro.com and
    // squarespace.com — eight employers in one queue, all previously generic.
    { n: 'Greenhouse', p: /[?&]gh_jid=\d+/i },
    { n: 'Greenhouse', p: /(^|\/\/)grnh\.se\//i },                     // their short link

    /* Teamtailor white-labelled onto the employer's domain. The shape is fixed —
       /jobs/<numeric id>-<slug> — and it was the single biggest fall-through in
       the queue (careers.sumsub.com alone was 20 jobs, plus spacelift, phorest
       and geelyauto). */
    { n: 'Teamtailor', p: /\/jobs\/\d{5,}-[a-z0-9-]+/i },

    // Personio serves from personio.com as well as .de, as /careers/<uuid>.
    { n: 'Personio', p: /personio\.(com|de)\/(careers|job)/i },
    // BambooHR's own hosting is <tenant>.bamboohr.com/careers/<id> — no "/jobs".
    { n: 'BambooHR', p: /bamboohr\.com\/careers\//i },
    /* Oracle Recruiting also serves /sites/<site>/job/<id> without the /hcmUI/
       prefix (explore-jobs.ciklum.com). */
    { n: 'Oracle Recruiting', p: /\/sites\/[a-z0-9_-]+\/job\/\d+/i },

    // Aplitrak is Bullhorn's apply domain; the others are single-tenant ATS that
    // turned up once each but cost a whole job when unrecognised.
    { n: 'Bullhorn', p: /aplitrak\.com/i },
    { n: 'Current Vacancies', p: /current-vacancies\.com/i },
    { n: 'ContactHR', p: /contacthr\.com/i },
    { n: 'Polymer', p: /(^|\.)polymer\.co\b|jobs\.polymer\.co/i },
    { n: 'WorkBright', p: /workbright\.com/i },
    { n: 'Jobsite', p: /jobsite\.co\.uk/i }, { n: 'CVLibrary', p: /cv-library\.co\.uk/i },
    // OptimHire / SpeedyApply supported ATS platforms
    { n: 'Zoho', p: /zohorecruit\.com|recruit\.zoho/i }, { n: 'Freshteam', p: /freshteam\.com/i },
    { n: 'Recruiterbox', p: /recruiterbox\.com/i }, { n: 'Jobadder', p: /jobadder\.com/i },
    { n: 'Recruitee', p: /hire\.trakstar\.com/i }, { n: 'CATSone', p: /catsone\.com/i },
    { n: 'PCRecruiter', p: /pcrecruiter\.net/i }, { n: 'ApplicantStack', p: /applicantstack\.com/i },
    { n: 'Hirebridge', p: /hirebridge\.com/i }, { n: 'Newton', p: /newtonsoftware\.com/i },
    { n: 'CEIPAL', p: /ceipal\.com/i }, { n: 'Oorwin', p: /oorwin\.com/i },
    { n: 'Vincere', p: /vincere\.io/i }, { n: 'Crelate', p: /crelate\.com/i },
    { n: 'Tracker', p: /tracker-rms\.com/i }, { n: 'Recooty', p: /recooty\.com/i },
    { n: 'TalentAdore', p: /talentadore\.com/i }, { n: 'Betterteam', p: /betterteam\.com/i },
    { n: 'Hire', p: /hire\.com/i }, { n: 'SmashFly', p: /smashfly\.com/i },
    { n: 'HRCloud', p: /hrcloud\.com/i }, { n: 'Eddy', p: /eddy\.com.*careers/i },
    { n: 'Paycor', p: /paycor\.com.*recruiting/i }, { n: 'PeopleFluent', p: /peoplefluent\.com/i },
    { n: 'SilkRoad', p: /silkroad\.com/i }, { n: 'Kenexa', p: /kenexa\.com/i },
    { n: 'Lumesse', p: /lumesse\.com|talentlink\.com/i }, { n: 'PageUp', p: /pageuppeople\.com/i },
    { n: 'Jobdiva', p: /jobdiva\.com/i }, { n: 'TempWorks', p: /tempworks\.com/i },
    { n: 'Avionte', p: /avionte\.com/i }, { n: 'TargetRecruit', p: /targetrecruit\.com/i },
    { n: 'Sage', p: /sage\.hr|sagehr\.com/i }, { n: 'HiBob', p: /hibob\.com.*careers/i },
    { n: 'BreezyHR', p: /app\.breezy\.hr/i }, { n: 'Recruitee2', p: /recruitee\.com/i },
    { n: 'SmartRecruiter', p: /smartrecruiters\.com.*jobs/i }, { n: 'GRNConnect', p: /grnconnect\.com/i },
    { n: 'ApplyOnline', p: /applyonline\.com\.au/i }, { n: 'ELMO', p: /elmosoftware\.com/i },
    { n: 'Tribepad', p: /tribepad\.com/i }, { n: 'Oleeo', p: /oleeo\.com/i },
    { n: 'Eploy', p: /eploy\.co\.uk/i }, { n: 'Peoplehr', p: /peoplehr\.com/i },
    { n: 'HRPartner', p: /hrpartner\.io/i }, { n: 'Kenjo', p: /kenjo\.io.*careers/i },
    { n: 'Occupop', p: /occupop\.com/i }, { n: 'GoHire', p: /gohire\.io/i },
    { n: '100Hires', p: /100hires\.com/i }, { n: 'Hireflix', p: /hireflix\.com/i },
    { n: 'TestGorilla', p: /testgorilla\.com/i }, { n: 'Codility', p: /codility\.com/i },
    { n: 'HackerRank', p: /hackerrank\.com/i }, { n: 'Dover2', p: /dover\.io/i },
    { n: 'Ashby2', p: /ashbyhq\.com.*application/i }, { n: 'Lever2', p: /lever\.co.*apply/i },
    // Generic career page patterns
    /* Phenom by PATH — deliberately the last real rule. An employer serving
       /<locale>/job/<id>/<slug> from its own domain is almost always Phenom, but
       amazon.jobs, pageuppeople.com and the rest use the same shape, so this only
       gets a say once every host-specific pattern above has declined. */
    { n: 'Phenom', p: /\/[a-z]{2}(-[a-z]{2})?\/(en\/)?jobs?\/[a-z0-9]{6,}(\/|$)|\/[a-z]{2,8}-[a-z]{2}\/jobs\/\d{4,}\//i },
    { n: 'Career', p: /\/careers?\/?$|\/jobs?\/?$|\/apply\b|\/positions?\/?$|\/openings?\/?$/i }
  ];

  // ===================== STORAGE & STATE =====================
  const st = {
    get: k => new Promise(r => chrome.storage.local.get(k, d => r(d[k]))),
    set: (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r)),
    getMulti: keys => new Promise(r => chrome.storage.local.get(keys, d => r(d)))
  };
  // Keep the Fully-Automated state authoritative across tabs/re-renders: whenever the
  // stored value changes (this tab, another tab, or a race), adopt it and repaint. This
  // guarantees the toggle reflects what's actually persisted — no reverting on refresh.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.ua_aa) { autoApply = !!changes.ua_aa.newValue; try { paintAutoToggle(); } catch (_) {} }
    });
  } catch (_) {}
  let queue = [], qActive = false, qPaused = false, autoApply = false, selected = new Set();
  let qSpeedFactor = 1; // multiplies automation waits (set from queue speed); lower = faster
  let qSkipApplied = true; // LazyApply-style: skip URLs already applied to (across imports)
  // LazyApply-enhanced state tracking
  let qStats = { completed: 0, failed: 0, skipped: 0, timedOut: 0, totalTime: 0 };
  let qStoppedAt = -1; // LazyApply session resumption index
  let queueUseTailor = false; // queue uses plain Autofill by default (see load())
  async function load() {
    queue = (await st.get(SK.Q)) || [];
    qActive = (await st.get(SK.QA)) || false;
    qPaused = (await st.get(SK.QP)) || false;
    autoApply = (await st.get(SK.AA)) || false;
    // Merge stored stats onto the defaults (don't replace) so a stats object saved by
    // an older build that lacks newer keys (e.g. timedOut) can't make `qStats.timedOut++`
    // evaluate to NaN and poison the whole stats display.
    qStats = { completed: 0, failed: 0, skipped: 0, timedOut: 0, totalTime: 0, ...((await st.get('ua_q_stats')) || {}) };
    qStoppedAt = (await st.get('ua_q_stopped_at')) || -1;
    qSpeed = (await st.get('ua_q_speed')) || 1; // persist speed across per-job navigations
    qSpeedFactor = speedFactorFor(qSpeed);
    // Default OFF: the queue uses the reliable plain "Autofill" path. The
    // "Generate Custom Resume + Autofill" combo depends on Jobright's resume
    // generator and can stall, so we don't use it automatically unless opted in.
    queueUseTailor = (await st.get('ua_queue_tailor')) === true;
    qSkipApplied = (await st.get('ua_skip_applied')) !== false; // default ON
    try { _submitMark = (await st.get(SUBMIT_MARK_KEY)) || null; } catch (_) { _submitMark = null; }
  }
  /* Every job that has reached a final state gets reported to the recorder
     exactly once. This sits on saveQ rather than on each of the eight places
     that set a terminal status, because those are scattered across the retry
     paths and a diagnostic that covers seven of eight exits is the kind that
     makes you trust a wrong number. New exits are covered automatically. */
  const _diagReported = new Set();
  const TERMINAL = ['done', 'failed', 'timeout', 'skipped'];
  function reportTerminalJobs() {
    try {
      for (const j of queue) {
        if (!j || !TERMINAL.includes(j.status)) continue;
        const id = j.id || j.url;
        if (!id || _diagReported.has(id)) continue;
        _diagReported.add(id);
        DIAG('job.' + j.status, j.error || '', {
          ats: j.jobBoard || (typeof detectATS === 'function' && detectATS()) || 'unknown',
          url: j.url,
          detail: j.duration ? { ms: j.duration } : undefined,
        });
      }
    } catch (_) {}
  }
  async function saveQ() { reportTerminalJobs(); await st.set(SK.Q, queue); }
  async function saveStats() { await st.set('ua_q_stats', qStats); }

  // ===================== ANSWER LEARNING SYSTEM =====================
  // Stores answers keyed by normalized field label for future reuse
  let _answerBank = {};
  let _answerBankLoaded = false;

  async function loadAnswerBank() {
    if (_answerBankLoaded) return _answerBank;
    const saved = await st.get(SK.ANS);
    _answerBank = saved || {};
    _answerBankLoaded = true;
    // Also pull from OptimHire storage if available
    const ohKeys = ['candidateDetails', 'userDetails', 'applicationDetails', 'questionAnswers', 'responses'];
    const ohData = await st.getMulti(ohKeys);
    for (const val of Object.values(ohData || {})) {
      if (!val) continue;
      try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        collectEntries(parsed);
      } catch (_) { }
    }
    return _answerBank;
  }

  function collectEntries(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collectEntries); return; }
    const response = node.response || node.answer || node.value || node.selected || node.a || node.text;
    if (response && typeof response === 'string') {
      const keys = [node.question, node.key, node.id, node.label, node.name];
      keys.forEach(k => { if (k && typeof k === 'string') _answerBank[normalizeKey(k)] = response; });
    }
    Object.values(node).forEach(collectEntries);
  }

  function normalizeKey(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  async function learnAnswer(label, value) {
    if (!label || !value) return;
    const key = normalizeKey(label);
    if (!key) return;
    _answerBank[key] = value;
    await st.set(SK.ANS, _answerBank);
  }

  function getLearnedAnswer(label, el, exactOnly) {
    const candidates = [label, el?.name, el?.id, el?.placeholder, el?.getAttribute?.('aria-label')];
    for (const c of candidates) {
      if (!c) continue;
      const k = normalizeKey(c);
      if (k && _answerBank[k]) return _answerBank[k];
    }
    if (exactOnly) return '';
    // Safe word-overlap match (prevents cross-field contamination)
    const queryKey = normalizeKey(label || '');
    if (!queryKey || queryKey.length < 3) return '';
    const queryWords = queryKey.split(' ').filter(w => w.length > 2);
    if (!queryWords.length) return '';
    let bestMatch = '', bestScore = 0;
    for (const [bk, bv] of Object.entries(_answerBank)) {
      if (!bk || bk.length < 3) continue;
      const bankWords = bk.split(' ').filter(w => w.length > 2);
      if (!bankWords.length) continue;
      const matchCount = bankWords.filter(bw => queryWords.includes(bw)).length;
      const score = matchCount / Math.min(bankWords.length, queryWords.length);
      if (score >= 0.6 && matchCount >= 1 && score > bestScore) { bestScore = score; bestMatch = bv; }
    }
    return bestMatch;
  }

  // ===================== PROFILE =====================
  const DEFAULTS = {
    authorized: 'Yes', sponsorship: 'No', relocation: 'Yes', remote: 'Yes',
    veteran: 'I am not a protected veteran', disability: 'I do not have a disability',
    gender: 'Prefer not to say', ethnicity: 'Prefer not to say', race: 'Prefer not to say',
    // Seven, not five: this is the number typed into "how many years of X?" on
    // every ATS that asks, and a screening filter looking for a minimum never
    // prefers the smaller answer.
    years: '7', salary: '80000', notice: '2 weeks', availability: 'Immediately',
    country: 'Ireland', phoneCountryCode: '+353', countryCode: 'IE',
    cover: 'I am excited to apply for this role. My background and skills make me an excellent candidate and I look forward to contributing to your team.',
    why: 'I admire the company culture and the opportunity to make a meaningful impact.',
    howHeard: 'LinkedIn',
  };

  async function getProfile() {
    let p = (await st.get(SK.PROF)) || {};
    // Also check OptimHire candidate data
    const ohData = await st.getMulti(['candidateDetails', 'userDetails']);
    try {
      const cd = typeof ohData.candidateDetails === 'string' ? JSON.parse(ohData.candidateDetails) : (ohData.candidateDetails || {});
      const ud = typeof ohData.userDetails === 'string' ? JSON.parse(ohData.userDetails) : (ohData.userDetails || {});
      p = { ...ud, ...cd, ...p };
    } catch (_) { }
    return p;
  }

  // ===================== SMART VALUE GUESSER =====================
  /* ── THE MESSAGE TO THE HIRING TEAM ────────────────────────────────────────
     "I keep seeing this text on a lot of my applications — is it misplaced?"

     It is not misplaced. It is the saved cover-letter text, pasted verbatim into
     every box whose label reads like a cover letter, a motivation, or a message
     to the hiring team. Identical wording across dozens of applications is worse
     than an empty box: it reads as a form letter and it names no employer.

     So the text is TAILORED before it is written — {company} / {title}
     placeholders are substituted, and when the saved text names no employer at
     all the company and role read off the page are woven into an opening
     sentence. And an OPTIONAL message box is now left alone when there is
     nothing specific to say, rather than filled with boilerplate. A REQUIRED one
     is still answered, because an empty required field blocks the application. */
  const COVER_FIELD_RE = /cover.?letter|motivation|message to (the )?(hiring|recruit|team|us)|why (do you )?(want|are you)|additional.?info|anything else you.?d like/i;
  const ATS_HOST_LABEL_RE = /^(myworkdayjobs|myworkdaysite|smartrecruiters|greenhouse|job-boards|lever|icims|taleo|oraclecloud|adp|workable|ashbyhq|avature|jobvite|jazzhr|bamboohr|successfactors|phenom|eightfold)$/i;

  function pageCompanyName() {
    // The queue knows it when the CSV carried it.
    try {
      const j = queue.find((x) => x.status === 'applying');
      if (j && j.companyName) return String(j.companyName).trim().slice(0, 60);
    } catch (_) {}
    try {
      const c = extractJDCompany();
      if (c) return c.replace(/\s*[|–-]?\s*(careers?|jobs?|hiring)\s*$/i, '').trim().slice(0, 60);
    } catch (_) {}
    /* Last resort: the employer's own label in the host. On a white-labelled ATS
       that IS the company — apply.deloitte.com, careers-amd.icims.com. */
    try {
      const h = location.hostname.replace(/^(www|apply|jobs|careers|boards|job-boards|recruiting)[.-]/i, '');
      const label = (h.split('.')[0] || '').replace(/^careers-/i, '');
      if (label && label.length > 1 && !ATS_HOST_LABEL_RE.test(label)) {
        return label.charAt(0).toUpperCase() + label.slice(1);
      }
    } catch (_) {}
    return '';
  }
  function pageJobTitle() {
    try {
      const j = queue.find((x) => x.status === 'applying');
      if (j && j.title) return String(j.title).trim().slice(0, 90);
    } catch (_) {}
    try { return (extractJDTitle() || '').slice(0, 90); } catch (_) { return ''; }
  }

  function tailorCoverText(text, opts) {
    let out = String(text == null ? '' : text).trim();
    if (!out) return '';
    const company = (opts && opts.company) || '';
    const title = (opts && opts.title) || '';
    out = out.replace(/\{\s*(company|employer)\s*\}/gi, company || 'your team')
      .replace(/\{\s*(title|role|position|job)\s*\}/gi, title || 'this role');
    if (!company) return out;
    // Already names the employer? The user's own wording stands.
    try {
      const esc = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('\\b' + esc + '\\b', 'i').test(out)) return out;
    } catch (_) {}
    const opener = title
      ? `I am applying for the ${title} role at ${company}. `
      : `I am writing to apply to ${company}. `;
    return opener + out;
  }

  /* "Today's date" as a FREE TEXT box (SmartRecruiters puts one under the
     signature field). Match whatever format the field advertises rather than
     guessing — a date in the wrong order is silently wrong, not obviously so. */
  function todayForField(el) {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const DD = p2(d.getDate()), MM = p2(d.getMonth() + 1), YYYY = String(d.getFullYear());
    let hint = '';
    try {
      hint = ((el && el.placeholder) || '') + ' ' + (getLabel(el) || '') + ' ' + ((el && el.getAttribute('aria-label')) || '');
    } catch (_) {}
    if (/yyyy\s*[-/.]\s*mm\s*[-/.]\s*dd/i.test(hint)) return `${YYYY}-${MM}-${DD}`;
    if (/dd\s*[-/.]\s*mm\s*[-/.]\s*yyyy/i.test(hint)) return `${DD}/${MM}/${YYYY}`;
    if (/mm\s*[-/.]\s*dd\s*[-/.]\s*yyyy/i.test(hint)) return `${MM}/${DD}/${YYYY}`;
    return `${MM}/${DD}/${YYYY}`;                       // the ATS default
  }

  function guessValue(label, p) {
    const l = (label || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    // "What state do you reside in?" is a value question; it kept coming back
    // "Yes" from a fuzzy saved-answer match, so answer it properly and early.
    if (/what state|which state|state do you (reside|live)|state you (reside|live)|state of (residence|resident)|home state|state province/.test(l))
      return p.state || p.region || p.province || '';
    if (/first.?name|given.?name|prenom/.test(l)) return p.first_name || p.firstName || '';
    if (/last.?name|family.?name|surname/.test(l)) return p.last_name || p.lastName || '';
    if (/middle.?name/.test(l)) return p.middle_name || '';
    if (/preferred.?name|nick.?name/.test(l)) return p.preferred_name || p.first_name || '';
    if (/full.?name|your name|^name$/.test(l) && !/company|last|first|user/.test(l)) return `${p.first_name || ''} ${p.last_name || ''}`.trim();
    if (/\bemail\b/.test(l)) return p.email || '';
    // Exclude "Phone Extension" — it was matching the generic phone regex and getting
    // the FULL phone number stuffed into it too (Workday then displayed the number
    // twice: "087 426 1508 x087 426 1508 (Mobile)"). Extension should stay blank.
    if (/phone|mobile|cell|telephone/.test(l) && !/ext(ension)?\b/.test(l)) return p.phone || '';
    if (/^city$|\bcity\b|current.?city/.test(l)) {
      // SmartRecruiters uses "City, Region, Country" format for city fields
      if (/smartrecruiters/i.test(location.href) && p.city) {
        return [p.city, p.state || p.region || '', p.country || DEFAULTS.country].filter(Boolean).join(', ');
      }
      return p.city || '';
    }
    // "state" was matching as a SUBSTRING of "statement" — a "Personal Statement" essay
    // field was getting the literal US-state value stuffed into it. Word-bounded now.
    if (/\bstate\b|province|region/.test(l) && !/statement/.test(l)) return p.state || '';
    if (/zip|postal/.test(l)) return p.postal_code || p.zip || '';
    if (/country/.test(l) && !/code|phone|dial/.test(l)) return p.country || DEFAULTS.country;
    if (/address|street/.test(l)) return p.address || '';
    if (/location|where.*(you|do you).*live/.test(l)) return p.city ? `${p.city}, ${p.state || ''}`.trim().replace(/,$/, '') : '';
    if (/linkedin/.test(l)) return p.linkedin_profile_url || p.linkedin || '';
    if (/github/.test(l)) return p.github_url || p.github || '';
    if (/website|portfolio|personal.?url/.test(l)) return p.website_url || p.website || '';
    if (/twitter|x\.com/.test(l)) return p.twitter_url || p.twitter || '';
    if (/university|school|college|alma.?mater/.test(l)) return p.school || p.university || '';
    // "qualification" alone was matching essay fields like "Additional Qualifications"
    // and stuffing the literal string "Bachelor's" into them — dropped; a genuine
    // degree field is virtually always labeled with the word "degree" itself.
    if (/\bdegree\b/.test(l)) return p.degree || "Bachelor's";
    if (/major|field.?of.?study|concentration/.test(l)) return p.major || '';
    if (/gpa|grade.?point/.test(l)) return p.gpa || '';
    if (/graduation|grad.?date|grad.?year/.test(l)) return p.graduation_year || p.grad_year || '';
    // Excluded "position/title APPLIED FOR" (that's the JOB's title, not the
    // candidate's) and "position type" (employment-type dropdown, e.g. Full-Time).
    if (/title|position|role|current.?title|job.?title/.test(l) && !/company|applied.?for|applying.?for|position.?type|employment.?type/.test(l)) return p.current_title || p.title || '';
    // Dropped bare "org" — a 3-letter fragment that could match unrelated labels
    // (e.g. a "yourname.org" website hint) and stuff the company name into them.
    if (/company|employer|current.?company/.test(l)) return p.current_company || p.company || '';
    // CRITICAL: these were \bfrom\b / \bto\b — matching the word "from"/"to" ANYWHERE
    // in a label, which fired on completely unrelated questions like "Are you willing
    // TO relocate?" (turning a Yes/No question into a wrong end-date value) before the
    // real relocation check further down the chain ever got a chance to run. Anchored
    // to the label being (almost) exactly "From"/"To" — the actual real-world pattern
    // for the bare From/To column headers on work-experience date ranges.
    if (/^from$|start.?date|begin.?date/.test(l) && !/salary|pay/.test(l)) return p.work_start_year ? `01/${p.work_start_year}` : `01/${new Date().getFullYear() - 2}`;
    if (/^to$|end.?date/.test(l) && !/salary|pay|email/.test(l)) return p.work_end_year ? `12/${p.work_end_year}` : `12/${new Date().getFullYear()}`;
    if (/salary|compensation|pay|desired.?pay/.test(l)) return p.expected_salary || DEFAULTS.salary;
    /* An e-signature box wants the applicant's NAME typed in, and the date box
       beside it wants today. Both are REQUIRED on SmartRecruiters' preliminary
       questions and neither was recognised, so the step could not be submitted. */
    if (/signature|sign here|type your (full )?name|e-?sign/.test(l) && !/upload|image|file/.test(l))
      return `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim();
    if (/today.?s date|date signed|signature date|current date|date of (signature|application)/.test(l)) return '__TODAY__';
    if (/cover.?letter|motivation|additional.?info|message.?to/.test(l)) return p.cover_letter || DEFAULTS.cover;
    if (/summary|about.?(yourself|you|me)|bio|objective/.test(l)) return p.summary || p.cover_letter || DEFAULTS.cover;
    if (/why.*(compan|role|want|interest|position)/.test(l)) return DEFAULTS.why;
    if (/how.*hear|where.*(find|learn|discover)|source|referred/.test(l)) return DEFAULTS.howHeard;
    if (/years.*(exp|work)|exp.*years|total.*experience/.test(l)) return DEFAULTS.years;
    if (/availab|start.?date|notice|when.*start/.test(l)) return DEFAULTS.availability;
    // Both directions from one decider — see workAuthorisationAnswer. The old
    // pair ran /authoriz/ (which never matched the British "authorised") and then
    // /sponsor|visa/, so every European eligibility question answered "No".
    {
      const wa = workAuthorisationAnswer(label || '');
      if (wa === 'yes') return DEFAULTS.authorized;
      if (wa === 'no') return DEFAULTS.sponsorship;
    }
    if (RELOCATION_RE.test(label || '')) return DEFAULTS.relocation;
    if (/remote|work.*home|hybrid|on.?site/.test(l)) return DEFAULTS.remote;
    if (/veteran|military|armed.?forces/.test(l)) return p.veteran || DEFAULTS.veteran;
    if (/disabilit/.test(l)) return p.disability || DEFAULTS.disability;
    if (/gender|sex\b|pronouns/.test(l)) return p.gender || DEFAULTS.gender;
    if (/ethnic|race|racial|heritage/.test(l)) return p.ethnicity || p.race || DEFAULTS.ethnicity;
    if (/country.?code|phone.?code|dial.?code|calling.?code/.test(l)) return p.phoneCountryCode || DEFAULTS.phoneCountryCode;
    if (/nationality|citizenship/.test(l)) return p.nationality || p.country || DEFAULTS.country;
    if (/language|fluency|fluent/.test(l)) return p.languages || 'English';
    if (/\bspeaking\b|\bspeak\b|oral.?proficiency/.test(l)) return p.language_proficiency || 'Advanced';
    if (/\bwriting\b|\bwritten\b|write.?proficiency/.test(l)) return p.language_proficiency || 'Advanced';
    if (/\breading\b|\bread\b|read.?proficiency/.test(l)) return p.language_proficiency || 'Advanced';
    if (/certif|license|credential/.test(l)) return p.certifications || '';
    if (/commute|travel|willing.*travel/.test(l)) return 'Yes';
    // Bare "background" was matching "Educational/Professional Background" essay fields
    // (which want real descriptive text, not Yes/No) AND "Background Check Authorization"
    // (where the correct answer is actually "Yes", not "No") — require explicit criminal-
    // history wording, and let a background-CHECK authorization fall through to the
    // generic "agree/consent" => Yes rule further down instead.
    if (/convicted|criminal|felony|(background.*(check|screening)).*(consent|authoriz|agree)/.test(l)) {
      if (/consent|authoriz|agree/.test(l)) return 'Yes'; // authorizing the check itself
      return 'No'; // "have you been convicted/have a criminal record" style question
    }
    if (/drug.?test|screening/.test(l)) return 'Yes';
    // Conditional "disclosure" knockout questions that should default to NO (they're the
    // ones left unanswered on Workday questionnaires — non-compete, prior applicant/
    // employee, prior engagement/client relationship, relative-at-company, conflicts).
    // These must be checked BEFORE the generic "agree/consent → Yes" rule below, or a
    // question like "...that would preclude your employment? If yes, please provide..."
    // would wrongly return Yes. Note the earlier /agree/ rule is for consent CHECKBOXES.
    if (/non.?compet|restrictive.?covenant|non.?solicit|would (preclude|restrict|prevent).*(employ|work)/.test(l)) return 'No';
    if (/(ever|previously).*(applied|interview|offer|employ).*(with|at|for|by)|former.*(applicant|employee)|worked.*(here|for us|for this company).*before/.test(l)) return 'No';
    if (/engagement team|worked.*(as|with).*(client|engagement)|independent.?contractor|third.?party.?labor/.test(l)) return 'No';
    if (/(related|relative|family).*(partner|principal|employee|associate|work)|conflict.*interest/.test(l)) return 'No';
    if (/terminated|dismissed|discharged|suspended.*(employ|job)|debarred|pending.*charge/.test(l)) return 'No';
    if (/\bage\b|18.*years|over.*18|at.*least.*18/.test(l)) return 'Yes';
    if (/agree|acknowledge|certif|attest|confirm|consent/.test(l)) return 'Yes';
    if (/please.?specify|other.?please/.test(l)) return p.city || p.state || '';
    if (/hear.?about.*position|referral.?source/.test(l)) return DEFAULTS.howHeard;
    if (/earliest.?start|when.*available|join.?date/.test(l)) return DEFAULTS.availability;
    if (/current.?salary|previous.?salary|last.?salary/.test(l)) return p.current_salary || DEFAULTS.salary;
    if (/desired.?salary|expected.?compensation|salary.?expectation/.test(l)) return p.expected_salary || DEFAULTS.salary;
    if (/reason.*leav|why.*leav|motivation.*change/.test(l)) return 'Seeking new growth opportunities and challenges.';
    if (/strength|strong.?suit|best.?quality/.test(l)) return p.strengths || 'Strong problem-solving skills, effective communication, and attention to detail.';
    if (/weakness|area.*improve|development.?area/.test(l)) return p.weaknesses || 'I sometimes focus too much on details, but I have learned to balance thoroughness with efficiency.';
    if (/reference|referee/.test(l) && !/number|phone|email/.test(l)) return 'Available upon request';
    if (/security.?clearance/.test(l)) return p.security_clearance || 'None';
    if (/date.?of.?birth|dob|birth.?date/.test(l)) return p.dob || '';
    if (/social.?security|ssn/.test(l)) return ''; // Never auto-fill SSN
    if (/driver.?licen/.test(l)) return p.drivers_license || 'Yes';
    if (/shift|work.?schedule|flexible.?hours/.test(l)) return 'Yes';
    if (/overtime/.test(l)) return 'Yes';
    if (/clearance.?level/.test(l)) return p.clearance_level || '';
    if (/address.?(line)?.*2|apt|suite|unit|apartment|floor|building/.test(l)) return p.address_line_2 || '';
    if (/city.*(state|region)|location.*(city|metro)|current.?location|based.?in/.test(l)) return p.city ? `${p.city}, ${p.state || ''}`.trim().replace(/,$/, '') : '';
    if (/notice.?period|how.*soon|days.?notice/.test(l)) return p.notice_period || '2 weeks';
    if (/visa.?status|immigration.?status|work.?status/.test(l)) return p.visa_status || DEFAULTS.authorized;
    if (/skills|technical.?skills|key.?skills/.test(l)) return p.skills || '';
    if (/\bprefix\b|salutation|honorific/.test(l)) return p.prefix || '';
    if (/\bsuffix\b|name.?suffix/.test(l)) return p.suffix || '';
    if (/number.*years|how.*many.*years/.test(l)) return DEFAULTS.years;
    if (/proficiency|skill.?level/.test(l)) return 'Advanced';
    if (/hear.?about.*company|how.*find.*us|job.?source/.test(l)) return DEFAULTS.howHeard;
    if (/social.?security|ssn|tax.?id/.test(l)) return '';
    return '';
  }

  /* ── DOES THE ANSWER FIT THE CONTROL? ──────────────────────────────────────
     Everything else decides WHAT to answer. This decides whether that answer is
     the right SHAPE for the box it is going into — the step that was missing.

     Two real failures it prevents:

       • A BUCKET WHERE A NUMBER BELONGS. "5-8" is exactly the right thing to
         click in a dropdown whose options are ranges. Typed into a free-text
         "How many years of X experience do you have?" box it is a string the
         ATS cannot parse — and a saved answer learned from a dropdown gets
         reused on text fields. Ranges become a single integer there, taking the
         TOP of the range: an employer screening on a minimum never prefers the
         lower number, and it is the honest reading of "5-8 years".

       • A YES/NO WHERE PROSE BELONGS. "If answered Yes, please provide the name
         of the employee who works at Heartflow" came back "Yes" from a fuzzy
         saved-answer match. When the parent answer was No, the answer the form
         itself asks for is N/A. */
  const YEARS_RANGE_RE = /^\s*(\d+)\s*(?:[-–—]|\s+to\s+)\s*(\d+)\s*\+?\s*(?:years?)?\s*$/i;
  // "More than 5" / "At least 10" — a floor with no upper bound.
  const YEARS_ATLEAST_RE = /^\s*(?:more than|over|at least|greater than|>)\s*(\d+)\s*\+?\s*(?:years?)?\s*(?:of experience)?\s*$/i;
  // "8+" / "10 or more" / "8 plus".
  const YEARS_PLUS_RE = /^\s*(\d+)\s*(?:\+|or more|plus)\s*(?:years?)?\s*(?:of experience)?\s*$/i;
  const YEARS_Q_RE = /how many years|years of (experience|exp)\b|number of years|years.{0,24}experience|experience.{0,12}years/i;
  const PROSE_Q_RE = /\b(please (explain|describe|provide|specify|list|elaborate|detail|share)|explain|describe|provide the name|name of the|which of|tell us|give details|reason for)\b/i;
  const NA_HINT_RE = /\b(if no,? (add|enter|type|put|write)|if not applicable|otherwise (add|enter|put|write)|add n\/?a|enter n\/?a|write n\/?a|put n\/?a|n\/?a if)\b/i;
  const CONDITIONAL_Q_RE = /^\s*if\s+(you\s+)?(have\s+)?(answered|selected|applicable|yes|no|so)\b|^\s*if\s+applicable\b|^\s*if\s+yes\b|^\s*if\s+no\b/i;

  function isFreeTextControl(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const t = (el.type || 'text').toLowerCase();
    return t === 'text' || t === 'number' || t === 'search' || t === '';
  }

  /* Is this a question a bare Yes/No can even answer? The saved-answer matcher
     is fuzzy by design — 40% keyword overlap — which a long question reaches just
     by sharing nouns. That is how "What state do you reside in?" and "…provide
     the name of the employee…" both came back "Yes". */
  function looksLikeYesNoQuestion(q) {
    const t = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (/\b(what|which|where|when|how many|how much|how long|how old|name of|provide the name|please (explain|describe|provide|specify|list)|explain|describe|list|specify)\b/.test(t)) return false;
    return /^(are|is|am|do|does|did|have|has|had|will|would|can|could|should|shall|may|might|was|were|must)\b/.test(t) ||
      /\byes\b\s*(\/|,|or)\s*\bno\b/.test(t);
  }

  // The candidate's own figure if they gave one, otherwise the default — never
  // zero and never blank, which are the two answers a years box must not carry.
  function yearsAnswer(p) {
    const real = String((p && (p.years_experience || p.yearsExperience)) || DEFAULTS.years).trim();
    const n = parseInt(real, 10);
    return n > 0 ? String(n) : DEFAULTS.years;
  }

  function refineAnswerForControl(val, label, p, el) {
    let v = String(val == null ? '' : val).trim();
    // Resolved here because the format depends on the control, not the question.
    if (v === '__TODAY__') return todayForField(el);
    let q = String(label || '');
    try { if (el) q += ' ' + (getFullQuestionText(el) || ''); } catch (_) {}
    q = q.replace(/\s+/g, ' ');
    if (!v) {
      /* Nothing resolved. Leaving it blank is normally right — inventing answers
         is how a form ends up full of nonsense. "How many years…" is the
         exception: it is nearly always required, and blank fails the submit as
         surely as 0 fails the screen. */
      return (YEARS_Q_RE.test(q) && isFreeTextControl(el)) ? yearsAnswer(p) : v;
    }

    // A Yes/No answer to a question that asks for a value is always wrong. On a
    // dropdown, dropping it lets the option matcher choose a real option instead.
    if (/^(yes|no|y|n|true|false)$/i.test(v) && !looksLikeYesNoQuestion(q)) {
      if (!isFreeTextControl(el)) return '';
      return (PROSE_Q_RE.test(q) || CONDITIONAL_Q_RE.test(q) || NA_HINT_RE.test(q)) ? 'N/A' : '';
    }
    /* The message to the hiring team — see tailorCoverText. Naming the employer
       is the difference between a letter and a form letter, and an optional box
       with nothing specific to say is better left empty. */
    if (COVER_FIELD_RE.test(q) && (isFreeTextControl(el) || (el && el.tagName === 'TEXTAREA'))) {
      const company = pageCompanyName();
      if (company) return tailorCoverText(v, { company, title: pageJobTitle() });
      let required = false;
      try { required = isFieldRequired(el); } catch (_) {}
      if (!required) {
        LOG('Leaving the optional message to the hiring team empty — nothing specific to say about this employer');
        return '';
      }
      return v;
    }
    if (!isFreeTextControl(el)) return v;      // a dropdown/radio wants the option text

    const isNumberBox = (el.type || '').toLowerCase() === 'number';
    if (YEARS_Q_RE.test(q) || isNumberBox) {
      const r = v.match(YEARS_RANGE_RE);
      if (r) return String(Math.max(parseInt(r[1], 10), parseInt(r[2], 10)));
      const a = v.match(YEARS_ATLEAST_RE);
      if (a) return String(parseInt(a[1], 10));
      const o = v.match(YEARS_PLUS_RE);
      if (o) return String(parseInt(o[1], 10));
      if (isNumberBox && !/^-?\d+(\.\d+)?$/.test(v)) {
        const first = v.match(/\d+/);
        v = first ? first[0] : '';
      }
      /* Zero is a knockout. "How many years of hands-on experience do you have
         with Linux system administration?" answered 0 fails every minimum-years
         screen there is, and it was reaching the box — a 0 landed on a live
         Comeet application. Nothing legitimately resolves to zero here: a
         genuinely empty answer, a value that parsed down to nothing, and a
         saved "0" are all the same mistake, so fall back to the real figure. */
      if (YEARS_Q_RE.test(q) && (!v || /^-?0+(\.0+)?$/.test(v))) return yearsAnswer(p);
    }
    return v;
  }

  function guessFieldValue(label, p, el) {
    // Priority: saved responses → an EXACT learned answer (the user answered this very
    // question before — their answer must beat any generic guess) → built-in guesses →
    // fuzzy learned match as the last resort (kept last to avoid contamination).
    const questionText = el ? getFullQuestionText(el) : label;
    /* Both of the FUZZY lookups are filtered — the saved-response bank and the
       fuzzy pass over learned answers. The exact learned answer between them is
       not: the user answered that precise question themselves, and their word is
       final even on a knockout. See safeKnockoutAnswer. */
    const fromSaved = safeKnockoutAnswer(findSavedResponseMatch(questionText), questionText);
    const raw = fromSaved || getLearnedAnswer(label, el, true) || guessValue(label, p) ||
      safeKnockoutAnswer(getLearnedAnswer(label, el), questionText) || '';
    // Last step: make the answer fit the control it is going into.
    return refineAnswerForControl(raw, label, p, el);
  }

  // ===================== SAVED RESPONSES SYSTEM (SpeedyApply-style) =====================
  // Keyword-based Q&A database with import/export/search/autofill
  let _savedResponses = [];
  let _savedResponsesLoaded = false;

  async function loadSavedResponses() {
    if (_savedResponsesLoaded) return _savedResponses;
    _savedResponses = (await st.get('ua_saved_responses')) || [];
    _savedResponsesLoaded = true;
    return _savedResponses;
  }

  async function saveSavedResponses() {
    await st.set('ua_saved_responses', _savedResponses);
  }

  function findSavedResponseMatch(questionText) {
    if (!_savedResponses.length || !questionText) return '';
    const qNorm = questionText.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const qWords = qNorm.split(' ').filter(w => w.length > 2);
    if (!qWords.length) return '';
    let bestMatch = null, bestScore = 0;
    for (const entry of _savedResponses) {
      if (!entry.keywords || !entry.keywords.length || !entry.response) continue;
      const matchCount = entry.keywords.filter(kw => qWords.includes(kw.toLowerCase())).length;
      const score = matchCount / entry.keywords.length;
      if (score > bestScore && score >= 0.4) { bestScore = score; bestMatch = entry.response; }
    }
    return bestMatch || '';
  }

  function addSavedResponse(keywords, response) {
    if (!keywords || !keywords.length || !response) return;
    // Check for duplicate
    const existing = _savedResponses.findIndex(r =>
      r.keywords.sort().join('|') === [...keywords].sort().join('|')
    );
    if (existing >= 0) {
      _savedResponses[existing].response = response;
      _savedResponses[existing].appearances = (_savedResponses[existing].appearances || 0) + 1;
      _savedResponses[existing].updatedAt = Date.now();
    } else {
      _savedResponses.push({ keywords, response, appearances: 1, createdAt: Date.now(), updatedAt: Date.now() });
    }
    saveSavedResponses();
  }

  // The QUESTION an input answers. For a radio/checkbox getLabel(el) returns the OPTION's
  // own label ("Yes"/"No") — useless to learn from — so climb to the group's question
  // (fieldset legend / radiogroup label / container text minus the option labels).
  function getQuestionForInput(el) {
    try {
      if (el && (el.type === 'radio' || el.type === 'checkbox')) {
        const fs = el.closest('fieldset');
        const legend = fs && fs.querySelector('legend');
        if (legend?.textContent?.trim()) return legend.textContent.trim();
        const grp = el.closest('[role="radiogroup"],[role="group"]');
        if (grp) {
          if (grp.getAttribute('aria-label')) return grp.getAttribute('aria-label');
          const lb = grp.getAttribute('aria-labelledby');
          if (lb) { const d = document.getElementById(lb); if (d?.textContent?.trim()) return d.textContent.trim(); }
        }
        const cont = el.closest('.question,[class*="question" i],.form-group,.field,[class*="Field"],li');
        if (cont) {
          let t = (cont.textContent || '').replace(/\s+/g, ' ').trim();
          // Strip each option's own label so only the question text remains.
          for (const r of cont.querySelectorAll('input[type=radio],input[type=checkbox]')) {
            const ol = getLabel(r); if (ol) t = t.split(ol).join(' ');
          }
          t = t.replace(/\s+/g, ' ').trim();
          if (t.length > 5) return t.slice(0, 200);
        }
      }
      return getLabel(el);
    } catch (_) { return getLabel(el); }
  }

  // Persist one manually-given Q&A into BOTH stores the fill paths read from:
  // the answer bank (exact/fuzzy label match) and saved responses (keyword match,
  // which is what answerKnockoutRadioGroup / choice groups consult).
  function learnManualAnswer(question, answer) {
    question = (question || '').replace(/\s+/g, ' ').trim();
    answer = (answer || '').trim();
    if (!question || question.length < 3 || !answer || answer.length > 300) return;
    if (/ssn|social.?security|password|credit.?card|cvv|routing|iban|passport.?number/i.test(question)) return;
    // Already known with the same answer (change + focusout both fire for one edit) — skip.
    if (_answerBank[normalizeKey(question)] === answer) return;
    learnAnswer(question, answer);
    const keywords = question.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2).slice(0, 12);
    if (keywords.length >= 2) addSavedResponse(keywords, answer);
    LOG(`Learned: "${question.slice(0, 70)}" → "${answer.slice(0, 40)}"`);
  }

  function learnFromFilledFields() {
    deepAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),textarea,select')
      .filter(el => isVisible(el) && hasFieldValue(el))
      .forEach(el => {
        // Radio/checkbox: question is the GROUP's, answer is the checked option's label.
        if (el.type === 'radio' || el.type === 'checkbox') {
          if (el.checked) learnManualAnswer(getQuestionForInput(el), (getLabel(el) || el.value || '').trim());
          return;
        }
        const lbl = getLabel(el);
        const val = el.tagName === 'SELECT' ? (el.options[el.selectedIndex]?.text || el.value) : el.value;
        if (lbl && val && val.trim()) learnManualAnswer(lbl, val.trim());
      });
  }

  function exportSavedResponses() {
    const data = JSON.stringify(_savedResponses, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `saved-responses-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    LOG(`Exported ${_savedResponses.length} saved responses`);
  }

  function importSavedResponses(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!Array.isArray(data)) throw new Error('Expected array');
      let imported = 0;
      for (const entry of data) {
        if (entry.keywords && entry.response) {
          const kws = Array.isArray(entry.keywords) ? entry.keywords : entry.keywords.split(',').map(s => s.trim());
          addSavedResponse(kws, entry.response);
          imported++;
        }
      }
      saveSavedResponses();
      LOG(`Imported ${imported} saved responses`);
      return imported;
    } catch (e) {
      LOG('Import error:', e.message);
      return 0;
    }
  }

  // ===================== MASTER KNOCKOUT QUESTION ANSWERING SYSTEM =====================
  // Comprehensive handling for radio, button-style, select, and text knockout questions
  function getFullQuestionText(el) {
    if (!el) return '';
    const containers = ['.question', '[class*="question"]', '[class*="Question"]', '.field',
      '.form-group', '[class*="FormField"]', '[data-automation-id]', 'fieldset',
      '[class*="form-field"]', '[class*="formElement"]', '[class*="input-group"]'];
    for (const sel of containers) {
      const p = el.closest(sel);
      if (p) return p.textContent?.trim().replace(/\s+/g, ' ') || '';
    }
    return getLabel(el);
  }

  /* ── WORK AUTHORISATION: the knockout that costs the most to get wrong ─────
     A recruiter wrote back: "I see that you filled in you're not allowed to work
     in Belgium. Is that correct? I see you're willing to move. We do not provide
     Visa sponsorship." The application had answered NO to an eligibility
     question, and that answer came from a single rule: any question mentioning
     visa or sponsorship was answered No. That is right for

         "Do you now or in the future REQUIRE visa sponsorship?"          → No

     and catastrophically wrong for

         "Are you allowed to work in Belgium WITHOUT visa sponsorship?"   → Yes

     Both sentences contain the word "sponsorship". What separates them is what
     the verb does to it, not whether the word is present:

       ELIGIBILITY — allowed / authorised / entitled / eligible / permitted / do
       you have the right to work — with or without a "…and will not require
       sponsorship" clause → YES.

       NEED — do you (now or in the future) require / need / seek / depend on
       sponsorship, a visa, or a work permit → NO.

       POSSESSION — do you hold a valid visa / work permit / right to work → YES.

     Also fixed here: British spelling. /authoriz/ never matched "authorised",
     and European ATS — most of what this queue applies to — spell it that way,
     so those questions fell through to the sponsorship rule and came back No. */
  const SPONSORSHIP_WORD_RE = /\b(sponsor\w*|visa|visas|work[\s-]?permit|working[\s-]?permit|immigration|h-?1b|tier[\s-]?2|skilled[\s-]?worker|green[\s-]?card|employment pass)\b/i;
  /* Phrases that ON THEIR OWN mean this is a right-to-work question, whatever
     else the sentence says. "Do you hold citizenship or permanent residency?"
     and "Do you require a Tier 2 / Skilled Worker visa?" contain no form of the
     word "work" at all. */
  const AUTH_STRONG_RE = /\b(sponsor\w*|visa|visas|work[\s-]?permit|working[\s-]?permit|immigration|h-?1b|tier[\s-]?2|skilled[\s-]?worker|green[\s-]?card|employment pass|right to work|work(ing)? rights?|work authoris\w+|work authoriz\w+|settled status|pre-?settled|citizenship|permanent residen\w*|residency|residence permit)\b/i;
  /* Weaker words — "allowed", "permitted", "legally" — that only mean right to
     work when the sentence is about working somewhere. */
  const ELIGIBILITY_WORD_RE = /\b(authoris\w+|authoriz\w+|eligib\w+|allowed|permitted|entitled|permission|lawful\w*|legally|legal right|able to work|can (you|i) work|freedom to work|unrestricted|proof of (your )?right)\b/i;
  // The verbs that turn a sponsorship mention into a request for the employer's help.
  const SPONSORSHIP_NEED_RE = /\b(requir\w*|need\w*|seek\w*|request\w*|obtain\w*|appl(y|ying) for|depend\w*|reliant|rely|assistance|support)\b/i;
  // …unless it is negated: "without requiring sponsorship", "does not require
  // sponsorship", "no sponsorship needed", "will not need a visa".
  const SPONSORSHIP_NEGATED_RE = /\b(without|not|non|no|never|free from|independent of|don'?t|doesn'?t|do not|does not|won'?t|will not)\b[^.?!]{0,48}?\b(sponsor\w*|visa|work[\s-]?permit|requir\w*|need\w*)/i;
  // "Do you HOLD a valid work permit / visa / right to work?"
  const HOLDS_AUTHORISATION_RE = /\b(have|has|hold|holds|holding|possess\w*|in possession of)\b[^.?!]{0,40}\b(valid |current |existing |unrestricted )?(visa|work[\s-]?permit|right to work|permission|authoris\w+|authoriz\w+|citizenship|residency|residence permit|green[\s-]?card|settled status)\b/i;

  /* 'yes' | 'no' | null. null means "this is not a work-authorisation question",
     so the caller carries on with its other rules. */
  function workAuthorisationAnswer(question) {
    const q = String(question || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!q) return null;
    const sponsorship = SPONSORSHIP_WORD_RE.test(q);
    const strong = AUTH_STRONG_RE.test(q);
    const eligibility = ELIGIBILITY_WORD_RE.test(q);
    if (!strong && !eligibility) return null;
    /* "legally", "permitted" and "allowed" turn up in questions that have nothing
       to do with the right to work — "have you ever been legally convicted?" is
       one, and answering that Yes would be far worse than the bug being fixed.
       A weak word only counts when the sentence is about working somewhere; a
       strong phrase ("visa", "right to work", "citizenship") needs no such help. */
    if (!strong && !/\b(work|working|worked|employ\w*|job|jobs|role|position|hire[dsr]?|career|country|nationality)\b/.test(q)) return null;
    // And never hijack a different knockout that happens to share the vocabulary.
    if (/\b(criminal|convict\w*|felony|misdemean\w*|debarr\w*|excluded by|non.?compete|restrictive covenant|terminated|dismissed|discharged|disciplin\w*|pending charges|drug (test|screen)|background check)\b/.test(q)) return null;
    // No sponsorship mentioned at all: a plain "are you allowed to work here?".
    if (!sponsorship) return 'yes';
    // Sponsorship IS mentioned — is it being ruled out, held, or asked for?
    if (SPONSORSHIP_NEGATED_RE.test(q)) return 'yes';
    if (HOLDS_AUTHORISATION_RE.test(q)) return 'yes';
    if (SPONSORSHIP_NEED_RE.test(q)) return 'no';
    if (eligibility) return 'yes';
    return 'no';                                   // bare "Visa sponsorship?" → No
  }

  // Exposed for the tests; kept next to the decider so the two cannot drift.
  function isWorkAuthorisationQuestion(q) {
    return workAuthorisationAnswer(q) !== null;
  }

  /* Relocation / mobility is the other half of that email ("I see you're willing
     to move") and is always Yes. The old list only knew four literal phrasings. */
  const RELOCATION_RE = /\b(relocat\w*|willing to move|open to (moving|relocation|relocating)|prepared to (move|relocate)|happy to (move|relocate)|consider (moving|relocating)|able to move|move (to|for)|willing to travel|able to commute|commute to)\b/i;

  // Smart Yes/No determination based on question context
  function determineYesNo(questionText) {
    const q = questionText.toLowerCase();
    // EEO/Diversity — prefer "Prefer not to say/answer"
    if (/gender|sex\b|disability|veteran|military|ethnic|race|racial|heritage|hispanic|latino/.test(q)) return 'eeo';

    // Work authorisation / sponsorship, decided by what the sentence actually
    // asks rather than by whether it contains the word "visa".
    const wa = workAuthorisationAnswer(q);
    if (wa) return wa;

    // STRONG "No" intents. These MUST take precedence over the generic yes-trigger
    // words ("will you", "can you", "do you"…) below. Previously a question like
    // "WILL YOU now or in the future require sponsorship?" returned "yes" purely
    // because /will you/ is a yes-word — which tells the employer the candidate NEEDS
    // sponsorship when they don't, failing the knockout. A strong-no always wins here,
    // EXCEPT when the sentence is actually an authorization/"without sponsorship"
    // affirmation ("Are you authorized to work WITHOUT requiring sponsorship?" → Yes).
    const strongNo = [
      /require.*(sponsor|visa|work.?permit)/, /need.*(sponsor|visa|work.?permit)/,
      /(require|requiring|need|needing).*sponsorship/, /sponsorship.*(required|needed)/,
      /previously.*worked.*for/, /former.*employee/, /current.*employee/,
      /worked.*(here|for us|for this|for the company).*before/, /applied.*before/,
      /criminal|convicted|felony|misdemeanor/, /non.?compete|restrictive.*covenant/,
      /conflict.*interest/, /(family|relative).*work/, /ever.*(work|employ).*(for|with).*(us|this|company)/,
      /pending.*charges/, /terminated|fired|dismissed|discharged/, /debarred/
    ];
    if (strongNo.some(r => r.test(q))) {
      // Word-bounded: a bare "no" here previously matched the "no" INSIDE "now"
      // (as in "Will you NOW or in the future require sponsorship?"), wrongly
      // flipping a No answer back to Yes.
      if (/authoriz|eligible|\b(?:without|not|don.?t)\b[^.]*(?:requir|need)[^.]*sponsor|legally\s+\w*\s*(?:work|authorized|able)/.test(q)) return 'yes';
      return 'no';
    }

    // Relocation / mobility, once the strong-No knockouts have had their say.
    if (RELOCATION_RE.test(q)) return 'yes';

    // Softer "No" intents — only applied when NO yes-word is present.
    const softNo = [/accommodation.*require/, /\brestriction/, /do you have.*(disability|felony|conviction|criminal)/];

    // Questions that should be "Yes".
    const yesPatterns = [
      ELIGIBILITY_WORD_RE, /proficien/, /experience.*have/,
      /comfortable/, /familiar/, /willing/, /\bable\b/, /available/, /can.*start/,
      /can.*commute/, /relocat/, /consent|agree|acknowledge|certify|confirm|attest/,
      /background.*check/, /drug.*test|screening/, /over.*18|18.*years|at.*least.*18/,
      /driving|license|licence/, /speak.*english|english.*proficien/, /reside/, /based.*in/,
      /commit/, /right.*work/, /work.*right/, /passport|citizen/,
      /docker|terraform|kubernetes|python|java|react|node|aws|azure|gcp|sql|typescript/,
      /debugging|network|linux|backend|developer|devops|sre|programming|rust|code|golang/,
      /production.*environment/, /hands.?on.*experience/, /do you have experience/,
      /have you.*experience/, /are you.*proficient/, /are you.*experienced/,
      /are you.*comfortable/, /can you/, /will you/, /would you be willing/,
      /reliable.*transport/, /work.*(night|weekend|holiday|overtime|shift|flexible)/,
      /travel.*up.*to/, /submit.*to/, /complete.*assessment/
    ];
    const shouldYes = yesPatterns.some(r => r.test(q));
    const shouldSoftNo = softNo.some(r => r.test(q));
    if (shouldSoftNo && !shouldYes) return 'no';
    if (shouldYes) return 'yes';
    return 'yes'; // Default to yes for unknown
  }

  // Experience range scoring (7+, 5-7, 3-5, 0-3)
  /* Which experience band to pick. Bands overlap on their boundaries — 5 years
     qualifies for both "3-5" and "5-8" — and whichever came first in the DOM used
     to win. More experience is never the worse answer to an employer screening on
     a minimum, so every qualifying band gets a bonus for its lower bound and the
     highest one wins. */
  function scoreExperienceRange(text, yearsExp) {
    const t = String(text || '').toLowerCase().trim();
    const band = (n) => Math.max(0, Math.min(parseInt(n, 10) || 0, 25));
    const plusM = t.match(/(\d+)\s*\+/);
    if (plusM && yearsExp >= parseInt(plusM[1])) return 200 + band(plusM[1]);
    const moreM = t.match(/(?:more\s+than|over|at\s+least)\s+(\d+)/i);
    if (moreM && yearsExp >= parseInt(moreM[1])) return 190 + band(moreM[1]);
    const rangeM = t.match(/(\d+)\s*(?:[-–—]|\s+to\s+)\s*(\d+)/);
    if (rangeM) {
      const low = parseInt(rangeM[1]), high = parseInt(rangeM[2]);
      if (yearsExp >= low && yearsExp <= high) return 150 + band(low);
      if (yearsExp > high) return 50 - (yearsExp - high);
      if (yearsExp < low) return 30 - (low - yearsExp);
    }
    const numM = t.match(/^(\d+)\s*years?/);
    if (numM && parseInt(numM[1]) <= yearsExp) return 100 + band(numM[1]);
    return 0;
  }

  // Comprehensive knockout question handler for radio button groups
  /* Commit one option of a multiple-choice question. A native radio takes a
     .click(); a Spark <spl-radio>, an Oracle <oj-radio>, a Material
     <mat-radio-button> or a role="radio" div does not, and silently stayed
     unanswered — which then blocked the whole step. Escalate until the control
     itself reports checked. */
  function commitChoice(el) {
    if (!el) return false;
    realClick(el);
    if (!choiceChecked(el)) triggerMouse(el);
    if (!choiceChecked(el)) {
      try {
        const scope = ownerScope(el);
        const lbl = (el.id && scope.querySelector) ? scope.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          : (el.closest && el.closest('label'));
        if (lbl) realClick(lbl);
      } catch (_) {}
    }
    if (!choiceChecked(el)) {
      const native = innerNative(el, 'input[type=radio],input[type=checkbox]') || el;
      try {
        if (typeof native.checked === 'boolean') native.checked = true;
        native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        native.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } catch (_) {}
      try { if (el.setAttribute && el !== native) el.setAttribute('aria-checked', 'true'); } catch (_) {}
    }
    return true;
  }

  /* Questions where the wrong answer is not a wrong answer but a rejection.
     Deliberately broad: it only ever decides whether a FUZZY match gets to
     overrule the reasoning below, so including a question that is not really a
     knockout costs nothing. */
  /* Sponsorship and visas are in here for a reason of their own. On a Greenhouse
     form these two sat next to each other:

       "Will you require visa sponsorship within the next 18 months to work in
        the United Kingdom?"
       "Do you currently have the right to work in the United Kingdom?"

     They share almost every word, so the 40%-overlap matcher handed the second
     question's saved "Yes" to the first — telling the employer the candidate
     needs sponsorship when they do not. */
  const KNOCKOUT_Q_RE = /\b(hands.?on|experience|experienced|proficien\w*|familiar|comfortable|willing|able to|capable|authoriz\w*|eligib\w*|right to work|legally|relocat\w*|commute|available|start date|sponsor\w*|visas?|work[\s-]?permit|do you have|have you (used|worked|built|managed))\b/i;

  /* A saved or learned answer normally beats every heuristic — they are the
     user's own words, given to this very question. But the matcher that finds
     them is fuzzy by design (40% keyword overlap), so a long question reaches an
     unrelated saved entry just by sharing nouns.

     On most questions a bad match is untidy. On a knockout it is fatal: a stray
     "No" against "Do you have hands-on experience with Linux patch and package
     management?" is an automatic rejection, and a recruiter has already written
     in about an application that claimed the candidate could not work in
     Belgium. So a saved Yes/No that contradicts the reasoning is dropped on
     exactly those questions, and only those. Anything that is not a bare Yes/No
     — a salary, a notice period, a written answer — is still returned as saved. */
  function safeKnockoutAnswer(saved, questionText) {
    if (!saved) return saved;
    const s = String(saved).trim().toLowerCase();
    if (!/^(yes|no|y|n|true|false)$/.test(s)) return saved;
    if (!KNOCKOUT_Q_RE.test(questionText)) return saved;
    let want = '';
    try { want = determineYesNo(String(questionText).toLowerCase()); } catch (_) {}
    if (want !== 'yes' && want !== 'no') return saved;
    const says = /^(yes|y|true)$/.test(s) ? 'yes' : 'no';
    if (says === want) return saved;
    LOG(`Ignoring a saved "${s}" on a knockout question — it contradicts the safe answer (${want})`);
    return '';
  }
  function savedAnswerFor(questionText) {
    return safeKnockoutAnswer(
      findSavedResponseMatch(questionText) || getLearnedAnswer(questionText), questionText);
  }

  function answerKnockoutRadioGroup(radios, parent, p) {
    // Read the question from the whole group container, shadow text included —
    // a web-component group's textContent is empty in the light DOM.
    let questionText = '';
    try {
      questionText = (parent && (parent.innerText || parent.textContent)) || '';
      if (!questionText.trim() && radios[0]) questionText = getFullQuestionText(radios[0]) || getLabel(radios[0]) || '';
    } catch (_) {}
    questionText = questionText.toLowerCase().replace(/\s+/g, ' ');

    // 1. Check saved responses first, then answers learned from the user's own manual
    // corrections — a previously-given human answer always beats the heuristics below.
    const savedAnswer = savedAnswerFor(questionText);
    if (savedAnswer) {
      const sNorm = savedAnswer.toLowerCase().trim();
      const optText = r => choiceLabel(r);
      // Exact option match first — a saved "No" must not hit "NOt applicable" by substring.
      const match = radios.find(r => optText(r) === sNorm)
        || (sNorm.length > 3 ? radios.find(r => optText(r).includes(sNorm)) : null);
      if (match) return commitChoice(match);
    }

    // 2. Experience range questions (0-3, 3-5, 5-7, 7+)
    if (/how many years|years of experience|experience.*years|how long.*work/i.test(questionText)) {
      const yearsExp = parseInt(p.years_experience || p.yearsExperience || DEFAULTS.years) || 9;
      let bestMatch = null, bestScore = -1;
      for (const radio of radios) {
        const text = choiceLabel(radio);
        const score = scoreExperienceRange(text, yearsExp);
        if (score > bestScore) { bestScore = score; bestMatch = radio; }
      }
      if (bestMatch && bestScore > 0) return commitChoice(bestMatch);
    }

    // 3. Yes/No questions with smart analysis
    const labels = radios.map(choiceLabel);
    // Yes/No — including REWORDED options ("Requires sponsorship" / "Does not require
    // sponsorship", "I am authorized" / "I am not authorized"). We decide semantically,
    // then map the decision onto the ACTUAL option wording via optionIndexForDecision.
    // This is the fix for picking the wrong option (or defaulting to the first = wrong)
    // when the choices aren't literally "Yes"/"No".
    {
      let decision = determineYesNo(questionText);
      if (decision === 'eeo') {
        // Try the profile value first for EEO questions.
        let eeoVal = '';
        if (/hispanic|latino|latina|latinx/i.test(questionText)) eeoVal = p.hispanic || 'No';
        else if (/gender|sex\b/i.test(questionText)) eeoVal = p.gender || '';
        else if (/ethnic|race|racial|heritage/i.test(questionText)) eeoVal = p.ethnicity || p.race || '';
        else if (/veteran|military/i.test(questionText)) eeoVal = p.veteran || '';
        else if (/disabilit/i.test(questionText)) eeoVal = p.disability || '';
        if (eeoVal) {
          const eeoMatch = radios.find(r => {
            const txt = choiceLabel(r);
            return txt === eeoVal.toLowerCase() || txt.includes(eeoVal.toLowerCase());
          });
          if (eeoMatch) return commitChoice(eeoMatch);
        }
        // Hispanic/Latino is really a No question; other EEO → decline.
        decision = /hispanic|latino|latina|latinx/i.test(questionText) ? 'no' : 'decline';
      }
      if (decision) {
        const idx = optionIndexForDecision(labels, decision, questionText);
        if (idx >= 0 && radios[idx]) return commitChoice(radios[idx]);
      }
    }

    // 4. Proficiency level questions
    if (/proficien|skill.?level|expertise|competenc|rating|how.*(rate|would you rate)/i.test(questionText)) {
      const levels = ['expert', 'advanced', 'proficient', 'experienced', 'senior', 'strong', 'high', 'fluent', '5', '4'];
      for (const level of levels) {
        const match = radios.find(r => choiceLabel(r).includes(level));
        if (match) return commitChoice(match);
      }
    }

    // 5. Education level questions
    if (/education.*level|highest.*degree|completed.*degree|level.*education/i.test(questionText)) {
      const levels = ["master", "master's", "graduate", "postgraduate", "bachelor", "undergraduate"];
      for (const level of levels) {
        const match = radios.find(r => choiceLabel(r).includes(level));
        if (match) return commitChoice(match);
      }
    }

    // 6. Salary range / compensation band questions
    if (/salary|compensation|pay.*range|pay.*band/i.test(questionText)) {
      const targetSalary = parseInt(p.expected_salary || DEFAULTS.salary) || 80000;
      let bestMatch = null, bestDiff = Infinity;
      for (const radio of radios) {
        const text = choiceLabel(radio);
        const nums = text.match(/[\d,]+/g);
        if (nums) {
          const avg = nums.reduce((s, n) => s + parseInt(n.replace(/,/g, '')), 0) / nums.length;
          const diff = Math.abs(avg - targetSalary);
          if (diff < bestDiff) { bestDiff = diff; bestMatch = radio; }
        }
      }
      if (bestMatch) return commitChoice(bestMatch);
    }

    // 7. Default: try guessValue match, then "Yes"
    const lbl = getLabel(radios[0]);
    const guess = guessFieldValue(lbl, p, radios[0]);
    if (guess) {
      const match = radios.find(r => choiceLabel(r).includes(guess.toLowerCase()));
      if (match) return commitChoice(match);
    }
    const yes = radios.find(r => /\byes\b/i.test(choiceLabel(r)));
    if (yes) return commitChoice(yes);
    return false;
  }

  // Button-style knockout questions (Ashby, Kraken, etc.) — non-radio UI
  // PERFORMANCE-CRITICAL: this used to be a synchronous loop over an ultra-broad, NESTED
  // selector, calling group.textContent (materializes the whole subtree) + a broad
  // querySelectorAll + isVisible (forces layout) on EVERY match. On a big form with open
  // date-picker calendars that was O(n²) synchronous work — the real "Page Unresponsive"
  // freeze. It's now bounded: narrower selector, a hard cap, innermost-first with consumed-
  // button dedup (so parent containers aren't reprocessed), option count capped at 2–6, and
  // the question text comes from a cheap bounded label — never a full-subtree textContent.
  function answerButtonStyleQuestions(p) {
    let answered = 0;
    let groups = deepAll('fieldset, [role="radiogroup"], [class*="radio-group"], [class*="RadioGroup"], [class*="ButtonGroup"], [class*="button-group"], [class*="question"], [class*="Question"]', 200)
      .filter(isVisible).slice(0, 120);
    // Innermost first so we answer the actual small choice group, not a wrapping container.
    const depth = el => { let d = 0; for (let n = el; n; n = n.parentElement) d++; return d; };
    groups.sort((a, b) => depth(b) - depth(a));
    const consumed = new Set(); // buttons already handled (dedupes nested containers)
    let processed = 0;
    for (const group of groups) {
      if (processed++ > 90) break; // hard cap — never let this run unbounded
      const selectedBtn = group.querySelector('[aria-checked="true"], [data-selected="true"], [aria-pressed="true"], [class*="Checked"]');
      if (selectedBtn) continue;
      const btns = $$('button, [role="button"], [role="option"], [role="radio"], div[tabindex], span[tabindex]', group)
        .filter(el => isVisible(el) && (el.textContent?.trim() || '').length > 0 && (el.textContent?.trim() || '').length < 80);
      if (btns.length < 2 || btns.length > 6) continue;      // a real Yes/No-ish choice group
      if (btns.some(b => consumed.has(b))) continue;          // handled via an inner group already
      btns.forEach(b => consumed.add(b));
      // Cheap, BOUNDED question text — a label/aria/legend, never the whole subtree.
      let groupText = (getLabel(group) || group.getAttribute('aria-label')
        || group.querySelector('legend,label,[class*="label"],[class*="title"],[class*="question"]')?.textContent
        || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
      const btnTexts = btns.map(b => (b.textContent?.trim() || '').toLowerCase());
      // Yes/No (incl. reworded options) — decide semantically, then map onto the real
      // button wording so "Does not require sponsorship" is picked for a NO, etc.
      const hasYesNoish = btnTexts.some(t => /^yes$/i.test(t)) || btnTexts.some(t => /^no$/i.test(t))
        || /sponsor|authori[sz]|require|eligible|do you|are you|have you|will you|willing|able to|consent|agree/i.test(groupText);
      if (hasYesNoish && btns.length <= 4) {
        let decision = determineYesNo(groupText);
        if (decision === 'eeo') decision = /hispanic|latino|latina|latinx/i.test(groupText) ? 'no' : 'decline';
        if (decision) {
          const bi = optionIndexForDecision(btnTexts, decision, groupText);
          if (bi >= 0 && btns[bi]) { realClick(btns[bi]); answered++; continue; }
        }
      }
      const hasRange = btnTexts.some(t => /\d+\s*[-–]\s*\d+|\d+\s*\+/i.test(t));
      if (hasRange && /experience|years|how (many|long)/i.test(groupText)) {
        const yearsExp = parseInt(p.years_experience || p.yearsExperience || DEFAULTS.years) || 9;
        let bestMatch = null, bestScore = -1;
        for (const btn of btns) {
          const score = scoreExperienceRange(btn.textContent?.trim() || '', yearsExp);
          if (score > bestScore) { bestScore = score; bestMatch = btn; }
        }
        if (bestMatch && bestScore > 0) { realClick(bestMatch); answered++; continue; }
      }
      if (/proficien|skill|expertise|level|rating/i.test(groupText)) {
        const levels = ['expert', 'advanced', 'proficient', 'experienced', 'strong', 'senior', 'high'];
        for (const level of levels) {
          const match = btns.find(b => b.textContent?.trim().toLowerCase().includes(level));
          if (match) { realClick(match); answered++; break; }
        }
      }
    }
    return answered;
  }

  // ===================== ENHANCED AUTOCOMPLETE DROPDOWN FINDER =====================
  function findAutocompleteDropdown(input) {
    const selectors = [
      '[class*="autocomplete"]', '[class*="typeahead"]', '[class*="suggestion"]',
      '[class*="dropdown"]', '[class*="listbox"]', '[role="listbox"]',
      '[class*="menu"]', 'ul[class*="option"]', '[data-automation-id*="dropdown"]',
      '.css-26l3qy-menu', '.Select-menu', '.react-select__menu',
      '[class*="dropdown-menu"]:not([style*="display: none"])'
    ];
    for (const sel of selectors) {
      const dd = $(sel);
      if (dd && isVisible(dd)) return dd;
    }
    const parent = input.closest('.form-group, .field, [class*="field"], [class*="FormField"]');
    if (parent) {
      for (const sel of selectors) { const dd = parent.querySelector(sel); if (dd && isVisible(dd)) return dd; }
    }
    return null;
  }

  function findBestDropdownMatch(dropdown, searchText) {
    const items = $$('li, [role="option"], [class*="option"], div[class*="item"]', dropdown);
    const search = searchText.toLowerCase();
    let match = items.find(i => i.textContent?.trim().toLowerCase() === search);
    if (match) return match;
    match = items.find(i => i.textContent?.trim().toLowerCase().includes(search));
    if (match) return match;
    const words = search.split(/\s+/);
    return items.find(i => words.some(w => w.length > 3 && i.textContent?.trim().toLowerCase().includes(w))) || null;
  }

  function findOtherOption(dropdown) {
    const items = $$('li, [role="option"], [class*="option"], option, div[class*="item"]', dropdown);
    return items.find(i => /^others?$/i.test(i.textContent?.trim() || '')) ||
      items.find(i => /\bother\b/i.test(i.textContent?.trim() || '')) ||
      items.find(i => /not listed|not found|unlisted|none of/i.test(i.textContent?.trim() || ''));
  }

  // ===================== ROBUST AUTOCOMPLETE / LOCATION COMMITTER (FULL-AUTO) =====================
  // Many "Location (City)" fields are Google-Places / typeahead widgets: typing text is NOT
  // enough — the site only accepts the value once a suggestion is *selected* from the dropdown.
  // Without that selection the form shows "Please enter your location" and the queue stalls
  // forever waiting for a human. This committer types the value, waits for the suggestion list,
  // and selects the best match (real click first, keyboard ArrowDown+Enter as fallback) so the
  // application runs with zero supervision.

  // Detect Google Places "pac" container suggestions (rendered at <body> level, outside the field).
  function findPacItems() {
    const containers = $$('.pac-container').filter(c => isVisible(c) && c.offsetHeight > 0);
    for (const c of containers) {
      const items = $$('.pac-item', c).filter(isVisible);
      if (items.length) return items;
    }
    return [];
  }

  // Is this input a location / city / address autocomplete?
  function isLocationField(el) {
    if (!el || (el.tagName !== 'INPUT' && el.getAttribute('contenteditable') !== 'true')) return false;
    const hay = [getLabel(el), el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'), el.getAttribute('data-automation-id')]
      .filter(Boolean).join(' ').toLowerCase();
    if (/password|email|phone|search jobs|keyword/i.test(hay)) return false;
    return /location|city|town|address|where.*(live|based)|postal|zip|metro|region/i.test(hay) ||
      el.getAttribute('autocomplete') === 'address-level2' ||
      /(^|\W)(pac-target-input)(\W|$)/.test(el.className || '');
  }

  // Type a value char-by-char so JS-driven autocompletes fire their keyup handlers.
  async function typeInto(el, value) {
    el.focus({ preventScroll: true });
    nativeSet(el, '');
    await sleep(60);
    // Set full value, then emit a trailing keystroke so frameworks open the dropdown.
    nativeSet(el, value);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true, composed: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, composed: true }));
  }

  // Commit an autocomplete field to a real, accepted value. Returns true on commit.
  async function commitAutocomplete(el, value) {
    if (!el || !value) return false;
    try {
      await typeInto(el, value);

      // Poll for a suggestion list to appear (Google Places + generic widgets).
      let pac = [], generic = null, generItems = [];
      for (let i = 0; i < 16; i++) { // up to ~4s
        await sleep(250);
        pac = findPacItems();
        if (pac.length) break;
        generic = findAutocompleteDropdown(el);
        if (generic) {
          generItems = $$('li,[role="option"],[class*="option"],div[class*="item"]', generic)
            .filter(isVisible).filter(it => (it.textContent || '').trim().length > 1);
          if (generItems.length) break;
        }
      }

      // Prefer Google Places suggestions.
      if (pac.length) {
        const search = value.toLowerCase();
        const best = pac.find(it => (it.textContent || '').toLowerCase().includes(search.split(',')[0].trim())) || pac[0];
        scrollIfNeeded(best);
        realClick(best);
        await sleep(400);
        // Google Places needs ArrowDown+Enter on some builds — do it as a reinforcement.
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        LOG('Location committed via Google Places suggestion');
        return true;
      }

      // Generic typeahead / react-select / listbox.
      if (generItems.length) {
        const match = findBestDropdownMatch(generic, value.split(',')[0].trim()) || generItems[0];
        scrollIfNeeded(match);
        realClick(match);
        await sleep(300);
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        LOG('Location committed via typeahead suggestion');
        return true;
      }

      // No dropdown at all — fall back to keyboard selection (ArrowDown+Enter) then commit raw.
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, composed: true }));
      await sleep(200);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      LOG('Location: no dropdown — committed via keyboard/raw value');
      return !!el.value?.trim();
    } catch (e) {
      LOG('commitAutocomplete error:', e?.message || e);
      return false;
    }
  }

  // Find every visible location-style input and commit it to a real selection.
  async function resolveLocationFields() {
    const p = await getProfile();
    const cityVal = (p.city ? `${p.city}${p.state ? ', ' + p.state : ''}${p.country ? ', ' + p.country : ''}` : '').trim()
      || p.location || p.city || '';
    if (!cityVal) return 0;
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button])')
      .filter(el => isVisible(el) && isLocationField(el));
    let committed = 0;
    for (const inp of inputs) {
      // Skip fields the site already accepts (value present AND no nearby validation error).
      const container = inp.closest('.form-group,.field,[class*="field"],[class*="Field"],li,div');
      const hasError = container && /please enter|required|invalid|enter your/i.test(container.textContent || '')
        && !hasFieldValue(inp);
      if (hasFieldValue(inp) && !hasError && !/^\s*$/.test(inp.value)) {
        // Has a value but the widget may still be uncommitted — only re-commit if an error shows.
        if (!container || !/please enter|enter your location|invalid/i.test(container.textContent || '')) continue;
      }
      // Use the most specific label-appropriate value (city-only for pure "city" fields).
      const lbl = (getLabel(inp) || '').toLowerCase();
      const val = /^.*\bcity\b.*$/.test(lbl) && p.city ? `${p.city}${p.state ? ', ' + p.state : ''}` : cityVal;
      if (await commitAutocomplete(inp, val)) committed++;
      await sleep(300);
    }
    if (committed) LOG(`Resolved ${committed} location field(s)`);
    return committed;
  }

  // WORKAROUND for the fields Jobright's autofill commonly leaves blank (and that then
  // block submission): visa-sponsorship / work-authorization questions and the EEO /
  // demographic questions, which are usually RADIO groups (guaranteeRequiredFields only
  // covered selects + text). Map the question text to a safe default and tick it.
  function chooseChoiceAnswer(q) {
    q = (q || '').toLowerCase();
    if (!q) return null;
    /* One decider for both directions. This used to be two rules in the wrong
       order — ANY mention of visa/sponsorship answered No, so "are you allowed to
       work in Belgium without visa sponsorship?" was answered No and the employer
       read it as "not allowed to work in Belgium". */
    const wa = workAuthorisationAnswer(q);
    if (wa) return wa;
    if (/hispanic|latino|latina|latinx/.test(q)) return 'no';   // "Are you Hispanic/Latino?" → No
    if (/veteran/.test(q)) return 'decline';
    if (/disab/.test(q)) return 'decline';
    if (/\bgender\b|\bsex\b|how do you identify/.test(q)) return 'decline';
    if (/\brace\b|ethnic/.test(q)) return 'decline';
    if (/at least 18|over 18|18 years|age of 18|are you.*\b18\b/.test(q)) return 'yes';
    if (/agree|consent|terms|certif|acknowledge|read and understood/.test(q)) return 'yes';
    // Knockouts where anything but Yes ends the application: location/relocation
    // commitment, in-office/hybrid attendance, commute, start availability.
    if (RELOCATION_RE.test(q)) return 'yes';
    if (/in.?office|on.?site|onsite|hybrid|days per week|commute|report to.*office|work from the office/.test(q)) return 'yes';
    if (/able to start|available to start|start (date|immediately|within)/.test(q)) return 'yes';
    if (/background check|drug (test|screen)|reference check|pre.?employment screen/.test(q)) return 'yes';
    return null;
  }
  /* Every ATS renders a Yes/No as something different: a native radio with a
     sibling <label>, a role="radio" div, a Spark <spl-radio> whose text lives in
     its own shadow root, an Oracle <oj-radioset> option. Read all of them, or the
     option matcher sees an empty label and falls back to "first option". */
  function choiceLabel(r) {
    let out = '';
    try {
      /* A custom element carries its own option text in an attribute —
         SmartRecruiters writes <spl-radio label="Yes">. Ask it FIRST. getLabel()
         climbs for a label, and on a web-component radio there is nothing local
         to find, so it kept climbing to the GROUP and returned the question
         text: every option in the group came back with the same string, and the
         matcher then picked whichever one it happened to see first. */
      const tag = (r.tagName || '').toLowerCase();
      if (tag.includes('-') && r.getAttribute) {
        out = (r.getAttribute('label') || r.getAttribute('aria-label') || '').trim();
      }
      if (!out) out = getLabel(r) || '';
      if (!out) out = (r.getAttribute && (r.getAttribute('aria-label') || r.getAttribute('label'))) || '';
      if (!out && r.shadowRoot) out = (r.shadowRoot.textContent || '').trim();
      if (!out) out = (r.value || '');
      if (!out && r.nextElementSibling) out = r.nextElementSibling.textContent || '';
      if (!out && r.closest && r.closest('label')) out = r.closest('label').textContent || '';
      if (!out) out = (r.textContent || '');
    } catch (_) {}
    return String(out).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  // Checked-state for any of those renderings.
  function choiceChecked(r) { return checkboxChecked(r); }
  /* Controls that can act as one option of a multiple-choice question, on every
     component library the supported ATS use. */
  const CHOICE_CONTROL_SEL = 'input[type=radio],[role="radio"],spl-radio,oj-radio,mat-radio-button,' +
    'md-radio,sl-radio,ion-radio,vaadin-radio-button';

  // ── Semantic option matching ──────────────────────────────────────────────
  // Our knockout logic decides yes / no / decline. But real ATS options are often
  // WORDED, not literal — e.g. "Requires sponsorship for employment authorization" vs
  // "Does not require sponsorship". These map a decision onto the actual option text by
  // reading each option's polarity, so a NO decision correctly clicks the "Does not
  // require…" option instead of guessing (or picking the first = wrong).
  function isDeclineOption(text) {
    return /prefer not|do(es)? ?n['’]?t wish|do not wish|\bdecline\b|choose not|not to (answer|say|disclose|identify)|rather not/i.test(text || '');
  }
  // -1 = negative/negated premise ("does not require", "no", "not authorized"),
  // +1 = affirmative ("requires", "yes", "I am authorized"), 0 = neutral/unknown.
  function optionPolarity(text) {
    const t = ' ' + (text || '').toLowerCase().replace(/[^a-z0-9'’\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    if (!t.trim()) return 0;
    /* A leading Yes / No is the answer; the rest of the option is elaboration.
       "Yes, I am authorized to work in the US without sponsorship" used to read
       as NEGATIVE, because it contains "without" — and on a two-option question
       that selected "No, I require sponsorship" instead. That is the answer the
       recruiter saw as "you filled in you're not allowed to work in Belgium". */
    if (/^ (no|nope|false|incorrect|i do not|i don'?t|i am not|i'?m not|i will not|i won'?t|i cannot|i can'?t|not)\b/.test(t)) return -1;
    if (/^ (yes|yeah|yep|true|correct)\b/.test(t)) return 1;
    /* An eligibility assertion whose only negative word is attached to
       sponsorship is affirmative: "authorized to work without sponsorship",
       "eligible to work, no visa required". A statement that negates the
       ELIGIBILITY itself still reads negative. */
    const assertsEligibility = /\b(authoriz\w+|authoris\w+|eligible|allowed|permitted|entitled|right to work|work rights?|work permit|citizen\w*|permanent resident\w*|lawfully)\b/.test(t);
    const negativeIsOnSponsorship = /\b(without|no|not|never|don'?t|doesn'?t|won'?t)\b[^.]{0,26}?\b(sponsor\w*|visa|work permit|immigration)\b/.test(t);
    const negatesEligibility = /\b(not|n['’]?t|never|cannot|cant|unable|ineligible)\b[^.]{0,20}?\b(authoriz\w+|authoris\w+|eligible|allowed|permitted|entitled)\b/.test(t);
    if (assertsEligibility && negativeIsOnSponsorship && !negatesEligibility) return 1;
    // An explicit negator makes the statement negative regardless of where it sits —
    // "I am NOT authorized" / "Does NOT require" must read as -1 even though "i am" /
    // "require" appear. Negation dominates; affirmative only counts when none is present.
    const NEG = /\b(no|not|n['’]?t|dont|doesnt|does not|do not|will not|wont|cannot|cant|never|without|none|neither|unable|unwilling)\b/;
    const AFF = /\b(yes|requires?|needs?|need|authorized|authorised|eligible|allowed|permitted|entitled|agree|accept|consent|confirm|i do|i am|i will|i have|i hold|holds?|possess\w*|currently)\b/;
    if (NEG.test(t)) return -1;
    if (AFF.test(t)) return 1;
    return 0;
  }
  // Return the index of the option (from an array of label texts) that best satisfies the
  // decision, or -1 if nothing fits confidently.
  /* Choosing the option for a work-authorisation question is not a generic
     polarity problem, and treating it as one is what produced the answer the
     recruiter read as "not allowed to work in Belgium".

     "I require visa sponsorship" is grammatically AFFIRMATIVE. "Does not require
     sponsorship" is grammatically NEGATIVE. Yet for an eligibility question the
     first is the wrong answer, and for a sponsorship question the second is the
     right one — the grammar points the opposite way to the meaning in both.

     There is only ever one stance to express here: I can work in this country and
     I do not need the employer to sponsor me. Whether the question asks it
     positively ("are you allowed to work here?") or negatively ("do you require
     sponsorship?"), that stance is the answer — so score each option for how well
     it SAYS that, and take the best. No decision needs to be threaded through. */
  function workAuthOptionIndex(texts) {
    if (!texts || !texts.length) return -1;
    const score = (raw) => {
      const t = ' ' + String(raw || '').toLowerCase().replace(/[^a-z0-9'’\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
      if (!t.trim()) return 0;
      const negatedSponsor = /\b(without|no|not|never|don'?t|doesn'?t|won'?t|will not|do not|does not)\b[^.]{0,26}?\b(sponsor\w*|visa|work permit|immigration)\b/.test(t);
      const needsSponsor = /\b(requir\w*|need\w*|seek\w*|depend\w*|reliant|rely)\b[^.]{0,26}?\b(sponsor\w*|visa|work permit|immigration)\b/.test(t) ||
        /\b(sponsor\w*|visa|work permit)\b[^.]{0,20}?\b(requir\w*|need\w*)\b/.test(t);
      const asserts = /\b(authoriz\w+|authoris\w+|eligible|allowed|permitted|entitled|right to work|work rights?|work permit|citizen\w*|permanent resident\w*|lawfully|hold\w*|have|possess\w*)\b/.test(t);
      const negatesEligibility = /\b(not|n'?t|never|cannot|unable|ineligible)\b[^.]{0,18}?\b(authoriz\w+|authoris\w+|eligible|allowed|permitted|entitled)\b/.test(t);
      let sc = 0;                                  // > 0 = "I can work here"
      if (/^ (yes|yeah|yep|true|correct)\b/.test(t)) sc += 6;
      if (/^ (no|nope|false|incorrect|not)\b/.test(t)) sc -= 6;
      if (negatedSponsor) sc += 4; else if (needsSponsor) sc -= 4;
      if (asserts) sc += 2;
      if (negatesEligibility) sc -= 8;
      return sc;
    };
    let best = -1, bestScore = 0;
    texts.forEach((t, i) => { const v = score(t); if (v > bestScore) { bestScore = v; best = i; } });
    return best;
  }

  function optionIndexForDecision(texts, decision, question) {
    if (!texts || !texts.length || !decision) return -1;
    const norm = texts.map(t => (t || '').trim().toLowerCase());
    // Work authorisation / sponsorship gets its own matcher — see above.
    if (question && workAuthorisationAnswer(question)) {
      const wi = workAuthOptionIndex(norm);
      if (wi >= 0) return wi;
    }
    if (decision === 'decline' || decision === 'eeo') {
      const di = norm.findIndex(isDeclineOption);
      if (di >= 0) return di;
    }
    const want = decision === 'no' ? 'no' : decision === 'yes' ? 'yes' : null;
    if (want) {
      const exact = norm.findIndex(t => t === want || t === want + '.');
      if (exact >= 0) return exact;
    }
    const wantPol = decision === 'yes' ? 1 : decision === 'no' ? -1 : 0;
    if (wantPol !== 0) {
      const pol = norm.map(optionPolarity);
      // Prefer an option whose polarity matches the decision.
      const match = pol.findIndex(p => p === wantPol);
      if (match >= 0) return match;
      // Two-option group where only the OPPOSITE is polarized → pick the other one.
      if (texts.length === 2) {
        const opp = pol.findIndex(p => p === -wantPol);
        if (opp >= 0) return opp === 0 ? 1 : 0;
      }
    }
    return -1;
  }

  // Decision-aware <option> picker for native selects, ATS-agnostic. Only applies the
  // yes/no/decline mapping when the option set is genuinely BINARY (<=3 options that
  // carry clear affirmative/negative polarity, or literal Yes/No) — so it never hijacks
  // a Country / Degree / Year select. Otherwise it defers to value/keyword matching.
  function selectOptionForQuestion(el, lbl, p) {
    const opts = $$('option', el).filter(o => o.value && o.index > 0);
    if (!opts.length) return null;
    const texts = opts.map(o => (o.text || '').trim());
    const q = lbl || '';
    const pols = texts.map(optionPolarity);
    const hasPolarPair = pols.includes(1) && pols.includes(-1);
    const literalYN = texts.some(t => /^yes$/i.test(t)) && texts.some(t => /^no$/i.test(t));
    const declinable = /gender|disability|veteran|race|ethnic|sex\b|hispanic|latino/i.test(q);
    if (texts.length <= 3 && (hasPolarPair || literalYN || declinable)) {
      let decision = determineYesNo(q);
      if (decision === 'eeo') decision = /hispanic|latino|latina|latinx/i.test(q) ? 'no' : 'decline';
      if (decision) {
        const idx = optionIndexForDecision(texts, decision, q);
        if (idx >= 0) return opts[idx];
      }
    }
    // Value/keyword fallback (exact text, then contains).
    const val = guessFieldValue(lbl, p, el);
    if (val) {
      const v = val.toLowerCase();
      return opts.find(o => o.text.trim().toLowerCase() === v)
        || opts.find(o => o.text.toLowerCase().includes(v))
        || null;
    }
    return null;
  }

  async function pickChoice(radios, want, question) {
    // First: semantic mapping onto the real option wording.
    const labels = radios.map(choiceLabel);
    const idx = optionIndexForDecision(labels, want, question);
    let target = idx >= 0 ? radios[idx] : null;
    if (!target) {
      // Legacy literal fallback.
      const isYes = r => /^\s*(yes|y|true|1|i (am|do|will)|authorized|eligible)\b/.test(choiceLabel(r));
      const isNo = r => /^\s*(no|n|false|0|i (am not|do not|don'?t|will not)|not require|do not require)\b/.test(choiceLabel(r));
      const isDecline = r => isDeclineOption(choiceLabel(r));
      target = want === 'yes' ? radios.find(isYes)
        : want === 'no' ? radios.find(isNo)
          : radios.find(isDecline) || radios.find(isNo);
    }
    if (!target) return false;
    // A plain .click() is ignored by Spark/JET/Material radios, so run the same
    // escalating strategy the consent boxes use (inner input → click → full
    // pointer sequence → label → Space → native set). Fire-and-forget: callers of
    // pickChoice are synchronous, and the state check below covers the fast paths.
    commitChoice(target);
    if (!choiceChecked(target)) { try { await setCheckboxChecked(target); } catch (_) {} }
    return true;
  }
  // Questions we've already decided an answer for, keyed by normalized question TEXT
  // (not DOM node identity). Some ATS forms re-render the radio inputs as fresh DOM
  // nodes on every state change, which reset WeakSet/`.checked`-based "already
  // answered" tracking to appear unanswered again — that was causing us to re-click
  // the same question repeatedly (visible as the Q&A checklist "flickering"). Keying
  // on the question text survives DOM node churn, and the cooldown below caps how
  // often we'll re-attempt any single question even if it keeps getting reset.
  const _choiceAnsweredAt = new Map();
  const CHOICE_RETRY_MS = 6000;
  function normalizeQ(q) { return (q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200); }
  async function answerChoiceGroups() {
    let n = 0;
    const groups = new Map();
    for (const r of deepAll(CHOICE_CONTROL_SEL).filter(isVisible)) {
      // Group by (in order of preference): native radio name, the closest shared
      // question/fieldset container, or the immediate parent element. We deliberately
      // never fall back to the radio ITSELF as a key — that split a single Yes/No
      // pair (two radios with no name/container in common) into two bogus 1-radio
      // "groups", which could answer/read the wrong one.
      let key = null;
      try { key = r.name || (r.getAttribute && r.getAttribute('name')) || null; } catch (_) {}
      if (!key) { try { key = r.closest('fieldset,[role=radiogroup],[role=group],.form-group,.field,.question,li'); } catch (_) {} }
      if (!key) key = r.parentElement || r;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const radios of groups.values()) {
      let fs = null;
      try { fs = radios[0].closest('fieldset,[role=radiogroup],[role=group],.question,[class*="question" i],.form-group,.field,li'); } catch (_) {}
      let q = '';
      if (fs) { const lab = fs.querySelector('legend,label,[class*="label" i],[class*="title" i],[class*="question" i]'); q = (lab && lab.textContent) || fs.textContent || ''; }
      if (!q) q = getLabel(radios[0]) || '';
      const nq = normalizeQ(q);
      if (radios.some(choiceChecked)) { _choiceAnsweredAt.set(nq, Date.now()); continue; } // already answered
      // Skip if we already attempted this exact question recently — stops an
      // infinite re-click loop on ATS forms that keep resetting the radio state.
      const lastTry = _choiceAnsweredAt.get(nq);
      if (lastTry && Date.now() - lastTry < CHOICE_RETRY_MS) continue;
      // An answer the user gave manually before (learned Q&A) wins over the defaults.
      const learned = findSavedResponseMatch(q) || getLearnedAnswer(q);
      if (learned) {
        const lnorm = learned.toLowerCase().trim();
        // Exact label match FIRST — a learned "No" must hit the "No" option, not
        // "NOt applicable" / "I do NOt wish to answer" via a substring match.
        const lm = radios.find(r => choiceLabel(r) === lnorm)
          || radios.find(r => { const cl = choiceLabel(r); return cl && (cl.startsWith(lnorm + ' ') || (lnorm.startsWith(cl) && cl.length > 1)); })
          || (lnorm.length > 3 ? radios.find(r => (choiceLabel(r) || '').includes(lnorm)) : null);
        if (lm) { _choiceAnsweredAt.set(nq, Date.now()); realClick(lm); n++; await sleep(120); continue; }
      }
      const want = chooseChoiceAnswer(q);
      if (!want) continue;
      _choiceAnsweredAt.set(nq, Date.now());
      if (await pickChoice(radios, want, q)) { n++; await sleep(120); }
    }
    if (n) LOG(`Workaround: answered ${n} choice group(s) Jobright left blank (sponsorship/auth/EEO)`);
    return n;
  }

  /* ── UNIVERSAL QUESTION COVERAGE (every ATS) ───────────────────────────────
     Three defects were platform-independent, even though each was reported on
     one site:

       1. STALE STEP. A single-page ATS swaps its questions in place. Waiting a
          flat 2.8s after "Next" and then reading the DOM meant we filled — and
          reported on — the step we had just left (SmartRecruiters /screening
          was the reproducer; Workday, Oracle, Greenhouse and Ashby all do the
          same thing). Nothing may be read until the question set has actually
          changed AND stopped moving.
       2. DEPENDENT QUESTIONS. A question that only renders once its parent is
          answered ("If you selected Yes, would you consider relocating at your
          own expense?") was never seen, because no pass ever looked again after
          answering something.
       3. DECLARATION BOXES. "You declare that you have read and understand the
          privacy notice of ..." is a custom element on half the platforms, so
          `input[type=checkbox]` never matched it and the step came back with
          "Value is required".

     All three are handled here once, and every driver goes through it. */

  /* Every control that can carry an answer, across native HTML and the web
     component sets the major ATS ship — Spark (spl-*, SmartRecruiters), Oracle
     JET (oj-*), Angular Material, Material Web, Shoelace, Ionic, Vaadin.
     Deliberately broad: a control we don't recognise is a question we silently
     skip, which is exactly the failure mode being fixed. */
  const QUESTION_CONTROL_SEL = [
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset])',
    'select', 'textarea', '[contenteditable="true"]',
    '[role="radio"]', '[role="checkbox"]', '[role="combobox"]', '[role="listbox"]',
    '[role="switch"]', '[role="spinbutton"]', '[role="textbox"]',
    'spl-input', 'spl-select', 'spl-radio', 'spl-checkbox', 'spl-textarea', 'spl-date-input',
    'oj-input-text', 'oj-text-area', 'oj-select-single', 'oj-select-one', 'oj-combobox-one',
    'oj-radioset', 'oj-checkboxset', 'oj-input-date',
    'mat-select', 'mat-checkbox', 'mat-radio-button', 'mat-slide-toggle',
    'md-outlined-select', 'md-filled-select', 'md-checkbox', 'md-radio',
    'sl-select', 'sl-checkbox', 'sl-radio', 'sl-switch',
    'ion-select', 'ion-checkbox', 'ion-radio', 'ion-toggle',
    'vaadin-combo-box', 'vaadin-checkbox', 'vaadin-radio-button', 'vaadin-select',
  ].join(',');

  /* getComputedStyle is the expensive half of isVisible, and calling it once per
     control forces a style recalculation each time — 400 of them per fingerprint,
     several times a second, was a large part of what made this build heavy. The
     fingerprint only needs to know whether a control is on screen at all, and a
     zero-sized box already covers display:none anywhere up the ancestor chain. */
  function isVisibleFast(el) {
    try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    catch (_) { return false; }
  }
  function questionControls(cap) {
    try { return deepAll(QUESTION_CONTROL_SEL, cap || 400).filter(isVisibleFast); }
    catch (_) { return []; }
  }

  /* A fingerprint of WHICH questions are on screen — never of their values, so
     filling a field does not look like a new step, while a step swap or a newly
     revealed sub-question always does. Built on deepAll, so it sees inside
     shadow roots and same-origin frames (the old getPageHash used a plain
     document query and was therefore IDENTICAL on every SmartRecruiters and
     Oracle step, which is what let the loop fill the previous step twice). */
  /* Memoised. waitForStepChange polls this every 300ms and several passes call
     it two or three times each, so without a cache one step transition meant
     dozens of full deep walks — each of which forces a layout per control. The
     TTL is short enough that a genuine step change is still seen on the next
     poll, and long enough that nested callers collapse into one computation. */
  let _sigCache = '', _sigAt = 0;
  const SIG_TTL_MS = 250;
  function stepSignature() {
    const now = Date.now();
    if (now - _sigAt < SIG_TTL_MS) return _sigCache;
    const sig = stepSignature__impl();
    _sigCache = sig; _sigAt = now;
    return sig;
  }
  function stepSignature__impl() {
    let bits = [];
    try {
      bits = questionControls(400).map((el) => {
        const tag = (el.tagName || '').toLowerCase();
        let type = '';
        let key = '';
        try {
          type = el.getAttribute('type') || '';
          key = (el.getAttribute('name') || el.getAttribute('id') ||
            el.getAttribute('data-automation-id') || el.getAttribute('data-testid') ||
            el.getAttribute('aria-labelledby') || '').trim();
        } catch (_) {}
        /* Never fall back to the LABEL. The label lookup reaches into the
           field's container, which picks up validation messages and helper text
           as well as the question — so the
           signature changed every time we filled something or the site showed an
           error, every caller concluded "the page advanced / new questions
           appeared", and the fill passes ran again and again. That is the
           infinite re-fill. A structural key changes when questions are added or
           removed and at no other time. */
        if (!key) {
          let idx = 0, n = el;
          try { while ((n = n.previousElementSibling)) idx++; } catch (_) {}
          let parentTag = '';
          try { parentTag = (el.parentElement && el.parentElement.tagName || '').toLowerCase(); } catch (_) {}
          key = parentTag + '#' + idx;
        }
        return tag + '|' + type + '|' + key;
      });
    } catch (_) {}
    let where = '';
    try { where = location.origin + location.pathname + location.search; } catch (_) {}
    return where + '::' + bits.length + '::' + bits.join('~').slice(0, 1800);
  }

  /* Wait until the page is genuinely showing a DIFFERENT set of questions, and
     then until that set stops moving. Returns false when the step never changed
     — the caller then knows something is blocking it (a validation error, a
     missed required field) rather than cheerfully re-filling the old step.
     Runs inside withBusy so the stall watchdog does not count a legitimate
     page transition as a stuck job. */
  async function waitForStepChange(previousSignature, maxMs) {
    return withBusy('waiting for the next step', async () => {
      const limit = maxMs || 15000;
      const start = Date.now();
      let seen = previousSignature;
      let settledAt = 0;
      while (Date.now() - start < limit) {
        await sleep(300);
        const now = stepSignature();
        if (now === previousSignature) { seen = now; settledAt = 0; continue; }
        if (now !== seen) { seen = now; settledAt = Date.now(); continue; }   // still rendering
        if (!settledAt) settledAt = Date.now();
        if (Date.now() - settledAt >= scaled(700, 220)) { noteProgress('next step rendered'); return true; }
      }
      return stepSignature() !== previousSignature;
    });
  }

  /* ── declaration / consent boxes on every platform ────────────────────────── */
  const CONSENT_CONTROL_SEL = 'input[type=checkbox],[role="checkbox"],[role="switch"],spl-checkbox,' +
    'oj-checkboxset,mat-checkbox,mat-slide-toggle,md-checkbox,sl-checkbox,sl-switch,ion-checkbox,' +
    'ion-toggle,vaadin-checkbox';

  /* Wording seen across ATS consent / declaration boxes. Wide on purpose: the
     old list (consent|agree|privacy|gdpr|terms|data process|acknowledg) missed
     "You DECLARE that you have READ and UNDERSTAND the privacy NOTICE of ...",
     which is how a 100%-filled form still failed with "Value is required". */
  const CONSENT_TEXT_RE = /\b(consent|agree|agreed|agreement|accept|accepted|privacy|policy|notice|statement|gdpr|ccpa|terms|conditions|data.?(process|processing|protection|transfer|retention)|acknowledg\w*|declar\w*|certif\w*|confirm\w*|attest\w*|affirm\w*|understand\w*|authoris\w*|authoriz\w*|permission|disclaimer|disclosure|e-?sign\w*|electronic signature|have read|read and|true and (complete|accurate)|to the best of my knowledge)\b/i;

  /* Text that means the form is currently REFUSING to advance because of this
     control — the "Value is required" under the unticked declaration box. */
  const REQUIRED_ERROR_RE = /\b(value is required|is required|required field|this field is required|please (select|choose|check|tick|accept|agree|confirm|answer|complete|provide)|must be (selected|checked|accepted|answered|provided)|cannot be (blank|empty)|mandatory|field is mandatory)\b/i;

  /* Never auto-tick these, however "required" the markup claims to be. */
  const MARKETING_TEXT_RE = /\b(market\w*|newsletter|promotion\w*|job.?alert\w*|subscribe|subscription|keep me (updated|informed|posted)|notify me|email me about|similar (jobs|roles|opportunities)|talent (community|network|pool)|future (job )?opportunities)\b/i;

  /* The native <input> a web-component checkbox wraps, wherever it hides it. */
  function innerNative(el, sel) {
    try {
      if (el.matches && el.matches(sel)) return el;
      if (el.shadowRoot) { const s = el.shadowRoot.querySelector(sel); if (s) return s; }
      if (el.querySelector) { const q = el.querySelector(sel); if (q) return q; }
    } catch (_) {}
    return null;
  }

  function checkboxChecked(el) {
    try {
      const native = innerNative(el, 'input[type=checkbox],input[type=radio]');
      if (native && typeof native.checked === 'boolean') return native.checked;
      if (typeof el.checked === 'boolean') return el.checked;
      const aria = el.getAttribute && el.getAttribute('aria-checked');
      if (aria === 'true') return true;
      if (aria === 'false') return false;
      if (el.hasAttribute && el.hasAttribute('checked')) return true;
    } catch (_) {}
    return false;
  }

  /* Everything readable about a control: its own label, its question container,
     and — for a web component — the text inside its shadow root, which is where
     SmartRecruiters keeps the declaration sentence. */
  function controlText(el) {
    const bits = [];
    try { bits.push(el.getAttribute && (el.getAttribute('aria-label') || '')); } catch (_) {}
    try { bits.push(getLabel(el) || ''); } catch (_) {}
    try { bits.push(getFullQuestionText(el) || ''); } catch (_) {}
    try {
      const host = el.closest && el.closest('label,.field,.question,[class*="checkbox" i],[class*="consent" i],[class*="declaration" i],li,fieldset');
      if (host) bits.push(host.innerText || host.textContent || '');
    } catch (_) {}
    try { if (el.shadowRoot) bits.push(el.shadowRoot.textContent || ''); } catch (_) {}
    return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  }

  /* A web-component checkbox ignores .click() on the host, and several ignore it
     on the inner input too. Try the ways that actually work, cheapest first, and
     stop the moment the control reports itself checked. */
  async function setCheckboxChecked(cb) {
    const attempts = [
      () => { const i = innerNative(cb, 'input[type=checkbox],input[type=radio]'); if (i && i !== cb) realClick(i); },
      () => realClick(cb),
      () => triggerMouse(cb),
      () => {
        let lbl = null;
        try {
          const scope = ownerScope(cb);
          if (cb.id && scope.querySelector) lbl = scope.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
          if (!lbl && cb.closest) lbl = cb.closest('label');
          if (!lbl && cb.shadowRoot) lbl = cb.shadowRoot.querySelector('label');
        } catch (_) {}
        if (lbl) realClick(lbl);
      },
      () => {
        try {
          cb.focus({ preventScroll: true });
          for (const type of ['keydown', 'keyup'])
            cb.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, composed: true }));
        } catch (_) {}
      },
      () => {
        // Last resort: set the native input and tell the framework about it.
        const i = innerNative(cb, 'input[type=checkbox],input[type=radio]') || cb;
        try {
          i.checked = true;
          i.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          i.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } catch (_) {}
        try { if (cb.setAttribute) { cb.setAttribute('checked', ''); cb.setAttribute('aria-checked', 'true'); } } catch (_) {}
      },
    ];
    for (const attempt of attempts) {
      try { attempt(); } catch (_) {}
      await sleep(110);
      if (checkboxChecked(cb)) return true;
    }
    return checkboxChecked(cb);
  }

  /* Tick every declaration/consent box the form needs, on any ATS, whether it is
     a native checkbox or a web component — and never a marketing opt-in. */
  /* A question answered WITH checkboxes is not a pile of independent consents.
     "How did you hear about this job?" ships nine boxes — Job site, LinkedIn,
     Job fair, Indeed, Glassdoor, ZipRecruiter, Employee, Handshake, Other — and
     because the question is required, the required-checkbox sweep ticked every
     one of them. That tells the employer the candidate found the job on all nine
     channels at once.

     A group of two or more checkboxes sharing a question gets exactly ONE answer:
     the option that matches what we would have said in a text box, else the first
     real option (never "Other" / "None" / "Prefer not to say"). One selection also
     satisfies a "select all that apply" that happens to be required. */
  function checkboxGroup(el) {
    let peers = [];
    try {
      const name = el.getAttribute && el.getAttribute('name');
      if (name) peers = deepAll(`input[type=checkbox][name="${CSS.escape(name)}"]`, 40).filter(isVisible);
    } catch (_) {}
    if (peers.length < 2) {
      let container = null;
      try { container = el.closest('fieldset,[role=group],.question,[class*="question" i],.form-group,.field,[class*="field" i],li'); } catch (_) {}
      if (container) {
        try { peers = deepQueryAll('input[type=checkbox],[role="checkbox"],spl-checkbox,mat-checkbox', container, 40).filter(isVisible); } catch (_) {}
      }
    }
    // Two is a question; forty is the whole form matched by an over-wide container.
    return (peers.length >= 2 && peers.length <= 25) ? peers : [];
  }

  async function answerCheckboxGroups() {
    const seen = new Set();
    let n = 0;
    let p = null;
    try { p = await getProfile(); } catch (_) {}
    for (const cb of deepAll('input[type=checkbox],[role="checkbox"],spl-checkbox,mat-checkbox', 200).filter(isVisible)) {
      const group = checkboxGroup(cb);
      if (!group.length) continue;
      if (seen.has(group[0])) continue;
      seen.add(group[0]);
      if (group.some(checkboxChecked)) continue;                  // already answered
      const q = (getFullQuestionText(cb) || getLabel(cb) || '').replace(/\s+/g, ' ').trim();
      const want = String((p && guessFieldValue(q, p, null)) || '').toLowerCase().trim();
      let pick = null;
      if (want && want !== 'n/a') {
        pick = group.find(c => choiceLabel(c) === want)
          || group.find(c => choiceLabel(c) && choiceLabel(c).includes(want))
          || group.find(c => { const cl = choiceLabel(c); return cl.length > 2 && want.includes(cl); });
      }
      if (!pick) pick = group.find(c => !/^\s*(other|none|n\/?a|prefer not|do not|decline)\b/i.test(choiceLabel(c)));
      if (!pick) pick = group[0];
      if (await setCheckboxChecked(pick)) {
        n++;
        noteProgress('answered a multiple-choice question');
        await sleep(120);
      }
    }
    if (n) LOG(`Answered ${n} checkbox question(s) with a single option`);
    return n;
  }

  async function tickConsentBoxes() {
    let n = 0;
    for (const cb of deepAll(CONSENT_CONTROL_SEL, 150).filter(isVisible)) {
      if (checkboxChecked(cb)) continue;
      // One option of a multiple-choice question, not a declaration — leave it to
      // answerCheckboxGroups, which picks exactly one.
      if (checkboxGroup(cb).length) continue;
      const txt = controlText(cb);
      let required = false;
      try { required = isFieldRequired(cb); } catch (_) {}
      if (!required) required = REQUIRED_ERROR_RE.test(txt);
      const consent = CONSENT_TEXT_RE.test(txt);
      if (!required && !consent) continue;                       // nothing says we must
      if (MARKETING_TEXT_RE.test(txt)) continue;                 // never opt the user in
      try { if (isMarketingCheckbox(cb)) continue; } catch (_) {}
      if (await setCheckboxChecked(cb)) {
        n++;
        noteProgress('accepted a required declaration');
        await sleep(120);
      } else {
        LOG('Could not tick a required declaration box: ' + txt.slice(0, 80));
      }
    }
    if (n) LOG(`Ticked ${n} required consent/declaration box(es)`);
    return n;
  }

  /* Answer what is on screen, then LOOK AGAIN. A Yes on one question routinely
     reveals another, and until now nothing went back for it — which is how a
     form could report every required field filled while an unanswered
     sub-question sat underneath the one that revealed it. Repeats until the set
     of visible questions stops changing, which is also what terminates it. */
  async function resolveDependentQuestions__impl(maxRounds) {
    const rounds = maxRounds || 5;
    let total = 0;
    let lastSig = '';
    for (let round = 1; round <= rounds; round++) {
      if (autoStopped()) break;
      const before = stepSignature();
      let did = 0;
      let p = null;
      try { p = await getProfile(); } catch (_) {}
      try { did += (await answerChoiceGroups()) || 0; } catch (e) { LOG('choice pass error:', e?.message || e); }
      try { if (p) did += answerButtonStyleQuestions(p) || 0; } catch (e) { LOG('button-question pass error:', e?.message || e); }
      try { if (p) did += (await fillCustomDropdowns(p)) || 0; } catch (e) { LOG('dropdown pass error:', e?.message || e); }
      try { did += (await answerCheckboxGroups()) || 0; } catch (e) { LOG('checkbox-question pass error:', e?.message || e); }
      try { did += (await tickConsentBoxes()) || 0; } catch (e) { LOG('consent pass error:', e?.message || e); }
      total += did;
      // Give the framework a beat to render whatever those answers unlocked.
      await sleep(400);
      await waitForFormStable(1500);
      const after = stepSignature();
      if (did) noteProgress(`answered ${did} question(s)`);
      if (after === before && !did) break;                       // nothing new, nothing answered
      if (after === lastSig && !did) break;                      // oscillating without progress
      if (after !== before) LOG(`Follow-up questions appeared (round ${round}) — answering those too`);
      lastSig = before;
    }
    return total;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function resolveDependentQuestions(...a) {
    if (_dependentDepth > 0) return 0;                  // already running higher up the stack
    _dependentDepth++;
    try { return await withBusy('answering follow-up questions', () => resolveDependentQuestions__impl(...a)); }
    finally { _dependentDepth--; }
  }

  // FULL-AUTO GUARANTOR: ensure no required field is left blank so the form is always submittable
  // and the queue never waits on a human. Runs location commit first, then a best-effort sweep.
  async function guaranteeRequiredFieldsPass() {
    await resolveLocationFields();
    await resolveDependentQuestions();
    const p = await getProfile();
    const required = deepAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),textarea,select')
      .filter(el => isVisible(el) && isFieldRequired(el) && !hasFieldValue(el));
    let fixed = 0;
    for (const el of required) {
      const lbl = getLabel(el);
      // A REQUIRED checkbox (privacy/processing consent, acknowledgements) must be ticked
      // or the form can't submit — the text-default path below was a no-op on checkboxes.
      // Marketing opt-ins are still skipped. Radios are handled by answerChoiceGroups.
      if (el.type === 'checkbox') {
        // One option of a required multiple-choice question — ticking each of them
        // in turn is what selected all nine "How did you hear about this job?"
        // answers. answerCheckboxGroups picks a single one.
        if (checkboxGroup(el).length) continue;
        if (!isMarketingCheckbox(el)) {
          realClick(el);
          if (!el.checked) { try { el.checked = true; el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {} }
          if (el.checked) fixed++;
        }
        continue;
      }
      if (el.type === 'radio') continue;
      if (el.tagName === 'SELECT') {
        const opts = deepAll('option', el).filter(o => o.value && o.index > 0);
        // Decision-aware pick (reads the real option wording); then EEO/decline; then
        // first real option as a last resort so a required select is never left blank.
        let opt = selectOptionForQuestion(el, lbl, p);
        if (!opt && /gender|disability|veteran|race|ethnic|sex\b/i.test(lbl || ''))
          opt = opts.find(o => /prefer not|decline|not to/i.test(o.text));
        if (!opt) opt = opts[0];
        if (opt) { setSelectValue(el, opt.value); fixed++; }
        continue;
      }
      if (isLocationField(el)) { continue; } // already handled by resolveLocationFields
      let val = guessFieldValue(lbl, p, el);
      if (!val) {
        // Safe generic defaults so a required text box is never left empty.
        // Never assign the phone number to an "extension" field, regardless of its input
        // type (some sites use type=tel for the extension box too) — see the phone/
        // extension duplication bug fixed above in guessValue().
        if (!/ext(ension)?\b/i.test(lbl || '') && (el.type === 'tel' || /phone/i.test(lbl || ''))) val = p.phone || '';
        else if (el.type === 'email' || /email/i.test(lbl || '')) val = p.email || '';
        else if (el.tagName === 'TEXTAREA') val = 'N/A';
        else if (el.type === 'number') val = '0';
      }
      if (val) { el.focus({ preventScroll: true }); await sleep(60); nativeSet(el, val); el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); fixed++; await sleep(120); }
    }
    if (fixed) LOG(`Guarantor filled ${fixed} still-required field(s)`);
    return fixed;
  }

  /* Answering a required field can reveal MORE required fields (conditional
     sub-questions, "other — please specify" boxes, follow-up disclosures). One
     pass therefore isn't enough: repeat until the question set stops changing,
     re-running the general fill each time new controls appear so newly revealed
     text boxes and dropdowns get answered too. Bounded, and it exits on the
     first round that reveals nothing. */
  async function guaranteeRequiredFields__impl() {
    let fixed = 0;
    for (let round = 1; round <= 3; round++) {
      const before = stepSignature();
      fixed += (await guaranteeRequiredFieldsPass()) || 0;
      await sleep(350);
      if (stepSignature() === before) break;
      LOG(`Answering revealed more questions (round ${round}) — filling those too`);
      noteProgress('answering revealed questions');
      try { await fallbackFill(); } catch (e) { LOG('follow-up fill error:', e?.message || e); }
    }
    return fixed;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function guaranteeRequiredFields(...a) { return withBusy('completing required fields', () => guaranteeRequiredFields__impl(...a)); }

  // ===================== DOM HELPERS =====================
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const $ = (sel, root) => (root || document).querySelector(sel);
  // While a queue is running, scale waits by the selected speed (1x..3x) so the
  // chosen speed visibly changes how fast each application is processed.
  /* THE SPEED SELECTOR ONLY EVER WORKED IN ONE OF THE TWO RUN MODES.

     qActive is the IN-PAGE single-tab runner's flag (ua_qa). The Queue Manager
     drives its jobs in parallel background tabs instead, and those tabs never set
     it — so `qActive && !qPaused` was false throughout, the factor was never
     applied, and 1x / 1.5x / 2x / 3x did literally nothing on the run people
     actually use for bulk. The speed WAS being read from storage correctly in
     every tab; it just was not reaching the arithmetic.

     The floor drops from 40ms to 25ms too: at 3x (factor 0.3) every sleep under
     133ms was being clamped back up, so the top speed was barely distinguishable
     from the one below it. */
  let _mgrDriving = false;                       // a Queue Manager job owns this tab
  const queueDriving = () => (qActive && !qPaused) || _mgrDriving;
  const sleep = ms => new Promise(r => setTimeout(r, Math.max(25, ms * (queueDriving() ? qSpeedFactor : 1))));
  // Scale a fixed delay the same way, for the waits that are not plain sleeps.
  const scaled = (ms, floor) => Math.max(floor || 60, Math.round(ms * (queueDriving() ? qSpeedFactor : 1)));
  function speedFactorFor(s) { return ({ 1: 1, 1.5: 0.66, 2: 0.45, 3: 0.3 })[s] || 1; }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      // A zero-sized box already covers display:none anywhere up the ancestor chain.
      if (r.width <= 0 || r.height <= 0) return false;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const cs = win.getComputedStyle ? win.getComputedStyle(el) : null;
      if (!cs) return true;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity || '1') === 0) return false;
      return true;
    } catch (_) { return false; }
  }

  /* THE bug behind "SmartRecruiters re-fills forever" and "the CV won't attach".
     Spark (spl-*), Oracle JET (oj-*) and every other web-component ATS put the
     real <input> inside a shadow root and listen for its events on the HOST,
     outside that root. A DOM event only escapes a shadow tree when it is
     `composed` — and every synthetic event we dispatched had `composed: false`
     (the default). So:

       • we set the value, the input showed it, the component never heard about
         it, its own model stayed empty, it re-rendered the field blank, our next
         pass saw an empty field and typed it again — forever;
       • we set input.files on the hidden file input and dispatched `change`,
         which never reached the uploader — so the CV never attached.

     Every synthetic event now goes through here. */
  function fireEvent(el, type, init) {
    if (!el || !el.dispatchEvent) return false;
    try {
      el.dispatchEvent(new Event(type, Object.assign({ bubbles: true, composed: true }, init || {})));
      return true;
    } catch (_) { return false; }
  }
  function fireAll(el, types) { for (const t of types) fireEvent(el, t); }
  /* Tell the web component that wraps this input, too — some listen on the host
     rather than on their own inner field. */
  function fireOnHostChain(el, types) {
    fireAll(el, types);
    let node = el;
    for (let hop = 0; node && hop < 4; hop++) {
      let host = null;
      try { const r = node.getRootNode && node.getRootNode(); host = r && r.host; } catch (_) {}
      if (!host) break;
      fireAll(host, types);
      node = host;
    }
  }

  function nativeSetLegacyUnused(el, val) {
    if (el.disabled || el.readOnly) return false;
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
        el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) { setter.call(el, ''); setter.call(el, val); } else el.value = val;
    } catch (_) { el.value = val; }
    el.dispatchEvent(new Event('focus', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const reactEvt = new Event('input', { bubbles: true, composed: true });
    Object.defineProperty(reactEvt, 'simulated', { value: true });
    el.dispatchEvent(reactEvt);
    if (el.type === 'tel' || /phone|mobile|cell/i.test(el.name || el.id || '')) {
      for (const ch of String(val)) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, composed: true }));
      }
    }
    el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    if (el.getAttribute('ng-model') || el.getAttribute('[(ngModel)]') || el.getAttribute('formControlName')) {
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    return true;
  }

  // Set a <select>'s value so REACT registers it. Assigning `sel.value = ...` directly
  // is bypassed by React's controlled-input value tracker (exactly like the text-input
  // bug we fixed earlier) — so on the next render React reverts the select and the field
  // stays "required / must have a value" even though the option visibly shows selected.
  // Calling the PROTOTYPE value setter + dispatching input & change is what makes it stick.
  function setSelectValue(sel, value) {
    if (!sel) return false;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(sel, value); else sel.value = value;
    } catch (_) { try { sel.value = value; } catch (__) {} }
    // Some frameworks track by selectedIndex — keep it consistent with the value we set.
    try { if (sel.value !== value) { for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value === value) { sel.selectedIndex = i; break; } } } } catch (_) {}
    fireOnHostChain(sel, ['input', 'change', 'blur']);
    return true;
  }

  /* ── DESTRUCTIVE-CONTROL GUARD ──────────────────────────────────────────────
     Controls that destroy work already on the page: the "×" beside an uploaded
     résumé, "Delete", "Discard", "Withdraw application". Nothing in an apply flow
     ever needs one, and clicking one is how a SmartRecruiters run died — the ×
     on the attached CV opened a native  Remove "…_CV"?  confirm, which blocks the
     JavaScript thread until it is answered, so the automation froze behind it
     until the watchdog killed the job. realClick is the single choke point every
     driver clicks through, so the guard lives here. */
  const DESTRUCTIVE_NAME_RE =
    /^\s*(remove|delete|discard|erase|trash|unattach|detach|start over|clear all|withdraw)\b|\b(remove|delete|replace)\s+(this\s+)?(file|resume|résumé|cv|attachment|document|upload)|\bwithdraw\s+(my\s+)?application\b|\bcancel\s+application\b/i;
  // Containers that hold an already-uploaded file. A bare icon button inside one
  // of these is a remove control even when it has no accessible name at all.
  const ATTACHMENT_CONTAINER_SEL =
    '[class*="attachment" i],[class*="uploaded" i],[class*="file-item" i],[class*="fileItem" i],' +
    '[class*="file-list" i],[class*="dropzone" i],[class*="upload" i],[class*="resume" i],' +
    'spl-file-upload,spl-attachment,spl-file,spl-file-item,oj-file-picker,' +
    '[data-test*="attachment" i],[data-testid*="attachment" i],[data-test*="file" i],[data-testid*="file" i]';
  function controlName(el) {
    try {
      const parts = [
        el.getAttribute && (el.getAttribute('aria-label') || ''),
        el.getAttribute && (el.getAttribute('title') || ''),
        el.getAttribute && (el.getAttribute('data-test') || el.getAttribute('data-testid') || el.getAttribute('data-automation-id') || ''),
        el.getAttribute && (el.getAttribute('name') || ''),
        (el.textContent || ''),
      ];
      const img = el.querySelector && el.querySelector('img[alt],svg title,use[href]');
      if (img) parts.push(img.getAttribute('alt') || img.textContent || '');
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    } catch (_) { return ''; }
  }
  /* Walk out of any shadow roots as well as up the light tree. closest() stops
     dead at a shadow boundary, so on SmartRecruiters — where the whole upload
     widget is spl-* web components — the remove button's attachment container was
     invisible to the guard and the click went through. That click is what opened
     the  Remove "…_CV"?  confirm. */
  function closestAcrossShadow(el, selector) {
    let node = el;
    for (let hop = 0; node && hop < 12; hop++) {
      try { const hit = node.closest && node.closest(selector); if (hit) return hit; } catch (_) {}
      const root = node.getRootNode && node.getRootNode();
      node = (root && root.host) ? root.host : null;      // step out of the shadow root
    }
    return null;
  }
  function isDestructiveControl(el) {
    try {
      if (!el || !el.getAttribute) return false;
      const name = controlName(el);
      if (DESTRUCTIVE_NAME_RE.test(name)) return true;
      // An icon-only control anywhere near an uploaded file. Checked across shadow
      // boundaries, and the icon may live inside the button's own shadow root.
      const shadowTxt = (el.shadowRoot && el.shadowRoot.textContent) || '';
      const txt = ((el.textContent || '') + shadowTxt).replace(/\s+/g, '');
      const iconish = txt === '' || /^[×✕✖x✗⨯🗑✖️❌]{1,3}$/i.test(txt);
      if (!iconish) return false;
      const tag = (el.tagName || '').toUpperCase();
      const looksClickable = tag === 'BUTTON' || tag === 'A' || tag.startsWith('SPL-') ||
        tag.startsWith('OJ-') || el.getAttribute('role') === 'button';
      if (!looksClickable) return false;
      return !!closestAcrossShadow(el, ATTACHMENT_CONTAINER_SEL);
    } catch (_) { return false; }
  }

  // opts.force bypasses the guard — used only by the dialog resolver, which has to
  // be able to press the "Cancel"/"Keep" button of a confirm it is answering.
  function realClick(el, opts) {
    if (!el) return false;
    if (!(opts && opts.force) && isDestructiveControl(el)) {
      LOG('Refusing to click destructive control:', controlName(el).slice(0, 60) || '(unlabelled ×)');
      return false;
    }
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
    el.click();
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  /* ── SHADOW-PIERCING QUERIES ────────────────────────────────────────────────
     $ / $$ above stop at a shadow boundary. Modern SmartRecruiters renders its
     whole form as `spl-*` web components (Spark design system), each with its own
     open shadow root, so a plain document.querySelector('#firstName') finds
     nothing — which is why autofill "did nothing" on that ATS. These walk into
     every open shadow root. Depth- and node-bounded so they stay cheap. */
  /* The extension's OWN interface must never be mistaken for the page.
     Jobright's sidebar is a plasmo-csui shadow root containing a full copy of
     your profile (first name, last name, email, city…) and its own green
     "Submit Application" button. Because deepQueryAll walks every open shadow
     root, all of that was being enumerated as if it were the ATS form:

       • the fill report counted sidebar inputs, so it read the values from the
         PREVIOUS step and reported 100% while the real questions sat empty;
       • findSubmitControl could pick Jobright's "Submit Application" instead of
         the ATS's own Next/Submit;
       • the dropdown and validation passes worked on sidebar controls.

     One predicate, applied at the single point every deep query goes through. */
  const OWN_UI_SEL = 'plasmo-csui,[id^="plasmo-"],[data-plasmo],#jobright-helper-id,' +
    '.jobright-helper-content-container,#ua-ctrl,#ua-drawer,#ua-captcha-banner,' +
    '[id^="ua-"],[class^="ua-"],#ua-dual-action-buttons';
  function isOwnUi(el) {
    let node = el;
    for (let hop = 0; node && hop < 14; hop++) {
      try { if (node.closest && node.closest(OWN_UI_SEL)) return true; } catch (_) {}
      const root = node.getRootNode && node.getRootNode();
      const host = root && root.host;
      if (host) {
        try {
          const tag = (host.tagName || '').toLowerCase();
          if (tag === 'plasmo-csui' || tag.startsWith('ua-') || /plasmo|jobright/i.test(host.id || '')) return true;
        } catch (_) {}
      }
      node = host || null;                              // step out of the shadow root
    }
    return false;
  }
  /* Tags that actually host open shadow roots on the ATS this build supports,
     plus the generic custom-element prefixes. CSS cannot say "any tag with a
     hyphen", so this is the enumeration — kept broad, and far cheaper than '*'. */
/* FINDING SHADOW HOSTS — and the regression that taught me how not to.

     v16.4 replaced "ask the node for every element" with an allow-list of tag
     names, to stop a full enumeration running several times a second. The
     performance reasoning was right. The implementation was wrong, and it broke
     SmartRecruiters completely.

     The list named LEAF components — spl-input, spl-select, spl-checkbox. But
     those sit INSIDE wrapper custom elements, and a wrapper that is not on the
     list is never descended into, so every field beneath it is invisible. Zero
     fields found, every job failed. An allow-list cannot work here: it would
     have to know every custom element every ATS will ever ship, including the
     ones on the 45 bespoke employer portals in these queues.

     So the enumeration is complete again, and the cost is paid for by a cache
     instead. A shadow host cannot appear without a DOM mutation, so the list is
     rebuilt on a short TTL rather than on every query — which, together with the
     250ms fingerprint memo, keeps the hot loop cheap while making it correct. */
  const _hostCache = new WeakMap();      // root → { hosts, at }
  const HOST_CACHE_TTL = 400;
  function shadowHostsIn(node) {
    const now = Date.now();
    const hit = _hostCache.get(node);
    if (hit && now - hit.at < HOST_CACHE_TTL) return hit.hosts;
    const hosts = [];
    try {
      for (const el of node.querySelectorAll('*')) {
        // Only an element with an OPEN shadow root can hide anything from us.
        if (el.shadowRoot && !isOwnUi(el)) hosts.push(el);
      }
    } catch (_) {}
    try { _hostCache.set(node, { hosts, at: now }); } catch (_) {}
    return hosts;
  }

  function deepQueryAll(sel, root, limit) {
    const out = [];
    const cap = limit || 400;
    const stack = [root || document];
    let guard = 0;
    while (stack.length && out.length < cap && guard++ < 20000) {
      const node = stack.pop();
      if (!node || !node.querySelectorAll) continue;
      try {
        for (const el of node.querySelectorAll(sel)) {
          if (isOwnUi(el)) continue;                    // our own UI is not the page
          out.push(el);
          if (out.length >= cap) break;
        }
      } catch (_) {}
      // Descend into every open shadow root, whatever the host is called. A
      // named list of host tags was tried here and it was wrong: the names that
      // matter are the WRAPPERS, which are private to each ATS and unknowable.
      // The cost of enumerating is paid by a short cache instead — see
      // shadowHostsIn.
      try { for (const el of shadowHostsIn(node)) stack.push(el.shadowRoot); } catch (_) {}
    }
    return out;
  }
  function deepQuery(sel, root) { return deepQueryAll(sel, root, 1)[0] || null; }
  function deepVisible(sel, root) { return deepQueryAll(sel, root).filter(isVisible); }

  /* ── CV / RESUME ATTACHMENT (all ATS) ──────────────────────────────────────
     Attaching the CV was Workday-only: every other ATS relied on Jobright having
     done it, and when it hadn't, the form failed validation with "Resume is
     required" and the job died with no explanation. The résumé is already stored
     locally as base64 (ua_resumes / ua_resume_data), so it can be attached
     properly on any platform via DataTransfer.

     Two failure modes this also removes:
       • advancing while the upload is still in flight — the ATS then reports no
         résumé, or silently drops it (a very common SmartRecruiters complaint);
       • re-attaching over a file that is already there, which is what opens the
         "Remove <file>?" confirm in the first place. */
  const RESUME_FIELD_RE = /resume|résumé|cv\b|curriculum|lebenslauf|attach|upload/i;

  function resumeFileInputs() {
    return deepAll('input[type="file"]', 60).filter((el) => {
      const hay = [el.name, el.id, el.accept, el.getAttribute('aria-label'),
        el.getAttribute('data-automation-id'), el.getAttribute('data-testid'), getLabel(el)].join(' ');
      if (RESUME_FIELD_RE.test(hay)) return true;
      // An unlabelled file input inside an upload area still counts.
      try { return !!el.closest('[class*="upload" i],[class*="dropzone" i],[class*="attach" i],[class*="resume" i],[class*="file" i]'); }
      catch (_) { return false; }
    });
  }
  // Is a file already attached? Checked before touching anything, so we never
  // re-upload over a good attachment (and never reach a remove button).
  function resumeAlreadyAttached() {
    for (const inp of resumeFileInputs()) if (inp.files && inp.files.length) return true;
    // The ATS usually renders the accepted file as a chip / filename row.
    const chips = deepAll('[class*="filename" i],[class*="file-name" i],[data-automation-id="file-name"],' +
      '[class*="attachment" i],[class*="uploaded" i],[class*="file-item" i],spl-file-upload', 80);
    // "PDF, DOC, DOCX up to 5MB" and "e.g. resume.pdf" are instructions, not an
    // attachment. Reading them as one made us skip the upload entirely and then
    // fail the step with "Resume is required".
    const HINT_RE = /\b(up to|max(imum)?|accepted|supported|allowed|formats?|file ?types?|e\.?g\.?|for example|drag|drop|browse|choose a file|select a file)\b/i;
    for (const c of chips) {
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 200) continue;
      if (!/[\w)]\.(pdf|docx?|rtf|txt|odt)\b/i.test(t)) continue;
      if (HINT_RE.test(t)) continue;
      return true;
    }
    return false;
  }

  /* Where a file can actually be handed to an uploader: the input itself, the
     dropzone around it, and the web-component hosts above it. `closest()` stops
     at a shadow boundary, so on SmartRecruiters the real <spl-file-upload>
     dropzone was never in the list. */
  function uploadDropTargets(inp) {
    const out = [];
    const push = (el) => { if (el && !out.includes(el)) out.push(el); };
    push(inp);
    try { push(inp.closest('[class*="dropzone" i],[class*="drop-zone" i],[class*="upload" i],[class*="attach" i],[class*="file" i]')); } catch (_) {}
    let node = inp;
    for (let hop = 0; node && hop < 4; hop++) {
      let host = null;
      try { const r = node.getRootNode && node.getRootNode(); host = r && r.host; } catch (_) {}
      if (!host) break;
      push(host);
      try { push(host.closest('[class*="dropzone" i],[class*="upload" i],[class*="attach" i]')); } catch (_) {}
      node = host;
    }
    for (const z of deepAll('spl-file-upload,[class*="dropzone" i],[class*="drop-zone" i]', 12)) push(z);
    return out.filter(Boolean);
  }

  /* ── A REQUIRED COVER LETTER ───────────────────────────────────────────────
     Greenhouse reported "Cover Letter is required." in red on a form the pass
     believed it had finished. A required cover letter is not a text box — it is
     an upload widget, with "Attach", "Google Drive" and "Enter manually" beside
     it, so nothing that fills <textarea>s ever touched it and nothing that
     attaches the CV recognised it either. The job then failed at the submit with
     everything else correct.

     Two ways to satisfy it, in order of how much the employer will like the
     result:

       1. "Enter manually" reveals a real textarea. That is the intended path and
          gives a letter addressed to this employer.
       2. Otherwise synthesise a .txt and attach it. Every one of these widgets
          lists txt among its accepted types — Greenhouse's says "pdf, doc, docx,
          txt, rtf" — and a plain-text letter beats a blocked application.

     Only ever for a REQUIRED one. An optional cover letter is deliberately left
     alone: a generic letter nobody asked for is worse than none. */
  const COVER_UPLOAD_RE = /cover.?letter|motivation.?letter|covering.?letter|anschreiben|lettre de motivation/i;
  const MANUAL_ENTRY_RE = /enter manually|type manually|write manually|paste|type it|enter text|write your own|compose/i;

  // The block on the page that IS the cover-letter question.
  function coverLetterBlock() {
    const hosts = deepAll('input[type="file"],[class*="upload" i],[class*="dropzone" i],[class*="attach" i],fieldset,[class*="field" i]', 120);
    for (const el of hosts) {
      let scope = el;
      for (let up = 0; up < 4 && scope; up++) {
        const t = (scope.innerText || scope.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 600 && COVER_UPLOAD_RE.test(t)) return scope;
        scope = scope.parentElement;
      }
    }
    return null;
  }

  async function satisfyCoverLetter(p) {
    const block = coverLetterBlock();
    if (!block || !isVisible(block)) return false;
    const text = (block.innerText || block.textContent || '').replace(/\s+/g, ' ').trim();

    /* Required either because the page says so, or because it has already told
       us so in red. The validation message is the more reliable of the two —
       it is the ATS's own verdict, after a submit attempt. */
    const complained = /cover.?letter\s+is\s+required|required/i.test(text);
    let required = complained;
    try { if (!required) required = deepQueryAll('input,textarea', block, 20).some(isFieldRequired); } catch (_) {}
    if (!required) return false;

    // Already satisfied — a filled textarea or an attached file.
    try {
      if (deepQueryAll('textarea', block, 10).some((t) => (t.value || '').trim().length > 40)) return false;
      if (deepQueryAll('input[type="file"]', block, 10).some((f) => f.files && f.files.length)) return false;
    } catch (_) {}

    const letter = tailorCoverText(p.cover_letter || DEFAULTS.cover,
      { company: pageCompanyName(), title: pageJobTitle() });

    // 1. The manual-entry path, which is what a person would use.
    const manual = deepQueryAll('button,a,[role="button"]', block, 40).filter(isVisible)
      .find((b) => MANUAL_ENTRY_RE.test((b.textContent || b.getAttribute('aria-label') || '')));
    if (manual) {
      LOG('Cover letter is required — opening the manual entry box');
      realClick(manual);
      await sleep(700);
      const box = deepQueryAll('textarea', block, 10).filter(isVisible)[0] ||
        deepAll('textarea', 20).filter((t) => isVisible(t) && !(t.value || '').trim())[0];
      if (box) {
        box.focus({ preventScroll: true });
        nativeSet(box, letter);
        DIAG('cover.manual', 'Required cover letter written into the manual box');
        return true;
      }
    }

    // 2. A plain-text file, which every one of these widgets accepts.
    const input = deepQueryAll('input[type="file"]', block, 10)[0];
    if (input) {
      try {
        const file = new File([letter], 'cover-letter.txt', { type: 'text/plain' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        fireAll(input, ['input', 'change']);
        LOG('Cover letter is required — attached one as a .txt');
        DIAG('cover.attached', 'Required cover letter attached as text/plain');
        return true;
      } catch (e) { LOG('Could not attach the cover letter:', e?.message || e); }
    }

    DIAG('cover.blocked', 'A required cover letter could not be satisfied');
    return false;
  }

  /* A real drag-and-drop, not just a `drop`. Uploaders that gate on dragenter /
     dragover (to set dropEffect) ignore a lone drop event. */
  function dropFileOn(target, file) {
    if (!target || !target.dispatchEvent) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      }
      return true;
    } catch (_) { return false; }
  }
  // An upload in flight: pressing Next now is what makes the résumé vanish.
  function resumeUploadInFlight() {
    try {
      const busy = deepAll('[class*="progress" i],[class*="spinner" i],[class*="loading" i],[aria-busy="true"],' +
        'progress,[role="progressbar"]', 60).filter(isVisible);
      if (busy.length) {
        // Only count one that sits near an upload area.
        for (const b of busy) {
          if (b.closest && b.closest('[class*="upload" i],[class*="attach" i],[class*="resume" i],[class*="file" i]')) return true;
        }
      }
      const txt = (document.body && document.body.innerText || '').slice(0, 4000);
      return /uploading|processing your (resume|cv)|parsing your (resume|cv)/i.test(txt);
    } catch (_) { return false; }
  }
  async function waitForResumeUpload(maxMs) {
    const dl = Date.now() + (maxMs || 20000);
    while (Date.now() < dl) {
      noteProgress('uploading CV');   // an upload in flight is not a stall
      if (!resumeUploadInFlight() && resumeAlreadyAttached()) return true;
      if (!resumeUploadInFlight() && Date.now() > dl - 15000) break;   // nothing happening
      await sleep(800);
    }
    return resumeAlreadyAttached();
  }
  async function storedResumeFile() {
    try {
      await loadResumes();
      const r = (_resumes && _resumes[_activeResumeIdx]) || (await st.get('ua_resume_data'));
      if (!r || !r.base64) return null;
      const name = r.fileName || r.name || 'resume.pdf';
      const raw = atob(String(r.base64).split(',').pop());
      const buf = new ArrayBuffer(raw.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
      return new File([buf], name, { type: r.mimeType || 'application/pdf' });
    } catch (e) { LOG('Stored resume unreadable:', e?.message || e); return null; }
  }
  /* Attach the CV on any ATS. Returns 'already' | 'attached' | 'no-resume' |
     'no-field' so the caller can report precisely instead of failing blind. */
  async function attachResume__impl() {
    if (resumeUploadInFlight()) { await waitForResumeUpload(20000); }
    if (resumeAlreadyAttached()) { LOG('CV already attached — leaving it alone'); return 'already'; }
    const inputs = resumeFileInputs();
    if (!inputs.length) return 'no-field';
    const file = await storedResumeFile();
    if (!file) {
      LOG('CV NOT attached: no résumé saved in the extension. Add one in Jobright/the sidebar, or the ATS will reject the form.');
      return 'no-resume';
    }
    for (const inp of inputs) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        try { inp.files = dt.files; } catch (_) {}
        /* Composed, and repeated up the shadow host chain. A Spark
           <spl-file-upload> listens OUTSIDE the shadow root that holds this
           input, so the old non-composed `change` never reached it — the file
           was on the input and the uploader never knew. That is why the CV
           "struggled to attach" on SmartRecruiters. */
        fireOnHostChain(inp, ['input', 'change']);
        noteProgress('attaching CV');
        await sleep(500);
        if (resumeUploadInFlight() || resumeAlreadyAttached()) {
          await waitForResumeUpload(25000);
          if (resumeAlreadyAttached()) { LOG(`CV attached: ${file.name}`); noteProgress('attached CV'); return 'attached'; }
        }
        // Nothing happened — some uploaders only accept a genuine drag-and-drop.
        for (const zone of uploadDropTargets(inp)) {
          if (!dropFileOn(zone, file)) continue;
          await sleep(500);
          if (resumeUploadInFlight() || resumeAlreadyAttached()) break;
        }
        await waitForResumeUpload(25000);
        if (resumeAlreadyAttached()) { LOG(`CV attached: ${file.name}`); noteProgress('attached CV'); return 'attached'; }
        LOG('CV upload did not register on this field — trying the next one');
      } catch (e) { LOG('CV attach failed on one input:', e?.message || e); }
    }
    if (resumeAlreadyAttached()) return 'attached';
    LOG('CV NOT attached: the uploader never acknowledged the file. The step will likely be rejected.');
    return 'no-field';
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function attachResume(...a) { return withBusy('attaching the CV', () => attachResume__impl(...a)); }

  /* ── CUSTOM DROPDOWN COMMITTER (all ATS) ───────────────────────────────────
     Native <select> is handled well already, but most modern ATS do not use one.
     Greenhouse, Ashby, Lever, Workable, SmartRecruiters (spl-select) and Oracle
     (oj-select) all render a div with role="combobox" plus a popup listbox. The
     universal filler had no handler for those at all, so any REQUIRED custom
     dropdown stayed empty — and an empty required field is the single commonest
     reason a fully "filled" form still refuses to submit.

     One committer for every flavour: open it, wait for the options to render
     (they are usually created on demand), pick the best match, and confirm the
     control actually took a value. */
  function comboText(el) {
    try { return (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim(); }
    catch (_) { return ''; }
  }
  // Does this combobox already hold an answer?
  function comboHasValue(el) {
    try {
      const inner = (el.shadowRoot && el.shadowRoot.querySelector('input')) || el.querySelector?.('input');
      if (inner && (inner.value || '').trim()) return true;
      if ((el.value || '').trim()) return true;
      // react-select / MUI render the chosen label as a child node.
      const shown = el.querySelector?.('[class*="singleValue" i],[class*="multiValue" i],[class*="selected" i],[class*="chip" i]');
      if (shown && comboText(shown)) return true;
      const t = comboText(el);
      // Placeholder text is not an answer.
      return !!t && !/^(select|choose|pick|--|—|none|please select|start typing|search)\b/i.test(t) && t.length > 1;
    } catch (_) { return false; }
  }
  function listboxFor(combo) {
    const id = combo.getAttribute?.('aria-controls') || combo.getAttribute?.('ariacontrols') ||
      combo.getAttribute?.('aria-owns') || combo.getAttribute?.('list');
    if (id) { try { const el = deepOne('#' + CSS.escape(id)); if (el) return el; } catch (_) {} }
    return null;
  }
  function visibleOptions(scope) {
    const sel = '[role="option"],spl-select-option,oj-option,li[data-value],li[role="option"],' +
      '[class*="option" i]:not([class*="options" i]),[class*="menu-item" i],[class*="MenuItem" i],' +
      // A Bootstrap menu — what Comeet renders — has no roles at all: the rows
      // are plain <li><a>. Nothing above matches one, so its options were
      // invisible and every Comeet dropdown stayed on its placeholder.
      '.dropdown-menu li,.dropdown-menu a,ul[class*="dropdown" i] > li,ul[class*="menu" i] > li > a';
    return (scope ? deepQueryAll(sel, scope, 300) : deepAll(sel, 300))
      .filter(isVisible)
      .filter(o => { const t = comboText(o); return t && t.length < 120; });
  }
  /* Pick `wanted` (or, for a required field, any sane option) in a custom
     dropdown. Returns true only if the control ended up holding a value. */
  async function commitCustomDropdown(combo, wanted, required) {
    if (!combo || comboHasValue(combo)) return false;
    const want = String(wanted == null ? '' : wanted).replace(/\s+/g, ' ').trim().toLowerCase();

    /* Some of these are only a costume. A "nice-select"-style wrapper hides a
       perfectly ordinary <select> behind a styled div, and driving the costume
       means synthesising clicks on rows that only mirror the real control.
       Setting the <select> itself is both more reliable and less work. */
    try {
      const native = (combo.querySelector && combo.querySelector('select')) ||
        (combo.parentElement && combo.parentElement.querySelector('select'));
      if (want && native && native.options && native.options.length > 1) {
        /* Matched on the option's TEXT, because `wanted` is display text —
           "5-10 years", not whatever value the page happens to use for it.
           setSelectValue reports success unconditionally, so the result is
           confirmed against the control rather than taken on trust. */
        const norm = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
        const opts = Array.from(native.options).filter((o) => norm(o.text) && o.value !== '');
        const hit = opts.find((o) => norm(o.text) === want) ||
          opts.find((o) => norm(o.value) === want) ||
          opts.find((o) => norm(o.text).includes(want) && want.length > 2);
        if (hit) {
          setSelectValue(native, hit.value);
          if (native.value === hit.value) {
            LOG(`Dropdown was a wrapper around a real <select> — set that instead ("${hit.text.trim().slice(0, 40)}")`);
            return true;
          }
        }
      }
    } catch (_) {}

    // Open it. Web components need the full pointer sequence; some open only on
    // keyboard, so fall back to ArrowDown.
    triggerMouse(combo);
    await sleep(450);
    let opts = visibleOptions(listboxFor(combo));
    if (!opts.length) {
      try {
        const inner = (combo.shadowRoot && combo.shadowRoot.querySelector('input')) || combo.querySelector?.('input') || combo;
        inner.focus?.({ preventScroll: true });
        inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, composed: true }));
      } catch (_) {}
      await sleep(450);
      opts = visibleOptions(listboxFor(combo));
    }
    // Typeahead: many comboboxes only render options once you type.
    if (!opts.length && want) {
      const inner = (combo.shadowRoot && combo.shadowRoot.querySelector('input')) || combo.querySelector?.('input');
      if (inner) {
        try { inner.focus({ preventScroll: true }); nativeSet(inner, want.slice(0, 24)); } catch (_) {}
        await sleep(700);
        opts = visibleOptions(listboxFor(combo));
      }
    }
    if (!opts.length) return false;

    const norm = (t) => String(t).replace(/\s+/g, ' ').trim().toLowerCase();
    const isPlaceholder = (t) => /^(select|choose|pick|--|—|none|please select|n\/a)\b/i.test(t);
    const real = opts.filter(o => !isPlaceholder(comboText(o)));
    let pick = null;

    /* A years dropdown is a RANGE list, and the plain matchers cannot read one:
       looking for "7" among "Less than 1 year", "1-2 years", "3-5 years",
       "5-10 years" finds nothing, and the required-field fallback then took
       real[0] — the FIRST option, which on an ordered list is always the worst
       one. That is how a Greenhouse application went out saying "Less than 1
       year" of professional experience. Score the ranges instead, exactly as the
       radio path already does. */
    const qFull = String(getFullQuestionText(combo) || getLabel(combo) || '');
    const isYearsQ = YEARS_Q_RE.test(qFull);
    if (isYearsQ) {
      const yrs = parseInt(String(want).match(/\d+/)?.[0], 10) || parseInt(DEFAULTS.years, 10);
      let best = 0;
      for (const o of real) {
        const s = scoreExperienceRange(comboText(o), yrs);
        if (s > best) { best = s; pick = o; }
      }
      /* Nothing scored — the options are worded in some way the scorer does not
         read. On a list ordered low to high the SAFE end is the top, never the
         bottom, so take the last option rather than the first. */
      if (!pick && real.length) pick = real[real.length - 1];
    }

    if (!pick && want) {
      pick = real.find(o => norm(comboText(o)) === want)
        || real.find(o => norm(comboText(o)).includes(want))
        || real.find(o => want.includes(norm(comboText(o))) && norm(comboText(o)).length > 2);
      if (!pick) {
        /* Word overlap, as a last resort before the category fallbacks. Bounded
           to WHOLE words and with the filler words dropped: an unbounded
           substring test matched "not" inside "Not applicable" and "another",
           so "I do not have a disability" picked whichever option happened to
           contain those three letters. */
        const STOP = /^(the|and|for|you|your|have|has|with|that|this|are|not|any|all|its|from|out|our|their|does|did|was|were|will|would|can|able)$/;
        const words = want.split(/[^a-z0-9]+/i).filter(w => w.length > 2 && !STOP.test(w));
        if (words.length) {
          const hit = (o, w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(norm(comboText(o)));
          // Prefer the option that shares the MOST words, not merely one.
          let best = -1;
          for (const o of real) {
            const n = words.filter(w => hit(o, w)).length;
            if (n > best) { best = n; if (n) pick = o; }
          }
        }
      }
    }
    // Demographic questions: never invent a specific answer — decline instead.
    const label = norm(getLabel(combo) || '');
    if (!pick && /gender|disability|veteran|race|ethnic|sex\b/.test(label)) {
      pick = real.find(o => /prefer not|decline|do not wish|not to say/i.test(comboText(o)));
    }
    // Last resort, and ONLY for a required field: an empty required dropdown
    // blocks submission outright, so any sane option beats leaving it blank.
    if (!pick && required) pick = real[0];
    if (!pick) { try { combo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })); } catch (_) {} return false; }

    const inner = pick.querySelector?.('spl-typography-body') ||
      (pick.shadowRoot && pick.shadowRoot.querySelector('spl-typography-body,span,div')) || pick;
    triggerMouse(inner);
    await sleep(350);
    if (!comboHasValue(combo)) { triggerMouse(pick); await sleep(300); }   // some need the row itself
    if (!comboHasValue(combo)) { await commitByKeyboard(combo, pick); }
    return comboHasValue(combo);
  }

  /* The keyboard is how these components were built to be driven, and on some it
     is the ONLY thing that works: Oracle's JET selects track the highlighted row
     in aria-activedescendant and commit on Enter, so a synthetic click on the
     row can leave the field looking untouched — which is how a page full of
     "This info is required." survived a pass that thought it had answered
     everything. Applies to any ARIA combobox, not just Oracle's. */
  async function commitByKeyboard(combo, pick) {
    const inner = (combo.shadowRoot && combo.shadowRoot.querySelector('input,[role="combobox"]')) ||
      combo.querySelector?.('input,[role="combobox"]') || combo;
    const wantId = (pick && pick.id) || '';
    const active = () => {
      try {
        return inner.getAttribute?.('aria-activedescendant') ||
          combo.getAttribute?.('aria-activedescendant') || '';
      } catch (_) { return ''; }
    };
    const key = (k, code) => {
      for (const type of ['keydown', 'keyup']) {
        try {
          inner.dispatchEvent(new KeyboardEvent(type, {
            key: k, code, keyCode: code === 'Enter' ? 13 : 40,
            bubbles: true, composed: true, cancelable: true,
          }));
        } catch (_) {}
      }
    };
    try { inner.focus?.({ preventScroll: true }); } catch (_) {}
    // Walk the list to the row we chose. Bounded — a list we cannot navigate
    // must not become a loop.
    if (wantId) {
      for (let i = 0; i < 40 && active() !== wantId; i++) {
        key('ArrowDown', 'ArrowDown');
        await sleep(40);
      }
      if (active() !== wantId) return false;
    }
    key('Enter', 'Enter');
    await sleep(300);
    return comboHasValue(combo);
  }

  /* Every custom dropdown on the page that still has no answer. */
  async function fillCustomDropdowns__impl(profile) {
    const combos = deepAll(
      '[role="combobox"],[ariarole="combobox"],[aria-haspopup="listbox"],' +
      '[class*="select__control" i],[class*="Select-control" i],.MuiSelect-root,.ant-select,spl-select,' +
      // Oracle ships three generations of the same control side by side, and a
      // Recruiting Cloud page mixes them. Naming only oj-select-single left the
      // rest of a form's required dropdowns empty.
      'oj-select-single,oj-c-select-single,oj-select-one,oj-combobox-one,oj-c-combobox-one,' +
      // Bootstrap's dropdown, still the most common thing on a small ATS.
      '[data-toggle="dropdown"],[data-bs-toggle="dropdown"],a.dropdown-toggle,button.dropdown-toggle'
    ).filter(isVisible);
    let filled = 0;
    for (const combo of combos.slice(0, 40)) {
      if (comboHasValue(combo)) continue;
      const q = getFullQuestionText(combo) || getLabel(combo) || '';
      const required = isFieldRequired(combo) || /\*/.test(q);
      const guess = q ? guessFieldValue(q, profile, combo) : '';
      try { if (await commitCustomDropdown(combo, guess, required)) filled++; } catch (_) {}
      await sleep(150);
    }
    if (filled) { LOG(`Custom dropdowns answered: ${filled}`); noteProgress('answered ' + filled + ' dropdown(s)'); }
    return filled;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function fillCustomDropdowns(...a) { return withBusy('answering dropdowns', () => fillCustomDropdowns__impl(...a)); }

  /* ── UNIVERSAL FIELD DISCOVERY ─────────────────────────────────────────────
     $ / $$ are document.querySelector(All): they stop at a shadow boundary and
     never enter an iframe. Every universal filler (fallbackFill,
     getMissingRequired, guaranteeRequiredFields, handleValidationErrors,
     hasApplicationForm…) used them, so on any ATS that renders its form in web
     components or an embedded frame the filler saw ZERO fields and quietly did
     nothing. That is not a per-platform bug — it is why "autofill did nothing"
     looked different on every ATS:

       SmartRecruiters  spl-input / spl-select   → open shadow roots
       Oracle Recruiting  oj-input-text          → open shadow roots
       Greenhouse embed, iCIMS, SuccessFactors,
       Taleo, BrassRing                          → the form is in an <iframe>

     These walk every open shadow root and every SAME-ORIGIN frame document.
     (Cross-origin frames are unreachable from here by design; the orchestrator
     injects the content script into those frames directly for queue jobs.) */
  function fieldRoots() {
    const roots = [document];
    // Same-origin frames, one level of nesting deep — enough for every embedded
    // ATS form seen in practice, and bounded so a page of ad frames stays cheap.
    const collectFrames = (doc, depth) => {
      if (!doc || depth > 2) return;
      let frames = [];
      try { frames = [...doc.querySelectorAll('iframe,frame')]; } catch (_) { return; }
      for (const f of frames.slice(0, 12)) {
        let d = null;
        try { d = f.contentDocument; } catch (_) { d = null; }   // cross-origin → null
        if (!d || !d.querySelectorAll) continue;
        roots.push(d);
        collectFrames(d, depth + 1);
      }
    };
    collectFrames(document, 0);
    return roots;
  }
  // All matching elements anywhere: light DOM, open shadow roots, same-origin frames.
  function deepAll(sel, limit) {
    const out = [];
    const cap = limit || 800;
    for (const root of fieldRoots()) {
      if (out.length >= cap) break;
      for (const el of deepQueryAll(sel, root, cap - out.length)) out.push(el);
    }
    return out;
  }
  function deepOne(sel) { return deepAll(sel, 1)[0] || null; }
  // The root node an element actually lives in — a shadow root, a frame document,
  // or the main document. getElementById/querySelector must be scoped to THIS, or
  // a label lookup for a field inside a shadow root silently finds nothing.
  function ownerScope(el) {
    try { const r = el.getRootNode(); return (r && r.querySelector) ? r : document; }
    catch (_) { return document; }
  }

  /* Web components frequently ignore .click() and only react to a full pointer
     sequence (this is exactly how SmartRecruiters' spl-select options behave). */
  function triggerMouse(el, opts2) {
    if (!el) return false;
    // Same guard as realClick: this is the path web components are clicked
    // through, so leaving it unguarded left the remove button reachable.
    if (!(opts2 && opts2.force) && isDestructiveControl(el)) {
      LOG('Refusing to pointer-click destructive control:', controlName(el).slice(0, 60) || '(unlabelled ×)');
      return false;
    }
    const opts = { bubbles: true, composed: true, cancelable: true, view: window };
    for (const t of ['pointerover', 'pointerenter', 'pointerdown', 'mouseover', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        const Ctor = t.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(t, opts));
      } catch (_) {}
    }
    try { el.click(); } catch (_) {}
    return true;
  }

  // True if the element is already (roughly) within the viewport, so we don't need to
  // scroll. Repeated scrollIntoView during autofill was making the page jump up/down.
  function inView(el) {
    try { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight); }
    catch (_) { return true; }
  }
  // Scroll only when needed, and INSTANT + 'nearest' (no smooth animation, no forced
  // centering) so the page doesn't bounce around while filling/clicking.
  function scrollIfNeeded(el) { try { if (el && !inView(el)) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {} }
  function clickEl(el) { if (!el) return false; scrollIfNeeded(el); realClick(el); return true; }
  // Automation should run only when Fully Automated is ON, or a bulk (CSV) run is active
  // in this runner tab. Long loops poll this so flipping the toggle OFF halts them.
  // Fail-CLOSED: if we cannot tell, we do not automate. (This used to return
  // false — "not stopped" — on error, i.e. it defaulted to running.)
  function autoStopped() {
    try {
      if (typeof window.__uaAutoAllowed === 'function') return !window.__uaAutoAllowed();
      return !autoApply && !(qActive && isRunnerTab());
    } catch (_) { return true; }
  }

  function waitFor(sel, ms, xpath) {
    return new Promise(res => {
      const f = () => xpath ? document.evaluate(sel, document, null, 9, null).singleNodeValue : document.querySelector(sel);
      const e = f(); if (e) { res(e); return; }
      const o = new MutationObserver(() => { const e = f(); if (e) { o.disconnect(); res(e); } });
      o.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { o.disconnect(); res(null); }, ms || 10000);
    });
  }

  async function findByText(sel, re, to) {
    const dl = Date.now() + (to || 5000);
    while (Date.now() < dl) {
      for (const e of $$(sel)) if (re.test(e.textContent?.trim()) && isVisible(e)) return e;
      await sleep(500);
    }
    return null;
  }

  // ===================== FIELD LABEL EXTRACTION =====================
  function splitCamelCase(s) { return (s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]/g, ' ').toLowerCase(); }
  function getLabel(el) {
    if (!el) return '';
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // Scope every lookup to the element's OWN root (shadow root / frame document).
    // Against `document` these all missed for fields inside web components, leaving
    // the field unlabelled — and an unlabelled field is one no guesser can fill.
    const scope = ownerScope(el);
    const byId = (id) => { try { return scope.getElementById ? scope.getElementById(id) : scope.querySelector('#' + CSS.escape(id)); } catch (_) { return null; } };
    const describedBy = el.getAttribute('aria-describedby');
    if (describedBy) { const d = byId(describedBy); if (d?.textContent?.trim()) return d.textContent.trim(); }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) { const d = byId(labelledBy); if (d?.textContent?.trim()) return d.textContent.trim(); }
    if (el.id) {
      let lbl = null;
      try { lbl = scope.querySelector(`label[for="${CSS.escape(el.id)}"]`); } catch (_) {}
      if (lbl) return lbl.textContent.trim();
    }
    // A GENERIC placeholder ("Enter your answer", "Type here", "Select…") tells us nothing
    // about the field and was previously returned here — shadowing the real question label
    // from the fieldset/container below, so guessValue couldn't match and the field got the
    // wrong value or none. Only use a placeholder if it's specific enough to be a real hint,
    // and only AFTER trying the structural labels (fieldset legend / container label).
    const GENERIC_PLACEHOLDER = /^\s*(enter|type|select|choose|pick|search|please|your answer|answer here|e\.?g\.?|example|start typing|--|\.\.\.|…)\b|^\s*(select|choose)\s*(an?\s+)?(option|one|value)?\s*\.*\s*$/i;
    const specificPlaceholder = (el.placeholder && !GENERIC_PLACEHOLDER.test(el.placeholder)) ? el.placeholder : '';
    const autoId = el.getAttribute('data-automation-id') || el.getAttribute('data-testid') || el.getAttribute('data-qa');
    if (autoId) { const readable = splitCamelCase(autoId); if (readable.length > 2 && !/^(input|field|text|form|container)$/i.test(readable)) return readable; }
    const fieldset = el.closest('fieldset');
    if (fieldset) { const legend = fieldset.querySelector('legend'); if (legend?.textContent?.trim()) return legend.textContent.trim(); }
    const container = el.closest('.form-group,.field,.question,[class*="Field"],[class*="Question"],[class*="form-row"],li,.form-item,.ant-form-item,.ant-row,[data-testid],[role="group"],.css-1wa3eu0-placeholder,.MuiFormControl-root,.MuiGrid-item,fieldset,[class*="formElement"],[class*="input-group"],[class*="form-field"]');
    if (container) {
      const lbl = container.querySelector('label,[class*="label"],[class*="Label"],legend,[class*="title"],[class*="prompt"],[class*="question-text"]');
      if (lbl && lbl !== el && !lbl.contains(el)) return lbl.textContent.trim();
    }
    // Fall back to a specific (non-generic) placeholder before the last-ditch sibling/name guesses.
    if (specificPlaceholder) return specificPlaceholder;
    const prev = el.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') && prev.textContent?.trim().length < 100) return prev.textContent.trim();
    const parentText = el.parentElement?.childNodes?.[0];
    if (parentText?.nodeType === 3 && parentText.textContent?.trim().length > 1 && parentText.textContent?.trim().length < 60) return parentText.textContent.trim();
    return splitCamelCase(el.name || el.id) || '';
  }

  // A checkbox we should NOT auto-tick: marketing/newsletter/promotional opt-ins.
  // Our account-creation flow ticks "every checkbox" to satisfy the required
  // "agree to terms / privacy notice" consent — but that could also silently opt the
  // user into job-alert / marketing emails. Skip anything that reads like marketing,
  // UNLESS it's clearly a REQUIRED legal consent (terms/privacy/agree).
  function isMarketingCheckbox(el) {
    try {
      const t = ((getLabel(el) || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase();
      if (!/market|newsletter|promotion|promotional|job.?alert|subscribe|keep me (updated|informed)|notify me|email me about|opt.?in|receive.*(email|update|offer)|similar (jobs|roles|opportunities)/.test(t)) return false;
      // Don't treat a genuine legal consent as marketing even if it mentions "email".
      if (/\b(terms|privacy|consent to the|agree to the|conditions|policy|acknowledge)\b/.test(t) && (el.required || el.getAttribute('aria-required') === 'true')) return false;
      return true;
    } catch (_) { return false; }
  }

  function isFieldRequired(el) {
    if (!el) return false;
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const container = el.closest('.field,.question,[class*="field"],[class*="Field"],[class*="question"],li,div');
    const label = getLabel(el);
    if (/\*\s*$|required/i.test(label || '')) return true;
    if (container) {
      if (container.classList.contains('required')) return true;
      if (container.getAttribute('data-required') === 'true') return true;
      // .mandatory is Avature's marker; .req/.is-required turn up elsewhere.
      if (container.querySelector('.required,.mandatory,.req,.is-required,.asterisk,[aria-label*="required" i]')) return true;
    }
    return false;
  }

  function hasFieldValue(el) {
    if (!el) return false;
    if (el.tagName === 'SELECT') {
      const val = (el.value || '').trim();
      if (!val) return false;
      const idx = el.selectedIndex;
      if (idx >= 0) {
        const txt = (el.options[idx]?.textContent || '').trim().toLowerCase();
        if (!txt || /^(select|choose|please|--|—)/.test(txt)) return false;
      }
      return true;
    }
    if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked;
    return !!el.value?.trim();
  }

  // ===================== QUEUE OPS =====================
  // Normalize a URL so the same job isn't counted twice (the two parsers can emit
  // slightly different strings — trailing punctuation, hash, etc.). This is what
  // made a CSV of N urls show ~2N "jobs".
  // Only http(s) URLs are ever queued or navigated to. A CSV cell is untrusted
  // input, and the queue feeds `location.href` — a `javascript:` or `data:` row
  // must never survive normalization. Tracking params are stripped so the same
  // job posting shared from two places de-duplicates to one entry.
  function isSafeJobUrl(u) {
    try { const p = new URL(String(u)).protocol; return p === 'http:' || p === 'https:'; } catch (_) { return false; }
  }
  function normalizeUrl(u) {
    if (!u) return '';
    let s = String(u).trim().replace(/^[\s"'<([]+/, '').replace(/[)\]}>"'.,;]+$/, '');
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[\w-]+(\.[\w-]+)+\//.test(s)) s = 'https://' + s;
    try {
      const x = new URL(s);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
      x.hash = '';
      for (const p of [...x.searchParams.keys()]) {
        if (/^(utm_[\w-]*|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|_ga|trk|trackingId)$/i.test(p)) x.searchParams.delete(p);
      }
      return x.href.replace(/\/$/, '');
    } catch (_) { return ''; }
  }
  async function addJob(url, title, meta) {
    url = normalizeUrl(url);
    if (!url || !isSafeJobUrl(url) || queue.some(j => normalizeUrl(j.url) === url)) return;
    queue.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, title: title || shortUrl(url), status: 'pending', addedAt: Date.now(), jobBoard: detectJobBoard(url), companyName: meta?.companyName || '', error: null, startedAt: null, completedAt: null, duration: null, ...(meta || {}) });
    await saveQ(); renderQ(); updateCtrl();
  }
  async function removeJob(id) { queue = queue.filter(j => j.id !== id); selected.delete(id); await saveQ(); renderQ(); updateCtrl(); }
  async function clearQ() { queue = []; selected.clear(); await saveQ(); renderQ(); updateCtrl(); }
  async function removeSelected() { queue = queue.filter(j => !selected.has(j.id)); selected.clear(); await saveQ(); renderQ(); updateCtrl(); }
  function shortUrl(u) { try { const p = new URL(u); return p.hostname.replace('www.', '') + p.pathname.slice(0, 30); } catch { return u.slice(0, 40); } }
  // Proper RFC-4180 parsing with delimiter sniffing. The old line-splitting version
  // corrupted any export whose cells were quoted and contained a comma or a newline
  // (job titles like "Engineer, Backend" are extremely common), and it only ever
  // understood comma/tab — semicolon files from European Excel came out as one giant
  // cell. It also pushed a whole "URL,Title,Location" line as a second bogus "URL",
  // which Chrome then percent-encoded into the malformed request Workday answered
  // with HTTP 406. Both classes of bug are gone: exactly one URL per row.
  function sniffDelimiter(text) {
    const line = String(text).split(/\r?\n/).find(l => l.trim()) || '';
    let best = ',', bestN = 0;
    for (const d of [',', ';', '\t', '|']) {
      const n = line.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    }
    return bestN ? best : ',';
  }
  function parseCsvRows(text, delim) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (inQ) {
        if (ch === '"' && nx === '"') { field += '"'; i++; }
        else if (ch === '"') inQ = false;
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\r') { /* handled by \n */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length && r.some(c => c.trim()));
  }
  // Pull the job URL out of a row however it was written: its own column, a bare URL
  // in any cell, a link with surrounding punctuation, or a hostname with no scheme.
  function urlFromCsvRow(row) {
    for (const raw of row) {
      const cell = String(raw == null ? '' : raw).trim();
      if (!cell) continue;
      const m = cell.match(/https?:\/\/[^\s,"'<>)\]]+/i);
      if (m) { const u = normalizeUrl(m[0]); if (u) return u; }
      const u = normalizeUrl(cell);
      if (u && /^https?:\/\/[^/]+\./i.test(u)) return u;
    }
    return '';
  }
  function parseCSV(t) {
    const text = String(t || '').replace(/^﻿/, '');   // strip Excel's BOM
    const rows = parseCsvRows(text, sniffDelimiter(text));
    const out = [];
    for (const r of rows) {
      const u = urlFromCsvRow(r);
      if (u && isSafeJobUrl(u) && !out.includes(u)) out.push(u);
    }
    return out;
  }

  // ===================== ATS =====================
  /* ── WHITE-LABELLED ATS: DETECT THE PLATFORM, NOT THE COMPANY ──────────────
     Deloitte runs Avature at apply.deloitte.com. JPMorgan runs Oracle Recruiting
     at jpmc.fa.oraclecloud.com and fronts it from careers.jpmorgan.com. Large
     employers nearly always put the ATS behind their own domain, so a host list
     can only ever cover the handful of companies someone has already hit — every
     other one falls through to the generic path and struggles.

     Two layers fix that without needing a domain list:

       1. ROUTE SIGNATURES. Every platform ships fixed route names, and those do
          not change when the domain does. /hcmUI/CandidateExperience is Oracle
          wherever it is served from; /careersection/ is Taleo; /careers/JobDetail
          is Avature. These are in the ATS table above.

       2. DOM FINGERPRINTS. When the URL says nothing — a bare careers.acme.com —
          the page itself still does. Workday stamps data-automation-id on
          everything; SmartRecruiters renders spl-* elements; Oracle renders oj-*;
          iCIMS wraps its form in an #icims_content_iframe. Checked in order of
          how specific the marker is, and only used when the URL was inconclusive,
          so it can never override a confident URL match. */
  const DOM_FINGERPRINTS = [
    // marker              → driver name        (most specific first)
    { n: 'iCIMS', sel: '#icims_content_iframe,iframe[src*="icims.com"],.iCIMS_MainWrapper,[id^="icims_"]' },
    { n: 'SmartRecruiters', sel: 'spl-input,spl-select,spl-button,spl-file-upload,[class*="spl-"]' },
    { n: 'Oracle Recruiting', sel: 'oj-input-text,oj-select-single,oj-radioset,oj-button,[id^="oj-"]' },
    { n: 'Workday', sel: '[data-automation-id="jobPostingHeader"],[data-automation-id="applyManually"],[data-automation-id]' },
    { n: 'Phenom', sel: '#phApp,.phApp-ph-page,[class^="ph-"],[data-ph-at-id]' },
    { n: 'Eightfold', sel: '[class*="pcs-"],#pcs-body-container,[data-test-id^="position-"]' },
    { n: 'Greenhouse', sel: '#grnhse_app,iframe[src*="greenhouse.io"],#application_form,[id^="job_application_"]' },
    { n: 'Lever', sel: '.application-form .application-question,[name^="cards["],.lever-application' },
    { n: 'Ashby', sel: '[data-testid="application-form"],._container_ashby,[class*="ashby"]' },
    { n: 'Avature', sel: 'form[action*="/careers/"] .mandatory,#avature,[id^="avature"],[class*="avature"]' },
    { n: 'SuccessFactors', sel: '[id*="sfCareer"],[class*="jobDescription"][class*="sf"],#careerSiteHeader' },
    { n: 'Cornerstone', sel: '[data-tag="csod"],[class*="csod-"],#csod-main' },
    { n: 'Taleo', sel: '#requisitionDescriptionInterface,[id^="requisitionDescriptionInterface"],.taleo' },
  ];

  /* The name of the platform this page is built with, or null. Deliberately
     conservative: one marker is not enough if it is a generic one, so the
     broad selectors are only trusted when nothing more specific matched. */
  function detectATSByDom() {
    for (const f of DOM_FINGERPRINTS) {
      try { if (deepAll(f.sel, 3).some(isVisible) || deepAll(f.sel, 3).length >= 2) return f.n; }
      catch (_) {}
    }
    return null;
  }

  /* URL first — a confident route match is stronger evidence than a DOM marker,
     which a page can carry for an embedded widget it merely links to. The generic
     "Career" catch-all is NOT confident, so a fingerprint is allowed to replace
     it: that is the case a white-labelled employer domain lands in. */
  function detectATS() {
    let byUrl = null;
    for (const a of ATS) { if (a.p.test(location.href)) { byUrl = a.n; break; } }
    if (byUrl && byUrl !== 'Career') return byUrl;
    const byDom = detectATSByDom();
    if (byDom) {
      if (byUrl !== byDom) LOG(`ATS recognised from the page itself: ${byDom}${byUrl ? ' (URL only said "' + byUrl + '")' : ''}`);
      return byDom;
    }
    return byUrl;
  }
  function isWorkday() { return /myworkdayjobs\.com|myworkdaysite\.com|workday\.com\/.*\/job/i.test(location.href); }
  function isJobright() { return /jobright\.ai/i.test(location.hostname); }

  // ===================== FALLBACK FORM FILLER =====================
  // Fills fields that Jobright autofill missed
  async function fallbackFill__impl() {
    LOG('Fallback fill starting — catching missed fields');
    const p = await getProfile();
    await loadAnswerBank();
    let filled = 0;

    // Text inputs & textareas — only unfilled ones
    const inputs = deepAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),textarea')
      .filter(el => isVisible(el) && !el.value?.trim());

    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      // Leave OPTIONAL date fields alone — typing into MM/YYYY pickers pops calendars
      // open and risks committing junk dates. Required ones are handled by the per-ATS
      // education/experience fillers with real dates.
      if (!isFieldRequired(inp) && (inp.type === 'date' || /MM\s*\/\s*YYYY|DD\s*\/\s*MM/i.test(inp.placeholder || '') || /\b(start|end)\s+date\b/i.test(lbl))) continue;
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      if (!writeAllowed(inp, val)) continue;   // it has already refused this value
      inp.focus({ preventScroll: true });
      await sleep(100); // Stabilize focus before setting value
      nativeSet(inp, val);                     // fires composed events on the host chain
      filled++;
      noteProgress('filling fields');   // per field: a long form is not a stall
      await sleep(200); // Accuracy-first: deliberate pacing between fields
    }

    // Select dropdowns — only unselected ones
    const selects = deepAll('select').filter(el => isVisible(el) && !hasFieldValue(el));
    for (const sel of selects) {
      const lbl = getLabel(sel);
      const lblLower = (lbl || '').toLowerCase();
      const isEEO = /gender|disability|veteran|race|ethnicity|sex\b|heritage/i.test(lblLower);
      const val = guessFieldValue(lbl, p, sel);
      const opts = deepAll('option', sel).filter(o => o.value && o.index > 0);
      let opt = null;
      if (val) {
        const valLower = val.toLowerCase().trim();
        opt = opts.find(o => o.text.trim().toLowerCase() === valLower)
          || opts.find(o => o.text.trim().toLowerCase().includes(valLower))
          || opts.find(o => o.value.toLowerCase() === valLower)
          || opts.find(o => valLower.includes(o.text.trim().toLowerCase()) && o.text.trim().length > 1);
        if (!opt) { const words = valLower.split(/\s+/).filter(w => w.length > 2); if (words.length) opt = opts.find(o => words.some(w => o.text.trim().toLowerCase().includes(w))); }
      }
      // EEO/demographic fields: if nothing matched (this also covers the common case
      // where guessValue already returned the generic "Prefer not to say" default and
      // it simply doesn't match the site's own wording), prefer a genuine "decline to
      // answer" style option over guessing a SPECIFIC demographic value.
      if (!opt && isEEO) opt = opts.find(o => /prefer not|decline|not to|do not|don.t wish/i.test(o.text));
      if (opt) { setSelectValue(sel, opt.value); filled++; }
      else if (isFieldRequired(sel) && opts.length) {
        // Blindly picking option[0] when we have NO confident match used to run
        // unconditionally — including on OPTIONAL dropdowns and EEO fields, where it
        // could select a wrong SPECIFIC value (e.g. a random gender/race) instead of
        // leaving an optional field alone. Now this last resort only fires when the
        // field is actually REQUIRED (so the form would otherwise be unsubmittable).
        setSelectValue(sel, opts[0].value); filled++;
      }
    }

    // Attach the CV if the form wants one and nothing is attached yet. Skipped
    // silently when a file is already there, so we never touch a remove control.
    try {
      const cvState = await attachResume();
      if (cvState === 'attached') filled++;
    } catch (e) { LOG('CV attach pass error:', e?.message || e); }

    // A REQUIRED cover letter is its own upload widget, not a text box, and it
    // blocks the submit exactly like a missing CV does. See satisfyCoverLetter.
    try { if (await satisfyCoverLetter(p)) filled++; } catch (e) { LOG('Cover letter pass error:', e?.message || e); }

    // Custom dropdowns (react-select / MUI / Ant / spl-select / oj-select). Native
    // <select> is handled above; these are what most modern ATS actually render,
    // and an unanswered REQUIRED one blocks submission however complete the rest
    // of the form is.
    try { filled += await fillCustomDropdowns(p); } catch (e) { LOG('Custom dropdown pass error:', e?.message || e); }

    // Radio buttons — Master Knockout Question System
    const groups = {};
    deepAll('input[type=radio]').filter(isVisible).forEach(r => { (groups[r.name || r.id] ||= []).push(r); });
    for (const [, radios] of Object.entries(groups)) {
      if (radios.some(r => r.checked)) continue;
      const parent = radios[0].closest('fieldset, .question, [class*="question"], .form-group, [class*="field"]');
      if (answerKnockoutRadioGroup(radios, parent, p)) filled++;
    }

    // Button-style questions (Ashby, Kraken, etc.)
    filled += answerButtonStyleQuestions(p);

    // Required checkboxes and declaration/consent boxes — native OR web component.
    // The old pass matched `input[type=checkbox][required]` only, so a Spark
    // `spl-checkbox` declaration ("You declare that you have read and understand
    // the privacy notice of ...") was never ticked and the step was rejected with
    // "Value is required" while every other field read as filled.
    try { filled += await tickConsentBoxes(); } catch (e) { LOG('Consent pass error:', e?.message || e); }

    // Anything those answers just revealed (conditional sub-questions).
    try { filled += await resolveDependentQuestions(3); } catch (e) { LOG('Dependent question pass error:', e?.message || e); }

    // Date fields — try to fill with reasonable defaults
    const dateInputs = deepAll('input[type=date]').filter(el => isVisible(el) && !el.value);
    for (const d of dateInputs) {
      const lbl = getLabel(d);
      const l = (lbl || '').toLowerCase();
      let val = '';
      if (/start|available|earliest|begin/.test(l)) {
        const today = new Date(); today.setDate(today.getDate() + 14);
        val = today.toISOString().split('T')[0];
      } else if (/grad|completion|end/.test(l)) {
        val = p.graduation_year ? `${p.graduation_year}-05-15` : '';
      } else if (/birth|dob/.test(l)) {
        val = p.dob || '';
      }
      if (val) { nativeSet(d, val); filled++; }
    }

    // Number fields (years of experience, salary, etc.)
    const numInputs = deepAll('input[type=number]').filter(el => isVisible(el) && !el.value);
    for (const n of numInputs) {
      const lbl = getLabel(n);
      const val = guessFieldValue(lbl, p, n);
      if (val && !isNaN(Number(val))) { nativeSet(n, val); n.dispatchEvent(new Event('change', { bubbles: true, composed: true })); filled++; await sleep(150); }
    }

    // Contenteditable divs (rich text editors)
    const editables = deepAll('[contenteditable="true"]').filter(el => isVisible(el) && !el.textContent?.trim());
    for (const ed of editables) {
      const lbl = getLabel(ed) || ed.getAttribute('data-placeholder') || '';
      const val = guessFieldValue(lbl, p, ed);
      if (val) { ed.textContent = val; ed.dispatchEvent(new Event('input', { bubbles: true, composed: true })); filled++; await sleep(150); }
    }

    // Fix phone country code on every fallback fill pass
    await fixPhoneCountryCode();

    // ===== ACCURACY VERIFICATION PASS =====
    // Re-scan all visible fields and verify values stuck; re-apply if cleared by JS frameworks
    await sleep(500); // Let frameworks settle after initial fill
    let verified = 0, refilled = 0;
    const verifyInputs = deepAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),textarea')
      .filter(el => isVisible(el) && !el.value?.trim());
    for (const inp of verifyInputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      // Field was supposed to be filled but is empty — the framework may have
      // cleared it. Retry, but only while the write ledger still allows it.
      if (!writeAllowed(inp, val)) continue;
      inp.focus({ preventScroll: true }); await sleep(100);
      nativeSet(inp, val);
      refilled++;
      await sleep(200);
    }
    const verifySelects = deepAll('select').filter(el => isVisible(el) && !hasFieldValue(el));
    for (const sel of verifySelects) {
      const lbl = getLabel(sel);
      const val = guessFieldValue(lbl, p, sel);
      if (!val) continue;
      const opt = deepAll('option', sel).find(o => o.text.toLowerCase().includes(val.toLowerCase()));
      if (opt) { setSelectValue(sel, opt.value); refilled++; }
    }
    if (refilled > 0) LOG(`Verification pass: re-filled ${refilled} fields that were cleared`);

    // FULL-AUTO: commit Google-Places / typeahead location fields LAST so the selection
    // is not clobbered by the verification re-fill above. This clears the common
    // "Please enter your location" stall that would otherwise require manual input.
    const locFixed = await resolveLocationFields();

    // Learn from all filled fields for future use
    learnFromFilledFields();

    LOG(`Fallback fill done: ${filled} fields filled, ${refilled} re-verified, ${locFixed} location committed`);
    if (filled || refilled || locFixed) noteProgress(`filled ${filled + refilled + locFixed} field(s)`);
    return filled + refilled + locFixed;
  }
  /* Re-entrancy and budget guards.

     The fill passes call each other: the general fill chases dependent
     questions, the guarantor runs the general fill again when answering reveals
     more, and the multi-page driver runs all of it once per page. Each is
     bounded on its own, but nested they multiply — and with an unstable step
     signature (fixed above) they never converged at all. Two guards make
     runaway filling impossible rather than merely unlikely. */
  let _fillDepth = 0;
  let _dependentDepth = 0;

  // A step may only be fully re-filled so many times. If a field refuses to keep
  // the value we write (a web component that never heard our events, a
  // server-side reset), the budget stops us retyping it forever.
  const FILL_PASSES_PER_STEP = 4;
  let _fillBudgetSig = '';
  let _fillBudgetUsed = 0;
  let _fillBudgetWarned = false;
  function fillBudgetOk() {
    const sig = stepSignature();
    if (sig !== _fillBudgetSig) { _fillBudgetSig = sig; _fillBudgetUsed = 0; _fillBudgetWarned = false; }
    if (_fillBudgetUsed >= FILL_PASSES_PER_STEP) {
      if (!_fillBudgetWarned) {
        _fillBudgetWarned = true;
        LOG(`This step has been filled ${FILL_PASSES_PER_STEP} times without changing — not filling it again`);
      }
      return false;
    }
    _fillBudgetUsed++;
    return true;
  }

  /* A field that will not keep what we write must not be retyped indefinitely —
     that is what "infinite autofill" looks like from the outside. Three attempts
     at the same value, then we leave it and say so once. */
  const _writeLedger = new WeakMap();
  /* The search box INSIDE an open dropdown is not a field. It looks like one to
     every enumerator — a visible, empty text input with the dropdown's label
     above it — so the filler typed the answer into it, the list filtered to
     nothing, and the actual field stayed empty. SmartRecruiters' is the one that
     showed it up; the pattern is the same wherever a combobox filters as you
     type, so this matches on the role rather than on any one ATS's class name. */
  function isTransientSearchBox(el) {
    try {
      if (!el || (el.tagName || '').toUpperCase() !== 'INPUT') return false;
      const cls = String(el.className || '') + ' ' + String(el.getAttribute('data-input') || '');
      if (/dropdown.?search|select.?search|combobox.?search|search.?input/i.test(cls)) return true;
      // An input the page itself declares as a listbox's filter.
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'searchbox' && el.getAttribute('aria-controls')) return true;
      return false;
    } catch (_) { return false; }
  }

  function writeAllowed(el, val) {
    if (isTransientSearchBox(el)) return false;
    try {
      const rec = _writeLedger.get(el);
      if (!rec || rec.val !== val) { _writeLedger.set(el, { val, tries: 1 }); return true; }
      if (rec.tries >= 3) {
        if (!rec.warned) {
          rec.warned = true;
          LOG('Field will not keep its value, leaving it: ' + String(getLabel(el) || el.name || el.id || 'field').slice(0, 60));
        }
        return false;
      }
      rec.tries++;
      return true;
    } catch (_) { return true; }
  }

  // Stall watchdog stands down while this runs — see withBusy.
  async function fallbackFill(...a) {
    if (_fillDepth > 0) return 0;                       // never nest a fill inside a fill
    if (!fillBudgetOk()) return 0;                      // this step has had its passes
    _fillDepth++;
    try { return await withBusy('filling fields', () => fallbackFill__impl(...a)); }
    finally { _fillDepth--; }
  }

  // ===================== LEARN FROM PAGE (capture filled answers) =====================
  async function learnFromPage() {
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),textarea,select')
      .filter(el => isVisible(el) && hasFieldValue(el));
    for (const el of inputs) {
      const lbl = getLabel(el);
      if (!lbl) continue;
      const val = el.tagName === 'SELECT' ? (el.options[el.selectedIndex]?.textContent || el.value) : el.value;
      if (val) await learnAnswer(lbl, val.trim());
    }
    LOG(`Learned answers from ${inputs.length} fields`);
  }

  // ===================== SUCCESS / FAILURE / STABILITY DETECTION =====================
  // (Robustness techniques adapted from the OptimHire auto-applier for 100% reliability.)
  const SUCCESS_TEXT_RE = /application\s+(was\s+)?(submitted|received|complete)|thank\s+you\s+for\s+(applying|your\s+application|your\s+interest)|we['’]ve\s+received\s+your\s+application|we\s+have\s+received\s+your\s+application|your\s+application\s+has\s+been\s+(received|submitted)|application\s+successful|you['’]ve\s+applied|you['’]re\s+all\s+set|application\s+is\s+under\s+review/i;
  /* A URL only counts as a confirmation page when one of these is a COMPLETE path
     segment. As a substring (what this used to be) it matched ordinary job slugs and
     declared the application submitted before anything had been submitted:
       /jobs/customer-success-manager   → "success"
       /jobs/applied-scientist-ii       → "applied"
       /careers/complete-care-nurse     → "complete"
       /job/donegal-warehouse-operative → "done"
     Those are some of the most common titles there are, which is why filled-but-never
     -submitted jobs were being marked done and skipped on every ATS. */
  const SUCCESS_PATH_RE = /(^|\/)(thanks|thank-?you|thankyou|success|successful|confirmation|submitted|application-?complete|application-?submitted|apply-?success|applicationconfirmation)(\/|$)/i;
  const FAILURE_TEXT_RE = /(already\s+applied|application\s+already\s+submitted|you\s+have\s+already\s+applied|no\s+application\s+(form|available)|job\s+is\s+no\s+longer\s+available|this\s+position\s+is\s+(closed|no\s+longer)|posting\s+is\s+closed|application\s+window\s+has\s+closed|page\s+not\s+found|404\s+error|job\s+posting\s+has\s+expired|posting\s+is\s+no\s+longer\s+available|no\s+longer\s+accepting\s+applications|position\s+has\s+been\s+filled|job\s+has\s+been\s+filled|vacancy\s+(is\s+)?closed)/i;
  /* ── STALL DETECTION ───────────────────────────────────────────────────────
     A "stuck" job looks exactly like a slow one to a wall-clock timeout. These
     track whether anything is actually happening — a field filled, a page
     advanced, a control clicked — so a job that is going nowhere is abandoned in
     seconds instead of holding a slot for minutes. */
  let _lastProgressAt = Date.now();
  let _lastProgressWhat = 'started';
  let _stallLimitMs = 15000;        // no progress for this long → give up on the job
  /* Every stage a job passes through already reports itself here, to keep the
     stall watchdog quiet. That makes it the natural place to record the trail
     too — so a failure comes with the story of how far it got, not just the
     point it stopped at.

     Deduplicated: a long form calls this once per FIELD, and a recorder that
     stored every one of those would be a thousand identical rows per job and
     nothing else. */
  let _lastDiagStage = '';
  function noteProgress(what) {
    _lastProgressAt = Date.now();
    if (what) {
      if (what !== _lastDiagStage) { _lastDiagStage = what; DIAG('stage', what); }
      _lastProgressWhat = what;
    }
  }
  /* The stall clock must not run while we are actually DOING something. Filling a
     long form, waiting for Jobright's own autofill to finish, uploading a CV or
     verifying a submission are all slow by nature — Jobright's autofill alone can
     take 20s+ inside triggerAutofill — and cutting any of them off mid-flight
     would interrupt work that was going fine. Operations that do real work run
     inside withBusy(), and the watchdog stands down for their duration. The
     per-job hard cap is the backstop if one of them ever hangs outright. */
  let _busyDepth = 0;
  let _busyWhat = '';
  function isBusy() { return _busyDepth > 0; }
  async function withBusy(what, fn) {
    _busyDepth++;
    _busyWhat = what;
    noteProgress(what);
    try { return await fn(); }
    finally { _busyDepth--; noteProgress(what); }
  }
  function stalledFor() { return Date.now() - _lastProgressAt; }
  function isStalled() { return stalledFor() > _stallLimitMs; }
  // A page whose URL or field-set changed is making progress even if nothing we
  // did caused it, so watch for that too rather than only crediting our own work.
  let _progressSignature = '';
  function pollPageProgress() {
    try {
      const sig = location.href + '|' + deepAll('input:not([type=hidden]),textarea,select', 200).length +
        '|' + (document.body ? document.body.innerText.length >> 8 : 0);
      if (sig !== _progressSignature) { _progressSignature = sig; noteProgress('page changed'); }
    } catch (_) {}
  }

  let _lastSubmitAt = 0;            // set when our flow clicks a real submit button
  const SUBMIT_GRACE_MS = 8000;    // after a submit with no validation error, treat as success
  /* Multi-page ATS (Taleo, Oracle, iCIMS…) submit on one document and render the
     confirmation in the NEXT one, where _lastSubmitAt is back to 0. Persist the
     attempt against the job so the evidence survives the navigation — without it
     a genuine submission could never be confirmed on those platforms. */
  const SUBMIT_MARK_KEY = 'ua_submit_mark';
  let _submitMark = null;           // { key, ts } restored from storage on boot
  function submitJobKey() {
    try { return (managedIdFromTab() || '') || normalizeUrl(location.href).replace(/[?#].*$/, ''); }
    catch (_) { return location.origin + location.pathname; }
  }
  function markSubmitAttempt() {
    _lastSubmitAt = Date.now();
    const mark = { key: submitJobKey(), ts: _lastSubmitAt, origin: location.origin };
    _submitMark = mark;
    try { st.set(SUBMIT_MARK_KEY, mark); } catch (_) {}
  }
  function clearSubmitAttempt() {
    _lastSubmitAt = 0;
    _submitMark = null;
    try { st.set(SUBMIT_MARK_KEY, null); } catch (_) {}
  }
  // True if we pressed submit for THIS job, in this document or the one before it.
  function submitAttempted() {
    if (_lastSubmitAt) return true;
    if (!_submitMark || !_submitMark.ts) return false;
    if (Date.now() - _submitMark.ts > 3 * 60 * 1000) return false;   // stale
    // Same job (manager id) or the same site we submitted on.
    return _submitMark.key === submitJobKey() || _submitMark.origin === location.origin;
  }
  function submitAttemptAge() {
    const ts = _lastSubmitAt || (_submitMark && _submitMark.ts) || 0;
    return ts ? Date.now() - ts : Infinity;
  }
  // Why a job ended without a confirmed submission. These are different failures:
  // "no Submit control" usually means the form has another page or the button sits
  // in a frame we did not reach; "no confirmation" means it probably did send.
  function submitFailureReason(validationStuck) {
    if (validationStuck) return 'Validation errors could not be resolved';
    if (!submitAttempted()) return 'Form filled but no Submit control was found — nothing was submitted';
    return 'Submit was clicked but no confirmation appeared';
  }
  // A persistent inline validation error means a required field couldn't be satisfied.
  function pageHasValidationError() {
    try {
      const el = $('[aria-invalid="true"],.error,.is-invalid,[class*="field-error"],[class*="fieldError"],[role="alert"]');
      if (!el || !isVisible(el)) return false;
      // [role=alert] is also used for success toasts — only count it if the text looks like an error.
      if (el.matches('[role="alert"]') && !/error|required|invalid|please|must|cannot|missing/i.test(el.textContent || '')) return false;
      return true;
    } catch (_) { return false; }
  }
  function pageHasFailure() {
    try { return FAILURE_TEXT_RE.test((document.body && document.body.innerText || '').slice(0, 4000)); } catch (_) { return false; }
  }

  // ===== CAPTCHA GATE (ported from OptimHire 2.6.4) =====
  // A VISIBLE captcha means no amount of filling/retrying will progress — the only move
  // is a human solving it. Detect it, pause, tell the user, auto-resume once solved.
  // Size/visibility filtering keeps the invisible reCAPTCHA v3 badge (which needs no
  // action) from pausing anything.
  function detectCaptcha() {
    try {
      const PROVIDERS = [
        ['iframe[src*="recaptcha"],iframe[title*="reCAPTCHA"]', 'reCAPTCHA'],
        ['iframe[src*="hcaptcha"],iframe[title*="hCaptcha"]', 'hCaptcha'],
        ['iframe[src*="turnstile"],iframe[src*="challenges.cloudflare.com"]', 'Cloudflare Turnstile'],
        ['.g-recaptcha[data-sitekey]', 'reCAPTCHA'],
        ['.h-captcha[data-sitekey]', 'hCaptcha'],
        ['.cf-turnstile', 'Cloudflare Turnstile'],
        // Providers the old list missed entirely, all common on ATS sign-in walls.
        ['iframe[src*="arkoselabs"],iframe[src*="funcaptcha"],#funcaptcha', 'Arkose / FunCaptcha'],
        ['iframe[src*="geetest"],.geetest_holder,.geetest_panel', 'GeeTest'],
        ['iframe[src*="captcha-delivery"],#px-captcha,[id^="px-captcha"]', 'DataDome / PerimeterX'],
        ['iframe[src*="awswaf"],[id*="awswaf-captcha"]', 'AWS WAF'],
        ['[data-testid="challenge"],[class*="press-and-hold" i]', 'Press-and-hold challenge'],
      ];
      for (const [sel, provider] of PROVIDERS) {
        // deepAll: a challenge rendered inside the application's own iframe, or in a
        // shadow root, was previously undetectable from the top document.
        for (const el of deepAll(sel, 40)) {
          const r = el.getBoundingClientRect();
          if (r.width < 60 || r.height < 50) continue; // v3 badge / hidden token frames
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
          return { provider, el };
        }
      }
      return null;
    } catch (_) { return null; }
  }
  function showCaptchaBanner(provider) {
    try {
      let b = document.getElementById('ua-captcha-banner');
      if (!b) {
        b = document.createElement('div');
        b.id = 'ua-captcha-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b45309;color:#fff;padding:10px 16px;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35)';
        (document.body || document.documentElement).appendChild(b);
      }
      b.textContent = `🧩 ${provider || 'Captcha'} detected — please solve it. Automation is paused and resumes automatically once solved.`;
    } catch (_) {}
  }
  function hideCaptchaBanner() { try { document.getElementById('ua-captcha-banner')?.remove(); } catch (_) {} }
  // Wait (bounded) for the visible captcha to be solved/dismissed. Returns true if clear.
  /* A CAPTCHA is a human check and this does not try to answer one. What it does
     is make the wait VISIBLE and bounded. A queue job runs in a background tab, so
     the on-page banner and the scroll-into-view below are drawn where nobody is
     looking: the old behaviour was to wait silently for three minutes and then let
     the manager's watchdog kill the job, with nothing in the log explaining why.
     Now the queue is told, so it can raise a notification, hold off the watchdog
     while a person is genuinely needed, and show which job is waiting. */
  function reportCaptcha(provider, blocked) {
    try {
      chrome.runtime.sendMessage({
        type: 'UA_JOB_NEEDS_HUMAN',
        reason: blocked ? 'captcha' : null,
        provider: provider || '',
        url: location.href,
        blocked: !!blocked,
      }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }
  /* Same channel, different reason: a job blocked on a verification email is a
     job that needs a person, and the queue has to be told so it can hold off the
     watchdog and show which one is waiting instead of failing it silently. */
  function reportNeedsHuman(reason) {
    try {
      chrome.runtime.sendMessage({
        type: 'UA_JOB_NEEDS_HUMAN',
        reason: String(reason || 'manual step'),
        url: location.href,
        blocked: true,
      }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }
  async function waitForCaptchaClear(maxMs = 180000) {
    const start = Date.now();
    let announced = false;
    while (Date.now() - start < maxMs) {
      const c = detectCaptcha();
      if (!c) {
        if (announced) { hideCaptchaBanner(); reportCaptcha('', false); LOG('Captcha cleared — resuming automation'); }
        return true;
      }
      if (!announced) {
        announced = true;
        showCaptchaBanner(c.provider);
        reportCaptcha(c.provider, true);
        LOG(`CAPTCHA (${c.provider}) detected — automation paused, waiting for you to solve it`);
        try { c.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
      }
      await sleep(2000);
    }
    hideCaptchaBanner();
    const still = !!detectCaptcha();
    if (announced) reportCaptcha('', false);      // stop holding the watchdog off
    if (still) LOG('CAPTCHA still present after the wait — giving up on this job');
    return !still;
  }
  // Resolve once the DOM has been quiet for ~300ms (or after `timeout`) — so we act on a
  // settled page instead of mid-render. Cuts races on multi-step / React forms.
  /* The quiet-period debounce is what this actually costs on a settled page, and
     it was a flat 300ms however fast the run was set to go. Scaled now; the
     overall timeout is left alone, because that is a safety cap rather than a
     pace. */
  function waitForFormStable(timeout = 3000) {
    return new Promise(resolve => {
      let timer = null;
      const quiet = scaled(300, 90);
      const done = () => { try { mo.disconnect(); } catch (_) {} resolve(); };
      const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
      try { mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (_) {}
      setTimeout(done, timeout);
      timer = setTimeout(done, quiet);
    });
  }
  // Same-host, segment-by-segment path match; tolerates a final apply→thanks step word so
  // a post-submit redirect still counts as the same job, but two different job ids don't.
  function urlsRoughlyMatch(a, b) {
    try {
      const ua = new URL(a), ub = new URL(b);
      if (ua.hostname.toLowerCase() !== ub.hostname.toLowerCase()) return false;
      const pa = ua.pathname.split('/').filter(Boolean), pb = ub.pathname.split('/').filter(Boolean);
      if (!pa.length || !pb.length) return true;
      const ACTION = /^(apply|application|apply-now|start|step\d*|thanks|thank-you|thankyou|success|confirm|confirmation|complete|completed|received|submitted|submit|done|review|finish)$/i;
      const n = Math.min(pa.length, pb.length);
      for (let i = 0; i < n; i++) {
        if (pa[i] === pb[i]) continue;
        if (i === n - 1 && (ACTION.test(pa[i]) || ACTION.test(pb[i]))) continue;
        return false;
      }
      return true;
    } catch (_) { return false; }
  }
  // Confirmed submission: an explicit success signal, OR we clicked submit, waited out the
  // grace period, and no validation error came back (handles ATS with no success page).
  /* A job may only be called submitted on real evidence. Previously ANY success
     signal was enough, so a job could be filled to 100%, never submitted, and still
     be marked done — the "it skips to the next one without submitting" report. */
  function confirmSubmitted() {
    if (hardSuccessSignal()) return true;                       // the page says so
    if (!submitAttempted()) return false;                       // we never pressed submit
    if (softSuccessSignal()) return true;                       // pressed + confirmation URL
    // Pressed, the grace window elapsed, no validation error came back, and the
    // form is gone. That combination only happens after a real submission.
    return submitAttemptAge() > SUBMIT_GRACE_MS && !pageHasValidationError() && !hasApplicationForm();
  }

  /* HARD evidence: the page itself says the application was submitted. Safe to
     trust on its own — no ATS renders these unless something really was sent. */
  function hardSuccessSignal() {
    const body = document.body?.innerText || '';
    if (SUCCESS_TEXT_RE.test(body)) return true;
    if ($('#application_confirmation,.application-confirmation,.confirmation-text,.posting-confirmation,.success-message,.submission-confirmation')) return true;
    if ($('[data-automation-id="congratulationsMessage"],[data-automation-id="confirmationMessage"],[data-automation-id="applicationSubmittedPage"]')) return true;
    if ($('#post_application_page,.application-submitted')) return true;      // Greenhouse
    if ($('.application-complete')) return true;                              // Lever
    if ($('.iCIMS_ConfirmMessage,.iCIMS_SuccessMessage')) return true;        // iCIMS
    // A status region, but only with confirmation-grade wording. The old test
    // accepted /submit|success|thank|received|complete/, so the validation error
    // "Please complete all required fields" counted as a successful submission.
    for (const el of $$('[role="alert"],[role="status"],.alert-success,.toast-success').slice(0, 12)) {
      if (SUCCESS_TEXT_RE.test(el.textContent || '')) return true;
    }
    return false;
  }
  /* SOFT evidence: consistent with success but also with never having submitted.
     Only trusted once we know a submit control was actually pressed for this job. */
  function softSuccessSignal() {
    try { if (SUCCESS_PATH_RE.test(new URL(location.href).pathname)) return true; } catch (_) {}
    return false;
  }
  function checkSuccess() { return hardSuccessSignal() || (submitAttempted() && softSuccessSignal()); }

  /* ── SUBMIT-CONTROL RECOGNITION (shared by every ATS driver) ───────────────
     Submit buttons are labelled differently on every platform, and the old test
     ("does the label START with submit/apply/send/complete/finish") missed most
     of the real ones while accepting "Apply", which merely opens a form.

     Missed before:  "Review and Submit" · "Accept & Submit" · "I Agree and Submit"
                     "Confirm and Submit" · "Sign and Submit" · "Send my application"
                     "Bewerbung absenden" · "Envoyer ma candidature" · "Enviar solicitud"
     Wrongly matched: "Apply" / "Apply Now" — those OPEN the application, and
                     clicking one as if it were a submit started the confirmation
                     grace timer on a form that had not been sent.

     A label qualifies on a whole-word submit verb ANYWHERE in it, minus an
     explicit exclusion list. Candidates are then scored so the real final action
     wins over an unrelated "Submit" on the same page (newsletter, search, a
     support form). */
  const SUBMIT_POSITIVE_RE = new RegExp([
    '\\bsubmit\\b',                                  // submit, submit application, review and submit
    '\\bsubmit(ting)?\\s+(my\\s+)?application\\b',
    '^\\s*send\\b',                                  // send, send application, send my application
    '\\bsend\\s+(my\\s+)?(application|cv|r[eé]sum[eé])\\b',
    '^\\s*(finish|complete)\\s*(my\\s+)?(application)?\\s*$',
    '\\bcomplete\\s+(my\\s+)?application\\b',
    '\\bfinish\\s+(and\\s+)?submit\\b',
    // Common non-English finals. "postuler"/"bewerben" are deliberately absent:
    // like "Apply", they open the form rather than send it.
    '\\babsenden\\b', '\\babschicken\\b',          // de
    '\\benvoyer\\b', '\\bsoumettre\\b',            // fr
    '\\benviar\\b',                                   // es/pt
    '\\binvia\\b', '\\binoltra\\b',                // it
    '\\bverzenden\\b', '\\bversturen\\b',          // nl
    '\\bwy[sś]lij\\b',                                // pl
  ].join('|'), 'i');

  const SUBMIT_NEGATIVE_RE = new RegExp([
    '\\b(cancel|back|previous|prev|close|dismiss|skip)\\b',
    '\\bsave\\b.*\\b(later|draft|progress)\\b', '\\bsave\\s+(as\\s+)?draft\\b',
    '\\b(delete|remove|discard|withdraw|clear|reset)\\b',
    '\\b(sign|log)\\s?in\\b', '\\bcreate\\s+account\\b', '\\bregister\\b',
    '\\bupload\\b', '\\bbrowse\\b', '\\battach\\b', '\\badd\\b', '\\bedit\\b',
    '\\bprint\\b', '\\bdownload\\b', '\\bshare\\b', '\\bsearch\\b',
    '\\bsubscribe\\b', '\\bnewsletter\\b', '\\bfeedback\\b', '\\breport\\b',
    '\\bcontact\\b', '\\bquestion\\b', '\\bcomment\\b', '\\bchat\\b',
    '\\bjob\\s+alert', '\\bsave\\s+(this\\s+)?job\\b',
    // "Apply"/"Apply now" open the application — openApplicationForm() owns them.
    '^\\s*apply\\b', '\\bapply\\s+now\\b', '\\bapply\\s+(for|to)\\b', '\\beasy\\s+apply\\b',
  ].join('|'), 'i');

  function controlLabel(el) {
    try {
      const raw = (el.innerText || el.textContent || el.value ||
        (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '');
      return String(raw).replace(/\s+/g, ' ').trim();
    } catch (_) { return ''; }
  }
  function isSubmitLabel(text) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60) return false;
    if (SUBMIT_NEGATIVE_RE.test(t)) return false;
    return SUBMIT_POSITIVE_RE.test(t);
  }

  /* Pick the most plausible FINAL submit on the page. Scored rather than
     first-match, because a page can carry several qualifying buttons and the one
     that ends the application is not necessarily the first in the DOM. */
  function findSubmitControl() {
    const enabled = el => el && isVisible(el) && !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true' && !/\bdisabled\b/.test(el.className || '');
    const cands = deepQueryAll(
      'button,input[type="submit"],input[type="button"],a[role="button"],[role="button"],spl-button,oj-button'
    ).filter(enabled).filter(el => isSubmitLabel(controlLabel(el)));
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];

    const scored = cands.map((el, i) => {
      const label = controlLabel(el).toLowerCase();
      let score = 0;
      if (/\bsubmit\b/.test(label)) score += 4;              // the strongest verb
      if (/\bapplication\b/.test(label)) score += 3;         // "...application" = the real one
      if (el.type === 'submit' || el.tagName === 'BUTTON') score += 1;
      // Inside the form that holds the most inputs — i.e. the application itself,
      // not a newsletter box that happens to have a Submit.
      try {
        const form = el.closest('form');
        if (form) score += Math.min(3, form.querySelectorAll('input,select,textarea').length / 5);
      } catch (_) {}
      // Final actions sit at the bottom of the page.
      try { score += Math.min(2, (el.getBoundingClientRect().top + window.scrollY) / Math.max(1, document.body.scrollHeight) * 2); } catch (_) {}
      score += i / (cands.length * 10);                      // stable tiebreak: later wins
      return { el, score, label };
    }).sort((a, b) => b.score - a.score);
    LOG('Submit candidates: ' + scored.map(x => `"${x.label}"(${x.score.toFixed(1)})`).join(', '));
    return scored[0].el;
  }

  // ===================== AUTO-SUBMIT / NEXT PAGE =====================
  async function autoSubmitOrNext__impl() {
    LOG('Attempting auto-submit or next...');

    // First: learn from the filled page before navigating away
    await learnFromPage();

    // FULL-AUTO: before deciding whether we can submit, guarantee every required field
    // (especially Google-Places location widgets) is committed. This prevents the queue
    // from stalling on "Please enter your location" and removes the need for supervision.
    await guaranteeRequiredFields();
    await sleep(400);

    // Check if all required fields are filled
    let missing = getMissingRequired();
    if (missing.length) {
      // One more guarantor pass to self-heal anything the first pass left.
      await guaranteeRequiredFields();
      await sleep(300);
      missing = getMissingRequired();
    }
    if (missing.length) {
      // Third pass, after a longer wait: SPA forms mount fields after first paint,
      // so the earlier sweeps genuinely could not see them yet.
      await sleep(1500);
      await fallbackFill();
      await guaranteeRequiredFields();
      await sleep(300);
      missing = getMissingRequired();
    }
    // An upload still in flight is the difference between "resume attached" and
    // "resume required" on most ATS. Never submit through one.
    if (resumeUploadInFlight()) { LOG('Waiting for a file upload to finish before submitting'); await waitForResumeUpload(25000); }
    logFillReport('Before submit');

    // Submit selectors (informational `missing` log above; actual gating below is on the
    // button's own enabled/disabled state, not on our heuristic missing-field count)
    const submitSels = [
      'button[type="submit"]', 'input[type="submit"]',
      'button[data-automation-id="submit"]', 'button[data-automation-id="submitButton"]',
      '#submit_app', '.postings-btn-submit', 'button.application-submit',
      'button[data-qa="btn-submit"]', 'button[aria-label*="Submit" i]',
      '[data-testid="submit-application"]', '[data-testid="submit-button"]',
      'button.btn-submit', '#resumeSubmitForm',
      'div.form-group.submit-button button.btn.btn-primary',
      '.application-submit-button', '#application-submit', '[name="submit_app"]',
      'button[data-qa="submit-application"]',
    ];

    // Try submit — ALWAYS attempt this (do NOT gate on our own `missing` heuristic).
    // getMissingRequired() is a best-effort guess and can false-positive (e.g. on
    // custom radio/checkbox widgets it doesn't fully recognize) — gating submit on it
    // was silently blocking the click FOREVER even when Jobright itself showed the
    // form 100% complete. Instead we trust the SITE's own validation: only click an
    // ENABLED submit button. A disabled one means the site itself still thinks
    // something's missing (clicking does nothing); if the site allows the click but
    // something really was missing, the post-submit validation-error / retry logic in
    // the queue's verification loop catches it and re-runs the guarantor sweep.
    const submitEnabled = el => el && isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    for (const sel of submitSels) {
      const btn = $(sel);
      if (submitEnabled(btn)) { LOG('Clicking submit:', sel); await sleep(500); realClick(btn); markSubmitAttempt(); return 'submitted'; }
    }
    // Fallback: button by text
    {
      // Label-based, shadow-piercing, scored. Covers the long tail of wordings
      // across platforms ("Submit Application", "Review and Submit", "Accept &
      // Submit", "Send my application", "Bewerbung absenden", …) and reaches the
      // submit buttons that live inside web-component shadow roots.
      const submitBtn = findSubmitControl();
      if (submitBtn) {
        LOG('Clicking submit: "' + controlLabel(submitBtn) + '"');
        scrollIfNeeded(submitBtn);
        await sleep(500);
        realClick(submitBtn);
        markSubmitAttempt();
        noteProgress('submitted');
        return 'submitted';
      }
    }

    // Also try Jobright's continue-button
    const jrContinue = pageOrSidebar('.continue-button:not(.continue-button-disabled)');
    if (jrContinue && isVisible(jrContinue)) {
      LOG('Clicking Jobright continue button');
      await sleep(500);
      realClick(jrContinue);
      return 'next_page';
    }

    // Next / Continue / Save-and-Continue — used by Workday + most multi-page ATS.
    // We only click ENABLED buttons (Workday disables "Continue to the next page"
    // until the page validates), scroll them into view, and if the only candidate
    // is disabled we re-fill + fix validation and try once more so the page advances.
    const enabled = el => el && isVisible(el) && !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !/disabled/.test(el.className || '');
    const nextSels = [
      'button[data-automation-id="bottom-navigation-next-button"]',
      'button[data-automation-id="pageFooterNextButton"]',
      'button[data-automation-id="next-button"]',
      'button[data-automation-id="continueButton"]',
      'button[data-automation-id="wizardNextButton"]',
      'button[aria-label*="Next" i]', 'button[aria-label*="Continue" i]',
      'button[aria-label*="Save and Continue" i]',
      '[data-testid="next-step"]', '[data-testid="continue"]', '[data-testid="next"]',
      'button[data-qa="btn-next"]', 'button[data-qa="continue"]', 'a.btn-next', 'button.btn-next',
    ];
    const nextTextRe = /^(next|continue|proceed|save (and|&) continue|save (and|&) next|agree (and|&) continue|continue to|go to next|next step|save (and|&) submit|review)\b/i;

    const findNext = () => {
      for (const sel of nextSels) { const b = $(sel); if (enabled(b)) return b; }
      return $$('button,a[role="button"],input[type="submit"],input[type="button"]')
        .filter(enabled)
        .find(b => { const t = (b.textContent || b.value || '').trim(); return nextTextRe.test(t) && !/cancel|back|previous|\bprev\b|close|sign ?out|log ?out/i.test(t); }) || null;
    };

    let nextBtn = findNext();
    if (!nextBtn) {
      // Maybe a "Continue" exists but is disabled — re-fill required fields, fix
      // validation, and look again so it becomes clickable.
      await guaranteeRequiredFields();
      await handleValidationErrors();
      await sleep(800);
      nextBtn = findNext();
    }
    if (nextBtn) {
      LOG('Clicking next/continue: ' + (nextBtn.textContent || nextBtn.value || '').trim().slice(0, 40));
      scrollIfNeeded(nextBtn);
      await sleep(300);
      realClick(nextBtn);
      return 'next_page';
    }

    LOG('No submit/next button found');
    return false;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function autoSubmitOrNext(...a) { return withBusy('submitting / advancing', () => autoSubmitOrNext__impl(...a)); }

  /* How complete is this form right now? Reported after every fill pass so the
     queue log says exactly which required fields were left, instead of the run
     silently moving on and leaving you to guess. */
  function fillReport() {
    const required = deepAll('input:not([type=hidden]),textarea,select')
      .filter(el => isVisible(el) && isFieldRequired(el));
    /* getMissingRequired returns LABELS, not elements. This read them as
       elements — getLabel(aString) finds nothing and a string has no .name or
       .id — so every entry collapsed to "(unlabelled)" and the one line that was
       supposed to name the blocking question named nothing. */
    const missing = getMissingRequired();
    const missingLabels = [];
    const seen = new Set();
    for (const raw of missing.slice(0, 20)) {
      const l = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 80) || '(unlabelled)';
      if (!seen.has(l)) { seen.add(l); missingLabels.push(l); }
    }
    const total = required.length;
    const done = Math.max(0, total - missing.length);
    return { total, done, missing: missing.length, missingLabels, pct: total ? Math.round(done / total * 100) : 100 };
  }
  function logFillReport(where) {
    try {
      const r = fillReport();
      LOG(`${where}: ${r.done}/${r.total} required fields filled (${r.pct}%)` +
        (r.missingLabels.length ? ' — still missing: ' + r.missingLabels.join(' | ') : ''));
      DIAG('stage.fill', where, { detail: { done: r.done, total: r.total, pct: r.pct } });
      /* One event per unanswered question, carrying the employer's own wording.
         This is the most useful thing the recorder collects: it turns "the form
         would not submit" into a list of the exact questions the filler has no
         answer for, counted across every ATS. The LABEL only — never what was
         or would have been typed into it. */
      for (const label of r.missingLabels) DIAG('field.unanswered', label);
      return r;
    } catch (_) { return null; }
  }

  function getMissingRequired() {
    const required = deepAll('input:not([type=hidden]),textarea,select').filter(el => isVisible(el) && isFieldRequired(el));
    const missing = [];
    // Dedupe named radio groups — without this, an unanswered Yes/No question reported
    // BOTH of its radio options as separate "missing" entries (inflating the count and,
    // via getMissingRequired's use elsewhere, misleading the UI's missing-fields list).
    const seenRadioGroups = new Set();
    for (const el of required) {
      if (el.type === 'radio') {
        if (el.name) {
          if (seenRadioGroups.has(el.name)) continue; // this group already evaluated
          seenRadioGroups.add(el.name);
          const group = deepAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`).filter(isVisible);
          if (group.some(r => r.checked)) continue;
        } else if (el.checked) continue;
      } else if (el.type === 'checkbox') {
        if (el.checked) continue;
      } else if (hasFieldValue(el)) continue;
      const lbl = getLabel(el) || el.name || el.id || 'Required field';
      if (!missing.includes(lbl)) missing.push(lbl);
    }
    // Web-component questions (Spark spl-radio, Oracle oj-radioset, Material,
    // role="radio"/role="checkbox" widgets) are not <input>s, so none of the above
    // saw them. An unanswered one still blocks the step — and being invisible here
    // is why the loop concluded "nothing left to fix" and gave up on a form that
    // very much still had something to fix.
    try {
      const seenGroups = new Set();
      for (const r of deepAll(CHOICE_CONTROL_SEL, 200).filter(isVisible)) {
        if (r.tagName === 'INPUT') continue;                       // already counted above
        let group = null;
        try { group = r.closest('fieldset,[role=radiogroup],[role=group],.question,.field,li'); } catch (_) {}
        const key = group || r.parentElement || r;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const options = group ? deepQueryAll(CHOICE_CONTROL_SEL, group) : [r];
        if (options.some(choiceChecked)) continue;
        const lbl = (getFullQuestionText(r) || getLabel(r) || 'Required question').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (lbl && !missing.includes(lbl)) missing.push(lbl);
      }
      for (const cb of deepAll(CONSENT_CONTROL_SEL, 100).filter(isVisible)) {
        if (cb.tagName === 'INPUT') continue;
        if (checkboxChecked(cb)) continue;
        const txt = controlText(cb);
        if (!isFieldRequired(cb) && !REQUIRED_ERROR_RE.test(txt)) continue;
        if (MARKETING_TEXT_RE.test(txt)) continue;
        const lbl = txt.slice(0, 120) || 'Required declaration';
        if (!missing.includes(lbl)) missing.push(lbl);
      }
    } catch (_) {}
    return missing;
  }

  // ===================== TAILOR-FIRST AUTOMATION FLOW =====================
  // Step 1: Click "Generate Custom Resume" (in Jobright sidebar)
  // Step 2: Wait for tailoring to complete
  // Step 3: Click "Continue to Autofill" / continue button
  // Step 4: Click "Autofill" button
  // Step 5: Fallback fill missed fields
  // Step 6: Submit or Next

  async function tailorFirstFlow() {
    const ats = detectATS();
    if (!ats) return;
    LOG(`Tailor-first flow starting for ${ats}...`);

    // Wait for Jobright sidebar to load (shadow-aware)
    const sidebar = await waitForSidebar(15000);
    if (!sidebar) { LOG('Jobright sidebar not found — falling back to direct autofill'); await directAutofillFlow(); return; }
    await sleep(2000);

    // Step 1: Click "Generate Custom Resume" only if the user opted into tailoring
    // during the queue. By default we skip it for reliability (the resume-generator
    // combo can hang on "Opening resume generator…") and go straight to Autofill.
    const tailorBtn = queueUseTailor ? (sidebar.querySelector('.application-dashboard-tailor-resume') ||
      sidebar.querySelector('.external-job-generate-resume-button')) : null;
    if (tailorBtn && isVisible(tailorBtn)) {
      LOG('Step 1: Clicking Generate Custom Resume');
      realClick(tailorBtn);
      await sleep(3000);

      // Wait for tailoring to complete (watch for loading to finish)
      LOG('Waiting for resume tailoring to complete...');
      const maxWait = 30000; // 30s max (reduced from 120s to prevent freezing)
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        // Check if loading indicator is gone
        const loading = sidebar.querySelector('.tailor-resume-loading-linear-progress,.resume-loading-container,.spin-loading');
        if (!loading || !isVisible(loading)) {
          // Check if tailored resume is ready (button text changed or autofill button available)
          const autofillBtn = sidebar.querySelector('.auto-fill-button:not([disabled])');
          if (autofillBtn) { LOG('Tailoring complete — autofill button ready'); break; }
          // If no loading and no button, don't spin forever
          if (!loading) { LOG('No loading indicator and no autofill button — moving on'); break; }
        }
        await sleep(1500);
      }
      await sleep(1500);
    } else {
      LOG('Step 1: No tailor button found — skipping to autofill');
    }

    // Step 2-3: Click "Continue to Autofill" / continue button if present
    const continueBtn = sidebar.querySelector('.continue-button:not(.continue-button-disabled)');
    if (continueBtn && isVisible(continueBtn)) {
      LOG('Step 2: Clicking Continue button');
      realClick(continueBtn);
      await sleep(2000);
    }

    // Step 4: Click the Autofill button
    LOG('Step 3: Triggering Autofill');
    await triggerAutofill();

    // Wait for Jobright autofill to complete (watch for "Filling" → "Autofill" text change)
    LOG('Waiting for Jobright autofill to complete...');
    await sleep(2000);
    const fillStart = Date.now();
    while (Date.now() - fillStart < 15000) { // 15s max (reduced from 60s)
      const afBtn = sidebar.querySelector('.auto-fill-button');
      if (afBtn) {
        const txt = afBtn.textContent?.trim().toLowerCase() || '';
        if (txt === 'autofill' || txt === '' || txt === 'filled') break; // Done filling
      } else break; // Button gone — don't wait forever
      await sleep(1000);
    }
    await sleep(1000);

    // Step 5: Try resume upload if needed
    await tryResumeUpload();

    // Step 6: Fallback fill to catch missed fields
    LOG('Step 4: Running fallback fill for missed fields');
    await fallbackFill();
    await sleep(1000);
    // Second pass
    await fallbackFill();
    await sleep(500);
    // Conditional sub-questions + declaration boxes + anything still required.
    await guaranteeRequiredFields();
    // Fix any validation errors
    await handleValidationErrors();
    await sleep(500);

    // Step 7: Auto submit or next
    LOG('Step 5: Auto-submit/next');
    await autoSubmitOrNext();
    await learnFromPage();
    await sleep(2000);
    // Remaining pages / review-confirm / account walls are driven to completion by
    // the dispatcher's universal multi-page driver after this returns.
  }

  // ===================== MULTI-PAGE FORM LOOP =====================
  // Self-navigating: at every step it (re)opens the apply form, completes any
  // account-creation / sign-in wall, autofills, then advances — until the
  // application is submitted (confirmed) or there is genuinely nothing left to do.
  async function multiPageLoop() {
    const MAX_PAGES = 18;
    let prevPageHash = getPageHash();
    let samePageRetries = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (autoStopped()) { LOG('Fully Automated turned off — stopping multi-page loop'); break; }
      if (checkSuccess()) { LOG('Success detected — stopping multi-page loop'); break; }
      // A modal confirm swallows every subsequent click and looks exactly like a
      // page that refuses to advance. Resolve it before spending a page budget.
      await resolveBlockingDialog();
      // A visible captcha blocks every next step — pause for the user instead of
      // burning the page budget on retries that can't succeed.
      if (detectCaptcha()) await waitForCaptchaClear();
      // Same for an email-verification wall: nothing on this page can advance
      // until the code or link arrives.
      if (detectEmailVerificationWall()) await resolveEmailVerification(90000);
      LOG(`Multi-page: processing page ${page}`);

      // Wait for page content to change
      await sleep(2000);

      // Detect whether the page actually advanced. getPageHash is URL + visible-field
      // count + labels, which stays IDENTICAL when a Workday-style page rejects "Save
      // and Continue" and just shows inline validation errors. Previously that made the
      // loop give up after a single failed attempt. Now: if the page didn't advance but
      // there's still something FIXABLE (a validation error or a missing required
      // field), we re-fill and retry the same page (bounded) instead of bailing —
      // clicking Continue re-validates, and the fill pass below re-answers anything we
      // now know how to (e.g. the disclosure "No" defaults + the React select setter).
      const newHash = getPageHash();
      if (page > 1 && newHash === prevPageHash) {
        await sleep(2000);
        const stillSame = getPageHash() === prevPageHash;
        const fixable = pageHasValidationError() || getMissingRequired().length > 0;
        if (stillSame) {
          samePageRetries++;
          if (!fixable || samePageRetries > 4) {
            LOG(`Multi-page: page not advancing (${fixable ? 'unresolved after ' + samePageRetries + ' retries' : 'nothing left to fix'}) — stopping`);
            break;
          }
          LOG(`Page did not advance — re-filling & retrying same page (attempt ${samePageRetries})`);
        }
      } else {
        samePageRetries = 0;
      }
      prevPageHash = getPageHash();

      // Handle anything blocking this step before filling: an "Apply"/"Continue
      // to application" button, or an account-creation / sign-in wall.
      await openApplicationForm();
      await handleAccountAuth();

      // Try Jobright autofill again
      await triggerAutofill();
      await sleep(3000);

      // Fallback fill — two passes + validation fix
      await fallbackFill();
      await sleep(1000);
      await fallbackFill();
      await sleep(500);
      // Conditional sub-questions, declaration boxes and anything still required —
      // this is also what re-scans after an answer reveals a follow-up question.
      await guaranteeRequiredFields();
      await handleValidationErrors();
      await sleep(300);

      // Submit or next
      const beforeAction = getPageHash();
      const action = await autoSubmitOrNext();
      if (action === 'submitted') {
        LOG('Submitted on page ' + page);
        await sleep(3000);
        if (confirmSubmitted()) { LOG('Success confirmed after submit'); break; }
        // Some ATS show a final review/confirm step after the first "submit" —
        // keep looping so we click it too instead of stopping prematurely.
        continue;
      } else if (action === 'next_page') {
        LOG('Next page clicked on page ' + page);
        // Wait for the NEXT step's questions to render before looping round.
        // A flat 3s sleep meant the top of the loop frequently re-read the step
        // we had just left, re-filled it, and burned a page of the budget.
        if (!(await waitForStepChange(beforeAction, 15000)))
          LOG('Page did not advance after Next — will re-check what is blocking it');
        continue;
      } else {
        // No submit/next found — re-fill once and retry; only stop if still nothing.
        await sleep(1500);
        await openApplicationForm();
        await handleAccountAuth();
        await fallbackFill();
        await handleValidationErrors();
        const retry = await autoSubmitOrNext();
        if (retry) { LOG('Retry result: ' + retry); await sleep(3000); continue; }
        LOG('Nothing left to click on page ' + page + ' — ending loop');
        break;
      }
    }
  }

  // Generate a hash of the current page state to detect page changes
  /* The step fingerprint the multi-page loop compares against. This used to be a
     plain `document.querySelectorAll` — blind to shadow roots — so on every web
     component ATS (SmartRecruiters, Oracle JET, Workday's newer steps) it read
     the SAME hash on every step and the loop believed the page had not advanced.
     stepSignature walks shadow roots and same-origin frames, and excludes our own
     sidebar, so a genuine step change is now visible. */
  function getPageHash() { return stepSignature(); }

  // ===================== DIRECT AUTOFILL FLOW (no sidebar) =====================
  async function directAutofillFlow() {
    await triggerAutofill();
    await sleep(5000);
    await fixPhoneCountryCode();
    await fallbackFill();
    await sleep(1000);
    await fallbackFill();
    await sleep(1000);
    // Conditional sub-questions + declaration boxes + anything still required.
    await guaranteeRequiredFields();
    await handleValidationErrors();
    await autoSubmitOrNext();
    await sleep(2000);
    // Remaining pages are driven by the dispatcher's universal multi-page driver.
  }

  // ===================== ASHBY AUTOMATION (from LazyApply) =====================
  async function ashbyAutomation() {
    LOG('Ashby automation starting...');
    const form = await waitFor('form,.ashby-application-form,[data-testid="application-form"]', 10000);
    if (!form) { LOG('No Ashby form found'); await directAutofillFlow(); return; }
    await sleep(1500);
    await fixPhoneCountryCode();
    await tailorFirstFlow();
  }

  // ===================== BAMBOOHR AUTOMATION =====================
  async function bamboohrAutomation() {
    LOG('BambooHR automation starting...');
    const form = await waitFor('.RenderForm,form#applicationForm,.positionapply', 10000);
    if (!form) { LOG('No BambooHR form found'); await directAutofillFlow(); return; }
    await sleep(1500);
    await fixPhoneCountryCode();
    await tailorFirstFlow();
  }

  // ===================== PHONE COUNTRY CODE FIXER (Ireland +353) =====================
  async function fixPhoneCountryCode() {
    const p = await getProfile();
    const targetCountry = p.country || DEFAULTS.country;
    const targetCode = p.phoneCountryCode || DEFAULTS.phoneCountryCode;
    LOG(`Fixing phone country code to ${targetCountry} (${targetCode})`);

    // Strategy 1: Workday country dropdown (data-automation-id)
    const wdCountryBtn = $('button[data-automation-id="countryDropdown"]:not([disabled]), button[id="country--country"]:not([disabled])');
    if (wdCountryBtn) {
      const txt = (wdCountryBtn.textContent || '').toLowerCase();
      if (!txt.includes(targetCountry.toLowerCase()) && !txt.includes('ireland')) {
        await selectFromWorkdayDropdown(wdCountryBtn, targetCountry);
      }
    }

    // Strategy 2: Phone country code select dropdowns
    const countrySelects = $$('select').filter(el => {
      const lbl = getLabel(el);
      return /country.?code|phone.?code|dial.?code|calling.?code|country.*phone|phone.*country/i.test(lbl || el.name || el.id || el.className);
    });
    for (const sel of countrySelects) {
      const ieOpt = $$('option', sel).find(o =>
        /ireland|\+353|353|IE\b/i.test(o.text) || o.value === 'IE' || o.value === '+353' || o.value === '353'
      );
      if (ieOpt) {
        setSelectValue(sel, ieOpt.value);
        LOG('Phone country code set to Ireland via select');
      }
    }

    // Strategy 3: Country flag/code button dropdowns (common in modern UIs)
    const codeButtons = $$('button,div[role="button"],.country-code-selector,.phone-country,.iti__selected-flag,[class*="country-code"],[class*="countryCode"],[class*="dial-code"],[class*="phone-prefix"]')
      .filter(el => isVisible(el) && /\+1|\+\d{1,3}|🇺🇸|flag/i.test(el.textContent + el.innerHTML));
    for (const btn of codeButtons) {
      if (btn.textContent?.includes('+353') || btn.innerHTML?.includes('🇮🇪')) continue; // Already Ireland
      realClick(btn);
      await sleep(500);
      // Look for Ireland in the opened dropdown
      const items = $$('li,div[role="option"],a,.iti__country,.country-option,[class*="option"],[class*="menu-item"]')
        .filter(el => isVisible(el) && /ireland|\+353|🇮🇪/i.test(el.textContent || ''));
      if (items.length) {
        realClick(items[0]);
        LOG('Phone country code set to Ireland via dropdown click');
        await sleep(300);
      }
    }

    // Strategy 4: intl-tel-input library (very common)
    const itiFlag = $('.iti__selected-flag,.iti__flag-container button');
    if (itiFlag && !itiFlag.querySelector('.iti__flag.iti__ie')) {
      realClick(itiFlag);
      await sleep(500);
      const ieItem = $('[data-country-code="ie"],.iti__country[data-country-code="ie"],li[data-dial-code="353"]');
      if (ieItem) { realClick(ieItem); LOG('Phone country code set to Ireland via intl-tel-input'); await sleep(300); }
    }
  }

  // Helper: select value from Workday popup dropdown
  async function selectFromWorkdayDropdown(btn, value) {
    if (!btn) return false;
    // Handle <select> elements directly
    if (btn.tagName === 'SELECT') {
      const opt = $$('option', btn).find(o => o.text.toLowerCase().includes(value.toLowerCase()));
      if (opt) { setSelectValue(btn, opt.value); return true; }
      return false;
    }
    realClick(btn);
    await sleep(600);
    const popup = $('[data-automation-widget="wd-popup"][data-automation-activepopup="true"]') ||
      $('[role="listbox"]:not([hidden])') || $('ul[role="listbox"]');
    if (!popup) return false;
    const items = $$('[data-automation-id="menuItem"],li[role="option"],li[role="menuitem"],li', popup);
    const match = items.find(i => i.textContent?.toLowerCase().includes(value.toLowerCase()));
    if (match) { realClick(match); await sleep(300); return true; }
    // Try search input within popup
    const searchInput = popup.querySelector('input[type="text"],input[type="search"]') ||
      $('[data-automation-id="searchBox"] input');
    if (searchInput) {
      nativeSet(searchInput, value);
      await sleep(800);
      const filtered = $$('[data-automation-id="menuItem"],li[role="option"],li[role="menuitem"],li', popup).filter(isVisible);
      if (filtered.length) { realClick(filtered[0]); await sleep(300); return true; }
    }
    // Escape to close popup if nothing matched
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    return false;
  }

  // SpeedyApply XPath helper — evaluate XPath and return first matching element
  function xpath(expr, ctx) {
    try { return document.evaluate(expr, ctx || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
    catch (_) { return null; }
  }
  function xpathAll(expr, ctx) {
    try {
      const r = document.evaluate(expr, ctx || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = []; for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i)); return out;
    } catch (_) { return []; }
  }

  // SpeedyApply iCIMS-style dropdown interaction: click input → wait for UL → click matching LI
  async function icimsDropdownSelect(containerXPath, value) {
    if (!value) return false;
    const input = xpath(`${containerXPath}//input`);
    if (!input) return false;
    input.focus({ preventScroll: true }); nativeSet(input, value); await sleep(500);
    const ul = xpath(`${containerXPath}//ul`);
    if (!ul) return false;
    await sleep(300);
    // Try exact title match first, then partial
    const li = xpath(`${containerXPath}//li[contains(@title, '${value.replace(/'/g, "\\'")}')]`) ||
      xpathAll(`${containerXPath}//li`, null).find(l => l.textContent?.toLowerCase().includes(value.toLowerCase()));
    if (li) { realClick(li); await sleep(300); return true; }
    return false;
  }

  // SpeedyApply: Workday degree mapping with fuzzy matching
  function mapDegree(degree) {
    if (!degree) return '';
    const d = degree.toLowerCase();
    const map = [
      [/bachelor|b\.?s\.?|b\.?a\.?|b\.?eng|bsc|undergrad/i, "Bachelor's Degree"],
      [/master|m\.?s\.?|m\.?a\.?|m\.?eng|msc|mba/i, "Master's Degree"],
      [/ph\.?d|doctor|doctoral/i, 'Doctorate'],
      [/associate|a\.?s\.?|a\.?a\./i, "Associate's Degree"],
      [/high.?school|secondary|ged|diploma/i, 'High School Diploma'],
      [/mba/i, 'MBA'],
    ];
    for (const [re, val] of map) if (re.test(d)) return val;
    return degree;
  }

  // ===================== WORKDAY AUTOMATION (SpeedyApply-enhanced) =====================
  async function workdayAutomation() {
    LOG('Workday automation starting (SpeedyApply-enhanced)...');
    const p = await getProfile();

    // Phase 1: Navigate to application form
    let clicked = false;
    // Strategy 1: data-automation-id Apply button
    const applyBtnWd = $('[data-automation-id="applyButton"],[data-automation-id="jobAction-apply"]');
    if (applyBtnWd && isVisible(applyBtnWd)) { clickEl(applyBtnWd); clicked = true; await sleep(2000); }
    // Strategy 2: Text-based Apply button
    if (!clicked) {
      const allBtns = $$('a, button');
      for (const b of allBtns) { if (/^\s*(Apply|Apply Now|Apply for Job)\s*$/i.test(b.textContent) && isVisible(b)) { clickEl(b); clicked = true; await sleep(2000); break; } }
    }
    // Always choose "Apply Manually" on Workday's "Start Your Application" modal —
    // never "Autofill with Resume" or "Use My Last Application" — then fill ourselves.
    await waitForApplyTarget(8000);
    await clickApplyManually();
    await sleep(1500);

    // STEP 1 of 7 — Create Account / Sign In — handled fully by SpeedyApply during
    // the queue (fills email + password + verifyPassword + createAccountCheckbox and
    // submits; signs in instead if this tenant already has an account). Manual use is
    // untouched (this only runs inside the automation flow), so Jobright's own native
    // Sign-up flow still works when you're not running the bulk queue.
    await waitForApplyTarget(6000);
    await fillWorkdayCreateAccount(true);
    await sleep(1500);

    // Wait for form page
    const fp = await waitFor("[data-automation-id='quickApplyPage'],[data-automation-id='applyFlowAutoFillPage'],[data-automation-id='contactInformationPage'],[data-automation-id='applyFlowMyInfoPage'],[data-automation-id='ApplyFlowPage'],[data-automation-id='applyFlowContainer'],[data-automation-id='applyFlowForm']", 10000);
    if (!fp) { LOG('Workday form page not found'); return; }
    await sleep(1000);

    // STEP 2 of 7 — My Information — filled fully by SpeedyApply.
    await workdayFillName(p);
    await workdayFillContact(p);
    await workdayFillAddress(p);
    await workdayFillSource();
    await workdayFillEducation(p);
    await workdayFillExperience(p);
    await workdayFillLanguage(p);
    await workdayResumeUpload();
    await fixPhoneCountryCode();

    // Jobright autofill as a BACKUP — catches any field SpeedyApply missed on this page.
    await triggerAutofill();
    await sleep(2000);
    await fallbackFill();

    // Phase 3: continue (tailor + autofill) into the multi-page flow.
    await tailorFirstFlow();

    // Phase 4: Workday multi-page navigation (handles all Workday page types)
    await workdayMultiPageFlow();
  }

  // SpeedyApply-style Workday name fill
  async function workdayFillName(p) {
    const first = p.first_name || p.firstName || '';
    const last = p.last_name || p.lastName || '';
    if (!first && !last) return;
    // Legal name
    const fnInput = $('input[data-automation-id="legalNameSection_firstName"], #name--legalName--firstName');
    const lnInput = $('input[data-automation-id="legalNameSection_lastName"], #name--legalName--lastName');
    if (fnInput && !fnInput.value) { fnInput.focus({ preventScroll: true }); nativeSet(fnInput, first); await sleep(100); }
    if (lnInput && !lnInput.value) { lnInput.focus({ preventScroll: true }); nativeSet(lnInput, last); await sleep(100); }
    // Preferred name (if checkbox or section exists)
    const prefFn = $('input[data-automation-id="preferredNameSection_firstName"], #name--preferredName--firstName');
    const prefLn = $('input[data-automation-id="preferredNameSection_lastName"], #name--preferredName--lastName');
    if (prefFn && !prefFn.value) nativeSet(prefFn, p.preferred_name || first);
    if (prefLn && !prefLn.value) nativeSet(prefLn, last);
    LOG('Workday: name fields filled');
  }

  // SpeedyApply-style Workday contact fill
  async function workdayFillContact(p) {
    // Email
    const emailInput = $('input[data-automation-id="email"], input[name="emailAddress"]');
    if (emailInput && !emailInput.value) { nativeSet(emailInput, p.email || ''); await sleep(100); }
    // Phone device type → Mobile
    const phoneTypeBtn = $('button[data-automation-id="phone-device-type"]:not([disabled]), button[id="phoneNumber--phoneType"]:not([disabled])');
    if (phoneTypeBtn) {
      const typeTxt = (phoneTypeBtn.textContent || '').toLowerCase();
      if (!typeTxt.includes('mobile') && !typeTxt.includes('cell')) {
        await selectFromWorkdayDropdown(phoneTypeBtn, 'Mobile');
      }
    }
    // Phone number
    const phoneInput = $('input[data-automation-id="phone-number"], #phoneNumber--phoneNumber');
    if (phoneInput && !phoneInput.value) { nativeSet(phoneInput, p.phone || ''); await sleep(100); }
    // Country dropdown (set to Ireland/user country)
    const countryBtn = $('button[data-automation-id="countryDropdown"]:not([disabled]), button[id="country--country"]:not([disabled])');
    if (countryBtn) {
      const country = p.country || DEFAULTS.country;
      const txt = (countryBtn.textContent || '').toLowerCase();
      if (!txt.includes(country.toLowerCase())) {
        await selectFromWorkdayDropdown(countryBtn, country);
      }
    }
    LOG('Workday: contact fields filled');
  }

  // SpeedyApply-style Workday address fill
  async function workdayFillAddress(p) {
    const line1 = $('input[data-automation-id="addressSection_addressLine1"], #address--addressLine1');
    const line2 = $('input[data-automation-id="addressSection_addressLine2"], #address--addressLine2');
    const city = $('input[data-automation-id="addressSection_city"], #address--city');
    const postal = $('input[data-automation-id="addressSection_postalCode"], #address--postalCode');
    if (line1 && !line1.value) nativeSet(line1, p.address || '');
    if (line2 && !line2.value && p.address2) nativeSet(line2, p.address2);
    if (city && !city.value) nativeSet(city, p.city || '');
    if (postal && !postal.value) nativeSet(postal, p.postal_code || p.zip || '');
    // Country/region dropdown
    const regionBtn = $('button[data-automation-id="addressSection_countryRegion"]:not([disabled]), #address--countryRegion');
    if (regionBtn) {
      const state = p.state || p.county || '';
      if (state) await selectFromWorkdayDropdown(regionBtn, state);
    }
    LOG('Workday: address fields filled');
  }

  // Workday "How Did You Hear" source fill
  async function workdayFillSource() {
    const sourceBtn = $('button[data-automation-id="sourceDropdown"]:not([disabled]), button[id="source--source"]:not([disabled])');
    if (!sourceBtn) return;
    const txt = (sourceBtn.textContent || '').toLowerCase();
    if (txt && !txt.includes('select') && !txt.includes('choose')) return; // Already filled
    await selectFromWorkdayDropdown(sourceBtn, DEFAULTS.howHeard);
    // Also check formField-source prompt
    const sourcePrompt = $('[data-automation-id="formField-sourcePrompt"] input,[data-automation-id="formField-source"] input');
    if (sourcePrompt && !sourcePrompt.value) nativeSet(sourcePrompt, DEFAULTS.howHeard);
    LOG('Workday: source filled');
  }

  // SpeedyApply Workday: education section fill (enhanced with iCIMS dropdowns + multi-entry)
  // Workday "School or University" is a SEARCHABLE TYPEAHEAD. Setting .value alone leaves
  // it uncommitted (stays required/red) — you must type, let Workday query, then SELECT an
  // option. When the school isn't in Workday's list (dropdown shows "No Items"), you must
  // pick "Not Listed" exactly as the page instructs. This commits it robustly, and never
  // blurs mid-search (blur closes the suggestion list).
  async function commitWorkdaySchool(input, schoolName) {
    if (!input || !isVisible(input)) return false;
    const name = (schoolName || '').trim();
    const typeNoBlur = (text) => {
      try {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        input.focus({ preventScroll: true });
        if (setter) setter.call(input, text); else input.value = text;
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }));
      } catch (_) {}
    };
    const optionEls = () => $$('[role="option"],[data-automation-id="promptOption"],[data-automation-id="menuItem"],[data-automation-id="promptLeafNode"],ul[role="listbox"] li')
      .filter(el => isVisible(el) && (el.textContent || '').trim() && !/^\s*no items\b/i.test((el.textContent || '').trim()));
    const waitOptions = async (ms) => { const dl = Date.now() + ms; let o = optionEls(); while (!o.length && Date.now() < dl) { await sleep(150); o = optionEls(); } return o; };
    const pick = (opts, matcher) => { const m = opts.find(matcher); if (m) { realClick(m); return true; } return false; };

    // 1) The real school name → select a matching suggestion.
    if (name) {
      typeNoBlur(name);
      const opts = await waitOptions(2500);
      const words = name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (pick(opts, o => { const t = (o.textContent || '').toLowerCase(); return t.includes(name.toLowerCase()) || (words.length && words.every(w => t.includes(w))) || words.some(w => t.includes(w)); })) { await sleep(400); return true; }
    }
    // 2) Not found → "Not Listed" (the page's own instruction).
    typeNoBlur('Not Listed');
    let opts = await waitOptions(2000);
    if (pick(opts, o => /not listed|not on (the )?list|none of|^\s*other\s*$/i.test((o.textContent || '').trim()))) { await sleep(400); return true; }
    // 3) Open the field's picklist (☰) and choose Not Listed there.
    const menuBtn = (input.closest('[data-automation-id="formField-school"],[data-automation-id^="education-"],div') || document)
      .querySelector('button[aria-haspopup="listbox"],button[data-automation-id="promptOption"],button[aria-label*="search" i]');
    if (menuBtn && isVisible(menuBtn)) { realClick(menuBtn); opts = await waitOptions(1500); if (pick(opts, o => /not listed|^\s*other\s*$/i.test((o.textContent || '').trim()))) { await sleep(400); return true; } }
    // 4) Last resort: take the first real suggestion for the name so it's never left blank/invalid.
    if (name) { typeNoBlur(name); opts = await waitOptions(1500); if (opts[0]) { realClick(opts[0]); await sleep(300); return true; } }
    return false;
  }

  // True when a Workday school typeahead already has a committed selection (a pill chip),
  // so we don't re-commit / overwrite it.
  function workdaySchoolCommitted(input) {
    const c = input.closest('[data-automation-id="formField-school"],[data-automation-id^="education-"],div');
    return !!(c && c.querySelector('[data-automation-id="selectedItem"],[data-automation-id="DELETE_charm"],[class*="multiValue"],[data-automation-id="pill"]'));
  }

  async function workdayFillEducation(p) {
    // Click "Add Education" if no education section exists yet
    const addEduBtn = $('button[data-automation-id="btnAddEducationHistory"],button[data-automation-id="add-button"]');
    const eduSection = $('[data-automation-id="educationSection"],[data-automation-id="formField-school"]');
    if (!eduSection && addEduBtn && isVisible(addEduBtn)) {
      realClick(addEduBtn); await sleep(1500);
    }

    const school = p.school || p.university || '';
    const degree = mapDegree(p.degree || "Bachelor's");

    // Strategy 1: Modern Workday data-automation-id inputs
    const schoolInput = $('input[data-automation-id="school"], [data-automation-id="formField-school"] input');
    if (schoolInput && !workdaySchoolCommitted(schoolInput)) {
      await commitWorkdaySchool(schoolInput, school);
    }
    const degreeInput = $('input[data-automation-id="degree"], [data-automation-id="formField-degree"] input');
    if (degreeInput && !degreeInput.value) nativeSet(degreeInput, degree);
    // Degree dropdown button
    const degreeBtn = $('button[data-automation-id="degree"]:not([disabled])');
    if (degreeBtn) await selectFromWorkdayDropdown(degreeBtn, degree);
    // Field of study / Major
    const majorInput = $('input[data-automation-id="fieldOfStudy"], [data-automation-id="formField-fieldOfStudy"] input, input[data-automation-id="major"]');
    if (majorInput && !majorInput.value && p.major) nativeSet(majorInput, p.major);

    // Strategy 2: iCIMS-style CandProfileFields dropdowns (SpeedyApply XPath)
    if (!schoolInput && school) {
      await icimsDropdownSelect("//div[contains(@id,'CandProfileFields.School_icimsDropdown_ctnr')]", school);
    }
    if (!degreeInput && !degreeBtn) {
      await icimsDropdownSelect("//div[contains(@id,'CandProfileFields.Degree_icimsDropdown_ctnr')]", degree);
    }
    if (p.major) {
      await icimsDropdownSelect("//div[contains(@id,'CandProfileFields.Major_icimsDropdown_ctnr')]", p.major);
    }
    // iCIMS GPA
    const icimsGpa = xpath("//div[contains(@id,'CandProfileFields.GPA')]//input");
    if (icimsGpa && !icimsGpa.value && p.gpa) nativeSet(icimsGpa, p.gpa);

    // GPA
    const gpaInput = $('input[data-automation-id="gpa"], [data-automation-id="formField-gradeAverage"] input');
    if (gpaInput && !gpaInput.value && p.gpa) nativeSet(gpaInput, p.gpa);

    // Date fields — Strategy 1: firstYearAttended/lastYearAttended
    const startYear = $('[data-automation-id="formField-firstYearAttended"] input, [data-automation-id="formField-startDate"] input');
    const endYear = $('[data-automation-id="formField-lastYearAttended"] input, [data-automation-id="formField-endDate"] input');
    if (startYear && !startYear.value && p.graduation_year) {
      const start = parseInt(p.graduation_year) - 4;
      nativeSet(startYear, start.toString());
    }
    if (endYear && !endYear.value && p.graduation_year) nativeSet(endYear, p.graduation_year);

    // Date fields — Strategy 2: SpeedyApply dateSectionMonth/Year-input pattern
    const eduDateStartYear = xpath('//div[@data-automation-id="formField-startDate"]//input[@data-automation-id="dateSectionYear-input"]');
    const eduDateStartMonth = xpath('//div[@data-automation-id="formField-startDate"]//input[@data-automation-id="dateSectionMonth-input"]');
    const eduDateEndYear = xpath('//div[@data-automation-id="formField-endDate"]//input[@data-automation-id="dateSectionYear-input"]');
    const eduDateEndMonth = xpath('//div[@data-automation-id="formField-endDate"]//input[@data-automation-id="dateSectionMonth-input"]');
    if (eduDateStartYear && !eduDateStartYear.value && p.graduation_year) nativeSet(eduDateStartYear, (parseInt(p.graduation_year) - 4).toString());
    if (eduDateStartMonth && !eduDateStartMonth.value) nativeSet(eduDateStartMonth, '09');
    if (eduDateEndYear && !eduDateEndYear.value && p.graduation_year) nativeSet(eduDateEndYear, p.graduation_year);
    if (eduDateEndMonth && !eduDateEndMonth.value) nativeSet(eduDateEndMonth, '05');

    // Strategy 3: SpeedyApply indexed education sections (education-1, education-2, etc.)
    // Prefer PER-ENTRY data captured from Jobright's own profile (p.education[i]) so each
    // education row gets its OWN school/field, instead of the same single school repeated.
    const eduEntries = Array.isArray(p.education) ? p.education : [];
    const eduSections = xpathAll('//div[starts-with(@data-automation-id,"education-")]');
    if (eduSections.length) {
      for (let i = 0; i < eduSections.length; i++) {
        const sec = eduSections[i];
        const entry = eduEntries[i] || {};
        const secSchool = sec.querySelector('input[data-automation-id="school"]');
        if (secSchool && !workdaySchoolCommitted(secSchool)) { await commitWorkdaySchool(secSchool, entry.school || school); }
        const secDegree = sec.querySelector('button[data-automation-id="degree"]:not([disabled])');
        if (secDegree) await selectFromWorkdayDropdown(secDegree, mapDegree(entry.degree || degree));
        const secMajor = sec.querySelector('input[data-automation-id="fieldOfStudy"], input[data-automation-id="major"]');
        if (secMajor && !secMajor.value && (entry.field || p.major)) nativeSet(secMajor, entry.field || p.major);
      }
    }

    // iCIMS date fields (Month/Day/Year selects)
    const icimsStartMonth = xpath("//select[contains(@id,'CandProfileFields.EducationStartDate_Month')]");
    const icimsStartYear = xpath("//input[contains(@id,'CandProfileFields.EducationStartDate_Year')]");
    const icimsEndMonth = xpath("//select[contains(@id,'CandProfileFields.EducationEndDate_Month')]");
    const icimsEndYear = xpath("//input[contains(@id,'CandProfileFields.EducationEndDate_Year')]");
    if (icimsStartMonth && p.graduation_year) { icimsStartMonth.value = '09'; icimsStartMonth.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }
    if (icimsStartYear && !icimsStartYear.value && p.graduation_year) nativeSet(icimsStartYear, (parseInt(p.graduation_year) - 4).toString());
    if (icimsEndMonth && p.graduation_year) { icimsEndMonth.value = '05'; icimsEndMonth.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }
    if (icimsEndYear && !icimsEndYear.value && p.graduation_year) nativeSet(icimsEndYear, p.graduation_year);

    // Graduated status
    const gradSelect = xpath("//select[contains(@id,'CandProfileFields.IsGraduated')]") || $('select[data-automation-id="isGraduated"]');
    if (gradSelect) { const opt = $$('option', gradSelect).find(o => /yes|complete|graduated/i.test(o.text)); if (opt) { setSelectValue(gradSelect, opt.value); } }

    // CATCH-ALL: commit EVERY school typeahead on the page that isn't already committed —
    // covers second/third education entries Workday renders outside the education-* wrapper
    // (the "required, no value" rows). Each gets the matching entry's school, else the
    // primary school, else "Not Listed".
    const schoolInputs = $$('input[data-automation-id="school"]').filter(isVisible);
    for (let i = 0; i < schoolInputs.length; i++) {
      const si = schoolInputs[i];
      if (workdaySchoolCommitted(si)) continue;
      await commitWorkdaySchool(si, (eduEntries[i] && eduEntries[i].school) || school);
      await sleep(200);
    }

    LOG('Workday: education fields filled (enhanced)');
  }

  // SpeedyApply Workday: experience section fill (enhanced with iCIMS + multi-entry + description)
  async function workdayFillExperience(p) {
    // Click "Add Work Experience" if no experience section exists
    const addExpBtn = $('button[data-automation-id="btnAddWorkHistory"],button[data-automation-id="add-button"]');
    const expSection = $('[data-automation-id="workSection"],[data-automation-id="formField-jobTitle"]');
    if (!expSection && addExpBtn && isVisible(addExpBtn)) {
      realClick(addExpBtn); await sleep(1500);
    }

    const title = p.current_title || p.title || '';
    const company = p.current_company || p.company || '';
    const loc = p.city ? `${p.city}, ${p.country || DEFAULTS.country}` : '';
    const startYear = p.work_start_year || (new Date().getFullYear() - 2).toString();
    const endYear = p.work_end_year || new Date().getFullYear().toString();

    // Strategy 1: Modern Workday data-automation-id
    const titleInput = $('[data-automation-id="jobTitle"] input, [data-automation-id="formField-jobTitle"] input');
    const companyInput = $('[data-automation-id="company"] input, [data-automation-id="formField-company"] input');
    const locInput = $('[data-automation-id="location"] input, [data-automation-id="formField-location"] input');
    if (titleInput && !titleInput.value && title) nativeSet(titleInput, title);
    if (companyInput && !companyInput.value && company) nativeSet(companyInput, company);
    if (locInput && !locInput.value && loc) nativeSet(locInput, loc);

    // Strategy 1b: Label-text based fallback for Job Title & Company (catches Workday variants)
    if ((!titleInput || !titleInput.value) && title) {
      const titleByLabel = xpath("//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'job title')]/ancestor::div[contains(@class,'formField') or @data-automation-id]//input") ||
        xpath("//label[contains(text(),'Job Title')]/following::input[1]");
      if (titleByLabel && !titleByLabel.value) nativeSet(titleByLabel, title);
    }
    if ((!companyInput || !companyInput.value) && company) {
      const companyByLabel = xpath("//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'company')]/ancestor::div[contains(@class,'formField') or @data-automation-id]//input") ||
        xpath("//label[contains(text(),'Company')]/following::input[1]");
      if (companyByLabel && !companyByLabel.value) nativeSet(companyByLabel, company);
    }

    // Description / responsibilities (textarea)
    const descInput = $('[data-automation-id="description"] textarea, textarea[data-automation-id="workDescription"], [data-automation-id="formField-description"] textarea');
    if (descInput && !descInput.value?.trim() && p.work_description) nativeSet(descInput, p.work_description);

    // Currently work here checkbox
    const currentCheckbox = $('input[data-automation-id="currentlyWorkHere"], input[data-automation-id="currentJob"]');
    if (currentCheckbox && !currentCheckbox.checked && p.currently_employed !== false) {
      realClick(currentCheckbox); await sleep(200);
    }

    // Strategy 2: iCIMS-style XPath fields (SpeedyApply pattern)
    if (!companyInput && company) {
      const icimsEmployer = xpath("//label[span[text() = 'Employer']]/../following-sibling::div/input");
      if (icimsEmployer && !icimsEmployer.value) nativeSet(icimsEmployer, company);
    }
    if (!titleInput && title) {
      const icimsTitle = xpath("//label[span[text() = 'Title']]/../following-sibling::div/input");
      if (icimsTitle && !icimsTitle.value) nativeSet(icimsTitle, title);
    }
    if (!locInput && loc) {
      const icimsLoc = xpath("//label[span[text() = 'Location' or text() = 'City']]/../following-sibling::div/input");
      if (icimsLoc && !icimsLoc.value) nativeSet(icimsLoc, loc);
    }

    // iCIMS date fields for experience
    const expStartMonth = xpath("//select[contains(@id,'CandProfileFields.WorkStartDate_Month')]") ||
      xpath("//label[span[text() = 'Start Date']]/../following-sibling::div//label[text()='Month']/following-sibling::select");
    const expStartYear = xpath("//input[contains(@id,'CandProfileFields.WorkStartDate_Year')]");
    const expEndMonth = xpath("//select[contains(@id,'CandProfileFields.WorkEndDate_Month')]");
    const expEndYear = xpath("//input[contains(@id,'CandProfileFields.WorkEndDate_Year')]");
    if (expStartMonth && startYear) { expStartMonth.value = '01'; expStartMonth.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }
    if (expStartYear && !expStartYear.value && startYear) nativeSet(expStartYear, startYear);
    if (expEndMonth) { expEndMonth.value = '12'; expEndMonth.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }
    if (expEndYear && !expEndYear.value) nativeSet(expEndYear, endYear);

    // Workday dateSectionMonth/Year-input for experience From/To dates
    // Scope to work experience section to avoid conflicting with education dates
    const workSection = $('[data-automation-id="workSection"],[data-automation-id="workExperience-1"],[data-automation-id="workExperience"]') || document;

    // From date (startDate within work experience context)
    const expDateStartYear = workSection.querySelector('[data-automation-id="formField-startDate"] [data-automation-id="dateSectionYear-input"]') ||
      xpath('//div[@data-automation-id="workSection"]//div[@data-automation-id="formField-startDate"]//input[@data-automation-id="dateSectionYear-input"]') ||
      xpath('//div[@data-automation-id="formField-startDate"]//input[@data-automation-id="dateSectionYear-input"]');
    const expDateStartMonth = workSection.querySelector('[data-automation-id="formField-startDate"] [data-automation-id="dateSectionMonth-input"]') ||
      xpath('//div[@data-automation-id="workSection"]//div[@data-automation-id="formField-startDate"]//input[@data-automation-id="dateSectionMonth-input"]') ||
      xpath('//div[@data-automation-id="formField-startDate"]//input[@data-automation-id="dateSectionMonth-input"]');
    if (expDateStartYear && !expDateStartYear.value) nativeSet(expDateStartYear, startYear);
    if (expDateStartMonth && !expDateStartMonth.value) nativeSet(expDateStartMonth, '01');

    // To date (endDate within work experience context)
    const expDateEndYear = workSection.querySelector('[data-automation-id="formField-endDate"] [data-automation-id="dateSectionYear-input"]') ||
      xpath('//div[@data-automation-id="workSection"]//div[@data-automation-id="formField-endDate"]//input[@data-automation-id="dateSectionYear-input"]') ||
      xpath('//div[@data-automation-id="formField-endDate"]//input[@data-automation-id="dateSectionYear-input"]');
    const expDateEndMonth = workSection.querySelector('[data-automation-id="formField-endDate"] [data-automation-id="dateSectionMonth-input"]') ||
      xpath('//div[@data-automation-id="workSection"]//div[@data-automation-id="formField-endDate"]//input[@data-automation-id="dateSectionMonth-input"]') ||
      xpath('//div[@data-automation-id="formField-endDate"]//input[@data-automation-id="dateSectionMonth-input"]');
    if (expDateEndYear && !expDateEndYear.value) nativeSet(expDateEndYear, endYear);
    if (expDateEndMonth && !expDateEndMonth.value) nativeSet(expDateEndMonth, '12');

    // Fallback: label-text based From/To date fields
    const fromLabel = xpath("//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'from')]/ancestor::div[1]//input");
    const toLabel = xpath("//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'to')]/ancestor::div[1]//input");
    if (fromLabel && !fromLabel.value) nativeSet(fromLabel, `01/${startYear}`);
    if (toLabel && !toLabel.value) nativeSet(toLabel, `12/${endYear}`);

    // SpeedyApply indexed workExperience sections. Prefer the PER-ENTRY data captured
    // from Jobright's own profile (p.work_experiences[i]) when available, so each of
    // Workday's "Work Experience 1/2/3/4" rows gets its OWN correct title/company —
    // instead of the same flat title/company being stamped into every row (or every
    // row staying blank when the flat fields were empty).
    const workEntries = Array.isArray(p.work_experiences) ? p.work_experiences : [];
    const expSections = xpathAll('//div[starts-with(@data-automation-id,"workExperience-")]');
    expSections.forEach((sec, i) => {
      const entry = workEntries[i] || {};
      const secTitle = sec.querySelector('input[data-automation-id="jobTitle"]');
      const secCompany = sec.querySelector('input[data-automation-id="company"]');
      const secLoc = sec.querySelector('input[data-automation-id="location"]');
      const secDesc = sec.querySelector('textarea[data-automation-id="description"], [data-automation-id="formField-description"] textarea');
      if (secTitle && !secTitle.value && (entry.title || title)) nativeSet(secTitle, entry.title || title);
      if (secCompany && !secCompany.value && (entry.company || company)) nativeSet(secCompany, entry.company || company);
      if (secLoc && !secLoc.value && (entry.location || loc)) nativeSet(secLoc, entry.location || loc);
      if (secDesc && !secDesc.value?.trim() && entry.description) nativeSet(secDesc, entry.description);
      // Fill From/To dates within each indexed experience section
      const secStartYear = sec.querySelector('[data-automation-id="formField-startDate"] [data-automation-id="dateSectionYear-input"]');
      const secStartMonth = sec.querySelector('[data-automation-id="formField-startDate"] [data-automation-id="dateSectionMonth-input"]');
      const secEndYear = sec.querySelector('[data-automation-id="formField-endDate"] [data-automation-id="dateSectionYear-input"]');
      const secEndMonth = sec.querySelector('[data-automation-id="formField-endDate"] [data-automation-id="dateSectionMonth-input"]');
      if (secStartYear && !secStartYear.value) nativeSet(secStartYear, startYear);
      if (secStartMonth && !secStartMonth.value) nativeSet(secStartMonth, '01');
      if (secEndYear && !secEndYear.value) nativeSet(secEndYear, endYear);
      if (secEndMonth && !secEndMonth.value) nativeSet(secEndMonth, '12');
    });

    LOG('Workday: experience fields filled (enhanced)');
  }

  // Workday: language section fill (Language name + Speaking/Writing/Reading proficiency)
  async function workdayFillLanguage(p) {
    const language = p.languages || p.language || 'English';
    const proficiency = p.language_proficiency || 'Advanced';

    // Click "Add Language" button if no language section exists
    const addLangBtn = $('button[data-automation-id="btnAddLanguage"],button[data-automation-id="add-section$languageSection"]') ||
      xpath("//button[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'add') and contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'language')]");
    const langSection = $('[data-automation-id="languageSection"],[data-automation-id="formField-language"]');
    if (!langSection && addLangBtn && isVisible(addLangBtn)) {
      realClick(addLangBtn); await sleep(1500);
    }

    // Strategy 1: data-automation-id based language dropdown
    const langDropdown = $('button[data-automation-id="language"],button[data-automation-id="formField-language"]') ||
      $('[data-automation-id="formField-language"] button,[data-automation-id="languageSection"] button[aria-haspopup]');
    if (langDropdown) {
      const currentText = (langDropdown.textContent || '').trim().toLowerCase();
      if (!currentText || currentText === 'select' || currentText === 'choose' || currentText === '') {
        await selectFromWorkdayDropdown(langDropdown, language);
        await sleep(300);
      }
    }

    // Strategy 1b: language as input field
    const langInput = $('[data-automation-id="language"] input,[data-automation-id="formField-language"] input');
    if (langInput && !langInput.value) nativeSet(langInput, language);

    // Strategy 2: Label-based language field
    if (!langDropdown && !langInput) {
      const langByLabel = xpath("//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'language')]/ancestor::div[1]//button[not(@disabled)]") ||
        xpath("//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'language')]/ancestor::div[1]//input");
      if (langByLabel) {
        if (langByLabel.tagName === 'BUTTON') await selectFromWorkdayDropdown(langByLabel, language);
        else if (!langByLabel.value) nativeSet(langByLabel, language);
      }
    }

    // Proficiency dropdowns: Speaking, Writing, Reading
    const proficiencyFields = [
      { ids: ['speaking', 'formField-speaking', 'speakingProficiency', 'formField-speakingProficiency', 'languageProficiency-0'], label: 'speaking' },
      { ids: ['writing', 'formField-writing', 'writingProficiency', 'formField-writingProficiency', 'languageProficiency-1'], label: 'writing' },
      { ids: ['reading', 'formField-reading', 'readingProficiency', 'formField-readingProficiency', 'languageProficiency-2'], label: 'reading' },
    ];

    for (const pf of proficiencyFields) {
      let filled = false;
      // Try data-automation-id selectors
      for (const aid of pf.ids) {
        const btn = $(`button[data-automation-id="${aid}"],[data-automation-id="${aid}"] button`) ||
          $(`[data-automation-id="${aid}"] select`);
        if (btn && isVisible(btn)) {
          const currentText = (btn.textContent || btn.value || '').trim().toLowerCase();
          if (!currentText || currentText === 'select' || currentText === 'choose' || currentText === '' || currentText === '---') {
            await selectFromWorkdayDropdown(btn, proficiency);
            filled = true;
            await sleep(300);
            break;
          }
        }
        const inp = $(`[data-automation-id="${aid}"] input,input[data-automation-id="${aid}"]`);
        if (inp && !inp.value) { nativeSet(inp, proficiency); filled = true; break; }
      }
      // Fallback: label-text based proficiency dropdown
      if (!filled) {
        const labelBtn = xpath(`//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${pf.label}')]/ancestor::div[1]//button[not(@disabled)]`) ||
          xpath(`//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${pf.label}')]/ancestor::div[1]//select`);
        if (labelBtn && isVisible(labelBtn)) {
          const currentText = (labelBtn.textContent || labelBtn.value || '').trim().toLowerCase();
          if (!currentText || currentText === 'select' || currentText === 'choose' || currentText === '' || currentText === '---') {
            await selectFromWorkdayDropdown(labelBtn, proficiency);
            await sleep(300);
          }
        }
      }
    }

    // Handle indexed language sections (languageSection-1, languageSection-2, etc.)
    const langSections = xpathAll('//div[starts-with(@data-automation-id,"languageSection-") or starts-with(@data-automation-id,"language-")]');
    for (const sec of langSections) {
      const secLangBtn = sec.querySelector('button[data-automation-id="language"]') || sec.querySelector('button[aria-haspopup]');
      if (secLangBtn) {
        const t = (secLangBtn.textContent || '').trim().toLowerCase();
        if (!t || t === 'select' || t === 'choose') await selectFromWorkdayDropdown(secLangBtn, language);
      }
      const secLangInput = sec.querySelector('input[data-automation-id="language"]');
      if (secLangInput && !secLangInput.value) nativeSet(secLangInput, language);
      // Proficiency within section
      for (const key of ['speaking', 'writing', 'reading']) {
        const secProfBtn = sec.querySelector(`button[data-automation-id="${key}"]`) ||
          sec.querySelector(`[data-automation-id="${key}"] button`) ||
          sec.querySelector(`[data-automation-id="formField-${key}"] button`);
        if (secProfBtn && isVisible(secProfBtn)) {
          const t = (secProfBtn.textContent || '').trim().toLowerCase();
          if (!t || t === 'select' || t === 'choose' || t === '---') {
            await selectFromWorkdayDropdown(secProfBtn, proficiency);
            await sleep(300);
          }
        }
      }
    }

    LOG('Workday: language section filled');
  }

  // SpeedyApply Workday: self-identify / EEO section
  async function workdayFillEEO() {
    // Gender
    const genderBtn = $('button[data-automation-id="gender"]:not([disabled]), select[data-automation-id="gender"]');
    const eeoP = await getProfile();
    if (genderBtn) await selectFromWorkdayDropdown(genderBtn, eeoP.gender || DEFAULTS.gender);
    // Ethnicity/Race
    const raceBtn = $('button[data-automation-id="ethnicity"]:not([disabled]), button[data-automation-id="race"]:not([disabled])');
    if (raceBtn) await selectFromWorkdayDropdown(raceBtn, eeoP.ethnicity || eeoP.race || DEFAULTS.ethnicity);
    // Veteran
    const vetBtn = $('button[data-automation-id="veteranStatus"]:not([disabled])');
    if (vetBtn) await selectFromWorkdayDropdown(vetBtn, eeoP.veteran || DEFAULTS.veteran);
    // Disability
    const disBtn = $('button[data-automation-id="disabilityStatus"]:not([disabled])');
    if (disBtn) await selectFromWorkdayDropdown(disBtn, eeoP.disability || DEFAULTS.disability);
    // Hispanic/Latino dropdown (SpeedyApply pattern)
    const hispBtn = $('button[data-automation-id="hispanicOrLatino"]:not([disabled]), [name="hispanicOrLatino"]');
    if (hispBtn) await selectFromWorkdayDropdown(hispBtn, 'I choose not to disclose');

    // SpeedyApply: ethnicity multi-checkbox groups
    const ethCheckboxes = $$('[data-automation-id="ethnicityPrompt"] [role="cell"],[data-automation-id="ethnicityMulti-CheckboxGroup"] [role="cell"]');
    if (ethCheckboxes.length) {
      for (const cell of ethCheckboxes) {
        const lbl = cell.querySelector('label');
        const cb = cell.querySelector('input[type="checkbox"]');
        if (lbl && cb && /choose not|decline|prefer not/i.test(lbl.textContent || '')) {
          if (!cb.checked) { lbl.click(); await sleep(100); }
          break;
        }
      }
    }

    // Radio-based EEO (some Workday sites use radios)
    const eeoRadios = $$('input[type="radio"]').filter(r => {
      const lbl = ($(`label[for="${CSS.escape(r.id)}"]`)?.textContent || r.value || '').toLowerCase();
      return /prefer not|decline|choose not|do not wish/i.test(lbl);
    });
    for (const r of eeoRadios) { if (!r.checked) { realClick(r); await sleep(100); } }

    // SpeedyApply: agreement checkboxes on self-identify pages
    const agreeCheckbox = $('input[data-automation-id="agreementCheckbox"], input[name="acceptTermsAndAgreements"]');
    if (agreeCheckbox && !agreeCheckbox.checked) { realClick(agreeCheckbox); await sleep(100); }

    LOG('Workday: EEO section filled (enhanced)');
  }

  // SpeedyApply Workday: resume upload via DataTransfer file injection
  async function workdayResumeUpload() {
    // SpeedyApply containers for resume section
    const containers = [
      'div[aria-labelledby="Resume/CV-section"]',
      'div[data-automation-id="resumeUpload"]',
      '[data-automation-id="quickApplyPage"]',
      '[data-fkit-id="resumeAttachments--attachments"]'
    ];
    const container = $(containers.join(','));

    // Find file input within container or globally
    const fileInput = container?.querySelector('input[data-automation-id="file-upload-input-ref"],input[type="file"]') ||
      $('input[data-automation-id="file-upload-input-ref"], input[data-automation-id="select-files"], input[type="file"][accept*="pdf"]');
    if (!fileInput) { LOG('Workday: no resume file input found'); return false; }

    // Check if resume already uploaded (file name visible)
    const existingFile = container?.querySelector('[data-automation-id="file-name"],.file-name,.upload-filename');
    if (existingFile?.textContent?.trim()) { LOG('Workday: resume already uploaded'); return true; }

    // Try to get resume from storage (base64 encoded)
    const resumeData = await st.get('ua_resume_data');
    if (resumeData?.base64 && resumeData?.fileName) {
      try {
        // SpeedyApply pattern: Convert base64 to File, inject via DataTransfer
        const byteString = atob(resumeData.base64.split(',').pop() || resumeData.base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const mime = resumeData.mimeType || 'application/pdf';
        const file = new File([ab], resumeData.fileName, { type: mime });

        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        LOG(`Workday: resume injected via DataTransfer — ${resumeData.fileName}`);
        await sleep(1500);
        return true;
      } catch (err) { LOG('Workday: resume injection failed — ' + err.message); }
    }

    // If no stored resume, let Jobright sidebar handle it
    LOG('Workday: resume file input found — waiting for sidebar upload');
    return !!fileInput;
  }

  // SpeedyApply Workday: fill question pages (Primary, Secondary, Supplementary questions)
  async function workdayFillQuestions(p) {
    await loadAnswerBank();
    // Workday question inputs (text, textarea, select, radio)
    const qInputs = $$('[data-automation-id^="formField-"] input:not([type=hidden]):not([type=file]),[data-automation-id^="formField-"] textarea,[data-automation-id^="formField-"] select')
      .filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of qInputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      if (inp.tagName === 'SELECT') {
        // Decision-aware pick (reads reworded options like "Does not require sponsorship")
        // then value/keyword fallback — applied uniformly across every ATS handler.
        const gv = guessFieldValue(lbl, p, inp);
        const opt = selectOptionForQuestion(inp, lbl, p)
          || (gv ? $$('option', inp).find(o => o.text.toLowerCase().includes(gv.toLowerCase())) : null);
        if (opt) { setSelectValue(inp, opt.value); }
        await sleep(80);
        continue;
      }
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val);
      await sleep(80);
    }
    // Workday radio/checkbox groups — Master Knockout Question System
    const radioGroups = {};
    $$('[data-automation-id^="formField-"] input[type=radio]').filter(isVisible).forEach(r => { (radioGroups[r.name || r.id] ||= []).push(r); });
    for (const [, radios] of Object.entries(radioGroups)) {
      if (radios.some(r => r.checked)) continue;
      const parent = radios[0].closest('[data-automation-id^="formField-"], fieldset, .question, [class*="question"], .form-group');
      answerKnockoutRadioGroup(radios, parent, p);
      await sleep(80);
    }
    // Button-style knockout questions in Workday
    answerButtonStyleQuestions(p);
    // Workday dropdowns (button-based) in question areas
    const qDropdowns = $$('[data-automation-id^="formField-"] button:not([disabled])').filter(btn => {
      const txt = (btn.textContent || '').toLowerCase();
      return isVisible(btn) && (txt.includes('select') || txt.includes('choose') || txt === '');
    });
    for (const btn of qDropdowns) {
      const lbl = getLabel(btn);
      const val = guessFieldValue(lbl, p, btn);
      if (val) await selectFromWorkdayDropdown(btn, val);
    }
    // Rich text areas (Workday uses contenteditable divs for some responses)
    const richTexts = $$('[data-automation-id="richText"] [contenteditable="true"]').filter(el => isVisible(el) && !el.textContent?.trim());
    for (const rt of richTexts) {
      const lbl = getLabel(rt);
      const val = guessFieldValue(lbl, p, rt);
      if (val) { rt.textContent = val; rt.dispatchEvent(new Event('input', { bubbles: true, composed: true })); }
    }
    learnFromFilledFields();
    LOG('Workday: question page filled');
  }

  // SpeedyApply Workday: fill website/link fields (GitHub, LinkedIn, etc.)
  async function workdayFillLinks(p) {
    const linkMap = {
      'githubQuestion': p.github_url || p.github || '',
      'linkedinQuestion': p.linkedin_profile_url || p.linkedin || '',
      'twitterQuestion': p.twitter_url || p.twitter || '',
      'personalWebsiteQuestion': p.website_url || p.website || '',
    };
    for (const [aid, val] of Object.entries(linkMap)) {
      if (!val) continue;
      const inp = $(`[data-automation-id="${aid}"] input, input[data-automation-id="${aid}"]`);
      if (inp && !inp.value) nativeSet(inp, val);
    }
    // formField-skills
    const skillsInput = $('[data-automation-id="formField-skills"] input, [data-automation-id="formField-skillsPrompt"] input');
    if (skillsInput && !skillsInput.value && p.skills) nativeSet(skillsInput, Array.isArray(p.skills) ? p.skills.join(', ') : p.skills);
    LOG('Workday: links/skills filled');
  }

  // SpeedyApply Workday: multi-page navigation with page type detection (enhanced)
  async function workdayMultiPageFlow() {
    const MAX_PAGES = 12;
    // SpeedyApply: both old and new Workday page naming variants
    const pageTypes = [
      'applyFlowAutoFillPage', 'applyFlowMyInfoPage', 'contactInformationPage',
      'applyFlowMyExpPage', 'myExperiencePage',
      'applyFlowPrimaryQuestionsPage', 'primaryQuestionnairePage',
      'applyFlowSecondaryQuestionsPage', 'secondaryQuestionnairePage',
      'applyFlowSelfIdentifyPage', 'selfIdentificationPage',
      'applyFlowVoluntaryDisclosuresPage', 'voluntaryDisclosuresPage',
      'applyFlowSupplementaryQuestionsPage',
      'applyFlowReviewPage', 'reviewJobApplicationPage'
    ];
    const p = await getProfile();
    let lastPageType = '';

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (autoStopped()) { LOG('Fully Automated turned off — stopping Workday flow'); break; }
      if (checkSuccess()) { LOG('Workday: success detected'); break; }
      await sleep(1500);

      // Detect current page type
      let currentPageType = 'unknown';
      for (const pt of pageTypes) {
        if ($(`[data-automation-id="${pt}"]`)) { currentPageType = pt; break; }
      }
      LOG(`Workday multi-page: page ${page} — ${currentPageType}`);

      // Detect stuck on same page (validation error likely)
      if (page > 1 && currentPageType === lastPageType) {
        LOG('Workday: stuck on same page — running validation fix');
        await handleValidationErrors();
        await fallbackFill();
        await sleep(1000);
      }
      lastPageType = currentPageType;

      // Fill based on page type
      if (/MyInfo|contactInformation|AutoFill/.test(currentPageType)) {
        await workdayFillName(p);
        await workdayFillContact(p);
        await workdayFillAddress(p);
        await workdayFillSource();
        await workdayFillLinks(p);
        await fixPhoneCountryCode();
      } else if (/MyExp/.test(currentPageType)) {
        await workdayFillEducation(p);
        await workdayFillExperience(p);
        await workdayFillLanguage(p);
      } else if (/Questions|Supplementary/.test(currentPageType)) {
        await workdayFillQuestions(p);
        await workdayFillLinks(p);
      } else if (/SelfIdentify|VoluntaryDisclosure/.test(currentPageType)) {
        await workdayFillEEO();
      } else if (/Review/.test(currentPageType)) {
        const submitBtn = $('button[data-automation-id="btnSubmit"]');
        if (submitBtn && isVisible(submitBtn)) {
          LOG('Workday: clicking Submit on review page');
          await sleep(500);
          realClick(submitBtn);
          await sleep(3000);
          break;
        }
      }

      // Also run generic fallback on every page
      await fallbackFill();
      await sleep(500);
      await handleValidationErrors();

      // Advance via the robust shared handler (skips disabled buttons, scrolls into
      // view, re-fills + fixes validation if "Continue to the next page" is disabled,
      // and submits on the final review page).
      const action = await autoSubmitOrNext();
      if (action === 'submitted') { await sleep(2500); if (confirmSubmitted()) break; }
      else if (action === 'next_page') { await sleep(2500); }
      else { LOG('Workday: no next/submit button found'); break; }
    }
  }

  // ===================== GREENHOUSE AUTOMATION (SpeedyApply-enhanced) =====================
  async function greenhouseAutomation() {
    LOG('Greenhouse automation starting...');
    const p = await getProfile();
    const form = await waitFor('#application_form,#application,.application-form,.main-content form', 10000);
    if (!form) { LOG('No Greenhouse form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // Greenhouse-specific field selectors (from SpeedyApply)
    const ghFields = {
      '#first_name': p.first_name || p.firstName || '',
      '#last_name': p.last_name || p.lastName || '',
      '#email': p.email || '',
      '#phone': p.phone || '',
      '#auto_complete_input': p.city ? `${p.city}, ${p.state || p.county || ''}, ${p.country || DEFAULTS.country}`.replace(/,\s*,/g, ',').replace(/,\s*$/, '') : '',
    };
    for (const [sel, val] of Object.entries(ghFields)) {
      const el = $(sel);
      if (el && !el.value && val) { el.focus({ preventScroll: true }); nativeSet(el, val); await sleep(80); }
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
  }

  // ===================== LEVER AUTOMATION =====================
  async function leverAutomation() {
    LOG('Lever automation starting...');
    // Lever uses a simple form at /apply
    const applyLink = $('a.posting-btn-submit,a[data-qa="show-page-apply"],.apply-button a,.postings-btn-submit');
    if (applyLink && isVisible(applyLink) && !location.href.includes('/apply')) {
      LOG('Clicking Lever Apply button');
      realClick(applyLink);
      await sleep(3000);
    }
    // Wait for form — Lever uses many different form selectors
    const form = await waitFor('.application-form,#application-form,.postings-form,form[action*="apply"],.application-page,.content form,.main-content form,form', 8000);
    if (!form) { LOG('No Lever form found'); await directAutofillFlow(); return; }
    await sleep(1000);

    const p = await getProfile();
    await loadAnswerBank();

    // Phase 1: Lever-specific named fields (Lever uses name= attributes)
    const leverFields = {
      'name': `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim(),
      'email': p.email || '',
      'phone': p.phone || '',
      'org': p.current_company || p.company || '',
      'urls[LinkedIn]': p.linkedin_profile_url || p.linkedin || '',
      'urls[GitHub]': p.github_url || p.github || '',
      'urls[Portfolio]': p.website_url || p.website || '',
      'urls[Twitter]': p.twitter_url || p.twitter || '',
      'urls[Other]': p.website_url || '',
    };
    for (const [name, val] of Object.entries(leverFields)) {
      if (!val) continue;
      const inp = $(`input[name="${name}"],textarea[name="${name}"]`);
      if (inp && !inp.value?.trim()) { inp.focus({ preventScroll: true }); nativeSet(inp, val); await sleep(50); }
    }

    // Phase 2: Fill by label matching for custom Lever fields
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
      .filter(el => isVisible(el) && !el.value?.trim());
    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      if (inp.tagName === 'SELECT') {
        const opt = $$('option', inp).find(o => o.text.toLowerCase().includes(val.toLowerCase()));
        if (opt) { setSelectValue(inp, opt.value); }
      } else {
        inp.focus({ preventScroll: true }); nativeSet(inp, val);
      }
      await sleep(50);
    }

    // Phase 3: Location field (Lever has "Where in the US are you located?" etc.)
    const locInputs = $$('input,textarea').filter(el => {
      const l = (getLabel(el) || '').toLowerCase();
      return isVisible(el) && !el.value?.trim() && /where.*(located|live|based)|current.?location|location/i.test(l);
    });
    for (const loc of locInputs) {
      const locVal = p.city ? `${p.city}, ${p.state || p.country || ''}`.trim().replace(/,$/, '') : '';
      if (locVal) { loc.focus({ preventScroll: true }); nativeSet(loc, locVal); }
    }

    // Phase 4: Sponsorship / authorization questions (common on Lever)
    const sponsorInputs = $$('input,textarea,select').filter(el => {
      const l = (getLabel(el) || '').toLowerCase();
      return isVisible(el) && !hasFieldValue(el) && /sponsor|visa|immigration|employment.?benefit|h-1b/i.test(l);
    });
    for (const sp of sponsorInputs) {
      if (sp.tagName === 'SELECT') {
        const opt = $$('option', sp).find(o => /no/i.test(o.text));
        if (opt) { setSelectValue(sp, opt.value); }
      } else {
        sp.focus({ preventScroll: true }); nativeSet(sp, DEFAULTS.sponsorship);
      }
    }

    // Phase 5: Radio buttons and checkboxes — Master Knockout System
    const groups = {};
    $$('input[type=radio]').filter(isVisible).forEach(r => { (groups[r.name || r.id] ||= []).push(r); });
    for (const [, radios] of Object.entries(groups)) {
      if (radios.some(r => r.checked)) continue;
      const parent = radios[0].closest('fieldset, .question, [class*="question"], .form-group, [class*="field"]');
      answerKnockoutRadioGroup(radios, parent, p);
      await sleep(50);
    }
    // Button-style questions (Ashby, Kraken, etc.)
    answerButtonStyleQuestions(p);

    // Phase 6: Required checkboxes (acknowledgments, consents)
    $$('input[type=checkbox][required],input[type=checkbox][aria-required="true"]')
      .filter(el => isVisible(el) && !el.checked)
      .forEach(cb => realClick(cb));

    await fixPhoneCountryCode();

    // Phase 7: Trigger Jobright sidebar autofill (non-blocking with timeout)
    await triggerAutofillQuick();

    // Phase 8: Final fallback pass
    await sleep(2000);
    await fallbackFill();
    await sleep(500);
    await handleValidationErrors();

    // Phase 9: Submit
    const submitBtn = $('button[type="submit"],.postings-btn,.application-submit,button.template-btn-submit,[data-qa="btn-submit"],input[type="submit"]');
    if (submitBtn && isVisible(submitBtn)) {
      LOG('Lever: submit button found');
      // Don't auto-submit — let user review
    }

    learnFromFilledFields();
    LOG('Lever automation complete');
  }

  /* The SmartRecruiters driver lives further down, with the other
     shadow-DOM-aware ones. A second, older copy used to sit here: JavaScript
     lets a later function declaration in the same scope silently replace an
     earlier one, so this one never ran and an edit made to it would have done
     nothing at all. tests/references.test.js now fails on any such pair. */

  // ===================== TALEO / ORACLE AUTOMATION =====================
  async function taleoAutomation() {
    LOG('Taleo/Oracle automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    // Wait for Taleo form (various selectors)
    const form = await waitFor('#requisitionDescriptionInterface,form[name="submitAction"],.candidate-self-service,#contentContainer,.requisitionContent,form', 10000);
    if (!form) { LOG('No Taleo form found'); await directAutofillFlow(); return; }
    await sleep(2000);

    // Taleo uses numbered fieldsets and iframe-heavy layouts
    // Phase 1: Fill personal info fields
    const taleoFields = {
      '#FirstName,input[id*="FirstName"]': p.first_name || p.firstName || '',
      '#LastName,input[id*="LastName"]': p.last_name || p.lastName || '',
      '#Email,input[id*="Email"],input[id*="email"]': p.email || '',
      '#PhoneNumber,input[id*="Phone"],input[id*="phone"]': p.phone || '',
      'input[id*="Address"],input[id*="Street"]': p.address || '',
      'input[id*="City"]': p.city || '',
      'input[id*="ZipCode"],input[id*="PostalCode"]': p.postal_code || p.zip || '',
    };
    for (const [sels, val] of Object.entries(taleoFields)) {
      if (!val) continue;
      for (const sel of sels.split(',')) {
        const el = $(sel.trim());
        if (el && !el.value?.trim()) { el.focus({ preventScroll: true }); nativeSet(el, val); await sleep(80); break; }
      }
    }

    // Phase 2: Fill selects (country, state, source)
    const countrySelect = $('select[id*="Country"],select[name*="country"]');
    if (countrySelect && !hasFieldValue(countrySelect)) {
      const opt = $$('option', countrySelect).find(o => new RegExp(p.country || DEFAULTS.country, 'i').test(o.text));
      if (opt) { setSelectValue(countrySelect, opt.value); }
    }
    const stateSelect = $('select[id*="State"],select[id*="Province"],select[name*="state"]');
    if (stateSelect && !hasFieldValue(stateSelect) && p.state) {
      const opt = $$('option', stateSelect).find(o => o.text.toLowerCase().includes(p.state.toLowerCase()));
      if (opt) { setSelectValue(stateSelect, opt.value); }
    }

    // Phase 3: Taleo multi-page navigation
    await fixPhoneCountryCode();
    await tailorFirstFlow();
  }

  // ===================== JOBVITE AUTOMATION =====================
  async function jobviteAutomation() {
    LOG('Jobvite automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    // Click Apply if on listing page
    const applyBtn = $('a.jv-button-apply,.jv-apply-button,a[href*="/apply"],button.apply-button');
    if (applyBtn && isVisible(applyBtn) && !/\/apply/i.test(location.pathname)) {
      realClick(applyBtn);
      await sleep(3000);
    }

    const form = await waitFor('.jv-application-form,form[name="applicationForm"],.application-form,form', 10000);
    if (!form) { LOG('No Jobvite form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // Jobvite field patterns
    const jvFields = {
      'input[name="firstName"],input[id*="firstName"]': p.first_name || p.firstName || '',
      'input[name="lastName"],input[id*="lastName"]': p.last_name || p.lastName || '',
      'input[name="email"],input[id*="email"]': p.email || '',
      'input[name="phone"],input[id*="phone"]': p.phone || '',
      'input[name="address"],input[id*="address"]': p.address || '',
      'input[name="city"],input[id*="city"]': p.city || '',
      'input[name="linkedIn"],input[id*="linkedin"]': p.linkedin_profile_url || p.linkedin || '',
    };
    for (const [sels, val] of Object.entries(jvFields)) {
      if (!val) continue;
      for (const sel of sels.split(',')) {
        const el = $(sel.trim());
        if (el && !el.value?.trim()) { el.focus({ preventScroll: true }); nativeSet(el, val); await sleep(80); break; }
      }
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('Jobvite automation complete');
  }

  // ===================== WORKABLE AUTOMATION =====================
  // Modeled on OptimHire 2.2.8's workableAutofill(): a bounded, single-pass fill of the
  // known fields, THEN answer every custom question (the sponsorship/authorization
  // dropdowns, yes/no knockouts, and free-text prompts that were being skipped — which is
  // why the checklist stayed empty), THEN commit required fields and click "Submit
  // application". No re-scanning loops of our own — the outer multiPageLoop handles any
  // second page.
  async function workableAutomation() {
    LOG('Workable automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('.application-form,form[data-ui="application-form"],form', 10000);
    if (!form) { LOG('No Workable form found'); await directAutofillFlow(); return; }
    await sleep(1200);

    // 1) Known fields (data-ui + name + aria-label fallbacks). Fill each once.
    const wkFields = {
      'input[data-ui="firstname"],input[name="firstname"],input[aria-label*="First name" i]': p.first_name || p.firstName || '',
      'input[data-ui="lastname"],input[name="lastname"],input[aria-label*="Last name" i]': p.last_name || p.lastName || '',
      'input[data-ui="email"],input[name="email"],input[type="email"]': p.email || '',
      'input[data-ui="phone"],input[name="phone"],input[type="tel"]': p.phone || '',
      'input[data-ui="address"],input[name="address"],input[aria-label*="Address" i]': p.address || p.city || '',
      'input[data-ui="city"],input[name="city"],input[aria-label*="City" i]': p.city || '',
      'input[name="region"],input[aria-label*="State" i],input[aria-label*="Estado" i]': p.state || p.region || '',
      'textarea[data-ui="cover_letter"],textarea[name="cover_letter"],textarea[aria-label*="cover" i]': p.cover_letter || DEFAULTS.cover,
    };
    for (const [sels, val] of Object.entries(wkFields)) {
      if (!val) continue;
      for (const sel of sels.split(',')) {
        const el = $(sel.trim());
        if (el && isVisible(el) && !el.value?.trim()) { el.focus({ preventScroll: true }); nativeSet(el, val); await sleep(70); break; }
      }
    }
    await fixPhoneCountryCode();

    // 2) Answer the custom questions Workable renders as native selects, react-select
    //    dropdowns, radio/button groups, and free-text prompts. This is the part that was
    //    missing — the semantic matchers map decisions onto the real option wording.
    await resolveLocationFields();
    await answerChoiceGroups();            // radios (sponsorship/authorization etc.)
    await answerButtonStyleQuestions(p);   // button / role=option groups + opened dropdowns
    await answerNativeSelects(p);          // native <select> knockouts (decision-aware)
    await answerWorkableDropdowns(p);      // Workable react-select comboboxes
    await fillOpenTextPrompts(p);          // "Please elaborate on your experience…" textareas
    await sleep(300);

    // 3) Guarantee anything still required (School default, remaining selects/checkboxes),
    //    then submit. The outer multiPageLoop picks up any confirmation/second step.
    await guaranteeRequiredFields();
    await handleValidationErrors();
    await sleep(400);
    const r = await autoSubmitOrNext();
    LOG('Workable automation complete (' + (r || 'no-submit') + ')');
    learnFromFilledFields();
  }

  // Fill Workable's native <select> knockouts using the decision-aware picker.
  async function answerNativeSelects(p) {
    for (const sel of $$('select').filter(el => isVisible(el) && !hasFieldValue(el))) {
      const lbl = getLabel(sel);
      const opt = selectOptionForQuestion(sel, lbl, p);
      if (opt) { setSelectValue(sel, opt.value); await sleep(80); }
    }
  }

  // Workable custom dropdowns (react-select style: a control you click to open a listbox).
  // Open each unfilled one, read the rendered options, and pick the decision-mapped option.
  async function answerWorkableDropdowns(p) {
    const controls = $$('[class*="Select__control"],[class*="select__control"],[role="combobox"],[aria-haspopup="listbox"]')
      .filter(el => isVisible(el));
    for (const ctrl of controls) {
      try {
        // Skip if it already shows a chosen value.
        const shown = ctrl.querySelector('[class*="singleValue"],[class*="single-value"]');
        if (shown && shown.textContent.trim()) continue;
        const lbl = getLabel(ctrl) || getFullQuestionText(ctrl);
        // NEVER click DATE controls — Workable's Start/End date (MM/YYYY) fields match the
        // combobox selectors, and clicking them pops open calendar pickers (the two open
        // calendars in the screenshots). Education dates are optional there anyway.
        const isDateCtrl = /\bdate\b|start date|end date|mm\s*\/\s*yyyy|dd\s*\/\s*mm|month|year of/i.test(lbl || '')
          || ctrl.querySelector('input[placeholder*="MM" i],input[placeholder*="YYYY" i],[class*="datepicker" i],[class*="DatePicker"]')
          || ctrl.closest('[class*="datepicker" i],[class*="DatePicker"],[data-ui*="date" i]');
        if (isDateCtrl) continue;
        realClick(ctrl);
        // Strict option selector — a loose [class*="option"] also matches "optional-label"
        // etc. and could click junk.
        const listSel = '[role="option"],li[role="option"],[class*="select__option"],[class*="Select__option"],[class*="menu"] [class*="option"]:not([class*="optional" i])';
        const first = await waitFor(listSel, 1200);
        if (!first) { continue; }
        const opts = $$(listSel).filter(isVisible);
        if (!opts.length) continue;
        const texts = opts.map(o => (o.textContent || '').trim());
        let decision = determineYesNo(lbl || '');
        if (decision === 'eeo') decision = /hispanic|latino/i.test(lbl || '') ? 'no' : 'decline';
        let idx = decision ? optionIndexForDecision(texts, decision, lbl || '') : -1;
        // Non-binary dropdown → try a value/keyword match instead of forcing yes/no.
        if (idx < 0) {
          const val = guessFieldValue(lbl, p, ctrl);
          if (val) { const v = val.toLowerCase(); idx = texts.findIndex(t => t.toLowerCase() === v); if (idx < 0) idx = texts.findIndex(t => t.toLowerCase().includes(v)); }
        }
        if (idx >= 0 && opts[idx]) { realClick(opts[idx]); await sleep(200); }
        else { // close the abandoned menu with Escape (a re-click can just re-open it)
          try { ctrl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })); document.body.click(); } catch (_) {}
          await sleep(100);
        }
      } catch (_) {}
    }
  }

  // Free-text "Please elaborate on your experience…" prompts (required textareas Workable
  // won't submit without). Prefer a learned/saved answer; else a concise professional
  // paragraph derived from the prompt so it's relevant, never blank.
  async function fillOpenTextPrompts(p) {
    for (const ta of $$('textarea').filter(el => isVisible(el) && !el.value?.trim())) {
      const lbl = getLabel(ta) || '';
      if (/cover/i.test(lbl)) continue; // handled above
      let val = findSavedResponseMatch(getFullQuestionText(ta)) || getLearnedAnswer(lbl, ta, true);
      if (!val) {
        const topic = lbl.replace(/please\s+elaborate\s+on\s+(your\s+)?/i, '').replace(/[?.]+$/, '').trim();
        val = topic
          ? `I have hands-on, professional experience with ${topic.slice(0, 140)}. In previous roles I applied these skills to deliver reliable, high-quality results, and I am confident I can bring the same value to your team.`
          : DEFAULTS.cover;
      }
      ta.focus({ preventScroll: true }); nativeSet(ta, val); await sleep(80);
    }
  }

  // ===================== INDEED EASY APPLY =====================
  async function indeedEasyApply() {
    LOG('Indeed Easy Apply automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    // Click Apply Now / Easy Apply
    const applyBtn = $('button[id="indeedApplyButton"],#applyButtonLinkContainer a,button[class*="apply"],a[class*="apply"]');
    if (applyBtn && isVisible(applyBtn)) {
      realClick(applyBtn);
      await sleep(3000);
    }

    // Indeed uses an iframe for the application
    const iframe = $('iframe[id*="indeedapply"],iframe[src*="indeedapply"]');
    if (iframe) {
      LOG('Indeed apply iframe detected — content script limited to main page');
    }

    // Wait for form (Indeed sometimes uses inline forms)
    const form = await waitFor('form[id*="apply"],form[class*="apply"],.ia-Questions,form', 8000);
    if (!form) { LOG('No Indeed form found'); return; }
    await sleep(1500);

    // Indeed multi-step flow
    const MAX_STEPS = 8;
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (checkSuccess()) break;
      LOG(`Indeed: step ${step}`);

      // Fill all visible fields
      const fields = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
        .filter(el => isVisible(el) && !hasFieldValue(el));
      for (const field of fields) {
        const lbl = getLabel(field);
        if (!lbl) continue;
        const val = guessFieldValue(lbl, p, field);
        if (!val) continue;
        if (field.tagName === 'SELECT') {
          const opt = $$('option', field).find(o => o.text.toLowerCase().includes(val.toLowerCase()));
          if (opt) { setSelectValue(field, opt.value); }
        } else { field.focus({ preventScroll: true }); nativeSet(field, val); }
        await sleep(80);
      }

      // Radio groups
      const groups = {};
      $$('input[type=radio]').filter(isVisible).forEach(r => { (groups[r.name || r.id] ||= []).push(r); });
      for (const [, radios] of Object.entries(groups)) {
        if (radios.some(r => r.checked)) continue;
        const parent = radios[0].closest('fieldset,.ia-Questions-item,.form-group,[class*="question"]');
        answerKnockoutRadioGroup(radios, parent, p);
      }

      answerButtonStyleQuestions(p);
      await handleValidationErrors();

      // Indeed Continue / Submit
      const continueBtn = $('button[id*="continue"],button.ia-continueButton,.ia-NavigationButtons button[data-testid*="continue"]');
      const submitBtn = $('button[id*="submit"],button.ia-submitButton,.ia-NavigationButtons button[data-testid*="submit"]');
      if (submitBtn && isVisible(submitBtn)) {
        LOG('Indeed: clicking Submit');
        await sleep(500);
        realClick(submitBtn);
        await sleep(3000);
        break;
      }
      if (continueBtn && isVisible(continueBtn)) {
        realClick(continueBtn);
        await sleep(2500);
        continue;
      }
      const txtBtn = $$('button').filter(isVisible).find(b => /^(continue|next|submit|apply)\b/i.test((b.textContent || '').trim()));
      if (txtBtn) { realClick(txtBtn); await sleep(2500); continue; }
      break;
    }
    learnFromFilledFields();
    LOG('Indeed Easy Apply complete');
  }

  // ===================== BREEZYHR AUTOMATION =====================
  async function breezyhrAutomation() {
    LOG('BreezyHR automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('.breezy-apply-form,form[id*="application"],.position-apply,form', 10000);
    if (!form) { LOG('No BreezyHR form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // BreezyHR field patterns
    const brFields = {
      'input[name="name"],input[placeholder*="name" i]': `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim(),
      'input[name="email"],input[type="email"]': p.email || '',
      'input[name="phone"],input[type="tel"]': p.phone || '',
      'input[name="address"],input[placeholder*="address" i]': p.address || '',
      'input[name="headline"],input[placeholder*="headline" i]': p.current_title || p.title || '',
      'textarea[name="summary"],textarea[placeholder*="summary" i]': p.summary || p.cover_letter || DEFAULTS.cover,
    };
    for (const [sels, val] of Object.entries(brFields)) {
      if (!val) continue;
      for (const sel of sels.split(',')) {
        const el = $(sel.trim());
        if (el && !el.value?.trim()) { el.focus({ preventScroll: true }); nativeSet(el, val); await sleep(80); break; }
      }
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('BreezyHR automation complete');
  }

  // ===================== RIPPLING AUTOMATION =====================
  async function ripplingAutomation() {
    LOG('Rippling automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('form,[class*="application-form"],[data-testid*="application"]', 10000);
    if (!form) { LOG('No Rippling form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // Rippling uses React-based forms
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
      .filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      if (inp.tagName === 'SELECT') {
        // Decision-aware pick (reads reworded options like "Does not require sponsorship")
        // then value/keyword fallback — applied uniformly across every ATS handler.
        const gv = guessFieldValue(lbl, p, inp);
        const opt = selectOptionForQuestion(inp, lbl, p)
          || (gv ? $$('option', inp).find(o => o.text.toLowerCase().includes(gv.toLowerCase())) : null);
        if (opt) { setSelectValue(inp, opt.value); }
        await sleep(80);
        continue;
      }
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val);
      await sleep(80);
    }

    // Handle React Select dropdowns (common in Rippling)
    const reactSelects = $$('[class*="react-select"],[class*="Select__control"],[class*="css-"][class*="control"]')
      .filter(el => isVisible(el) && !el.querySelector('[class*="singleValue"]')?.textContent?.trim());
    for (const rs of reactSelects) {
      const lbl = getLabel(rs);
      const val = guessFieldValue(lbl, p, rs);
      if (!val) continue;
      const input = rs.querySelector('input');
      if (input) { input.focus({ preventScroll: true }); nativeSet(input, val); await sleep(500); }
      const option = await waitFor('[class*="option"]', 1000);
      if (option && isVisible(option)) { realClick(option); await sleep(200); }
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('Rippling automation complete');
  }

  // ===================== ADP AUTOMATION =====================
  async function adpAutomation() {
    LOG('ADP automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('.apply-form,form[id*="application"],form[class*="candidate"],form', 10000);
    if (!form) { LOG('No ADP form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    const adpFields = {
      'input[id*="firstName"],input[name*="firstName"]': p.first_name || p.firstName || '',
      'input[id*="lastName"],input[name*="lastName"]': p.last_name || p.lastName || '',
      'input[id*="email"],input[name*="email"],input[type="email"]': p.email || '',
      'input[id*="phone"],input[name*="phone"],input[type="tel"]': p.phone || '',
      'input[id*="address"],input[name*="address"]': p.address || '',
      'input[id*="city"],input[name*="city"]': p.city || '',
      'input[id*="zip"],input[id*="postal"],input[name*="zip"]': p.postal_code || p.zip || '',
    };
    for (const [sels, val] of Object.entries(adpFields)) {
      if (!val) continue;
      for (const sel of sels.split(',')) {
        const el = $(sel.trim());
        if (el && !el.value?.trim()) { el.focus({ preventScroll: true }); nativeSet(el, val); await sleep(80); break; }
      }
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('ADP automation complete');
  }

  // ===================== SUCCESSFACTORS AUTOMATION =====================
  async function successFactorsAutomation() {
    LOG('SuccessFactors automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('form[id*="application"],form,.applicationForm,[class*="applyForm"]', 10000);
    if (!form) { LOG('No SuccessFactors form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // SuccessFactors uses various field naming conventions
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
      .filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      if (inp.tagName === 'SELECT') {
        // Decision-aware pick (reads reworded options like "Does not require sponsorship")
        // then value/keyword fallback — applied uniformly across every ATS handler.
        const gv = guessFieldValue(lbl, p, inp);
        const opt = selectOptionForQuestion(inp, lbl, p)
          || (gv ? $$('option', inp).find(o => o.text.toLowerCase().includes(gv.toLowerCase())) : null);
        if (opt) { setSelectValue(inp, opt.value); }
        await sleep(80);
        continue;
      }
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val);
      await sleep(80);
    }

    // Radio/checkbox groups
    const groups = {};
    $$('input[type=radio]').filter(isVisible).forEach(r => { (groups[r.name || r.id] ||= []).push(r); });
    for (const [, radios] of Object.entries(groups)) {
      if (radios.some(r => r.checked)) continue;
      const parent = radios[0].closest('fieldset,.form-group,[class*="question"],[class*="field"]');
      answerKnockoutRadioGroup(radios, parent, p);
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('SuccessFactors automation complete');
  }

  // ===================== JAZZHR AUTOMATION =====================
  async function jazzhrAutomation() {
    LOG('JazzHR automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('#jazzhr-apply,form[id*="apply"],form.resume-form,form', 10000);
    if (!form) { LOG('No JazzHR form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    const jzFields = {
      '#first_name,input[name="first_name"]': p.first_name || p.firstName || '',
      '#last_name,input[name="last_name"]': p.last_name || p.lastName || '',
      '#email,input[name="email"]': p.email || '',
      '#phone,input[name="phone"]': p.phone || '',
      '#address,input[name="address"]': p.address || '',
      '#city,input[name="city"]': p.city || '',
      '#linkedin_url,input[name*="linkedin"]': p.linkedin_profile_url || p.linkedin || '',
      '#eeo_gender,select[name="eeo_gender"]': p.gender || DEFAULTS.gender,
      '#eeo_race,select[name="eeo_race"]': p.ethnicity || p.race || DEFAULTS.ethnicity,
      '#eeo_veteran,select[name="eeo_veteran"]': p.veteran || DEFAULTS.veteran,
      '#eeo_disability,select[name="eeo_disability"]': p.disability || DEFAULTS.disability,
    };
    for (const [sels, val] of Object.entries(jzFields)) {
      if (!val) continue;
      for (const sel of sels.split(',')) {
        const el = $(sel.trim());
        if (!el || hasFieldValue(el)) continue;
        if (el.tagName === 'SELECT') {
          const opt = $$('option', el).find(o => o.text.toLowerCase().includes(val.toLowerCase()) || /prefer not|decline/i.test(o.text));
          if (opt) { setSelectValue(el, opt.value); }
        } else { el.focus({ preventScroll: true }); nativeSet(el, val); }
        await sleep(80);
        break;
      }
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('JazzHR automation complete');
  }

  // ===================== HANDSHAKE AUTOMATION =====================
  async function handshakeAutomation() {
    LOG('Handshake automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('form[class*="application"],form,.apply-form', 10000);
    if (!form) { LOG('No Handshake form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // Fill all visible empty fields using generic approach
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
      .filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      if (inp.tagName === 'SELECT') {
        // Decision-aware pick (reads reworded options like "Does not require sponsorship")
        // then value/keyword fallback — applied uniformly across every ATS handler.
        const gv = guessFieldValue(lbl, p, inp);
        const opt = selectOptionForQuestion(inp, lbl, p)
          || (gv ? $$('option', inp).find(o => o.text.toLowerCase().includes(gv.toLowerCase())) : null);
        if (opt) { setSelectValue(inp, opt.value); }
        await sleep(80);
        continue;
      }
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val);
      await sleep(80);
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('Handshake automation complete');
  }

  // ===================== USAJOBS AUTOMATION =====================
  async function usajobsAutomation() {
    LOG('USAJOBS automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    // USAJOBS has a specific flow — Apply button redirects to agency site
    const applyBtn = $('a[href*="apply"],button[data-automation*="apply"],.usajobs-apply-button');
    if (applyBtn && isVisible(applyBtn)) {
      LOG('USAJOBS: Apply button found — click to proceed to agency site');
      // Don't auto-click — let user decide
    }

    // Fill any inline forms
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
      .filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      if (inp.tagName === 'SELECT') {
        // Decision-aware pick (reads reworded options like "Does not require sponsorship")
        // then value/keyword fallback — applied uniformly across every ATS handler.
        const gv = guessFieldValue(lbl, p, inp);
        const opt = selectOptionForQuestion(inp, lbl, p)
          || (gv ? $$('option', inp).find(o => o.text.toLowerCase().includes(gv.toLowerCase())) : null);
        if (opt) { setSelectValue(inp, opt.value); }
        await sleep(80);
        continue;
      }
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val);
      await sleep(80);
    }

    await fixPhoneCountryCode();
    await fallbackFill();
    learnFromFilledFields();
    LOG('USAJOBS automation complete');
  }

  // ===================== EIGHTFOLD AUTOMATION =====================
  async function eightfoldAutomation() {
    LOG('Eightfold automation starting...');
    const p = await getProfile();
    await loadAnswerBank();

    const form = await waitFor('.apply-form,form[class*="application"],[class*="ApplicationForm"],form', 10000);
    if (!form) { LOG('No Eightfold form found'); await directAutofillFlow(); return; }
    await sleep(1500);

    // Eightfold uses React with custom components
    const inputs = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select')
      .filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of inputs) {
      const lbl = getLabel(inp);
      if (!lbl) continue;
      if (inp.tagName === 'SELECT') {
        // Decision-aware pick (reads reworded options like "Does not require sponsorship")
        // then value/keyword fallback — applied uniformly across every ATS handler.
        const gv = guessFieldValue(lbl, p, inp);
        const opt = selectOptionForQuestion(inp, lbl, p)
          || (gv ? $$('option', inp).find(o => o.text.toLowerCase().includes(gv.toLowerCase())) : null);
        if (opt) { setSelectValue(inp, opt.value); }
        await sleep(80);
        continue;
      }
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val);
      await sleep(80);
    }

    await fixPhoneCountryCode();
    await tailorFirstFlow();
    learnFromFilledFields();
    LOG('Eightfold automation complete');
  }

  // ===================== iCIMS AUTOMATION =====================
  async function icimsAutomation() {
    LOG('iCIMS automation starting...');
    // iCIMS often has an "Apply" link that opens a new page or iframe
    const applyBtn = $('a.iCIMS_MainLink[href*="apply"],a[title*="Apply"],a.header-apply-button,.iCIMS_ApplyLink,button.applyButton');
    if (applyBtn && isVisible(applyBtn)) {
      LOG('Clicking iCIMS Apply button');
      realClick(applyBtn);
      await sleep(4000);
    }
    // iCIMS can load in an iframe
    const iframe = $('iframe[src*="icims"],iframe[name*="icims"]');
    if (iframe) {
      LOG('iCIMS iframe detected — content script cannot access cross-origin iframe, proceeding with main page');
    }
    // Wait for form fields
    await waitFor('.iCIMS_InfoMsg_Job,.iCIMS_Forms_Region,form,.applicant-form', 8000);
    await sleep(1500);
    // iCIMS-specific fields (from SpeedyApply)
    const p = await getProfile();
    const icimsFields = {
      '#PersonProfileFields\\.Login': p.email || '',
      '#PersonProfileFields\\.LastName': p.last_name || p.lastName || '',
      '#PersonProfileFields\\.Email': p.email || '',
    };
    for (const [sel, val] of Object.entries(icimsFields)) {
      try { const el = $(sel); if (el && !el.value && val) nativeSet(el, val); } catch (_) { }
    }
    await fixPhoneCountryCode();
    await tailorFirstFlow();
  }

  // ===================== LINKEDIN EASY APPLY =====================
  async function linkedinEasyApply() {
    LOG('LinkedIn Easy Apply automation starting...');
    // Click the Easy Apply button if on a job listing
    const easyApplyBtn = await findByText('button', /easy apply/i, 5000);
    if (easyApplyBtn && isVisible(easyApplyBtn)) {
      LOG('Clicking Easy Apply button');
      realClick(easyApplyBtn);
      await sleep(2000);
    }
    // Wait for the modal form
    const modal = await waitFor('.jobs-easy-apply-modal,.jobs-easy-apply-content,[class*="easy-apply"],.artdeco-modal', 8000);
    if (!modal) { LOG('LinkedIn Easy Apply modal not found'); return; }
    await sleep(1500);

    // LinkedIn Easy Apply has multiple pages — loop through them
    const MAX_STEPS = 8;
    for (let step = 1; step <= MAX_STEPS; step++) {
      LOG(`LinkedIn Easy Apply: step ${step}`);
      await sleep(1000);

      // Fill visible fields
      const p = await getProfile();
      await loadAnswerBank();
      const fields = $$('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select', modal)
        .filter(el => isVisible(el) && !hasFieldValue(el));
      for (const field of fields) {
        const lbl = getLabel(field);
        if (!lbl) continue;
        const val = guessFieldValue(lbl, p, field);
        if (!val) continue;
        if (field.tagName === 'SELECT') {
          const opt = $$('option', field).find(o => o.text.toLowerCase().includes(val.toLowerCase()));
          if (opt) { setSelectValue(field, opt.value); }
        } else {
          field.focus({ preventScroll: true }); nativeSet(field, val);
        }
        await sleep(80);
      }

      // Check for required radio groups
      const radioGroups = {};
      $$('input[type=radio]', modal).filter(isVisible).forEach(r => { (radioGroups[r.name || r.id] ||= []).push(r); });
      for (const [, radios] of Object.entries(radioGroups)) {
        if (radios.some(r => r.checked)) continue;
        const lbl = getLabel(radios[0]);
        const guess = guessFieldValue(lbl, p, radios[0]);
        const match = radios.find(r => {
          const t = ($(`label[for="${CSS.escape(r.id)}"]`)?.textContent || r.value || '').toLowerCase();
          return guess && t.includes(guess.toLowerCase());
        });
        if (match) realClick(match);
        else {
          const yes = radios.find(r => /yes|true/i.test(r.value || $(`label[for="${CSS.escape(r.id)}"]`)?.textContent || ''));
          if (yes) realClick(yes);
        }
      }

      // Look for Next / Review / Submit
      const nextBtn = modal.querySelector('button[aria-label*="next" i],button[aria-label*="Continue" i],button[data-easy-apply-next-button]');
      const reviewBtn = modal.querySelector('button[aria-label*="Review" i]');
      const submitBtn = modal.querySelector('button[aria-label*="Submit" i],button[data-control-name="submit_unify"]');

      if (submitBtn && isVisible(submitBtn)) {
        LOG('LinkedIn: clicking Submit');
        await sleep(500);
        realClick(submitBtn);
        await sleep(2000);
        // Check for success
        const dismiss = modal.querySelector('button[aria-label*="Dismiss" i],button[data-control-name="close_artdeco_modal"]');
        if (dismiss) { LOG('LinkedIn: Application submitted successfully!'); realClick(dismiss); }
        return;
      }
      if (reviewBtn && isVisible(reviewBtn)) {
        LOG('LinkedIn: clicking Review');
        realClick(reviewBtn);
        await sleep(2000);
        continue;
      }
      if (nextBtn && isVisible(nextBtn)) {
        LOG('LinkedIn: clicking Next');
        realClick(nextBtn);
        await sleep(2000);
        continue;
      }

      // Fallback: text-based button search
      const allBtns = $$('button', modal).filter(isVisible);
      const txtBtn = allBtns.find(b => /^(submit|next|continue|review)\b/i.test((b.textContent || '').trim()));
      if (txtBtn) { realClick(txtBtn); await sleep(2000); continue; }

      LOG('LinkedIn: No next/submit button found — stopping');
      break;
    }
  }

  // ===================== RESUME/FILE UPLOAD AUTOMATION =====================
  async function tryResumeUpload() {
    // Look for file input fields (resume, cover letter)
    const fileInputs = $$('input[type="file"]').filter(el => {
      const lbl = getLabel(el);
      return /resume|cv|cover.?letter|document|upload/i.test(lbl || el.name || el.id || el.accept || '');
    });
    if (!fileInputs.length) return false;

    // Check if Jobright sidebar has a resume ready (shadow-aware)
    const sidebar = getSidebar();
    if (!sidebar) return false;

    // Look for "Download Resume" or similar button in sidebar
    const dlBtn = sidebar.querySelector('a[download],a[href*="resume"],button[class*="download"],.download-resume-button');
    if (dlBtn) {
      LOG('Found resume download button in Jobright sidebar — resume upload handled by sidebar');
      return true;
    }

    // Check for drag-and-drop upload zones
    const dropZones = $$('[class*="dropzone"],[class*="upload-area"],[class*="file-drop"],[class*="dz-clickable"],.upload-container,.file-upload-area')
      .filter(isVisible);
    if (dropZones.length) {
      LOG('Drop zones found — Jobright sidebar handles resume upload');
    }
    return false;
  }

  // ===================== FORM VALIDATION ERROR HANDLER =====================
  async function handleValidationErrors__impl() {
    // Wait a moment for validation to trigger
    await sleep(500);
    const errors = deepAll('.error,.field-error,.error-message,.validation-error,[class*="error"],[class*="Error"],.invalid-feedback,.help-block.with-errors,.field-validation-error,[aria-invalid="true"],[data-error]')
      .filter(el => isVisible(el) && el.textContent?.trim());

    if (!errors.length) return 0;
    LOG(`Found ${errors.length} validation errors — attempting to fix`);

    let fixed = 0;
    const p = await getProfile();
    for (const errEl of errors) {
      // Find the associated input
      const container = errEl.closest('.form-group,.field,.question,[class*="Field"],[class*="Question"],li,.form-item,.ant-form-item,.MuiFormControl-root,fieldset,div');
      if (!container) continue;
      const inp = container.querySelector('input:not([type=hidden]):not([type=file]),textarea,select');
      if (!inp) continue;

      // RADIO GROUP in the error container — previously this fell through to nativeSet()
      // on a radio (a no-op), so radio-based questions with a validation error (common on
      // Workday questionnaires) never got fixed. Route them through the knockout radio
      // answerer (Yes/No/EEO/experience-range aware).
      if (inp.type === 'radio') {
        const radios = [...container.querySelectorAll('input[type=radio]')].filter(isVisible);
        if (radios.length && !radios.some(r => r.checked)) {
          if (answerKnockoutRadioGroup(radios, container, p)) fixed++;
        }
        await sleep(60);
        continue;
      }
      // Required consent CHECKBOX with an error — tick it (unless it's a marketing opt-in).
      if (inp.type === 'checkbox') {
        if (!inp.checked && !isMarketingCheckbox(inp)) { realClick(inp); fixed++; }
        await sleep(60);
        continue;
      }
      if (hasFieldValue(inp)) continue;

      const lbl = getLabel(inp);
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;

      if (inp.tagName === 'SELECT') {
        const opt = deepAll('option', inp).find(o => o.text.toLowerCase().includes(val.toLowerCase()));
        if (opt) { setSelectValue(inp, opt.value); fixed++; }
      } else {
        inp.focus({ preventScroll: true }); nativeSet(inp, val); fixed++;
      }
      await sleep(60);
    }

    // Also handle aria-invalid fields directly
    const invalidFields = deepAll('[aria-invalid="true"]').filter(el => isVisible(el) && !hasFieldValue(el));
    for (const inp of invalidFields) {
      const lbl = getLabel(inp);
      const val = guessFieldValue(lbl, p, inp);
      if (!val) continue;
      inp.focus({ preventScroll: true }); nativeSet(inp, val); fixed++;
      await sleep(60);
    }

    LOG(`Fixed ${fixed} validation errors`);
    return fixed;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function handleValidationErrors(...a) { return withBusy('fixing validation errors', () => handleValidationErrors__impl(...a)); }

  // ===================== ERROR RECOVERY & RETRY =====================
  async function withRetry(fn, label, maxRetries) {
    maxRetries = maxRetries || 2;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (err) {
        LOG(`${label} failed (attempt ${attempt}/${maxRetries + 1}):`, err?.message || err);
        if (attempt <= maxRetries) {
          await sleep(1000 * attempt); // Progressive backoff
          // Check for validation errors and try to fix them
          await handleValidationErrors();
        } else {
          throw err;
        }
      }
    }
  }

  // ===================== KEYBOARD SHORTCUTS =====================
  // Is the user typing? document.activeElement stops at a shadow boundary and
  // reports the HOST element, so on SmartRecruiters/Workday forms it says
  // "SPL-INPUT" rather than "INPUT" and the old check waved the keystroke
  // through. Walk into the shadow tree, and treat contenteditable as typing too.
  function isTypingTarget() {
    try {
      let el = document.activeElement;
      for (let i = 0; i < 5 && el && el.shadowRoot && el.shadowRoot.activeElement; i++) el = el.shadowRoot.activeElement;
      if (!el) return false;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
      if (el.isContentEditable) return true;
      if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
      return false;
    } catch (_) { return true; }   // unsure → assume typing, never steal the key
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (isTypingTarget()) return;
      if (!e.altKey) return;

      switch (e.key.toLowerCase()) {
        // Alt+A is a KILL SWITCH, not a toggle. Turning Fully Automated ON is a
        // deliberate act and must go through the on-screen switch: a stray Alt+A
        // (plenty of sites and OS layouts use it) was silently turning automation
        // back on and starting an application on the spot.
        case 'a':
          e.preventDefault();
          if (autoApply) setAutoApply(false, false, 'Alt+A');
          else LOG('Alt+A ignored — turn Fully Automated ON with the switch, not a shortcut');
          break;
        case 'q': // Alt+Q: Toggle drawer
          e.preventDefault();
          const d = document.getElementById('ua-drawer');
          if (d) { d.classList.toggle('open'); positionDrawer(); }
          break;
        case 'f': // Alt+F: Run a manual full pass (apply → account → fill → next)
          e.preventDefault();
          LOG('Manual full fill triggered via Alt+F');
          (async () => {
            await openApplicationForm();
            await handleAccountAuth();
            await fallbackFill();
            await guaranteeRequiredFields();
            await autoSubmitOrNext();
          })().catch(err => LOG('Alt+F error:', err));
          break;
        case 's': // Alt+S: Start/stop queue
          e.preventDefault();
          if (qActive) stopQ(); else startQ();
          break;
        case 'j': // Alt+J: Add current page to queue
          e.preventDefault();
          addJob(location.href, document.title);
          break;
        case 'p': // Alt+P: Pause/resume queue
          e.preventDefault();
          if (qPaused) resumeQ(); else if (qActive) pauseQ();
          break;
        case 'n': // Alt+N: Skip current job
          e.preventDefault();
          if (qActive) skipJob();
          break;
        case 'e': // Alt+E: Export queue to CSV
          e.preventDefault();
          exportQueueCSV();
          break;
        case 'd': // Alt+D: Toggle dark mode
          e.preventDefault();
          toggleDarkMode().then(dark => {
            const btn = document.getElementById('ua-dark-toggle');
            if (btn) btn.textContent = dark ? '☀️' : '🌙';
          });
          break;
        case 'g': // Alt+G: Scrape jobs from page
          e.preventDefault();
          scrapeAndAddToQueue();
          break;
        case 'r': // Alt+R: Retry failed jobs
          e.preventDefault();
          retryFailedJobs();
          break;
        case 'h': // Alt+H: Export application history
          e.preventDefault();
          exportAppHistory();
          break;
      }
    });
  }

  // ===================== EXPORT QUEUE TO CSV =====================
  function exportQueueCSV() {
    if (!queue.length) { LOG('No jobs to export'); return; }
    const header = 'URL,Title,Status,Added\n';
    const rows = queue.map(j => {
      const url = j.url.replace(/"/g, '""');
      const title = (j.title || '').replace(/"/g, '""');
      const date = j.addedAt ? new Date(j.addedAt).toISOString() : '';
      return `"${url}","${title}","${j.status}","${date}"`;
    }).join('\n');
    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `job-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    LOG(`Exported ${queue.length} jobs to CSV`);
  }

  // ===================== RESUME TAILORING (on Jobright website) =====================
  async function resumeTailoringAutomation() {
    if (!isJobright() || (!location.href.includes('plugin_tailor=1') && !location.href.includes('/jobs/info/'))) return;
    await sleep(3000);
    let el = await findByText('button,a,div[role="button"]', /improve my resume/i, 8000); if (el) { clickEl(el); await sleep(2000); }
    el = await findByText('button,a,div[role="button"],label,span', /full edit/i, 5000); if (el) { clickEl(el); await sleep(3000); }
    el = await findByText('button,a,span,div[role="button"],label', /select all/i, 5000); if (el) { clickEl(el); await sleep(1000); }
    el = await findByText('button,a,div[role="button"]', /generate (my new )?resume|generate$/i, 5000); if (el) clickEl(el);
  }

  // ===================== AUTOFILL TRIGGER =====================
  // Shadow-DOM aware: 1.14.0 renders the sidebar inside an open shadow root, so we
  // locate the button via getSidebar()/findAutofillButton() rather than document.
  async function triggerAutofill__impl() {
    await waitForSidebar(8000);
    await sleep(1500);
    // Try several times — the button may still be mounting / disabled while the
    // sidebar hydrates. This is the click that was silently failing in 1.14.0.
    for (let attempt = 0; attempt < 5; attempt++) {
      const b = findAutofillButton();
      if (b && !b.disabled && isVisible(b)) { realClick(b); LOG(`Autofill button clicked (attempt ${attempt + 1})`); return true; }
      await sleep(attempt === 0 ? 1500 : 2500);
    }
    LOG('Autofill button not found or disabled (shadow-aware lookup)');
    return false;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function triggerAutofill(...a) { return withBusy('running Jobright autofill', () => triggerAutofill__impl(...a)); }

  // Quick autofill trigger with shorter timeout (won't freeze the flow)
  async function triggerAutofillQuick__impl() {
    let b = findAutofillButton();
    if (!b) { LOG('No sidebar/autofill button — skipping quick autofill'); return false; }
    if (b && !b.disabled) { realClick(b); LOG('Quick autofill triggered'); await sleep(3000); return true; }
    // One retry after 1.5s
    await sleep(1500);
    b = findAutofillButton();
    if (b && !b.disabled) { realClick(b); LOG('Quick autofill triggered (retry)'); await sleep(3000); return true; }
    return false;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function triggerAutofillQuick(...a) { return withBusy('running Jobright autofill', () => triggerAutofillQuick__impl(...a)); }

  // ===================== QUEUE ENGINE (LazyApply-enhanced) =====================
  // LazyApply-inspired: configurable delays and timeout
  const QUEUE_DELAYS = { 1: 1500, 1.5: 1000, 2: 600, 3: 300 };
  let qSpeed = 1;
  let qTimeout = 150000; // 150s hard cap per job — enough for the fill→submit→verify→retry loop; protects against truly stuck pages (captcha/login)
  let _qTimeoutId = null;

  // ===================== SINGLE RUNNER TAB =====================
  // The queue must drive exactly ONE tab — otherwise every open tab (and any new
  // tab you open to browse) would also navigate itself to job URLs and hijack your
  // browsing. window.name survives same-tab navigations (even cross-origin), so we
  // tag the tab that started the run and only that tab processes/navigates.
  const RUNNER_PREFIX = 'UAQRUN::';
  /* ── WHICH TAB IS DRIVING THE RUN ──────────────────────────────────────────
     This was the single defect behind three separate symptoms: the run stopping
     on its own, the "Automation In Progress" panel vanishing mid-run, and a
     queue that reports 0 applied while looking busy.

     A content script has exactly one piece of per-tab scratch space: window.name.
     Chrome CLEARS window.name whenever a tab navigates between different sites
     (window.name isolation). A CSV run drives ONE tab from greenhouse.io to
     lever.co to smartrecruiters.com — so the runner marker was wiped at the
     FIRST cross-site job, and from then on:

       • processQ() returned early at `if (!isRunnerTab()) return;` — the queue
         stopped advancing, permanently;
       • updateCtrl() took its else branch and removed the panel;
       • the 600ms watchdog that would have re-mounted the panel was itself
         gated on isRunnerTab(), so nothing brought it back.

     It looked random because it depends on whether consecutive jobs happen to be
     on the same site. It is not random: it is the first cross-site hop.

     The service worker's view of a tab id survives every navigation, so ask it.
     window.name stays as the synchronous fast path for same-site hops; the
     worker's answer is the authority that outlives them. */
  let _runnerTabConfirmed = null;                  // null = not asked yet
  const RUNNER_TAB_KEY = 'ua_runner_tab';
  function myTabId() {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage({ type: 'UA_WHICH_TAB' }, (r) => {
          void chrome.runtime.lastError;
          res(r && typeof r.tabId === 'number' ? r.tabId : null);
        });
      } catch (_) { res(null); }
    });
  }
  function isRunnerTab() {
    try { if (typeof window.name === 'string' && window.name.indexOf(RUNNER_PREFIX) === 0) return true; } catch (_) {}
    return _runnerTabConfirmed === true;
  }
  /* Re-establish the marker after a cross-site navigation wiped it. Cheap, and
     the answer is cached — this runs on load and from the panel watchdog. */
  async function confirmRunnerTab() {
    try {
      if ((await st.get(SK.QA)) !== true) { _runnerTabConfirmed = false; return false; }
      const stored = await st.get(RUNNER_TAB_KEY);
      if (stored == null) return _runnerTabConfirmed === true;
      const id = await myTabId();
      if (id == null) return _runnerTabConfirmed === true;      // can't tell — don't downgrade
      const match = id === stored;
      _runnerTabConfirmed = match;
      if (match) {
        try { if (window.name.indexOf(RUNNER_PREFIX) !== 0) window.name = RUNNER_PREFIX + (window.name || ''); } catch (_) {}
      }
      return match;
    } catch (_) { return _runnerTabConfirmed === true; }
  }
  function markRunnerTab() {
    try { if (window.name.indexOf(RUNNER_PREFIX) !== 0) window.name = RUNNER_PREFIX + (window.name || ''); } catch (_) {}
    _runnerTabConfirmed = true;
    // Remember WHICH tab, so the marker can be rebuilt after a cross-site hop.
    myTabId().then((id) => { if (id != null) { try { st.set(RUNNER_TAB_KEY, id); } catch (_) {} } });
  }
  function unmarkRunnerTab() {
    try { if (typeof window.name === 'string' && window.name.indexOf(RUNNER_PREFIX) === 0) window.name = window.name.slice(RUNNER_PREFIX.length); } catch (_) {}
    _runnerTabConfirmed = false;
    try { st.set(RUNNER_TAB_KEY, null); } catch (_) {}
  }

  // Has this URL already been applied to in a previous session?
  function alreadyApplied(url) {
    const n = normalizeUrl(url);
    return (_appHistory || []).some(a => a.status === 'applied' && normalizeUrl(a.url) === n);
  }

  // ===================== WORKDAY CREATE-ACCOUNT AUTO-FILLER =====================
  // Workday gates the application behind a Create Account step (email, password,
  // verify password, "Agree to Privacy Notice"). Jobright pauses here asking you to
  // "Set a password to continue" because that password lives in Jobright's own store.
  // We fill the actual Workday fields with the saved credentials and submit so the
  // flow moves past the account step — independent of Jobright's prompt.
  // Set a value on a React-controlled input so REACT actually commits it.
  // Workday's inputs are React-controlled: assigning `el.value` directly bypasses
  // React's value tracker, so on the next render React REVERTS the field to its
  // own state (this is exactly why a typed 15-char password collapsed back to the
  // 3-char "•••" value Jobright had put in state). Calling the *prototype* value
  // setter is the documented workaround — React's tracker sees the change and the
  // dispatched input event updates React state, so the value sticks.
  function reactTypeValue(el, value) {
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      const KE = (t) => el.dispatchEvent(new KeyboardEvent(t, { bubbles: true, composed: true, cancelable: false }));
      el.focus({ preventScroll: true });
      KE('keydown'); KE('keypress');
      if (setter) setter.call(el, value); else el.value = value; // native setter → React registers the change
      KE('keyup');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true, composed: true })); // Workday validates on blur
    } catch (_) {
      try { el.value = value; ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true, composed: true }))); } catch (_) {}
    }
  }

  let _wdLastSubmit = 0;
  let _wdActions = 0;          // total submit/switch actions taken (bounded)
  const WD_MAX_ACTIONS = 10;
  // Drives Workday's "Create Account / Sign In" step to completion, fully automatically.
  // Returns: 'working' (keep trying), 'stop' (give up).
  // Design rules learned from the debug logs:
  //  • NEVER click the page-HEADER "Sign In" link (utilityButtonSignIn) — it navigates
  //    away and makes the form bounce. Only ever click the in-FORM submit buttons /
  //    in-form switch links.
  //  • Prefer CREATE ACCOUNT. Only switch Create<->Sign-In based on the real error text
  //    ("already exists" → Sign In; "wrong password / locked" → Create Account), so a
  //    fresh tenant actually creates the account instead of failing a sign-in.
  //  • Defend the fields with the saved password so Create and future Sign-In always use
  //    the SAME credentials, then auto-click the matching submit button.
  async function fillWorkdayCreateAccount(submit) {
    if (!isWorkday()) return 'stop';
    let pwFields = $$('input[type=password]').filter(isVisible);
    if (!pwFields.length) return 'stop'; // not on a create-account / sign-in page
    const email = await getAppEmail();
    const pw = await getAppPassword();
    if (!email || !pw) return 'working';

    // Which form are we on?
    const createBtn = $('button[data-automation-id="createAccountSubmitButton"]');
    const signInBtn = $('button[data-automation-id="signInSubmitButton"]');
    const verifyField = pwFields.find(f => /verify|confirm|re-?enter|retype/i.test((getLabel(f) || '') + (f.name || '') + (f.id || '') + (f.getAttribute('data-automation-id') || '')));
    const onCreate = !!createBtn && isVisible(createBtn);
    const onSignIn = !onCreate && !!signInBtn && isVisible(signInBtn) && !verifyField;

    // Defend email + password(s) with the saved credentials (React-committing setter).
    let emailField = $('input[data-automation-id="email"]') ||
      $$('input[type=email],input[type=text]').filter(isVisible)
        .find(i => /e-?mail/i.test((getLabel(i) || '') + (i.name || '') + (i.id || '') + (i.getAttribute('data-automation-id') || '')));
    if (emailField && emailField.value !== email) reactTypeValue(emailField, email);
    for (const f of pwFields) if (f.value !== pw) reactTypeValue(f, pw);
    if (onCreate) $$('input[type=checkbox]').filter(isVisible).forEach(c => { if (!c.checked && !isMarketingCheckbox(c)) realClick(c); });
    if (!submit) return 'working';

    const pwOK = pwFields.every(f => f.value === pw) && pw.length >= 8;
    const emOK = !emailField || emailField.value === email;
    if (!pwOK || !emOK) { LOG(`Workday: defending fields (pwOK=${pwOK} emailOK=${emOK})`); return 'working'; }
    if (Date.now() - _wdLastSubmit < 3500) return 'working'; // let the previous submit settle
    if (_wdActions >= WD_MAX_ACTIONS) { LOG('Workday: account step exhausted attempts — stopping. Check the saved password under 🔑 ATS account login.'); return 'stop'; }

    // Read Workday's visible error banner to decide whether to create or sign in.
    const pageText = (document.body.innerText || '').toLowerCase();
    const existsErr = /already (exists|registered|in use)|account.*already/i.test(pageText);
    const wrongCredErr = /wrong email|wrong password|might be locked|incorrect|invalid (email|password)|couldn'?t find|no account/i.test(pageText);
    // In-form switch link finder (NEVER the page-header utilityButtonSignIn).
    const inFormLink = (re) => $$('a,button,[role="button"]').filter(isVisible).find(b => {
      const aid = (b.getAttribute('data-automation-id') || '');
      if (/utilityButtonSignIn|headerSignIn/i.test(aid)) return false;
      const t = (b.textContent || '').trim();
      return t.length < 44 && re.test(t);
    });

    // CREATE ACCOUNT COMES FIRST. Workday's apply flow lands on the Sign In form by
    // default, but a first-time applicant has NO account yet — so trying to Sign In just
    // fails. Unless we have a record that this tenant already has an account, proactively
    // switch to Create Account BEFORE submitting anything (don't wait for a failed sign-in).
    const known = await accountExistsFor(location.hostname);
    if (onSignIn && !known && !existsErr) {
      const toCreate = inFormLink(/create account|create my account|sign ?up|new user|don'?t have an account|register/i)
        || $('[data-automation-id="createAccountLink"],a[data-automation-id*="createAccount" i]');
      if (toCreate && isVisible(toCreate)) { _wdLastSubmit = Date.now(); _wdActions++; LOG('Workday: fresh application (no account yet) — switching to Create Account FIRST'); realClick(toCreate); return 'working'; }
    }
    // Mirror image: if we KNOW an account was already created here, prefer Sign In.
    if (onCreate && known && !wrongCredErr) {
      const toSignIn = inFormLink(/sign ?in|log ?in|already have an account/i)
        || $('[data-automation-id="signInLink"],a[data-automation-id*="signIn" i]');
      if (toSignIn && isVisible(toSignIn)) { _wdLastSubmit = Date.now(); _wdActions++; LOG('Workday: account already created here — switching to Sign In'); realClick(toSignIn); return 'working'; }
    }

    // Self-correct the form mode based on the error text (covers accounts created outside
    // the extension, or a stale record).
    if (onSignIn && wrongCredErr) {
      const toCreate = inFormLink(/create account|sign ?up|new user|don'?t have an account/i);
      if (toCreate) { _wdLastSubmit = Date.now(); _wdActions++; LOG('Workday: Sign In rejected (no account yet) — switching to Create Account'); realClick(toCreate); return 'working'; }
    }
    if (onCreate && existsErr) {
      // The site telling us the account exists is the strongest proof there is —
      // stronger than our own bookkeeping. Record it so the NEXT job at this
      // employer opens Sign In directly instead of repeating this round trip.
      await markAccountCreated(location.hostname);
      const toSignIn = inFormLink(/sign ?in|log ?in|already have an account/i);
      if (toSignIn) { _wdLastSubmit = Date.now(); _wdActions++; LOG('Workday: account already exists — switching to Sign In'); realClick(toSignIn); return 'working'; }
    }

    // Submit the CURRENT form.
    if (onCreate) {
      const consentOK = $$('input[type=checkbox]').filter(isVisible).every(c => c.checked);
      if (!consentOK) { LOG('Workday: waiting for consent checkbox…'); return 'working'; }
      if (!createBtn.disabled && createBtn.getAttribute('aria-disabled') !== 'true') {
        _wdLastSubmit = Date.now(); _wdActions++;
        LOG(`Workday: submitting Create Account (action ${_wdActions}/${WD_MAX_ACTIONS}; pw ${pw.length} chars)`);
        clickEl(createBtn);
        /* Record it NOW, not only if the watcher later happens to see the
           My Information page. The run frequently navigates on before that
           selector appears, and the account was then never written down — so the
           next job at this employer created a second one. Recording optimistically
           is safe: the worst case is that Sign In is tried first next time, which
           is the correct order once an account exists, and a wrong-credentials
           error flips it straight back to Create Account. */
        await markAccountCreated(location.hostname);
      }
      return 'working';
    }
    if (onSignIn) {
      if (!signInBtn.disabled && signInBtn.getAttribute('aria-disabled') !== 'true') {
        _wdLastSubmit = Date.now(); _wdActions++;
        LOG(`Workday: signing in with saved credentials (action ${_wdActions}/${WD_MAX_ACTIONS})`);
        clickEl(signInBtn);
        await markAccountCreated(location.hostname);   // an account we can sign into exists
      }
      return 'working';
    }
    return 'working';
  }

  // ===================== STANDALONE WORKDAY CREATE-ACCOUNT WATCHER =====================
  // Runs on ANY Workday tab (not just the bulk queue). Jobright's native autofill
  // pauses at the Create Account step asking you to "Set a password to continue"
  // because that password lives in Jobright's own store. This watcher fills the
  // actual Workday Email/Password/Verify fields with the saved ATS credentials and
  // submits — so account creation passes whether or not you've set a Jobright
  // sign-up password, and whether or not the bulk queue is running. It only TYPES
  // into the Workday DOM; it never writes to Jobright's storage, so the native
  // Sign-up password save is unaffected.
  let _wdWatchStarted = false;
  function startWorkdayAccountWatch() {
    if (_wdWatchStarted || !isWorkday()) return;
    _wdWatchStarted = true;
    LOG('Workday account watcher armed for', location.hostname);
    let ticks = 0;
    let busy = false;
    const iv = setInterval(async () => {
      if (busy) return;
      // Respect the Fully Automated toggle — if it's switched OFF, pause (don't act),
      // but keep the interval alive so flipping it back ON resumes without a reload.
      if (!autoApply && !(qActive && isRunnerTab())) return;
      ticks++;
      if (ticks > 160) { clearInterval(iv); LOG('Workday account watcher: stopped (timeout)'); return; } // ~240s — multi-step create→signin needs headroom
      try {
        const pwFields = (typeof $$ === 'function' ? $$('input[type=password]').filter(isVisible) : []);
        // Stop once we're past the account step (My Information / apply flow page shown).
        if (document.querySelector("[data-automation-id='applyFlowMyInfoPage'],[data-automation-id='contactInformationPage'],[data-automation-id='quickApplyPage'],[data-automation-id='applyFlowAutoFillPage']")) {
          markAccountCreated(location.hostname); // confirmed: this tenant now has an account
          clearInterval(iv); LOG('Workday account watcher: account step passed ✓'); return;
        }
        if (!pwFields.length) return; // not on a create-account / sign-in page yet
        // Defend the fields + make a BOUNDED set of submit attempts. fillWorkdayCreateAccount
        // returns 'stop' once it has exhausted Create-Account/Sign-In attempts, so we don't
        // hammer the form (the old code spam-clicked ~30×, bouncing between the two forms).
        busy = true;
        const btn = document.querySelector('button[data-automation-id="createAccountSubmitButton"],button[data-automation-id="signInSubmitButton"]');
        const matchCnt = await (async () => { try { const pw = await getAppPassword(); return pwFields.filter(f => f.value === pw).length; } catch (_) { return 0; } })();
        LOG(`Workday account: pw fields=${pwFields.length}, filled=${pwFields.filter(f => f.value).length}, matchSaved=${matchCnt}, submitBtn=${btn ? (btn.disabled ? 'disabled' : 'enabled') : 'none'}`);
        const res = await fillWorkdayCreateAccount(true);
        if (res === 'stop') { clearInterval(iv); LOG('Workday account watcher: stopped (attempts exhausted — manual Sign In may be needed).'); return; }
      } catch (e) { LOG('Workday account watcher error:', e?.message || e); }
      finally { busy = false; }
    }, 1500);
  }

  // Are we on the page for the currently-applying job? Match the queued URL, OR
  // clicking "Apply" often navigates us to an external ATS form whose URL differs
  // from the imported listing URL. Without this the queue would skip mid-apply.
  function onCurrentJobPage(c) {
    // Segment-wise URL match (tolerates apply→thanks redirects, rejects different job ids).
    try { if (urlsRoughlyMatch(location.href, c.url)) return true; } catch (_) {}
    try {
      const p = new URL(c.url).pathname;
      if (location.href.includes(p.slice(0, Math.min(p.length, 25)))) return true;
    } catch (_) {}
    try { if (new URL(c.url).hostname === location.hostname) return true; } catch (_) {}
    return hasApplicationForm() || hasApplyButton();
  }

  // ===== MANAGER MODE (OptimHire-style orchestration) =====
  // The docked Queue Manager page (ua-queue.html — openable as a tab or Chrome side
  // panel) opens each job in its own BACKGROUND tab. Here, the content script in that
  // tab recognizes it's manager-driven, applies with the same verified flow as the
  // single-tab runner, then reports a terminal status; the manager closes this tab and
  // opens the next. window.name carries the job id across cross-origin redirects.
  const MGR_PREFIX = 'UA_MJOB:';
  function managedIdFromTab() {
    try { if (typeof window.name === 'string' && window.name.indexOf(MGR_PREFIX) === 0) return window.name.slice(MGR_PREFIX.length); } catch (_) {}
    return '';
  }
  async function findManagedJob() {
    try {
      if ((await st.get('ua_mgr_active')) !== true) return null;
      if (isRunnerTab()) return null; // the old runner owns its tab
      const tagId = managedIdFromTab();
      if (tagId) return queue.find(j => j.id === tagId && j.status === 'applying') || null;
      const here = normalizeUrl(location.href);
      const j = queue.find(x => x.status === 'applying'
        && (normalizeUrl(x.url) === here || urlsRoughlyMatch(x.url, location.href)));
      if (j) { try { window.name = MGR_PREFIX + j.id; } catch (_) {} }
      return j || null;
    } catch (_) { return null; }
  }
  /* Is there anything on this page we can actually apply through? Probed over
     several rounds rather than once, because a queued URL typically lands on a
     Jobright/aggregator page that redirects to the real ATS, or on an SPA that
     renders its form after first paint. Rounds where the document is still
     loading, or where the URL just changed, don't count against the budget. */
  async function probeApplyTarget(tries, gapMs) {
    const gap = gapMs || 3000;
    let budget = tries || 4;
    let lastHref = location.href;
    // Hard wall-clock bound so a page that never finishes loading, or an SPA that
    // rewrites its URL on a timer, can't hold a job tab open indefinitely.
    const deadline = Date.now() + Math.min(60000, (tries || 4) * gap * 3);
    while (budget > 0 && Date.now() < deadline) {
      // Waiting for a page to load or redirect is the page being slow, not the
      // job being stuck — don't let the stall watchdog count it against us.
      if (document.readyState !== 'complete') noteProgress('waiting for the page');
      if (document.readyState === 'complete') {
        try { await openApplicationForm(); } catch (_) {}
        if (hasApplicationForm() || hasApplyButton() || detectATS() || isWorkday() || findApplyManually() || checkSuccess()) return true;
        budget--;
      }
      await sleep(gap);
      if (location.href !== lastHref) { lastHref = location.href; budget = tries || 4; noteProgress('page navigated'); }
    }
    return false;
  }

  /* ── TRIAGE: GIVE UP FAST ON A JOB THAT CANNOT BE WON ──────────────────────
     A 544-job run reported 2 applied, 1 skipped, 13 FAILED. Most of those 13
     could never have succeeded — a sign-in wall behind a reCAPTCHA, a posting
     that has closed — and each one burned the CAPTCHA grace (1 min) and then the
     per-job cap (3 min) before being written off. Thirteen jobs × up to four
     minutes is the better part of an hour spent on nothing.

     Recognising them in seconds is worth more to a bulk run than any raw speed
     increase, and it turns a misleading "failed" into an honest "skipped" with a
     reason you can act on. */
  const CLOSED_POSTING_RE = /no longer (accepting|available|open|active)|position (has been )?(closed|filled)|this (job|posting|requisition|vacancy) (is|has been) (closed|filled|removed|expired)|applications? (are )?closed|expired|nicht mehr verf[üu]gbar|stelle (ist )?besetzt|offre (est )?(clos|pourvue)|ya no est[áa] disponible|niet meer beschikbaar/i;

  /* A CAPTCHA on the APPLICATION is a human wait — you can solve it and the job
     continues. A CAPTCHA on the SIGN-IN wall is different: the account step has
     to be completed before anything can be filled, so an unattended run is
     finished here regardless of how long it waits. */
  function captchaBlocksSignIn() {
    try {
      if (!detectCaptcha()) return false;
      return looksLikeAuthPage() || authPasswordFields().length > 0;
    } catch (_) { return false; }
  }

  /* A reason string when this job is definitively unwinnable right now, else ''. */
  function unwinnableReason() {
    try {
      let copy = '';
      try { copy = (document.body && document.body.innerText || '').slice(0, 4000); } catch (_) {}
      if (CLOSED_POSTING_RE.test(copy) && !hasApplicationForm()) return 'The posting has closed';
      if (captchaBlocksSignIn()) {
        const c = detectCaptcha();
        return `Sign-in is behind a ${(c && c.provider) || 'CAPTCHA'} — an account is needed before applying`;
      }
    } catch (_) {}
    return '';
  }

  async function processManagedJob(c) {
    LOG(`Manager mode: driving "${c.title || c.url}"`);
    _mgrDriving = true;                          // so the speed selector applies here too
    // Native confirm/alert would block this tab's JS thread outright, so the
    // MAIN-world hooks answer them for the lifetime of this job (and only then).
    setAutomationFlag(true);
    noteProgress('job started');
    let finalized = false, tId = null, stallIv = null, beatIv = null;
    const finalize = async (status, error) => {
      if (finalized) return; finalized = true;
      clearTimeout(tId);
      _mgrDriving = false;
      setAutomationFlag(false);
      // Every outcome is recorded, not only the bad ones — a failure count means
      // nothing without the number of jobs the same ATS got through.
      DIAG('job.' + status, error || '', { detail: { ms: Date.now() - (c.startedAt || Date.now()) } });
      const patch = { status, error: error || null, completedAt: Date.now(), duration: Date.now() - (c.startedAt || Date.now()) };
      Object.assign(c, patch);
      // Fresh read-modify-write on ua_q: parallel job tabs each hold their own copy of
      // the array, so writing the whole local copy would clobber sibling results.
      try {
        const q = (await st.get(SK.Q)) || [];
        const j = q.find(x => x.id === c.id);
        if (j) Object.assign(j, patch);
        await st.set(SK.Q, q);
      } catch (_) {}
      if (status === 'done' || status === 'failed') {
        try { await recordApplication(c.url, c.title, status === 'done' ? 'applied' : 'failed', c.jobBoard, patch.duration); } catch (_) {}
      }
      try { await learnFromPage(); } catch (_) {}
      // Report over BOTH channels with the same timestamp. The runtime message
      // reaches the service worker instantly (and wakes it if it was idle); the
      // storage write is the fallback for the case where the worker is mid-restart
      // and the message is dropped. The orchestrator de-duplicates on (id, ts), so
      // whichever arrives second is a no-op.
      clearInterval(stallIv); clearInterval(beatIv);
      const ts = Date.now();
      try { chrome.runtime.sendMessage({ type: 'UA_JOB_RESULT', id: c.id, status, error: error || null, ts }, () => void chrome.runtime.lastError); } catch (_) {}
      await st.set('ua_mgr_advance', { id: c.id, status, ts });
      LOG(`Manager mode: job ${status} — manager will close this tab`);
    };
    const onTimeout = async () => {
      if (finalized) return;
      if (detectCaptcha()) { showCaptchaBanner(detectCaptcha()?.provider); tId = setTimeout(onTimeout, 60000); return; }
      await finalize('timeout', `Timed out after ${qTimeout / 1000}s`);
    };
    tId = setTimeout(onTimeout, qTimeout);

    /* Give up on a job that is going NOWHERE, rather than waiting out the full
       per-job cap. A page stuck on a spinner, a redirect loop, or a form that
       will not accept anything costs ~75s now instead of six minutes, and the
       slot is handed straight to the next job. A CAPTCHA is a human wait, not a
       stall, so it is exempt. */
    stallIv = setInterval(() => {
      if (finalized) return;
      pollPageProgress();
      // Actively filling, uploading, submitting or verifying: the countdown does
      // not run at all, so a slow-but-working step is never interrupted.
      if (isBusy()) { noteProgress(_busyWhat); return; }
      if (detectCaptcha()) { noteProgress('waiting for captcha'); return; }
      if (!isStalled()) return;
      const secs = Math.round(stalledFor() / 1000);
      LOG(`Job stalled — no progress for ${secs}s (last: ${_lastProgressWhat}) — skipping to keep the queue moving`);
      finalize('timeout', `Stalled — no progress for ${secs}s (last activity: ${_lastProgressWhat})`);
    }, 3000);

    /* Heartbeat. Without it, a tab whose content script died (crash, or a
       navigation into a page we were not injected on) looked identical to one
       working hard, and held its slot until the manager's watchdog fired. */
    const beat = () => {
      if (finalized) return;
      let pct = null;
      try { pct = fillReport().pct; } catch (_) {}
      try {
        chrome.runtime.sendMessage({
          type: 'UA_JOB_PROGRESS', id: c.id, stage: _lastProgressWhat,
          idleMs: stalledFor(), pct,
        }, () => void chrome.runtime.lastError);
      } catch (_) {}
    };
    beat();   // straight away: a page that just reloaded should not look silent
    beatIv = setInterval(() => {
      if (finalized) return;
      let pct = null;
      try { pct = fillReport().pct; } catch (_) {}
      try {
        chrome.runtime.sendMessage({
          type: 'UA_JOB_PROGRESS', id: c.id, stage: _lastProgressWhat,
          idleMs: stalledFor(), pct,
        }, () => void chrome.runtime.lastError);
      } catch (_) {}
    }, 5000);

    try {
      if (qSkipApplied && alreadyApplied(c.url)) return void await finalize('skipped', 'Already applied');
      await openApplicationForm();
      await handleAccountAuth();
      /* Triage before the waits. A sign-in wall behind a CAPTCHA, or a posting
         that has closed, cannot be completed however long we sit here — skip in
         seconds with the reason rather than burning the CAPTCHA grace and then
         the per-job cap on it. */
      {
        const dead = unwinnableReason();
        if (dead) { LOG('Skipping fast: ' + dead); return void await finalize('skipped', dead); }
      }
      if (detectCaptcha()) await waitForCaptchaClear();
      // The wait may have ended because a human solved it — or because the wall
      // is still there. Re-check rather than pressing on into a form we cannot reach.
      {
        const dead = unwinnableReason();
        if (dead) { LOG('Skipping after the wait: ' + dead); return void await finalize('skipped', dead); }
      }
      // A false "no application form" is the worst outcome in a bulk run: the job is
      // dropped silently and never retried. The old two-shot check fired while the tab
      // was still on the Jobright landing page or mid-redirect to the ATS, so real jobs
      // were skipped. Probe repeatedly instead, and abandon this pass entirely if the
      // page navigates — the content script on the next page picks the job back up.
      if (!(await probeApplyTarget(5, 4000))) {
        if (finalized) return;
        /* Two very different outcomes were being reported identically, and
           "skipped" hid the one that matters.

           If there is no form, no Apply button and no recognised ATS, the URL is
           simply not an application — skipping it is right and there is nothing
           to act on. But if an Apply button IS sitting there and we could not get
           through it, the job was applicable and we failed at it. Calling that
           "skipped" buries a real failure in the column people ignore. */
        const openable = hasApplyButton() || !!findApplyManually();
        if (openable) {
          LOG('An Apply control is present but the form never opened — reporting this as a failure, not a skip');
          return void await finalize('failed', 'Could not open the application form (Apply was present but led nowhere)');
        }
        return void await finalize('skipped', 'Not an application page — no form, no Apply button, no known ATS');
      }
      if (pageHasFailure()) return void await finalize('skipped', 'Already applied / posting closed');
      clearSubmitAttempt();   // this job has not submitted anything yet

      /* ── ONE PASS, THEN ONE CHEAP RETRY ────────────────────────────────────
         This used to stack four layers of repetition on top of each other, and
         that is what "a lot of refiring of the autofill" looks like from the
         outside:

           attempt loop (×2)
             └ withRetry(…, 2)        → up to 3 more dispatches if one threw
                 └ dispatchATSAutomation
                     ├ the per-ATS driver  (its own step loop)
                     └ multiPageLoop       (up to 18 pages, 2 fills each)
             └ retry pass               → fill again, and multiPageLoop AGAIN

         Worst case that is six full drives of the same form. The per-step fill
         budget capped the damage but could not stop the structure.

         Now: the driver runs ONCE. withRetry gets no retries of its own,
         because the attempt loop below already is the retry, and the retry pass
         does not re-enter multiPageLoop — the driver it follows has already
         walked every page there was. */
      let success = false, validationStuck = false;
      for (let attempt = 0; attempt < 2 && !success && !finalized; attempt++) {
        if (attempt === 0) {
          await withRetry(async () => { await dispatchATSAutomation(); }, 'Manager job automation', 0);
        } else {
          /* Second and final attempt: top up whatever is still empty and press
             the button again. No driver, no page walk — if the first pass could
             not find the form, running the identical code a second time will not
             find it either, it will just cost another minute. */
          LOG('Second pass: completing anything still outstanding and re-submitting');
          try {
            await openApplicationForm();
            await waitForFormStable(2500);
            await fallbackFill();
            await guaranteeRequiredFields();
            await handleValidationErrors();
            await autoSubmitOrNext();
          } catch (e) { LOG('Second pass error:', e?.message || e); }
        }
        await withBusy('verifying submission', async () => {
          for (let check = 0; check < 6 && !finalized; check++) {
            await sleep(1500);
            if (detectCaptcha()) { await waitForCaptchaClear(); continue; }
            if (confirmSubmitted()) { success = true; break; }
            if (pageHasFailure()) break;
            // A form still sitting there with an unfixed complaint will not become
            // submitted by waiting — stop the clock and let the retry act on it.
            if (check >= 2 && pageHasValidationError()) { validationStuck = true; break; }
          }
        });
        if (success || finalized) break;
        // A validation error on the FIRST pass is worth one more attempt; on the
        // second it is the answer.
        if (validationStuck && attempt > 0) break;
        validationStuck = false;
      }
      if (finalized) return;
      if (success) await finalize('done', null);
      else await finalize('failed', submitFailureReason(validationStuck));
    } catch (e) {
      if (!finalized) await finalize('failed', e?.message || String(e));
    }
  }

  // The manager (side panel) tells THIS tab exactly which job it owns — robust across
  // the Jobright→ATS→apply-page redirects that made URL-guessing fail. Fires on every
  // completed navigation in the tab, so the content script on the FINAL apply page is
  // the one that runs. A per-job guard makes double-delivery a no-op.
  let _mgrHandledJobId = null;
  /* Run-wide options the orchestrator owns (the panel writes them, the worker
     hands them to each tab). Applied here so every job tab in a run behaves
     identically no matter which page it booted on. */
  function applyManagerSettings(s) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.skipApplied === 'boolean') qSkipApplied = s.skipApplied;
    if (typeof s.tailor === 'boolean') queueUseTailor = s.tailor;
    if (s.stallMs) _stallLimitMs = Math.max(5000, s.stallMs);
    if (s.jobTimeoutMs) {
      // Stay comfortably inside the worker's hard cap so THIS tab reports a real
      // status before the watchdog kills it — a watchdog timeout tells you nothing
      // about why the job failed.
      qTimeout = Math.max(60000, Math.min(150000, s.jobTimeoutMs - 45000));
    }
  }
  async function runManagedAssignment(job, settings) {
    if (!job || !job.id) return;
    if (_mgrHandledJobId === job.id) return;
    _mgrHandledJobId = job.id;
    // Tag the tab so a later navigation in the SAME tab can recover the job id
    // locally, without another round-trip to the worker.
    try { window.name = MGR_PREFIX + job.id; } catch (_) {}
    LOG(`Manager assigned this tab to "${job.title || job.url}"`);
    // On an odd redirect init() may have bailed before loading these — ensure they're ready.
    try { await load(); } catch (_) {}
    try {
      await loadAnswerBank(); await loadSavedResponses(); await loadAppHistory();
      await loadResumes(); await loadCustomDefaults(); await loadRateLimitDelay();
    } catch (_) {}
    applyManagerSettings(settings);
    try { injectCSS(); } catch (_) {}
    await processManagedJob(job);
  }

  /* PULL-based assignment. Pushes from the worker can all land before this
     content script boots (common on a fast ATS page reached through two
     redirects), which used to leave the tab idle until the 6-minute watchdog
     killed the job. Asking "which job am I?" by tab id removes that race
     entirely — the worker answers from its own tab map, so it is correct no
     matter how many times the page redirected on the way here. */
  async function askManagerForJob() {
    if (window.self !== window.top) return null;
    if (isRunnerTab()) return null;                        // the in-page runner owns its tab
    return await new Promise((res) => {
      try {
        chrome.runtime.sendMessage({ type: 'UA_MGR_WHOAMI' }, (r) => { void chrome.runtime.lastError; res(r && r.job ? r : null); });
      } catch (_) { res(null); }
    });
  }
  /* Late-boot safety net: ask again a few seconds in, for the case where the
     worker was asleep on the first ask and had not yet restored its tab map. */
  async function pullManagedAssignment() {
    const resp = await askManagerForJob();
    if (!resp || _mgrHandledJobId === resp.job.id) return !!resp;
    runManagedAssignment(resp.job, resp.settings);
    return true;
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /* "Is this tab still running JavaScript?" A page held by a native dialog
       cannot answer, and that silence is what the worker's runner watchdog acts
       on — so this must stay trivial and synchronous. Anything that could block
       would make a healthy tab look frozen. */
    if (msg && msg.type === 'UA_RUNNER_PING') {
      try { sendResponse({ alive: true }); } catch (_) {}
      return false;
    }
    if (msg && msg.type === 'UA_ASSIGN_JOB' && msg.job) {
      if (window.self === window.top && !isRunnerTab()) runManagedAssignment(msg.job, msg.settings);
      // Respond synchronously — returning true without ever calling sendResponse
      // leaves the worker's callback hanging until the port closes, which is what
      // made assignment retries look like failures.
      try { sendResponse({ ok: true }); } catch (_) {}
      return false;
    }
  });

  async function processQ() {
    if (!qActive || qPaused || !queue.length) return;
    // Only the dedicated runner tab drives the queue — never hijack other tabs.
    // But a wiped window.name is not evidence that this is someone else's tab:
    // ask the service worker before standing down, or a cross-site job ends the
    // run for good.
    if (!isRunnerTab() && !(await confirmRunnerTab())) return;
    setAutomationFlag(true);
    const c = queue.find(j => j.status === 'applying');
    if (c) {
      try {
        if (onCurrentJobPage(c)) {
          // LazyApply: start timeout timer — auto-skip if job stalls
          clearTimeout(_qTimeoutId);
          const onJobTimeout = async () => {
            // Guard: if the main flow already finalized this job (done/failed/skipped)
            // in the meantime, do nothing — otherwise the timeout would also call
            // goNext(), double-advancing and silently SKIPPING the next queued job.
            if (c.status !== 'applying') return;
            // A visible captcha is a HUMAN wait, not a stuck page — extend instead of
            // skipping so the job isn't thrown away while the user solves it.
            if (detectCaptcha()) {
              LOG('Queue: captcha visible at timeout — extending 60s for manual solve');
              showCaptchaBanner(detectCaptcha()?.provider);
              _qTimeoutId = setTimeout(onJobTimeout, 60000);
              return;
            }
            LOG(`Queue: job timed out after ${qTimeout / 1000}s — auto-skipping`);
            c.status = 'timeout';
            c.error = `Timed out after ${qTimeout / 1000}s`;
            c.completedAt = Date.now();
            qStats.timedOut++;
            await saveQ(); await saveStats();
            renderQ(); updateCtrl();
            goNext();
          };
          _qTimeoutId = setTimeout(onJobTimeout, qTimeout);

          // LazyApply-style: never re-apply to a job already applied to before.
          if (qSkipApplied && alreadyApplied(c.url)) {
            LOG('Already applied previously — skipping');
            clearTimeout(_qTimeoutId);
            c.status = 'skipped'; c.error = 'Already applied'; c.completedAt = Date.now();
            qStats.skipped++;
            await saveQ(); await saveStats(); renderQ(); updateCtrl();
            await sleep(400);
            goNext();
            return;
          }

          // FAST VALIDITY GATE (LazyApply-style): if this URL has no application
          // form, no Apply button, isn't a known ATS, and isn't already a success
          // page, skip it quickly instead of burning minutes on retries.
          await openApplicationForm();
          await handleAccountAuth();
          // Captcha gate: pause here (not skip) until the user solves it — sign-in and
          // apply pages are the most common places one appears.
          if (detectCaptcha()) await waitForCaptchaClear();
          // Same multi-round probe the manager path uses: a single check fired while
          // the page was still redirecting and threw away perfectly good jobs.
          if (!(await probeApplyTarget(5, 4000))) {
            LOG('No application form / Apply found — skipping as invalid job');
            clearTimeout(_qTimeoutId);
            if (c.status !== 'applying') return;
            c.status = 'skipped'; c.error = 'No application form found'; c.completedAt = Date.now();
            qStats.skipped++;
            await saveQ(); await saveStats(); renderQ(); updateCtrl();
            await sleep(600);
            goNext();
            return;
          }

          // Already applied / posting closed → skip fast (don't burn retries).
          if (pageHasFailure()) {
            LOG('Failure signal (already-applied / closed) — skipping');
            clearTimeout(_qTimeoutId);
            c.status = 'skipped'; c.error = 'Already applied / posting closed'; c.completedAt = Date.now();
            qStats.skipped++;
            await saveQ(); await saveStats(); renderQ(); updateCtrl();
            await sleep(500); goNext(); return;
          }

          // Drive the application to a CONFIRMED submission before moving on.
          // Each job must be fully autofilled AND submitted before the queue advances.
          // Verification uses OptimHire-style signals: an explicit success page/text, OR
          // a submit-click followed by an 8s grace window with no validation error. A
          // persistent validation error fast-fails instead of waiting the whole timeout.
          clearSubmitAttempt(); // no submit evidence carried over from the previous job
          let success = false, validationStuck = false;
          for (let attempt = 0; attempt < 2 && !success; attempt++) {
            await withRetry(async () => { await dispatchATSAutomation(); }, 'Queue job automation');
            // Verify submission (poll for a confirmation signal).
            await withBusy('verifying submission', async () => {
            for (let check = 0; check < 6; check++) {
              await sleep(2000);
              // A captcha popping up post-submit blocks confirmation — wait it out.
              if (detectCaptcha()) { await waitForCaptchaClear(); continue; }
              if (confirmSubmitted()) { success = true; break; }
              if (pageHasFailure()) { LOG('Failure signal during verify — stopping'); break; }
            }
            });
            if (success) break;
            // Not confirmed — fill any remaining gaps and force another submit.
            LOG(`Submission not confirmed (attempt ${attempt + 1}/2) — retrying fill + submit`);
            try {
              await openApplicationForm();
              await waitForFormStable(2500);
              await fallbackFill();
              await guaranteeRequiredFields();
              const r = await autoSubmitOrNext();
              if (r === 'next_page') { await sleep(2500); await multiPageLoop(); }
            } catch (e) { LOG('Retry pass error:', e?.message || e); }
            await withBusy('verifying submission', async () => {
              for (let check = 0; check < 5; check++) {
                await sleep(2000);
                if (confirmSubmitted()) { success = true; break; }
                // Validation error that persists across the whole poll → the form can't be
                // satisfied automatically; stop retrying and mark failed.
                if (check >= 3 && pageHasValidationError() && !success) { validationStuck = true; break; }
              }
            });
            if (validationStuck) break;
          }

          // Clear timeout — job finished (confirmed or exhausted retries)
          clearTimeout(_qTimeoutId);

          // Guard: if the per-job timeout already fired and finalized this job while the
          // fill/verify loop above was still running, don't finalize + goNext() again.
          if (c.status !== 'applying') { return; }

          c.completedAt = Date.now();
          c.duration = c.completedAt - (c.startedAt || c.completedAt);
          if (success) {
            c.status = 'done';
            qStats.completed++;
            LOG('Queue job: submission CONFIRMED');
            await recordApplication(c.url, c.title, 'applied', c.jobBoard, c.duration);
          } else {
            // Could not confirm submission — mark failed (not a false "done") so the
            // user can see it didn't complete, and don't silently skip it as applied.
            c.status = 'failed';
            c.error = submitFailureReason(validationStuck);
            qStats.failed++;
            LOG('Queue job: submission NOT confirmed' + (validationStuck ? ' (validation stuck)' : '') + ' — marked failed');
            await recordApplication(c.url, c.title, 'failed', c.jobBoard, c.duration);
          }
          qStats.totalTime += c.duration;

          await learnFromPage();
          await saveQ(); await saveStats(); renderQ(); updateCtrl();
          await sleep(2000);
          goNext();
          return;
        }
      } catch (err) {
        clearTimeout(_qTimeoutId);
        c.status = 'failed';
        c.error = err?.message || 'Unknown error';
        c.completedAt = Date.now();
        qStats.failed++;
        await saveQ(); await saveStats(); renderQ(); updateCtrl();
        goNext();
        return;
      }
    }
    goNext();
  }

  function goNext() {
    if (qPaused) return;
    // Drop anything that isn't a real web URL before it can reach location.href.
    for (const j of queue) {
      if (j.status === 'pending' && !isSafeJobUrl(j.url)) {
        j.status = 'skipped'; j.error = 'Unsupported URL scheme'; j.completedAt = Date.now();
      }
    }
    const n = queue.find(j => j.status === 'pending');
    if (n) {
      n.status = 'applying';
      n.startedAt = Date.now();
      // LazyApply: save stoppedAt index for session resumption
      const idx = queue.indexOf(n);
      st.set('ua_q_stopped_at', idx);
      saveQ().then(() => {
        // Inter-job delay scales with speed (no hidden 3s floor unless the user
        // explicitly enabled rate limiting).
        const delay = Math.max(_rateLimitDelay || 0, QUEUE_DELAYS[qSpeed] || 1500);
        setTimeout(() => { location.href = n.url; }, delay);
      });
    } else {
      qActive = false;
      st.set(SK.QA, false);
      st.set('ua_q_stopped_at', -1);
      unmarkRunnerTab(); // free this tab — run finished
      setAutomationFlag(false); // native dialogs behave normally again
      // LazyApply-style: completion summary
      LOG('Queue complete — all jobs processed');
      const done = queue.filter(j => j.status === 'done').length;
      const failed = queue.filter(j => j.status === 'failed').length;
      const timedOut = queue.filter(j => j.status === 'timeout').length;
      const skipped = queue.filter(j => j.status === 'skipped').length;
      LOG(`Results: ${done} done, ${failed} failed, ${timedOut} timed out, ${skipped} skipped of ${queue.length} total`);
      if (qStats.totalTime > 0) LOG(`Average time: ${Math.round(qStats.totalTime / Math.max(done, 1) / 1000)}s per application`);
      // Browser notification
      st.get('ua_notif_enabled').then(enabled => {
        if (enabled) sendNotification('Queue Complete!', `${done} applied, ${failed} failed, ${skipped} skipped of ${queue.length} total`);
      });
      renderQ(); updateCtrl(); showCompletionSummary();
    }
  }

  async function startQ() {
    const pending = queue.filter(j => j.status === 'pending');
    if (!pending.length) return;
    qActive = true; qPaused = false;
    markRunnerTab(); // this tab becomes the dedicated automation tab
    qStats = { completed: 0, failed: 0, skipped: 0, timedOut: 0, totalTime: 0 };
    await st.set(SK.QA, true); await st.set(SK.QP, false); await saveStats();
    updateCtrl(); goNext();
  }
  // LazyApply: resume from where we stopped (session resumption)
  async function resumeFromStopped() {
    if (qStoppedAt < 0 || qStoppedAt >= queue.length) return false;
    // Reset jobs from stoppedAt onwards to pending
    for (let i = qStoppedAt; i < queue.length; i++) {
      if (queue[i].status === 'applying' || queue[i].status === 'timeout') queue[i].status = 'pending';
    }
    qActive = true; qPaused = false;
    markRunnerTab();
    await st.set(SK.QA, true); await st.set(SK.QP, false);
    await saveQ(); updateCtrl(); goNext();
    LOG(`Resumed queue from job #${qStoppedAt + 1}`);
    return true;
  }
  async function stopQ() {
    clearTimeout(_qTimeoutId);
    qActive = false; qPaused = false;
    unmarkRunnerTab();
    setAutomationFlag(false);
    await st.set(SK.QA, false); await st.set(SK.QP, false);
    // LazyApply: save stop point for session resumption
    const applyingIdx = queue.findIndex(j => j.status === 'applying');
    if (applyingIdx >= 0) { queue[applyingIdx].status = 'pending'; st.set('ua_q_stopped_at', applyingIdx); }
    await saveQ(); renderQ(); updateCtrl();
  }
  async function pauseQ() { qPaused = true; await st.set(SK.QP, true); renderQ(); updateCtrl(); }
  async function resumeQ() { qPaused = false; await st.set(SK.QP, false); processQ().catch(e => LOG('processQ error:', e)); renderQ(); updateCtrl(); }
  async function skipJob() {
    clearTimeout(_qTimeoutId);
    const c = queue.find(j => j.status === 'applying');
    if (c) { c.status = 'skipped'; c.error = 'Skipped by user'; c.completedAt = Date.now(); qStats.skipped++; await saveQ(); await saveStats(); }
    goNext();
  }

  // LazyApply: detect job board from URL for analytics
  function detectJobBoard(url) {
    try {
      const u = new URL(url);
      const h = u.hostname;
      if (/myworkday/i.test(h)) return 'workday';
      if (/greenhouse/i.test(h)) return 'greenhouse';
      if (/lever\.co/i.test(h)) return 'lever';
      if (/icims/i.test(h)) return 'icims';
      if (/linkedin/i.test(h)) return 'linkedin';
      if (/indeed/i.test(h)) return 'indeed';
      if (/glassdoor/i.test(h)) return 'glassdoor';
      if (/ziprecruiter/i.test(h)) return 'ziprecruiter';
      if (/dice/i.test(h)) return 'dice';
      if (/ashby/i.test(h)) return 'ashby';
      if (/bamboohr/i.test(h)) return 'bamboohr';
      if (/smartrecruiters/i.test(h)) return 'smartrecruiters';
      if (/wellfound/i.test(h)) return 'wellfound';
      if (/rippling/i.test(h)) return 'rippling';
      return 'other';
    } catch { return 'other'; }
  }

  // LazyApply-inspired: bulk URL import from text (supports various formats)
  function parseBulkUrls(text) {
    const urls = [];
    // Split by lines, commas, tabs, semicolons and pipes so a pasted spreadsheet
    // row works as well as a plain list.
    const tokens = String(text || '').replace(/^﻿/, '').split(/[\r\n,\t;|]+/).map(s => s.trim()).filter(Boolean);
    for (const token of tokens) {
      // Skip header cells (but never a cell that IS a link — "link.example.com/…").
      if (!/^https?:\/\//i.test(token) && /^(url|link|job|title|company|status|date|source)\b/i.test(token)) continue;
      const urlMatch = token.match(/https?:\/\/[^\s,"'<>]+/i);
      const candidate = urlMatch ? urlMatch[0] : token;
      // normalizeUrl rejects anything that isn't http(s) and strips trailing junk.
      const clean = normalizeUrl(candidate);
      if (clean && isSafeJobUrl(clean) && !urls.includes(clean)) urls.push(clean);
    }
    return urls;
  }

  // LazyApply-inspired: form analysis (check how many fields are on current page)
  function analyzeCurrentForm() {
    const fields = deepAll('input:not([type=hidden]):not([type=file]):not([type=submit]),textarea,select').filter(isVisible);
    const filled = fields.filter(hasFieldValue).length;
    const required = fields.filter(isFieldRequired).length;
    const requiredFilled = fields.filter(f => isFieldRequired(f) && hasFieldValue(f)).length;
    return { total: fields.length, filled, unfilled: fields.length - filled, required, requiredFilled, requiredUnfilled: required - requiredFilled };
  }

  // ===================== APPLICATION HISTORY TRACKING =====================
  let _appHistory = [];
  let _appHistoryLoaded = false;

  async function loadAppHistory() {
    if (_appHistoryLoaded) return _appHistory;
    _appHistory = (await st.get('ua_app_history')) || [];
    _appHistoryLoaded = true;
    return _appHistory;
  }

  async function saveAppHistory() {
    await st.set('ua_app_history', _appHistory);
  }

  async function recordApplication(url, title, status, atsName, duration) {
    await loadAppHistory();
    _appHistory.unshift({
      url, title: title || shortUrl(url),
      status: status || 'applied',
      ats: atsName || detectATS() || 'Unknown',
      appliedAt: Date.now(),
      duration: duration || 0,
      company: extractCompanyFromUrl(url),
    });
    // Keep last 500 applications
    if (_appHistory.length > 500) _appHistory = _appHistory.slice(0, 500);
    await saveAppHistory();
    // On a CONFIRMED submission, queue a LinkedIn recruiter follow-up for this company/
    // role. The LinkedIn module (below) sends it when you land on a matching profile.
    if ((status || 'applied') === 'applied') {
      try {
        // Attach the insider contacts we captured from Jobright just before applying, so the
        // LinkedIn module aims at the exact recruiter / hiring manager Jobright surfaced.
        let contacts = [];
        const pend = await st.get('ua_pending_insiders');
        if (pend && Array.isArray(pend.contacts) && (Date.now() - (pend.ts || 0) < 30 * 60 * 1000)) {
          contacts = pend.contacts;
          await st.set('ua_pending_insiders', null); // consume once
        }
        await enqueueFollowUp(extractCompanyFromUrl(url), title || '', url, contacts);
      } catch (_) {}
    }
  }

  // ---- LinkedIn recruiter follow-up queue (consumed by the LinkedIn module) ----
  // A queue item can carry EXACT people to contact (captured from Jobright's "Insider
  // Connection" panel — Jobright is good at surfacing the right person), each with their
  // LinkedIn profile slug so the LinkedIn module messages that precise person, not a guess.
  async function enqueueFollowUp(company, role, url, contacts) {
    if (!company || company === 'Unknown') return;
    const q = (await st.get('ua_followup_queue')) || [];
    const key = (company + '|' + (role || '')).toLowerCase();
    const existing = q.find(f => (f.company + '|' + (f.role || '')).toLowerCase() === key);
    if (existing) {
      if (contacts && contacts.length) { // merge any newly-found insider contacts
        existing.contacts = existing.contacts || [];
        for (const c of contacts) if (c.profile && !existing.contacts.some(x => x.profile === c.profile)) existing.contacts.push(c);
        await st.set('ua_followup_queue', q);
      }
      return;
    }
    q.unshift({ company, role: role || '', url: url || '', ts: Date.now(), status: 'pending', contacts: contacts || [] });
    await st.set('ua_followup_queue', q.slice(0, 200));
    LOG(`Follow-up queued for ${company}${role ? ' — ' + role : ''}${contacts && contacts.length ? ' (' + contacts.length + ' insider contacts)' : ''}`);
  }

  // Classify a person's title/headline: who has the most say over an interview?
  //  3 = the actual hiring manager / decision maker for the role (VP/Director/Head/Lead/Manager
  //      of the relevant function, or literally "hiring manager").
  //  2 = a recruiter / talent-acquisition / people-team contact (owns the pipeline).
  //  1 = anyone else at the company (weak signal — last resort).
  // Higher wins, so the LinkedIn module messages the person who matters most first.
  function scoreContactRole(title) {
    const t = (title || '').toLowerCase();
    if (/hiring manager|\bhead of\b|\bvp\b|vice president|\bdirector\b|\bchief\b|\bcto\b|\bceo\b|\blead\b|\bmanager\b|\bprincipal\b|founder/.test(t)) return 3;
    if (/recruit|talent|sourcer|\bta\b|people|human resources|\bhr\b|staffing|acquisition/.test(t)) return 2;
    return 1;
  }

  // Scrape Jobright's "Insider Connection" panel for the specific people it surfaced.
  // Depends on the panel exposing linkedin.com/in/ profile links (the "in" button). If
  // Jobright renders those as JS-only buttons without hrefs we simply capture nothing and
  // fall back to company-based matching — never guesses a wrong person. Each captured
  // contact carries its title + a role score so we can aim at the recruiter / hiring
  // manager for THIS role (the people with a say on getting the interview) first.
  function captureInsiderConnections() {
    try {
      if (!isJobright()) return [];
      const links = (typeof window.__uaDeepQueryAll === 'function')
        ? window.__uaDeepQueryAll('a[href*="linkedin.com/in/"]')
        : [...document.querySelectorAll('a[href*="linkedin.com/in/"]')];
      const seen = new Set(), out = [];
      for (const a of links) {
        const m = (a.getAttribute('href') || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
        if (!m) continue;
        const slug = m[1].toLowerCase();
        if (seen.has(slug)) continue; seen.add(slug);
        // Name/title from the card around the link (best-effort).
        const card = a.closest('li,[class*="card"],[class*="connection"],[class*="item"],div') || a;
        const name = ((card.querySelector('[class*="name"],b,strong,h3,h4')?.textContent) || a.textContent || '').trim().slice(0, 60);
        // Title/headline sits near the name in the card; grab the fuller card text minus
        // the name so scoreContactRole can spot "Recruiter" / "Engineering Manager" etc.
        let title = (card.querySelector('[class*="title"],[class*="headline"],[class*="position"],[class*="role"],[class*="subtitle"]')?.textContent || '').trim();
        if (!title) { const ct = (card.textContent || '').replace(name, ' ').replace(/\s+/g, ' ').trim(); title = ct.slice(0, 120); }
        const score = scoreContactRole(title);
        out.push({ profile: slug, name, title: title.slice(0, 120), score, ts: Date.now() });
      }
      // Best contacts first: hiring managers, then recruiters, then everyone else.
      out.sort((a, b) => b.score - a.score);
      return out;
    } catch (_) { return []; }
  }

  // Capture the insiders on the CURRENT Jobright job page and stash them (with the job's
  // role) so recordApplication — which fires later on the ATS page — can attach them to the
  // follow-up queue item. Recency-matched: an application submitted shortly after viewing a
  // Jobright job belongs to the insiders we just saw.
  async function stashInsidersFromJobright(role) {
    try {
      if (!isJobright()) return;
      const contacts = captureInsiderConnections();
      if (!contacts.length) return;
      await st.set('ua_pending_insiders', { role: role || '', contacts, ts: Date.now() });
      LOG(`Captured ${contacts.length} insider contact(s) from Jobright (top: ${contacts[0].name || contacts[0].profile})`);
    } catch (_) {}
  }

  function extractCompanyFromUrl(url) {
    try {
      const h = new URL(url).hostname;
      // Extract company from ATS subdomain patterns
      const m = h.match(/([^.]+)\.(myworkdayjobs|greenhouse|lever|icims|smartrecruiters|jobvite|bamboohr|ashbyhq|workable|breezy)/);
      if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      // Fallback: second-level domain
      const parts = h.replace('www.', '').split('.');
      return parts[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } catch { return 'Unknown'; }
  }

  function getHistoryStats() {
    const now = Date.now();
    const today = _appHistory.filter(a => now - a.appliedAt < 86400000);
    const thisWeek = _appHistory.filter(a => now - a.appliedAt < 604800000);
    const thisMonth = _appHistory.filter(a => now - a.appliedAt < 2592000000);
    const atsCounts = {};
    _appHistory.forEach(a => { atsCounts[a.ats] = (atsCounts[a.ats] || 0) + 1; });
    const topAts = Object.entries(atsCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const companyCounts = {};
    _appHistory.forEach(a => { if (a.company) companyCounts[a.company] = (companyCounts[a.company] || 0) + 1; });
    const avgDuration = _appHistory.filter(a => a.duration > 0).reduce((s, a) => s + a.duration, 0) / Math.max(_appHistory.filter(a => a.duration > 0).length, 1);
    return {
      total: _appHistory.length,
      today: today.length,
      thisWeek: thisWeek.length,
      thisMonth: thisMonth.length,
      topAts,
      avgDuration: Math.round(avgDuration / 1000),
      companies: Object.keys(companyCounts).length,
    };
  }

  function exportAppHistory() {
    const header = 'URL,Title,Company,ATS,Status,Applied At,Duration (s)\n';
    const rows = _appHistory.map(a => {
      const url = (a.url || '').replace(/"/g, '""');
      const title = (a.title || '').replace(/"/g, '""');
      const company = (a.company || '').replace(/"/g, '""');
      const date = a.appliedAt ? new Date(a.appliedAt).toISOString() : '';
      return `"${url}","${title}","${company}","${a.ats || ''}","${a.status || ''}","${date}","${Math.round((a.duration || 0) / 1000)}"`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `application-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    LOG(`Exported ${_appHistory.length} application records`);
  }

  // ===================== RESUME MANAGER (Multi-Resume Support) =====================
  let _resumes = [];
  let _resumesLoaded = false;
  let _activeResumeIdx = 0;

  async function loadResumes() {
    if (_resumesLoaded) return _resumes;
    _resumes = (await st.get('ua_resumes')) || [];
    _activeResumeIdx = (await st.get('ua_active_resume')) || 0;
    _resumesLoaded = true;
    // Migrate old single resume
    const oldResume = await st.get('ua_resume_data');
    if (oldResume && !_resumes.length) {
      _resumes.push({ name: oldResume.fileName || 'Resume', base64: oldResume.base64, mimeType: oldResume.mimeType || 'application/pdf', fileName: oldResume.fileName, addedAt: Date.now() });
      await saveResumes();
    }
    return _resumes;
  }

  async function saveResumes() {
    await st.set('ua_resumes', _resumes);
    await st.set('ua_active_resume', _activeResumeIdx);
    // Also sync to ua_resume_data for backward compatibility
    if (_resumes[_activeResumeIdx]) {
      await st.set('ua_resume_data', _resumes[_activeResumeIdx]);
    }
  }

  function addResume(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        _resumes.push({
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          base64: reader.result,
          mimeType: file.type || 'application/pdf',
          size: file.size,
          addedAt: Date.now(),
        });
        _activeResumeIdx = _resumes.length - 1;
        await saveResumes();
        resolve(true);
      };
      reader.readAsDataURL(file);
    });
  }

  async function removeResume(idx) {
    _resumes.splice(idx, 1);
    if (_activeResumeIdx >= _resumes.length) _activeResumeIdx = Math.max(0, _resumes.length - 1);
    await saveResumes();
  }

  async function setActiveResume(idx) {
    _activeResumeIdx = idx;
    await saveResumes();
  }

  // ===================== PROFILE IMPORT/EXPORT =====================
  async function exportProfile() {
    const p = await getProfile();
    const data = JSON.stringify(p, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `profile-${new Date().toISOString().slice(0, 10)}.json`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    LOG('Profile exported');
  }

  async function importProfile(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid profile format');
      await st.set(SK.PROF, data);
      LOG('Profile imported successfully');
      return true;
    } catch (e) {
      LOG('Profile import error:', e.message);
      return false;
    }
  }

  // ===================== AUTO-RETRY FAILED JOBS =====================
  async function retryFailedJobs() {
    const failed = queue.filter(j => j.status === 'failed' || j.status === 'timeout');
    if (!failed.length) { LOG('No failed jobs to retry'); return; }
    let count = 0;
    for (const j of failed) {
      j.status = 'pending';
      j.error = null;
      j.startedAt = null;
      j.completedAt = null;
      j.duration = null;
      count++;
    }
    await saveQ();
    renderQ();
    LOG(`Reset ${count} failed jobs for retry`);
  }

  // ===================== RATE LIMITING =====================
  let _rateLimitDelay = 3000; // ms between applications (default 3s)
  let _rateLimitLoaded = false;

  async function loadRateLimitDelay() {
    if (_rateLimitLoaded) return;
    const saved = await st.get('ua_rate_limit');
    if (saved) _rateLimitDelay = saved;
    _rateLimitLoaded = true;
  }

  async function setRateLimitDelay(ms) {
    _rateLimitDelay = ms;
    await st.set('ua_rate_limit', ms);
  }

  // ===================== BROWSER NOTIFICATIONS =====================
  function sendNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: chrome.runtime.getURL?.('icon128.plasmo.3c1ed2d2.png') || '' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') new Notification(title, { body });
      });
    }
  }

  // ===================== FORM ANALYSIS =====================
  function getFormAnalysis() {
    const analysis = analyzeCurrentForm();
    const ats = detectATS();
    const successCheck = checkSuccess();
    return {
      ...analysis,
      ats: ats || 'None detected',
      successDetected: successCheck,
      pageUrl: location.href,
      missingRequired: getMissingRequired(),
    };
  }

  // ===================== DARK MODE =====================
  let _darkMode = false;

  async function loadDarkMode() {
    _darkMode = (await st.get('ua_dark_mode')) || false;
    return _darkMode;
  }

  async function toggleDarkMode() {
    _darkMode = !_darkMode;
    await st.set('ua_dark_mode', _darkMode);
    applyDarkMode();
    return _darkMode;
  }

  function applyDarkMode() {
    const drawer = document.getElementById('ua-drawer');
    if (!drawer) return;
    if (_darkMode) {
      drawer.classList.add('ua-dark');
    } else {
      drawer.classList.remove('ua-dark');
    }
  }

  // ===================== CUSTOMIZABLE DEFAULTS =====================
  let _customDefaults = null;

  async function loadCustomDefaults() {
    const saved = await st.get('ua_custom_defaults');
    if (saved) {
      _customDefaults = saved;
      Object.assign(DEFAULTS, saved);
    }
    return DEFAULTS;
  }

  async function saveCustomDefaults(newDefaults) {
    _customDefaults = newDefaults;
    Object.assign(DEFAULTS, newDefaults);
    await st.set('ua_custom_defaults', newDefaults);
  }

  // ===================== JOB SCRAPER (LinkedIn/Indeed/Glassdoor Search Pages) =====================
  function scrapeJobListings() {
    const url = location.href;
    const jobs = [];

    // LinkedIn search results
    if (/linkedin\.com\/(jobs\/search|jobs\/collections)/i.test(url)) {
      $$('.job-card-container a.job-card-list__title,.jobs-search-results__list-item a,.job-card-container__link,.scaffold-layout__list-item a[href*="/jobs/view/"]').forEach(a => {
        const href = a.href?.split('?')[0];
        const title = a.textContent?.trim() || '';
        if (href && /\/jobs\/view\//i.test(href)) jobs.push({ url: href, title });
      });
    }

    // Indeed search results
    if (/indeed\.com\/(jobs|q-)/i.test(url)) {
      $$('a[data-jk],a.jcs-JobTitle,h2.jobTitle a,.job_seen_beacon a[href*="/viewjob"],.resultContent a[href*="/rc/clk"]').forEach(a => {
        const href = a.href;
        const title = a.textContent?.trim() || '';
        if (href && /viewjob|clk/i.test(href)) jobs.push({ url: href, title });
      });
    }

    // Glassdoor search results
    if (/glassdoor\.com\/Job/i.test(url)) {
      $$('a[data-test="job-link"],a.jobLink,.JobCard a[href*="/job-listing/"]').forEach(a => {
        const href = a.href;
        const title = a.textContent?.trim() || '';
        if (href) jobs.push({ url: href, title });
      });
    }

    // ZipRecruiter search results
    if (/ziprecruiter\.com\/jobs/i.test(url)) {
      $$('a.job_link,a[data-job-id],article a[href*="/c/"]').forEach(a => {
        const href = a.href;
        const title = a.textContent?.trim() || '';
        if (href) jobs.push({ url: href, title });
      });
    }

    // Dice search results
    if (/dice\.com\/jobs/i.test(url)) {
      $$('a[data-cy="card-title-link"],a.card-title-link,.search-card a[href*="/job-detail/"]').forEach(a => {
        const href = a.href;
        const title = a.textContent?.trim() || '';
        if (href) jobs.push({ url: href, title });
      });
    }

    // Wellfound/AngelList
    if (/wellfound\.com|angel\.co/i.test(url) && /\/jobs/i.test(url)) {
      $$('a[href*="/jobs/"],.styles_component__container a,.browse-table-row a').forEach(a => {
        const href = a.href;
        const title = a.textContent?.trim() || '';
        if (href && title.length > 3 && title.length < 120) jobs.push({ url: href, title });
      });
    }

    // Generic career pages
    if (/\/careers?\/|\/jobs?\//i.test(url) && !jobs.length) {
      $$('a[href*="/job"],a[href*="/position"],a[href*="/opening"],a[href*="/career"]').forEach(a => {
        const href = a.href;
        const title = a.textContent?.trim() || '';
        if (href && title.length > 5 && title.length < 120 && href !== url) jobs.push({ url: href, title });
      });
    }

    // Deduplicate
    const seen = new Set();
    return jobs.filter(j => {
      if (seen.has(j.url)) return false;
      seen.add(j.url);
      return true;
    });
  }

  async function scrapeAndAddToQueue() {
    const jobs = scrapeJobListings();
    if (!jobs.length) { LOG('No job listings found on this page'); return 0; }
    let added = 0;
    for (const j of jobs) {
      if (!queue.some(q => q.url === j.url)) {
        await addJob(j.url, j.title);
        added++;
      }
    }
    LOG(`Scraped and added ${added} jobs from search results (${jobs.length} found, ${jobs.length - added} duplicates)`);
    return added;
  }

  // ===================== CREDIT HIDE =====================
  function hideCredits() {
    $$('.autofill-credit-row,.payment-entry,.plugin-setting-credits-tip').forEach(e => e.style.display = 'none');
    $$('.ant-modal-root').forEach(m => {
      const txt = m.textContent || '';
      // Hide credit/upgrade modals
      if (/remaining.*credit|upgrade.*turbo|out of credit|credits.*refill|get unlimited/i.test(txt)) m.style.display = 'none';
      // TASK 4: Hide review submission prompts (GoodReviewsModel, CriticizeReviewsModal, leave-review)
      if (/leave.*review|rate.*experience|how.*was.*your|review.*your.*experience|good.*review|criticize|feedback.*application|share.*experience/i.test(txt)) {
        LOG('Suppressing review prompt');
        m.style.display = 'none';
        // Also try clicking dismiss/close button
        const closeBtn = m.querySelector('.ant-modal-close,button[aria-label="Close" i],.close-button,[class*="close"],[class*="dismiss"]');
        if (closeBtn) realClick(closeBtn);
      }
    });
    // Hide review-related elements by class
    $$('.good-reviews-popup-text,.good-reviews-popup-title,.leave-review-button,.leave-review-text,[class*="GoodReviewsModel"],[class*="CriticizeReviewsModal"],[class*="review-popup"],[class*="review-modal"],[class*="feedback-modal"]')
      .forEach(e => e.style.display = 'none');
    // Replace credit text
    $$('*').forEach(el => { if (el.children.length === 0 && /\d+\s*credits?\s*available/i.test(el.textContent || '')) el.textContent = el.textContent.replace(/\d+\s*(credits?\s*available)/i, 'Unlimited $1'); });
    // Simplify+ coin/token bypass display
    $$('*').forEach(el => { if (el.children.length === 0 && /\d+\s*(coins?|tokens?)\s*(left|remaining|available)/i.test(el.textContent || '')) el.textContent = el.textContent.replace(/\d+(\s*(coins?|tokens?))/i, '∞$1'); });
  }

  // ===================== CSS =====================
  function injectCSS() {
    if (document.getElementById('ua-css')) return;
    const s = document.createElement('style'); s.id = 'ua-css';
    s.textContent = `
.autofill-credit-row,.autofill-credit-text,.autofill-credit-text-right,.payment-entry,.plugin-setting-credits-tip{display:none!important}
.ant-modal-root:has(.popup-modal-actions){display:none!important}
/* Hide review/feedback prompts after submission */
.ant-modal-root:has(.good-reviews-popup-text),.ant-modal-root:has(.good-reviews-popup-title),.ant-modal-root:has(.leave-review-button),.ant-modal-root:has(.leave-review-text),.ant-modal-root:has(.CriticizeReviewsModal),.ant-modal-root:has(.GoodReviewsModel){display:none!important}
[class*="review-popup"],[class*="review-modal"],[class*="feedback-modal"],[class*="good-reviews"],[class*="leave-review"]{display:none!important}
/* Hide Simplify paywall/upgrade prompts */
[class*="paywall"],[class*="upgrade-modal"],[class*="coin-required"],[class*="token-required"],[class*="premium-gate"]{display:none!important}

/* === DRAGGABLE FAB === */
#ua-fab{position:fixed;bottom:28px;right:28px;width:48px;height:48px;border-radius:50%;border:none;cursor:grab;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#00c985,#00b377);box-shadow:0 2px 12px rgba(0,201,133,.4);z-index:2147483647;transition:box-shadow .2s;user-select:none;-webkit-user-select:none;touch-action:none}
#ua-fab:hover{box-shadow:0 4px 20px rgba(0,201,133,.55)}
#ua-fab:active{cursor:grabbing}
#ua-fab .ico{width:22px;height:22px;pointer-events:none}
#ua-fab .badge{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;border-radius:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid #fff;font-family:system-ui,sans-serif;line-height:1}
#ua-fab .badge:empty{display:none}

/* === ADD FAB === */
#ua-fab-add{position:fixed;bottom:84px;right:32px;width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:#064e3b;box-shadow:0 2px 10px rgba(0,0,0,.2);z-index:2147483646;transition:transform .2s,background .2s}
#ua-fab-add:hover{transform:scale(1.1);background:#065f46}
#ua-fab-add .ico{width:18px;height:18px}

/* === AUTOMATION IN PROGRESS PANEL (matches Jobright 1.14.0 dark UI) === */
/* Anchored to the LEFT edge — Jobright's own sidebar (with the field checklist) lives on
   the RIGHT, so a right-anchored overlay sat right on top of it. Left keeps both readable.
   Still draggable; a saved position overrides this. */
/* !important throughout: this panel lives in the host page's DOM, and a site
   whose CSS says div{display:none!important} or clamps z-index would otherwise
   hide the only Pause/Skip/Quit controls the run has. */
#ua-ctrl{position:fixed!important;top:80px;left:20px;right:auto;z-index:2147483647!important;display:none;visibility:visible!important;opacity:1!important;font-family:'Inter',system-ui,-apple-system,sans-serif}
#ua-ctrl.show{display:block!important}
#ua-ctrl-card{width:300px;background:#0e0e0f;border:1px solid #232325;border-radius:14px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.45);color:#e7e7ea}
.uc-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.uc-title{font-size:14px;font-weight:700;color:#fff;letter-spacing:.1px}
.uc-count{font-size:11px;font-weight:700;color:#cfcfd4;background:#1c1c1f;border:1px solid #2c2c30;border-radius:8px;padding:3px 9px;white-space:nowrap;font-variant-numeric:tabular-nums}
.uc-pos{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:13px;font-size:13px;color:#e7e7ea}
.uc-pos-co{font-size:11px;font-weight:600;color:#cfcfd4;background:#1c1c1f;border:1px solid #2c2c30;border-radius:7px;padding:2px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uc-bar{margin-top:12px;height:5px;border-radius:4px;background:#2a2a2d;overflow:hidden}
.uc-bar-fill{height:100%;width:0%;border-radius:4px;background:linear-gradient(90deg,#00a86b,#00e58f);transition:width .4s ease}
.uc-proc{margin-top:11px;font-size:12px;font-weight:600;color:#4ea1ff}
.uc-proc.paused{color:#fbbf24}
.uc-stats{display:flex;gap:10px;margin-top:9px;font-size:11px;color:#9aa0a6}
.uc-stat b{font-variant-numeric:tabular-nums;font-weight:800}
.uc-stat.ok b{color:#34d399}.uc-stat.sk b{color:#9aa0a6}.uc-stat.fa b{color:#f87171}
.uc-why{margin-top:7px;font-size:11px;line-height:1.35;color:#f0a35e;cursor:pointer;word-break:break-word}
.uc-why:hover{text-decoration:underline}
.uc-why.copied{color:#34d399}
.uc-speed{display:flex;align-items:center;gap:6px;margin-top:14px}
.uc-speed-l{font-size:12px;font-weight:600;color:#bfbfc4;margin-right:2px}
.uc-sp{min-width:38px;height:28px;padding:0 9px;border-radius:14px;border:1px solid #34343a;background:transparent;color:#bfbfc4;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s}
.uc-sp:hover{border-color:#00f0a0;color:#e7e7ea}
.uc-sp:hover{border-color:#4b4b52;color:#e7e7ea}
.uc-sp.active{background:#00f0a0;border-color:#00f0a0;color:#06231a;box-shadow:0 0 0 2px rgba(0,240,160,.25)}
.uc-actions{display:flex;gap:10px;margin-top:16px}
.uc-act{flex:1;height:38px;border-radius:9px;border:none;cursor:pointer;font-size:13px;font-weight:700;transition:filter .15s,background .15s}
.uc-act:hover{filter:brightness(1.08)}
.uc-act.pause{background:#f5b13d;color:#1a1205}
.uc-act.resume{background:#34d399;color:#04120c}
.uc-act.skip{background:transparent;color:#e7e7ea;border:1px solid #3a3a40}
.uc-act.quit{background:#000;color:#fff;border:1px solid #2c2c30}

/* === DRAWER === */
#ua-drawer{position:fixed;display:none;width:380px;max-height:520px;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.14);flex-direction:column;overflow:hidden;border:1px solid #e5e7eb;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#111827}
#ua-drawer.open{display:flex}

.ua-hdr{background:linear-gradient(135deg,#00a86b,#00c985);padding:14px 18px;display:flex;justify-content:space-between;align-items:center}
.ua-hdr-t{font-size:15px;font-weight:700;color:#fff}
.ua-hdr-sub{font-size:10px;color:rgba(255,255,255,.6);margin-top:1px}
.ua-hdr-badge{background:rgba(255,255,255,.18);color:#fff;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.3px}
.ua-body{padding:14px 16px;overflow-y:auto;max-height:420px;flex:1}
.ua-sec{margin-bottom:14px}.ua-sec:last-child{margin-bottom:0}
.ua-sec-t{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;margin-bottom:6px}

/* Toggle */
.ua-tog{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f9fafb;border-radius:10px;border:1px solid #f3f4f6}
.ua-tog-l{font-size:12px;font-weight:600;color:#111827}
.ua-tog-d{font-size:10px;color:#9ca3af;margin-top:1px}
.ua-sw{position:relative;width:40px;height:22px;flex-shrink:0}
.ua-sw input{opacity:0;width:0;height:0;position:absolute}
.ua-sw-s{position:absolute;cursor:pointer;inset:0;background:#d1d5db;border-radius:22px;transition:.25s}
.ua-sw-s:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.ua-sw input:checked+.ua-sw-s{background:#00c985}
.ua-sw input:checked+.ua-sw-s:before{transform:translateX(18px)}

/* Status */
.ua-stat{padding:6px 10px;border-radius:8px;font-size:10px;font-weight:600;display:flex;align-items:center;gap:5px;margin-top:6px}
.ua-stat.on{background:#ecfdf5;color:#059669}
.ua-stat.off{background:#f9fafb;color:#9ca3af}
.ua-stat .dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.ua-stat.on .dot{background:#059669;animation:uap 1.5s infinite}
.ua-stat.off .dot{background:#d1d5db}
@keyframes uap{0%,100%{opacity:1}50%{opacity:.3}}

/* Import */
.ua-drop{border:1.5px dashed #d1d5db;border-radius:10px;padding:14px;text-align:center;cursor:pointer;transition:.2s;background:#fafafa}
.ua-drop:hover,.ua-drop.over{border-color:#00c985;background:#ecfdf5}
.ua-drop-t{font-size:11px;font-weight:600;color:#6b7280}
.ua-drop-sub{font-size:10px;color:#9ca3af;margin-top:2px}
.ua-csv-in{display:none}
.ua-url-row{display:flex;gap:5px;margin-top:8px}
.ua-url-inp{flex:1;padding:7px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:11px;outline:none;transition:border .2s;font-family:inherit}
.ua-url-inp:focus{border-color:#00c985}
.ua-url-btn{background:#00c985;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.ua-url-btn:hover{background:#00a86b}

/* Queue Toolbar */
.ua-q-bar{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}
.ua-q-bar label{display:flex;align-items:center;gap:3px;font-size:10px;color:#6b7280;cursor:pointer}
.ua-q-bar label input{width:13px;height:13px;accent-color:#00c985}
.ua-q-bar .del{background:none;border:1px solid #fca5a5;color:#ef4444;border-radius:6px;padding:3px 8px;font-size:9px;font-weight:600;cursor:pointer}
.ua-q-bar .del:hover{background:#fef2f2}
.ua-q-bar .del:disabled{opacity:.3;cursor:default}
.ua-q-bar .info{margin-left:auto;font-size:10px;color:#9ca3af}

/* Queue List */
.ua-qlist{max-height:180px;overflow-y:auto;border:1px solid #f3f4f6;border-radius:8px}
.ua-qlist:empty::after{content:'No jobs in queue';display:block;text-align:center;color:#9ca3af;padding:16px;font-size:11px}
.ua-qi{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #f9fafb;font-size:11px}
.ua-qi:last-child{border-bottom:none}
.ua-qi:hover{background:#fafafa}
.ua-qi input{width:13px;height:13px;accent-color:#00c985;flex-shrink:0}
.ua-qi .num{width:18px;height:18px;border-radius:4px;background:#f3f4f6;color:#6b7280;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ua-qi .url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4b5563}
.ua-qi .st{font-size:8px;padding:2px 6px;border-radius:4px;font-weight:700;flex-shrink:0;text-transform:uppercase;letter-spacing:.3px}
.ua-qi .st.pending{background:#fef3c7;color:#92400e}
.ua-qi .st.applying{background:#dbeafe;color:#1e40af}
.ua-qi .st.done{background:#d1fae5;color:#065f46}
.ua-qi .st.failed{background:#fee2e2;color:#991b1b}
.ua-qi .st.timeout{background:#fef3c7;color:#78350f}
.ua-qi .st.skipped{background:#e5e7eb;color:#4b5563}
.ua-qi .rm{width:18px;height:18px;border:none;background:none;cursor:pointer;color:#d1d5db;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;border-radius:4px;flex-shrink:0}
.ua-qi .rm:hover{background:#fee2e2;color:#ef4444}

/* Queue Summary */
.ua-qsum{display:flex;gap:10px;padding:6px 0;font-size:10px;color:#6b7280;justify-content:center}
.ua-qsum i{width:5px;height:5px;border-radius:50%;display:inline-block;margin-right:2px;vertical-align:middle}

/* Queue Buttons */
.ua-qbtns{display:flex;gap:5px;margin-top:6px}
.ua-qbtns button{flex:1;padding:8px 4px;border:none;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.4px;transition:.15s}
.ua-qbtns .pri{background:#00c985;color:#fff}.ua-qbtns .pri:hover{background:#00a86b}
.ua-qbtns .pri:disabled{background:#e5e7eb;color:#9ca3af;cursor:default}
.ua-qbtns .sec{background:#f3f4f6;color:#6b7280}.ua-qbtns .sec:hover{background:#e5e7eb}
.ua-qbtns .dan{background:#fff;color:#ef4444;border:1px solid #fecaca}.ua-qbtns .dan:hover{background:#fef2f2}

/* ATS Badge */
#ua-ats{position:fixed;top:12px;right:12px;z-index:2147483646;background:#064e3b;color:#6ee7b7;padding:5px 12px;border-radius:10px;font-family:system-ui,sans-serif;font-size:10px;font-weight:700;box-shadow:0 2px 12px rgba(0,0,0,.15);display:none;align-items:center;gap:5px}
#ua-ats.show{display:flex}
#ua-ats .dot{width:5px;height:5px;border-radius:50%;background:#34d399;animation:uap 1.5s infinite}

/* === DARK MODE === */
#ua-drawer.ua-dark{background:#1f2937;color:#e5e7eb;border-color:#374151}
#ua-drawer.ua-dark .ua-body{scrollbar-color:#4b5563 #1f2937}
#ua-drawer.ua-dark .ua-sec-t{color:#6b7280}
#ua-drawer.ua-dark .ua-tog{background:#111827;border-color:#374151}
#ua-drawer.ua-dark .ua-tog-l{color:#e5e7eb}
#ua-drawer.ua-dark .ua-tog-d{color:#6b7280}
#ua-drawer.ua-dark .ua-drop{border-color:#4b5563;background:#111827}
#ua-drawer.ua-dark .ua-drop:hover{border-color:#00c985;background:#064e3b}
#ua-drawer.ua-dark .ua-drop-t{color:#9ca3af}
#ua-drawer.ua-dark .ua-url-inp{background:#111827;border-color:#4b5563;color:#e5e7eb}
#ua-drawer.ua-dark .ua-qlist{border-color:#374151}
#ua-drawer.ua-dark .ua-qi{border-color:#374151}
#ua-drawer.ua-dark .ua-qi:hover{background:#111827}
#ua-drawer.ua-dark .ua-qi .url{color:#d1d5db}
#ua-drawer.ua-dark .ua-qi .num{background:#374151;color:#9ca3af}
#ua-drawer.ua-dark .ua-qbtns .sec{background:#374151;color:#d1d5db}
#ua-drawer.ua-dark .ua-qbtns .dan{background:#1f2937;border-color:#ef4444;color:#f87171}
#ua-drawer.ua-dark .ua-stat.off{background:#111827;color:#6b7280}
#ua-drawer.ua-dark input[type="text"],#ua-drawer.ua-dark input[type="number"],#ua-drawer.ua-dark select{background:#111827;border-color:#4b5563;color:#e5e7eb}
#ua-drawer.ua-dark .ua-q-bar .info{color:#6b7280}
#ua-drawer.ua-dark #ua-prof{background:#111827;border-color:#374151}
#ua-drawer.ua-dark #ua-prof-toggle{background:#111827;border-color:#374151;color:#9ca3af}
#ua-drawer.ua-dark kbd{background:#374151;border-color:#4b5563;color:#d1d5db}

/* === HISTORY PANEL === */
.ua-hist-item{padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:10px;display:flex;gap:6px;align-items:center}
.ua-hist-item:last-child{border-bottom:none}
.ua-hist-item .company{font-weight:600;color:#111827;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ua-hist-item .ats{font-size:8px;padding:1px 5px;border-radius:3px;background:#dbeafe;color:#1e40af}
.ua-hist-item .date{font-size:8px;color:#9ca3af}
#ua-drawer.ua-dark .ua-hist-item{border-color:#374151}
#ua-drawer.ua-dark .ua-hist-item .company{color:#e5e7eb}

/* === STATS CARDS === */
.ua-stats-row{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
.ua-stat-card{flex:1;min-width:70px;background:#f0fdf4;border:1px solid #d1fae5;border-radius:8px;padding:8px;text-align:center}
.ua-stat-card .num{font-size:18px;font-weight:800;color:#059669}
.ua-stat-card .lbl{font-size:8px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
#ua-drawer.ua-dark .ua-stat-card{background:#064e3b;border-color:#065f46}
#ua-drawer.ua-dark .ua-stat-card .num{color:#6ee7b7}
#ua-drawer.ua-dark .ua-stat-card .lbl{color:#9ca3af}

/* === RESUME LIST === */
.ua-resume-item{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#f9fafb;border:1px solid #f3f4f6;border-radius:6px;margin-bottom:4px;font-size:10px}
.ua-resume-item.active{border-color:#00c985;background:#ecfdf5}
.ua-resume-item .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#111827}
.ua-resume-item .size{color:#9ca3af;font-size:8px}
.ua-resume-item button{background:none;border:none;cursor:pointer;padding:2px;color:#9ca3af;font-size:12px}
.ua-resume-item button:hover{color:#ef4444}
#ua-drawer.ua-dark .ua-resume-item{background:#111827;border-color:#374151}
#ua-drawer.ua-dark .ua-resume-item.active{border-color:#00c985;background:#064e3b}
#ua-drawer.ua-dark .ua-resume-item .name{color:#e5e7eb}

/* === FORM ANALYSIS === */
.ua-form-bar{display:flex;gap:4px;margin-bottom:6px}
.ua-form-pill{padding:3px 8px;border-radius:12px;font-size:9px;font-weight:600}
.ua-form-pill.good{background:#d1fae5;color:#065f46}
.ua-form-pill.warn{background:#fef3c7;color:#92400e}
.ua-form-pill.bad{background:#fee2e2;color:#991b1b}
.ua-form-progress{height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;margin-bottom:4px}
.ua-form-progress .fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#00c985,#059669);transition:width .3s}

/* === SCRAPE BUTTON === */
.ua-scrape-btn{width:100%;padding:8px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.4px;margin-top:6px}
.ua-scrape-btn:hover{background:linear-gradient(135deg,#2563eb,#1d4ed8)}
.ua-scrape-btn:disabled{background:#e5e7eb;color:#9ca3af;cursor:default}
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ===================== SVG (inline, sized) =====================
  function ico(name, w, h, clr) {
    w = w || 16; h = h || 16; const c = clr || 'currentColor';
    const paths = {
      bolt: `<path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" fill="${c}"/>`,
      plus: `<line x1="12" y1="5" x2="12" y2="19" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`,
      pause: `<rect x="6" y="4" width="4" height="16" rx="1" fill="${c}"/><rect x="14" y="4" width="4" height="16" rx="1" fill="${c}"/>`,
      play: `<path d="M8 5v14l11-7z" fill="${c}"/>`,
      stop: `<rect x="6" y="6" width="12" height="12" rx="2" fill="${c}"/>`,
      skip: `<path d="M5 4l10 8-10 8V4z" fill="${c}"/><rect x="17" y="4" width="3" height="16" rx="1" fill="${c}"/>`,
      quit: `<circle cx="12" cy="12" r="9" fill="none" stroke="${c}" stroke-width="2"/><line x1="15" y1="9" x2="9" y2="15" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`
    };
    return `<svg class="ico" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${paths[name] || ''}</svg>`;
  }

  // ===================== UI BUILD =====================
  // Build (or re-build) the "Automation In Progress" control panel. Idempotent and
  // safe to call very early (document_start) and repeatedly — this is what keeps the
  // Skip/Pause/Quit controls constantly visible across every page navigation.
  function ensureOverlay() {
    try {
      if (window.self !== window.top) return null;
      /* documentElement, not body: single-page apps routinely replace the whole
         of <body>, which took the panel with it. A fixed-position element is
         happy as a child of <html>, and this also lets the panel mount at
         document_start before <body> exists. */
      const host = document.documentElement || document.body;
      if (!host) return null;
      let ctrl = document.getElementById('ua-ctrl');
      if (ctrl && ctrl.isConnected) return ctrl;
      injectCSS(); // ensure .uc-* styles exist
      ctrl = document.createElement('div'); ctrl.id = 'ua-ctrl';
      ctrl.innerHTML = `<div id="ua-ctrl-card">
        <div class="uc-top">
          <div class="uc-title">Automation In Progress</div>
          <div class="uc-count" id="uc-count">Job 0 of 0</div>
        </div>
        <div class="uc-pos"><span id="uc-pos">Preparing…</span><span class="uc-pos-co" id="uc-pos-co" style="display:none"></span></div>
        <div class="uc-bar"><div class="uc-bar-fill" id="uc-bar"></div></div>
        <div class="uc-proc" id="uc-proc">Processing…</div>
        <div class="uc-stats" id="uc-stats"><span class="uc-stat ok"><b id="uc-ok">0</b> applied</span><span class="uc-stat sk"><b id="uc-sk">0</b> skipped</span><span class="uc-stat fa"><b id="uc-fa">0</b> failed</span></div>
        <div class="uc-why" id="uc-why" style="display:none" title="Click to copy every failure and its reason"></div>
        <div class="uc-speed">
          <span class="uc-speed-l">Speed:</span>
          <button class="uc-sp active" data-sp="1">1x</button>
          <button class="uc-sp" data-sp="1.5">1.5x</button>
          <button class="uc-sp" data-sp="2">2x</button>
          <button class="uc-sp" data-sp="3">3x</button>
        </div>
        <div class="uc-actions">
          <button class="uc-act pause" id="uc-pause">Pause</button>
          <button class="uc-act skip" id="uc-skip">Skip</button>
          <button class="uc-act quit" id="uc-quit">Quit</button>
        </div>
      </div>`;
      host.appendChild(ctrl);
      makeDraggableByHandle(ctrl, ctrl.querySelector('.uc-top'));
      st.get('ua_ctrl_pos').then(p => {
        if (!p || !p.left) return;
        const left = Math.max(0, Math.min(window.innerWidth - 80, parseInt(p.left) || 0));
        const top = Math.max(0, Math.min(window.innerHeight - 40, parseInt(p.top) || 0));
        ctrl.style.left = left + 'px'; ctrl.style.top = top + 'px'; ctrl.style.right = 'auto';
      });
      ctrl.querySelector('#uc-pause').addEventListener('click', () => { if (qPaused) resumeQ(); else pauseQ(); });
      ctrl.querySelector('#uc-skip').addEventListener('click', skipJob);
      ctrl.querySelector('#uc-quit').addEventListener('click', stopQ);
      ctrl.querySelectorAll('.uc-sp').forEach(btn => btn.addEventListener('click', () => setQueueSpeed(parseFloat(btn.dataset.sp) || 1)));
      /* One click turns the run's failures into something you can paste to
         someone who can fix them. Without this the reasons exist but stay
         locked inside the extension's storage. */
      const whyBtn = ctrl.querySelector('#uc-why');
      if (whyBtn) whyBtn.addEventListener('click', async () => {
        const text = failureReportText();
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
        if (!ok) {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand('copy');
            ta.remove();
          } catch (_) {}
        }
        const was = whyBtn.textContent;
        whyBtn.textContent = ok ? 'Copied — paste it wherever you need it' : 'Could not copy — use the Queue Manager\u2019s Export';
        whyBtn.classList.toggle('copied', ok);
        setTimeout(() => { whyBtn.textContent = was; whyBtn.classList.remove('copied'); }, 2500);
      });
      // If we already know a run is active in this runner tab, show immediately.
      if (isRunnerTab()) ctrl.classList.add('show');
      updateCtrl();
      return ctrl;
    } catch (_) { return null; }
  }

  function buildUI() {
    if (window.self !== window.top) return;

    // --- Main FAB (the old "Ultimate Autofill" drawer entry) — HIDDEN by request.
    // Everything is now driven from the native Jobright popup (bulk-apply card) plus
    // the draggable "Automation In Progress" overlay, so this separate panel is not
    // shown. The drawer code stays for power users via keyboard shortcut only.
    const fab = document.createElement('div'); fab.id = 'ua-fab';
    fab.innerHTML = ico('bolt', 22, 22, '#fff') + '<span class="badge" id="ua-badge"></span>';
    fab.style.display = 'none';
    document.body.appendChild(fab);
    makeDraggable(fab);
    fab.addEventListener('click', () => { const d = document.getElementById('ua-drawer'); d.classList.toggle('open'); positionDrawer(); });

    // --- Add-to-queue mini FAB --- (also hidden; add jobs from the sidebar card)
    const af = document.createElement('div'); af.id = 'ua-fab-add';
    af.innerHTML = ico('plus', 18, 18, '#6ee7b7');
    af.title = 'Add this page to queue';
    af.style.display = 'none';
    document.body.appendChild(af);
    af.addEventListener('click', () => addJob(location.href, document.title));

    // --- Automation In Progress panel --- (created via ensureOverlay so it can be
    // re-mounted instantly and kept alive throughout the run)
    ensureOverlay();

    // --- Drawer ---
    const dw = document.createElement('div'); dw.id = 'ua-drawer';
    dw.innerHTML = `
      <div class="ua-hdr"><div><div class="ua-hdr-t">Ultimate Autofill</div><div class="ua-hdr-sub">AI-Powered Job Applications</div></div><div style="display:flex;gap:6px;align-items:center"><button id="ua-dark-toggle" title="Dark Mode" style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px">🌙</button><span class="ua-hdr-badge">UNLIMITED</span></div></div>
      <div class="ua-body">
        <div class="ua-sec">
          <div class="ua-sec-t">Auto-Apply</div>
          <div class="ua-tog"><div><div class="ua-tog-l">Auto-Apply on ATS Pages</div><div class="ua-tog-d">Tailor → Autofill → Fill gaps → Submit</div></div><label class="ua-sw"><input type="checkbox" id="ua-aa"><span class="ua-sw-s"></span></label></div>
          <div id="ua-stat" class="ua-stat off"><span class="dot"></span><span id="ua-stat-t">Inactive</span></div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Form Analysis</div>
          <div id="ua-form-analysis">
            <div class="ua-form-progress"><div class="fill" id="ua-form-progress-fill" style="width:0%"></div></div>
            <div class="ua-form-bar" id="ua-form-pills"></div>
            <div style="display:flex;gap:4px">
              <button id="ua-fill-now" style="flex:1;padding:6px;background:#00c985;color:#fff;border:none;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer">Fill Now (Alt+F)</button>
              <button id="ua-analyze" style="flex:1;padding:6px;background:#f3f4f6;color:#6b7280;border:none;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer">Analyze</button>
            </div>
          </div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Application History</div>
          <div class="ua-stats-row" id="ua-hist-stats">
            <div class="ua-stat-card"><div class="num" id="ua-hist-today">0</div><div class="lbl">Today</div></div>
            <div class="ua-stat-card"><div class="num" id="ua-hist-week">0</div><div class="lbl">This Week</div></div>
            <div class="ua-stat-card"><div class="num" id="ua-hist-total">0</div><div class="lbl">Total</div></div>
            <div class="ua-stat-card"><div class="num" id="ua-hist-companies">0</div><div class="lbl">Companies</div></div>
          </div>
          <div id="ua-hist-list" style="max-height:120px;overflow-y:auto;border:1px solid #f3f4f6;border-radius:8px;margin-bottom:6px"></div>
          <div style="display:flex;gap:4px">
            <button id="ua-hist-export" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #60a5fa;border-radius:6px;background:none;color:#3b82f6;cursor:pointer">Export History</button>
            <button id="ua-hist-clear" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #fca5a5;border-radius:6px;background:none;color:#ef4444;cursor:pointer">Clear History</button>
          </div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Resumes <span id="ua-resume-cnt" style="color:#00c985"></span></div>
          <div id="ua-resume-list" style="margin-bottom:6px"></div>
          <div style="display:flex;gap:4px">
            <button id="ua-resume-add" style="flex:1;padding:6px;background:#00c985;color:#fff;border:none;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer">Upload Resume</button>
            <input type="file" id="ua-resume-file" accept=".pdf,.doc,.docx,.txt,.rtf" style="display:none">
          </div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Import Jobs</div>
          <div id="ua-drop" class="ua-drop"><div class="ua-drop-t">Drop CSV or click to browse</div><div class="ua-drop-sub">.csv .txt .tsv — or paste multiple URLs</div><input type="file" id="ua-csv" class="ua-csv-in" accept=".csv,.txt,.tsv,.json"></div>
          <div class="ua-url-row"><input type="text" id="ua-url" class="ua-url-inp" placeholder="Paste job URL..."><button id="ua-add" class="ua-url-btn">Add</button></div>
          <button id="ua-scrape-btn" class="ua-scrape-btn">Scrape Jobs From This Page</button>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Saved Responses <span id="ua-resp-cnt" style="color:#00c985"></span></div>
          <input type="text" id="ua-resp-search" placeholder="Search by Keyword or Response" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;margin-bottom:6px;box-sizing:border-box">
          <div id="ua-resp-list" style="max-height:180px;overflow-y:auto;font-size:10px;color:#9ca3af;margin-bottom:6px"></div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button id="ua-resp-new" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #a78bfa;border-radius:6px;background:none;color:#7c3aed;cursor:pointer">+ New</button>
            <button id="ua-resp-import" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #60a5fa;border-radius:6px;background:none;color:#3b82f6;cursor:pointer">Import</button>
            <button id="ua-resp-export" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #60a5fa;border-radius:6px;background:none;color:#3b82f6;cursor:pointer">Export</button>
            <button id="ua-resp-delete" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #fca5a5;border-radius:6px;background:none;color:#ef4444;cursor:pointer">Delete All</button>
          </div>
          <input type="file" id="ua-resp-file" accept=".json" style="display:none">
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Answer Bank <span id="ua-ans-cnt" style="color:#00c985"></span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:10px;color:#6b7280" id="ua-ans-info">Learned answers help fill forms faster</span>
            <button id="ua-ans-clear" style="font-size:9px;padding:3px 8px;border:1px solid #fca5a5;border-radius:6px;background:none;color:#ef4444;cursor:pointer;white-space:nowrap">Clear All</button>
          </div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Profile <span id="ua-prof-status" style="color:#9ca3af">(click to edit)</span></div>
          <div id="ua-prof" style="display:none;padding:8px;background:#f9fafb;border-radius:8px;border:1px solid #f3f4f6">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px" id="ua-prof-fields"></div>
            <div style="display:flex;gap:6px"><button class="ua-url-btn" id="ua-prof-save" style="flex:1">Save Profile</button><button class="ua-url-btn" id="ua-prof-cancel" style="flex:1;background:#6b7280">Cancel</button></div>
          </div>
          <button id="ua-prof-toggle" style="width:100%;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;color:#6b7280;text-align:left">Edit Profile (name, email, phone...)</button>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button id="ua-prof-export-btn" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #60a5fa;border-radius:6px;background:none;color:#3b82f6;cursor:pointer">Export Profile</button>
            <button id="ua-prof-import-btn" style="flex:1;font-size:9px;padding:4px 8px;border:1px solid #60a5fa;border-radius:6px;background:none;color:#3b82f6;cursor:pointer">Import Profile</button>
            <input type="file" id="ua-prof-file" accept=".json" style="display:none">
          </div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Customizable Defaults</div>
          <div id="ua-defaults-panel" style="display:none;padding:8px;background:#f9fafb;border-radius:8px;border:1px solid #f3f4f6">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px" id="ua-defaults-fields"></div>
            <div style="display:flex;gap:6px"><button class="ua-url-btn" id="ua-defaults-save" style="flex:1">Save Defaults</button><button class="ua-url-btn" id="ua-defaults-cancel" style="flex:1;background:#6b7280">Cancel</button></div>
          </div>
          <button id="ua-defaults-toggle" style="width:100%;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;color:#6b7280;text-align:left">Edit Default Answers (authorization, sponsorship...)</button>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Queue Settings</div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
            <label style="font-size:10px;color:#6b7280;white-space:nowrap">Delay between jobs:</label>
            <select id="ua-rate-limit" style="padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:10px;flex:1">
              <option value="1000">1s (Fast)</option>
              <option value="2000">2s</option>
              <option value="3000" selected>3s (Default)</option>
              <option value="5000">5s</option>
              <option value="10000">10s (Cautious)</option>
              <option value="15000">15s (Very Safe)</option>
              <option value="30000">30s (Ultra Safe)</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
            <label style="font-size:10px;color:#6b7280;white-space:nowrap">Job timeout:</label>
            <select id="ua-timeout" style="padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:10px;flex:1">
              <option value="60000">60s</option>
              <option value="90000" selected>90s (Default)</option>
              <option value="120000">120s</option>
              <option value="180000">180s</option>
              <option value="300000">300s</option>
            </select>
          </div>
          <div class="ua-tog" style="margin-bottom:6px"><div><div class="ua-tog-l">Browser Notifications</div><div class="ua-tog-d">Notify on queue complete/errors</div></div><label class="ua-sw"><input type="checkbox" id="ua-notif"><span class="ua-sw-s"></span></label></div>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Queue <span id="ua-q-cnt" style="color:#00c985">(0)</span></div>
          <div class="ua-q-bar"><label><input type="checkbox" id="ua-selall">Select all</label><button class="del" id="ua-del" disabled>Delete selected</button><button class="del" id="ua-retry-failed" style="border-color:#fbbf24;color:#b45309">Retry failed</button><span class="info" id="ua-q-info"></span></div>
          <div class="ua-qlist" id="ua-qlist"></div>
          <div class="ua-qsum" id="ua-qsum"></div>
          <div class="ua-qbtns" id="ua-qbtns"></div>
          <button id="ua-export" style="width:100%;margin-top:6px;padding:6px;background:none;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;color:#6b7280">Export Queue to CSV</button>
        </div>
        <div class="ua-sec">
          <div class="ua-sec-t">Keyboard Shortcuts</div>
          <div style="font-size:10px;color:#6b7280;line-height:1.8">
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+Q</kbd> Toggle panel</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+A</kbd> Auto-apply on/off</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+F</kbd> Fill form now</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+J</kbd> Add page to queue</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+S</kbd> Start/stop queue</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+P</kbd> Pause/resume queue</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+N</kbd> Skip current job</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+E</kbd> Export CSV</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+D</kbd> Dark mode toggle</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+G</kbd> Scrape jobs from page</div>
            <div><kbd style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9px;border:1px solid #e5e7eb">Alt+R</kbd> Retry failed jobs</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dw);

    // ATS badge
    const ab = document.createElement('div'); ab.id = 'ua-ats';
    ab.innerHTML = '<span class="dot"></span><span id="ua-ats-n"></span>';
    document.body.appendChild(ab);

    bindDrawer();
  }

  function positionDrawer() {
    const d = document.getElementById('ua-drawer');
    const f = document.getElementById('ua-fab');
    if (!d || !f) return;
    const r = f.getBoundingClientRect();
    d.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    d.style.right = (window.innerWidth - r.right) + 'px';
  }

  // ===================== DRAGGABLE =====================
  // Drag `target` only when grabbing `handle` (so buttons inside still click).
  function makeDraggableByHandle(target, handle) {
    if (!target || !handle) return;
    handle.style.cursor = 'move';
    handle.style.userSelect = 'none';
    handle.title = 'Drag to move';
    let sx, sy, ox, oy, dragging = false;
    const onDown = e => {
      if (e.target.closest('button')) return; // never start a drag from a control
      const t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY;
      const r = target.getBoundingClientRect(); ox = r.left; oy = r.top;
      dragging = true;
      target.style.transition = 'none';
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
      e.preventDefault();
    };
    const onMove = e => {
      if (!dragging) return; e.preventDefault();
      const t = e.touches ? e.touches[0] : e;
      const nx = Math.max(0, Math.min(window.innerWidth - target.offsetWidth, ox + (t.clientX - sx)));
      const ny = Math.max(0, Math.min(window.innerHeight - target.offsetHeight, oy + (t.clientY - sy)));
      target.style.left = nx + 'px'; target.style.top = ny + 'px'; target.style.right = 'auto'; target.style.bottom = 'auto';
    };
    const onUp = () => {
      dragging = false; target.style.transition = '';
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
      if (target.style.left) { try { st.set('ua_ctrl_pos', { left: target.style.left, top: target.style.top }); } catch (_) {} }
    };
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }

  function makeDraggable(el) {
    let sx, sy, ox, oy, dragging = false, moved = false;
    const onDown = e => {
      e.preventDefault();
      const t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      dragging = true; moved = false;
      el.style.transition = 'none';
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
    };
    const onMove = e => {
      if (!dragging) return; e.preventDefault();
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      const nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, ox + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + dy));
      el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    };
    const onUp = () => {
      dragging = false; el.style.transition = '';
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
      if (moved) {
        st.set(SK.POS, { left: el.style.left, top: el.style.top });
        const suppress = ev => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', suppress, { capture: true, once: true });
      }
    };
    el.addEventListener('mousedown', onDown); el.addEventListener('touchstart', onDown, { passive: false });
    st.get(SK.POS).then(p => { if (p?.left) { el.style.left = p.left; el.style.top = p.top; el.style.right = 'auto'; el.style.bottom = 'auto'; } });
  }

  // ===================== DRAWER EVENTS =====================
  function bindDrawer() {
    const tog = document.getElementById('ua-aa'); tog.checked = autoApply;
    tog.addEventListener('change', e => { setAutoApply(e.target.checked, true, 'drawer checkbox'); });

    const drop = document.getElementById('ua-drop'), csv = document.getElementById('ua-csv');
    drop.addEventListener('click', () => csv.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    csv.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    document.getElementById('ua-add').addEventListener('click', () => { const i = document.getElementById('ua-url'); if (i.value.trim()) { addJob(i.value.trim()); i.value = ''; } });
    document.getElementById('ua-url').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('ua-add').click(); });
    // LazyApply-style: support pasting multiple URLs at once
    document.getElementById('ua-url').addEventListener('paste', async e => {
      await sleep(50);
      const text = document.getElementById('ua-url').value;
      const urls = parseBulkUrls(text);
      if (urls.length > 1) {
        e.preventDefault();
        for (const u of urls) await addJob(u);
        document.getElementById('ua-url').value = '';
        LOG(`Bulk pasted ${urls.length} URLs`);
      }
    });
    document.getElementById('ua-selall').addEventListener('change', e => { if (e.target.checked) queue.forEach(j => selected.add(j.id)); else selected.clear(); renderQ(); });
    document.getElementById('ua-export')?.addEventListener('click', exportQueueCSV);
    document.getElementById('ua-del').addEventListener('click', removeSelected);

    // ---- Saved Responses bindings ----
    const respCnt = document.getElementById('ua-resp-cnt');
    const respList = document.getElementById('ua-resp-list');
    const respSearch = document.getElementById('ua-resp-search');
    const respFile = document.getElementById('ua-resp-file');

    function renderResponses(filter = '') {
      if (!respList) return;
      const filt = filter.toLowerCase().trim();
      const filtered = _savedResponses.filter(r => {
        if (!filt) return true;
        return (r.keywords || []).some(k => k.toLowerCase().includes(filt)) ||
          (r.response || '').toLowerCase().includes(filt);
      });
      if (!filtered.length) {
        respList.innerHTML = `<div style="text-align:center;padding:12px;color:#9ca3af">${filt ? 'No matches' : 'No saved responses yet'}</div>`;
      } else {
        respList.innerHTML = filtered.map((r, i) => {
          const idx = _savedResponses.indexOf(r);
          return `<div style="padding:6px 8px;border:1px solid #f3f4f6;border-radius:6px;margin-bottom:4px;background:#fafafa" data-resp-idx="${idx}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="color:#7c3aed;font-weight:600;font-size:9px">${(r.keywords || []).join(', ')}</span>
              <span style="color:#d1d5db;font-size:8px">×${r.appearances || 1}</span>
            </div>
            <div style="color:#374151;font-size:10px;margin-top:2px;word-break:break-word">${(r.response || '').slice(0, 120)}${(r.response || '').length > 120 ? '…' : ''}</div>
            <button class="ua-resp-del-one" data-idx="${idx}" style="font-size:8px;color:#ef4444;background:none;border:none;cursor:pointer;padding:2px 0;margin-top:2px">remove</button>
          </div>`;
        }).join('');
        respList.querySelectorAll('.ua-resp-del-one').forEach(btn => {
          btn.addEventListener('click', async e => {
            const idx = parseInt(e.target.dataset.idx);
            _savedResponses.splice(idx, 1);
            await saveSavedResponses();
            renderResponses(respSearch?.value || '');
            if (respCnt) respCnt.textContent = `(${_savedResponses.length})`;
          });
        });
      }
      if (respCnt) respCnt.textContent = `(${_savedResponses.length})`;
    }

    if (respSearch) respSearch.addEventListener('input', () => renderResponses(respSearch.value));

    document.getElementById('ua-resp-export')?.addEventListener('click', exportSavedResponses);

    document.getElementById('ua-resp-import')?.addEventListener('click', () => respFile?.click());
    if (respFile) respFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const count = importSavedResponses(reader.result);
        renderResponses(respSearch?.value || '');
        alert(`Imported ${count} saved responses`);
      };
      reader.readAsText(file);
      respFile.value = '';
    });

    document.getElementById('ua-resp-new')?.addEventListener('click', () => {
      const kw = prompt('Keywords (comma-separated):');
      if (!kw) return;
      const resp = prompt('Response:');
      if (!resp) return;
      addSavedResponse(kw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), resp);
      renderResponses(respSearch?.value || '');
    });

    document.getElementById('ua-resp-delete')?.addEventListener('click', async () => {
      if (confirm(`Delete all ${_savedResponses.length} saved responses?`)) {
        _savedResponses = [];
        await saveSavedResponses();
        renderResponses();
      }
    });

    // Initial render of saved responses
    loadSavedResponses().then(() => renderResponses());

    // Answer bank
    const ansCnt = document.getElementById('ua-ans-cnt');
    const ansInfo = document.getElementById('ua-ans-info');
    if (ansCnt) ansCnt.textContent = `(${Object.keys(_answerBank).length} answers)`;
    document.getElementById('ua-ans-clear')?.addEventListener('click', async () => {
      if (confirm('Clear all learned answers?')) {
        _answerBank = {}; _answerBankLoaded = false;
        await st.set(SK.ANS, {});
        if (ansCnt) ansCnt.textContent = '(0 answers)';
        if (ansInfo) {
          ansInfo.textContent = 'Cleared!';
          setTimeout(() => { ansInfo.textContent = 'Learned answers help fill forms faster'; }, 2000);
        }
      }
    });

    // ---- Dark Mode ----
    document.getElementById('ua-dark-toggle')?.addEventListener('click', async () => {
      const dark = await toggleDarkMode();
      document.getElementById('ua-dark-toggle').textContent = dark ? '☀️' : '🌙';
    });
    loadDarkMode().then(dark => {
      applyDarkMode();
      const btn = document.getElementById('ua-dark-toggle');
      if (btn) btn.textContent = dark ? '☀️' : '🌙';
    });

    // ---- Form Analysis ----
    function updateFormAnalysis() {
      const analysis = getFormAnalysis();
      const progress = analysis.total > 0 ? Math.round((analysis.filled / analysis.total) * 100) : 0;
      const fill = document.getElementById('ua-form-progress-fill');
      if (fill) fill.style.width = progress + '%';
      const pills = document.getElementById('ua-form-pills');
      if (pills) {
        const parts = [];
        parts.push(`<span class="ua-form-pill ${progress >= 80 ? 'good' : progress >= 50 ? 'warn' : 'bad'}">${analysis.filled}/${analysis.total} filled</span>`);
        if (analysis.ats !== 'None detected') parts.push(`<span class="ua-form-pill good">${analysis.ats}</span>`);
        if (analysis.requiredUnfilled > 0) parts.push(`<span class="ua-form-pill bad">${analysis.requiredUnfilled} required empty</span>`);
        if (analysis.successDetected) parts.push(`<span class="ua-form-pill good">Success!</span>`);
        pills.innerHTML = parts.join('');
      }
    }
    document.getElementById('ua-fill-now')?.addEventListener('click', async () => {
      LOG('Manual fill triggered via button');
      await fallbackFill();
      updateFormAnalysis();
    });
    document.getElementById('ua-analyze')?.addEventListener('click', updateFormAnalysis);
    setInterval(updateFormAnalysis, 5000);
    setTimeout(updateFormAnalysis, 1500);

    // ---- Application History ----
    function getTimeAgo(ts) {
      const diff = Date.now() - ts;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
      return new Date(ts).toLocaleDateString();
    }
    async function renderHistory() {
      await loadAppHistory();
      const stats = getHistoryStats();
      const todayEl = document.getElementById('ua-hist-today');
      const weekEl = document.getElementById('ua-hist-week');
      const totalEl = document.getElementById('ua-hist-total');
      const companiesEl = document.getElementById('ua-hist-companies');
      if (todayEl) todayEl.textContent = stats.today;
      if (weekEl) weekEl.textContent = stats.thisWeek;
      if (totalEl) totalEl.textContent = stats.total;
      if (companiesEl) companiesEl.textContent = stats.companies;
      const listEl = document.getElementById('ua-hist-list');
      if (listEl) {
        if (!_appHistory.length) {
          listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:10px">No applications yet</div>';
        } else {
          listEl.innerHTML = _appHistory.slice(0, 50).map(a => {
            const timeAgo = getTimeAgo(a.appliedAt);
            return `<div class="ua-hist-item"><span class="company" title="${(a.url || '').replace(/"/g, '&quot;')}">${a.company || a.title || 'Unknown'}</span><span class="ats">${a.ats || ''}</span><span class="date">${timeAgo}</span></div>`;
          }).join('');
        }
      }
    }
    document.getElementById('ua-hist-export')?.addEventListener('click', exportAppHistory);
    document.getElementById('ua-hist-clear')?.addEventListener('click', async () => {
      if (confirm(`Clear ${_appHistory.length} application history records?`)) {
        _appHistory = [];
        await saveAppHistory();
        renderHistory();
      }
    });
    renderHistory();

    // ---- Resume Manager ----
    async function renderResumes() {
      await loadResumes();
      const cntEl = document.getElementById('ua-resume-cnt');
      if (cntEl) cntEl.textContent = `(${_resumes.length})`;
      const listEl = document.getElementById('ua-resume-list');
      if (!listEl) return;
      if (!_resumes.length) {
        listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:10px">No resumes uploaded</div>';
      } else {
        listEl.innerHTML = _resumes.map((r, i) => {
          const sizeStr = r.size ? (r.size < 1024 ? r.size + 'B' : Math.round(r.size / 1024) + 'KB') : '';
          return `<div class="ua-resume-item ${i === _activeResumeIdx ? 'active' : ''}" data-idx="${i}">
            <input type="radio" name="ua-resume-active" ${i === _activeResumeIdx ? 'checked' : ''} data-idx="${i}" style="accent-color:#00c985">
            <span class="name">${r.name || r.fileName || 'Resume'}</span>
            <span class="size">${sizeStr}</span>
            <button data-idx="${i}" title="Remove">&times;</button>
          </div>`;
        }).join('');
        listEl.querySelectorAll('input[name="ua-resume-active"]').forEach(r => {
          r.addEventListener('change', async e => {
            await setActiveResume(parseInt(e.target.dataset.idx));
            renderResumes();
          });
        });
        listEl.querySelectorAll('button[data-idx]').forEach(btn => {
          btn.addEventListener('click', async e => {
            const idx = parseInt(e.currentTarget.dataset.idx);
            if (confirm(`Remove "${_resumes[idx]?.name || 'this resume'}"?`)) {
              await removeResume(idx);
              renderResumes();
            }
          });
        });
      }
    }
    document.getElementById('ua-resume-add')?.addEventListener('click', () => {
      document.getElementById('ua-resume-file')?.click();
    });
    document.getElementById('ua-resume-file')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      await addResume(file);
      renderResumes();
      LOG(`Resume uploaded: ${file.name}`);
      e.target.value = '';
    });
    renderResumes();

    // ---- Profile Import/Export ----
    document.getElementById('ua-prof-export-btn')?.addEventListener('click', exportProfile);
    document.getElementById('ua-prof-import-btn')?.addEventListener('click', () => {
      document.getElementById('ua-prof-file')?.click();
    });
    document.getElementById('ua-prof-file')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const ok = await importProfile(text);
      if (ok) {
        alert('Profile imported successfully!');
        const profStatusEl = document.getElementById('ua-prof-status');
        if (profStatusEl) { profStatusEl.textContent = '(imported)'; profStatusEl.style.color = '#059669'; }
      } else {
        alert('Failed to import profile. Check JSON format.');
      }
      e.target.value = '';
    });

    // ---- Customizable Defaults ----
    const defaultsFields = [
      { k: 'authorized', l: 'Authorized to Work' }, { k: 'sponsorship', l: 'Need Sponsorship' },
      { k: 'relocation', l: 'Open to Relocation' }, { k: 'remote', l: 'Remote Preference' },
      { k: 'veteran', l: 'Veteran Status' }, { k: 'disability', l: 'Disability Status' },
      { k: 'gender', l: 'Gender (EEO)' }, { k: 'ethnicity', l: 'Ethnicity (EEO)' },
      { k: 'years', l: 'Years Experience' }, { k: 'salary', l: 'Expected Salary' },
      { k: 'notice', l: 'Notice Period' }, { k: 'availability', l: 'Availability' },
      { k: 'country', l: 'Default Country' }, { k: 'phoneCountryCode', l: 'Phone Code' },
      { k: 'howHeard', l: 'How Did You Hear' }, { k: 'cover', l: 'Default Cover Letter' },
    ];
    const defaultsPanel = document.getElementById('ua-defaults-panel');
    const defaultsToggle = document.getElementById('ua-defaults-toggle');
    const defaultsContainer = document.getElementById('ua-defaults-fields');
    defaultsToggle?.addEventListener('click', async () => {
      if (defaultsPanel.style.display === 'none') {
        defaultsPanel.style.display = 'block';
        defaultsToggle.style.display = 'none';
        await loadCustomDefaults();
        defaultsContainer.innerHTML = defaultsFields.map(f =>
          `<div><label style="font-size:9px;color:#6b7280;display:block;margin-bottom:2px">${f.l}</label>${f.k === 'cover' ?
            `<textarea data-dk="${f.k}" style="width:100%;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;box-sizing:border-box;height:60px;resize:vertical">${DEFAULTS[f.k] || ''}</textarea>` :
            `<input type="text" data-dk="${f.k}" value="${(DEFAULTS[f.k] || '').replace(/"/g, '&quot;')}" style="width:100%;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;box-sizing:border-box">`
          }</div>`
        ).join('');
      }
    });
    document.getElementById('ua-defaults-save')?.addEventListener('click', async () => {
      const newDefaults = {};
      defaultsContainer.querySelectorAll('[data-dk]').forEach(el => {
        newDefaults[el.dataset.dk] = (el.value || el.textContent || '').trim();
      });
      await saveCustomDefaults(newDefaults);
      defaultsPanel.style.display = 'none';
      defaultsToggle.style.display = 'block';
      LOG('Custom defaults saved');
    });
    document.getElementById('ua-defaults-cancel')?.addEventListener('click', () => {
      defaultsPanel.style.display = 'none';
      defaultsToggle.style.display = 'block';
    });

    // ---- Queue Settings ----
    loadRateLimitDelay().then(() => {
      const rlSelect = document.getElementById('ua-rate-limit');
      if (rlSelect) rlSelect.value = _rateLimitDelay.toString();
    });
    document.getElementById('ua-rate-limit')?.addEventListener('change', e => {
      setRateLimitDelay(parseInt(e.target.value));
    });
    document.getElementById('ua-timeout')?.addEventListener('change', e => {
      qTimeout = parseInt(e.target.value);
      st.set('ua_timeout', qTimeout);
    });
    st.get('ua_timeout').then(v => {
      if (v) { qTimeout = v; const el = document.getElementById('ua-timeout'); if (el) el.value = v.toString(); }
    });

    // Notifications toggle
    let _notifEnabled = false;
    st.get('ua_notif_enabled').then(v => {
      _notifEnabled = !!v;
      const el = document.getElementById('ua-notif');
      if (el) el.checked = _notifEnabled;
    });
    document.getElementById('ua-notif')?.addEventListener('change', async e => {
      _notifEnabled = e.target.checked;
      await st.set('ua_notif_enabled', _notifEnabled);
      if (_notifEnabled && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }
    });

    // Retry failed
    document.getElementById('ua-retry-failed')?.addEventListener('click', retryFailedJobs);

    // ---- Job Scraper ----
    document.getElementById('ua-scrape-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('ua-scrape-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }
      const count = await scrapeAndAddToQueue();
      if (btn) { btn.disabled = false; btn.textContent = count > 0 ? `Added ${count} jobs!` : 'No jobs found'; }
      setTimeout(() => { if (btn) btn.textContent = 'Scrape Jobs From This Page'; }, 3000);
    });

    // Profile editor
    const profFields = [
      { k: 'first_name', l: 'First Name' }, { k: 'last_name', l: 'Last Name' }, { k: 'email', l: 'Email' }, { k: 'phone', l: 'Phone' },
      { k: 'phoneCountryCode', l: 'Phone Code (+353)' }, { k: 'city', l: 'City' }, { k: 'state', l: 'State/County' }, { k: 'postal_code', l: 'Eircode/Zip' },
      { k: 'country', l: 'Country' }, { k: 'address', l: 'Address' }, { k: 'address_line_2', l: 'Address Line 2' },
      { k: 'gender', l: 'Gender (Male/Female/Other)' }, { k: 'ethnicity', l: 'Ethnicity' }, { k: 'veteran', l: 'Veteran Status' }, { k: 'disability', l: 'Disability Status' },
      { k: 'linkedin', l: 'LinkedIn URL' }, { k: 'github', l: 'GitHub URL' }, { k: 'website', l: 'Website' },
      { k: 'school', l: 'School/University' }, { k: 'degree', l: 'Degree' }, { k: 'major', l: 'Major' },
      { k: 'graduation_year', l: 'Grad Year' }, { k: 'current_title', l: 'Job Title' }, { k: 'current_company', l: 'Company' },
      { k: 'expected_salary', l: 'Expected Salary' }, { k: 'years', l: 'Years Experience' }, { k: 'nationality', l: 'Nationality' },
      { k: 'skills', l: 'Skills' }, { k: 'notice_period', l: 'Notice Period' }, { k: 'visa_status', l: 'Visa Status' },
    ];
    const profContainer = document.getElementById('ua-prof-fields');
    const profPanel = document.getElementById('ua-prof');
    const profToggle = document.getElementById('ua-prof-toggle');
    const profStatus = document.getElementById('ua-prof-status');

    profToggle.addEventListener('click', async () => {
      if (profPanel.style.display === 'none') {
        profPanel.style.display = 'block'; profToggle.style.display = 'none';
        const p = await getProfile();
        profContainer.innerHTML = profFields.map(f => `<div><label style="font-size:9px;color:#6b7280;display:block;margin-bottom:2px">${f.l}</label><input type="text" data-pk="${f.k}" value="${(p[f.k] || '').replace(/"/g, '&quot;')}" style="width:100%;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;box-sizing:border-box"></div>`).join('');
      }
    });
    document.getElementById('ua-prof-save')?.addEventListener('click', async () => {
      const p = await getProfile();
      profContainer.querySelectorAll('input[data-pk]').forEach(inp => { p[inp.dataset.pk] = inp.value.trim(); });
      await st.set(SK.PROF, p);
      profPanel.style.display = 'none'; profToggle.style.display = 'block';
      profStatus.textContent = '(saved)'; profStatus.style.color = '#059669';
      setTimeout(() => { profStatus.textContent = '(click to edit)'; profStatus.style.color = '#9ca3af'; }, 2000);
      LOG('Profile saved', p);
    });
    document.getElementById('ua-prof-cancel')?.addEventListener('click', () => {
      profPanel.style.display = 'none'; profToggle.style.display = 'block';
    });
  }

  async function handleFile(f) {
    const text = await f.text();
    // The structured parser handles real CSV/TSV exports; the loose one catches
    // free-text lists (a pasted block of links). Normalize + de-dupe across both so
    // the count matches the number of unique job URLs in the file — the double-parse
    // used to report roughly 2x the real number.
    const raw = [...parseCSV(text), ...parseBulkUrls(text)];
    const u = [...new Set(raw.map(normalizeUrl).filter(x => x && isSafeJobUrl(x)))];
    if (!u.length) { alert('No valid job URLs found in the file.'); return; }
    const before = queue.length;
    for (const x of u) await addJob(x);
    const added = queue.length - before;
    LOG(`Imported ${u.length} unique URLs (${added} new, ${u.length - added} already in queue)`);
    injectSidebarUI(); updateSidebarUI();
  }

  // ===================== RENDER =====================
  function renderQ() {
    const list = document.getElementById('ua-qlist'), cnt = document.getElementById('ua-q-cnt'), sum = document.getElementById('ua-qsum'), btns = document.getElementById('ua-qbtns'), badge = document.getElementById('ua-badge'), del = document.getElementById('ua-del'), sa = document.getElementById('ua-selall'), info = document.getElementById('ua-q-info');
    if (!list) return;
    cnt.textContent = `(${queue.length})`;
    badge.textContent = queue.length || '';
    info.textContent = queue.length ? queue.length + ' URL' + (queue.length > 1 ? 's' : '') : '';
    del.disabled = !selected.size;
    sa.checked = queue.length > 0 && selected.size === queue.length;

    // Titles and URLs come from an imported CSV — untrusted text. Escape them, or a
    // crafted cell injects markup straight into the page through innerHTML.
    list.innerHTML = queue.map((j, i) => `<div class="ua-qi"><input type="checkbox" data-id="${escHtml(j.id)}" class="qcb" ${selected.has(j.id) ? 'checked' : ''}><span class="num">${i + 1}</span><span class="url" title="${escHtml(j.url)}">${escHtml(j.title || j.url)}</span><span class="st ${escHtml(j.status)}">${escHtml(j.status)}</span><button class="rm" data-id="${escHtml(j.id)}">&times;</button></div>`).join('');

    list.querySelectorAll('.qcb').forEach(c => c.addEventListener('change', e => { if (e.target.checked) selected.add(e.target.dataset.id); else selected.delete(e.target.dataset.id); renderQ(); }));
    list.querySelectorAll('.rm').forEach(b => b.addEventListener('click', e => removeJob(e.currentTarget.dataset.id)));

    const pn = queue.filter(j => j.status === 'pending').length, dn = queue.filter(j => j.status === 'done').length, fl = queue.filter(j => j.status === 'failed').length, ap = queue.filter(j => j.status === 'applying').length;
    const to = queue.filter(j => j.status === 'timeout').length, sk = queue.filter(j => j.status === 'skipped').length;
    sum.innerHTML = queue.length ? `<span><i style="background:#f59e0b"></i>${pn} pending</span><span><i style="background:#3b82f6"></i>${ap} active</span><span><i style="background:#10b981"></i>${dn} done</span>${fl ? `<span><i style="background:#ef4444"></i>${fl} failed</span>` : ''}${to ? `<span><i style="background:#f97316"></i>${to} timeout</span>` : ''}${sk ? `<span><i style="background:#9ca3af"></i>${sk} skipped</span>` : ''}` : '';

    if (!queue.length) { btns.innerHTML = ''; return; }
    if (!qActive) {
      // LazyApply: show Resume button if there's a saved stop point
      const hasResumable = qStoppedAt >= 0 && qStoppedAt < queue.length;
      btns.innerHTML = `<button class="pri" id="uq-start" ${pn ? '' : 'disabled'}>Start Applying</button>${hasResumable ? '<button class="pri" id="uq-resume" style="background:#3b82f6">Resume</button>' : ''}<button class="sec" id="uq-clear">Clear All</button>`;
    }
    else { btns.innerHTML = `<button class="dan" id="uq-stop">Stop</button>`; }
    document.getElementById('uq-start')?.addEventListener('click', startQ);
    document.getElementById('uq-resume')?.addEventListener('click', resumeFromStopped);
    document.getElementById('uq-stop')?.addEventListener('click', stopQ);
    document.getElementById('uq-clear')?.addEventListener('click', clearQ);
  }

  // ===================== IN-SIDEBAR BULK-APPLY UI (native Jobright panel) =====================
  // Per user request the CSV import + queue controls live INSIDE the native Jobright
  // sidebar (not a separate floating popup that can disappear). We use one persistent
  // node and re-attach it whenever React re-renders the sidebar, so it never vanishes.
  let _sbSection = null;

  // Jobright 1.14.0 mounts its sidebar inside an OPEN Shadow DOM (plasmo-csui →
  // attachShadow). document.querySelector cannot pierce it, so the autofill button
  // lookups must walk shadow roots. getSidebar() returns the sidebar container
  // element (light or shadow) and caches it until it disconnects.
  let _sidebarCache = null;
  function getSidebar() {
    if (_sidebarCache && _sidebarCache.isConnected) return _sidebarCache;
    _sidebarCache = null;
    // 1. Light DOM (older builds)
    const light = document.getElementById('jobright-helper-id');
    if (light) { _sidebarCache = light; return light; }
    // 2. Known Plasmo hosts (fast path)
    for (const host of $$('plasmo-csui,[id*="plasmo"],[class*="plasmo"]')) {
      const r = host.shadowRoot;
      if (r) {
        const inner = r.querySelector('#jobright-helper-id,.jobright-helper-content-container');
        if (inner) { _sidebarCache = inner; return inner; }
      }
    }
    // 3. Bounded deep walk of every open shadow root (robust fallback)
    const stack = [document.documentElement];
    let guard = 0;
    while (stack.length && guard++ < 40000) {
      const node = stack.pop();
      if (!node) continue;
      const sr = node.shadowRoot;
      if (sr) {
        const inner = sr.querySelector('#jobright-helper-id,.jobright-helper-content-container');
        if (inner) { _sidebarCache = inner; return inner; }
        const afb = sr.querySelector('.auto-fill-button');
        // Return a node INSIDE the shadow tree (never the host — its querySelector
        // can't see into its own shadow root).
        if (afb) { _sidebarCache = afb.closest('#jobright-helper-id,.jobright-helper-content-container') || afb.parentElement; return _sidebarCache; }
        for (const c of sr.children) stack.push(c);
      }
      const kids = node.children;
      if (kids) for (const c of kids) stack.push(c);
    }
    return null;
  }
  // Back-compat alias used by the in-sidebar UI injector.
  function findSidebarRoot() { return getSidebar(); }
  // Query inside the sidebar (pierces shadow because we start from a node in its tree).
  function sbQuery(sel) { const s = getSidebar(); return s && s.querySelector ? s.querySelector(sel) : null; }
  // The Jobright "Autofill" button, wherever it lives.
  function findAutofillButton() { return sbQuery('.auto-fill-button'); }
  // Resolve a selector against the page first, then the sidebar shadow tree.
  function pageOrSidebar(sel) { return document.querySelector(sel) || sbQuery(sel); }
  // Wait until the Jobright sidebar exists (shadow-aware).
  function waitForSidebar(ms) {
    return new Promise(res => {
      const dl = Date.now() + (ms || 10000);
      const tick = () => {
        const s = getSidebar();
        if (s) return res(s);
        if (Date.now() > dl) return res(null);
        setTimeout(tick, 300);
      };
      tick();
    });
  }
  // Best-effort: make sure the Jobright sidebar is visible/expanded during a run,
  // and re-show our own control overlay. The host may have been hidden (display:none)
  // by a previous toggle, or Jobright may have collapsed the panel.
  function forceOpenSidebar() {
    try {
      const s = getSidebar();
      if (s) {
        // Only un-hide the host if something hid it. We deliberately do NOT click
        // Jobright's collapse toggle — doing so on every tick made the panel flicker
        // (disappear/appear). The panel naturally reloads once per job navigation.
        const host = (s.getRootNode && s.getRootNode().host) || null;
        if (host && host.style && host.style.display === 'none') host.style.display = '';
      }
      const ctrl = document.getElementById('ua-ctrl');
      if (ctrl && qActive && isRunnerTab()) ctrl.classList.add('show');
    } catch (_) {}
  }

  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Render the manageable job list inside the sidebar card (checkboxes, status,
  // per-row remove). Cheap-guarded so it only rebuilds when the queue/selection
  // actually changes (avoids resetting scroll/checkboxes on every status tick).
  let _sbQueueSig = '';
  function renderSidebarQueue() {
    if (!_sbSection) return;
    const manage = _sbSection.querySelector('#ua-sb-manage');
    const list = _sbSection.querySelector('#ua-sb-list');
    if (!manage || !list) return;
    if (!queue.length) { manage.style.display = 'none'; list.innerHTML = ''; _sbQueueSig = ''; return; }
    const sig = queue.length + '|' + queue.map(j => j.id + ':' + j.status + (selected.has(j.id) ? '*' : '')).join(',');
    if (sig === _sbQueueSig) return;
    _sbQueueSig = sig;
    manage.style.display = 'block';
    const STC = { pending: '#9aa0a6', applying: '#4ea1ff', done: '#34d399', failed: '#f87171', timeout: '#fbbf24', skipped: '#9aa0a6' };
    const MAX = 150;
    const shown = queue.slice(0, MAX);
    list.innerHTML = shown.map(j => {
      const label = j.companyName ? `${j.companyName} — ${j.title || ''}` : (j.title || shortUrl(j.url));
      return `<div style="display:flex;align-items:center;gap:7px;padding:5px 8px;background:#0e0e0f;border:1px solid #242427;border-radius:7px">
        <input type="checkbox" class="ua-sb-jobcb" data-id="${j.id}" ${selected.has(j.id) ? 'checked' : ''} style="accent-color:#00f0a0;width:13px;height:13px;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:#e7e7ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(j.url)}">${escHtml(label)}</div>
          <div style="font-size:9px;font-weight:600;color:${STC[j.status] || '#9aa0a6'};text-transform:capitalize">${escHtml(j.status)}</div>
        </div>
        <button class="ua-sb-jobdel" data-id="${j.id}" title="Remove" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0;padding:0 2px">×</button>
      </div>`;
    }).join('') + (queue.length > MAX ? `<div style="font-size:10px;color:#6f6f76;text-align:center;padding:5px">+${queue.length - MAX} more</div>` : '');
    list.querySelectorAll('.ua-sb-jobcb').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
      const selall = _sbSection.querySelector('#ua-sb-selall');
      if (selall) selall.checked = queue.length > 0 && queue.every(j => selected.has(j.id));
    }));
    list.querySelectorAll('.ua-sb-jobdel').forEach(b => b.addEventListener('click', () => removeJob(b.dataset.id)));
    const selall = _sbSection.querySelector('#ua-sb-selall');
    if (selall) selall.checked = queue.length > 0 && queue.every(j => selected.has(j.id));
  }

  function buildSidebarSection() {
    if (_sbSection) return _sbSection;
    const wrap = document.createElement('div');
    wrap.id = 'ua-sb';
    wrap.setAttribute('data-ua-keep', '1');
    wrap.setAttribute('style', "margin:10px 12px;padding:13px 14px;background:#141416;border:1px solid #2a2a2d;border-radius:12px;font-family:'Inter',system-ui,-apple-system,sans-serif;color:#e7e7ea");
    const greenBtn = 'padding:11px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;width:100%;background:#00f0a0;color:#001b12';
    const ghostBtn = 'padding:9px;border:1px solid #34343a;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#e7e7ea';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700;color:#fff">⚡ Bulk Auto-Apply</div>
        <div id="ua-sb-count" style="font-size:11px;font-weight:700;color:#9ff5d3;background:#0c2a20;border:1px solid #1c5743;border-radius:8px;padding:3px 9px">0 jobs</div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="ua-sb-upload" style="${ghostBtn};flex:1">⬆ Upload CSV</button>
        <button id="ua-sb-paste-toggle" style="${ghostBtn};flex:1">⛓ Paste URLs</button>
      </div>
      <div id="ua-sb-drop" style="border:1px dashed #2c5c4a;border-radius:9px;padding:9px;margin-bottom:8px;text-align:center;font-size:10.5px;color:#7d8b86;transition:all .15s;cursor:pointer">
        …or drop a CSV here <span style="color:#5b6b66">(or a list of job URLs)</span>
      </div>
      <input type="file" id="ua-sb-file" accept=".csv,.txt,.tsv,.json" multiple style="display:none">
      <div id="ua-sb-paste-wrap" style="display:none;margin-bottom:8px">
        <textarea id="ua-sb-textarea" placeholder="Paste job URLs — one per line" style="width:100%;box-sizing:border-box;min-height:64px;background:#0e0e0f;border:1px solid #34343a;border-radius:9px;color:#e7e7ea;font-size:12px;padding:8px;resize:vertical"></textarea>
        <button id="ua-sb-add" style="${ghostBtn};width:100%;margin-top:6px">Add to queue</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;color:#bfbfc4;cursor:pointer;user-select:none">
        <input type="checkbox" id="ua-sb-tailor" style="accent-color:#00f0a0;width:14px;height:14px"> Tailor resume for each job <span style="color:#6f6f76">(slower)</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;color:#bfbfc4;cursor:pointer;user-select:none"><input type="checkbox" id="ua-sb-skipapplied" style="accent-color:#00f0a0;width:13px;height:13px"> Skip jobs already applied to</label>
      <button id="ua-sb-cred-toggle" style="${ghostBtn};width:100%;text-align:left;margin-bottom:8px">🔑 ATS account login (saved credentials)</button>
      <div id="ua-sb-cred-wrap" style="display:none;margin-bottom:10px">
        <input id="ua-sb-cred-email" type="text" placeholder="Email" autocomplete="off" style="width:100%;box-sizing:border-box;background:#0e0e0f;border:1px solid #34343a;border-radius:8px;color:#e7e7ea;font-size:12px;padding:8px;margin-bottom:6px">
        <div style="position:relative">
          <input id="ua-sb-cred-pw" type="password" placeholder="Password (reused for ATS sign-ups)" autocomplete="new-password" spellcheck="false" style="width:100%;box-sizing:border-box;background:#0e0e0f;border:1px solid #34343a;border-radius:8px;color:#e7e7ea;font-size:12px;padding:8px;padding-right:38px">
          <button id="ua-sb-cred-eye" type="button" title="Show password" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:14px;line-height:1;color:#9aa0a6;padding:4px">👁</button>
        </div>
        <button id="ua-sb-cred-save" style="${ghostBtn};width:100%;margin-top:6px">Save credentials</button>
        <div style="font-size:9px;color:#6f6f76;margin-top:5px;line-height:1.4">Used to auto-create / sign in to ATS accounts (Workday, iCIMS, Taleo, SuccessFactors…). The same email &amp; password are reused across sites.</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:11px">
        <span style="font-size:11px;font-weight:600;color:#bfbfc4">Speed:</span>
        <button class="ua-sb-sp" data-sp="1" style="min-width:30px;height:24px;border-radius:12px;border:1px solid #fff;background:#fff;color:#0e0e0f;font-size:11px;font-weight:700;cursor:pointer">1x</button>
        <button class="ua-sb-sp" data-sp="1.5" style="min-width:30px;height:24px;border-radius:12px;border:1px solid #34343a;background:transparent;color:#bfbfc4;font-size:11px;font-weight:600;cursor:pointer">1.5x</button>
        <button class="ua-sb-sp" data-sp="2" style="min-width:30px;height:24px;border-radius:12px;border:1px solid #34343a;background:transparent;color:#bfbfc4;font-size:11px;font-weight:600;cursor:pointer">2x</button>
        <button class="ua-sb-sp" data-sp="3" style="min-width:30px;height:24px;border-radius:12px;border:1px solid #34343a;background:transparent;color:#bfbfc4;font-size:11px;font-weight:600;cursor:pointer">3x</button>
      </div>
      <div id="ua-sb-status" style="display:none;margin-bottom:9px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span id="ua-sb-job" style="font-size:12px;font-weight:600;color:#e7e7ea">Job 0 of 0</span>
          <span id="ua-sb-proc" style="font-size:11px;font-weight:600;color:#4ea1ff">Processing…</span>
        </div>
        <div style="margin-top:7px;height:5px;border-radius:4px;background:#2a2a2d;overflow:hidden"><div id="ua-sb-bar" style="height:100%;width:0%;border-radius:4px;background:linear-gradient(90deg,#00a86b,#00e58f);transition:width .4s"></div></div>
      </div>
      <button id="ua-sb-start" style="${greenBtn}">Start Applying</button>
      <button id="ua-sb-mgr" style="${greenBtn};background:#161925;color:#6ee7b7;border:1px solid #2c2c30" title="Docked queue manager: runs jobs in parallel background tabs and stays in place while you browse">🗂 Queue Manager (parallel tabs)</button>
      <button id="ua-sb-stop" style="${greenBtn};background:#000;color:#fff;border:1px solid #2c2c30;display:none">Stop</button>
      <div id="ua-sb-runrow" style="display:none;gap:8px;margin-top:8px">
        <button id="ua-sb-pause" style="${ghostBtn};flex:1">Pause</button>
        <button id="ua-sb-skip" style="${ghostBtn};flex:1">Skip</button>
      </div>
      <div id="ua-sb-manage" style="display:none;margin-top:12px;border-top:1px solid #242427;padding-top:11px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#bfbfc4;cursor:pointer;user-select:none"><input type="checkbox" id="ua-sb-selall" style="accent-color:#00f0a0;width:13px;height:13px"> All</label>
          <button id="ua-sb-delsel" style="${ghostBtn};padding:6px 9px;flex:0 0 auto;font-size:11px">Delete selected</button>
          <button id="ua-sb-clear" style="padding:6px 9px;border:1px solid #5a2330;border-radius:8px;background:transparent;color:#f87171;font-size:11px;font-weight:600;cursor:pointer">Clear all</button>
        </div>
        <div id="ua-sb-list" style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
      </div>
      <div style="margin-top:10px;font-size:10px;color:#6f6f76;line-height:1.4">CSV / list of job URLs → opens each, runs Jobright Autofill, fills required fields &amp; submits automatically.</div>
    `;
    // --- wire events (engine functions are in this same scope) ---
    const fileInput = wrap.querySelector('#ua-sb-file');
    wrap.querySelector('#ua-sb-upload').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) await handleFile(f);
    });

    /* Drag and drop, on the whole bulk-apply card as well as the dashed strip —
       dropping a CSV is the natural gesture and the button alone made it a
       hidden feature. Text drops work too, so a list of URLs copied out of a
       spreadsheet or an email can be dragged straight in. */
    const dropZone = wrap.querySelector('#ua-sb-drop');
    const idleStyle = { border: '1px dashed #2c5c4a', background: 'transparent', color: '#7d8b86' };
    const overStyle = { border: '1px dashed #00f0a0', background: 'rgba(0,240,160,.08)', color: '#9ff5d3' };
    const paint = (st) => { if (dropZone) Object.assign(dropZone.style, st); };
    let dragDepth = 0;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

    dropZone?.addEventListener('click', () => fileInput.click());

    for (const target of [wrap, dropZone].filter(Boolean)) {
      target.addEventListener('dragenter', (e) => { stop(e); if (++dragDepth === 1) paint(overStyle); });
      target.addEventListener('dragover', (e) => {
        stop(e);
        // Tell the browser this is a copy, or some platforms refuse the drop.
        try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
      });
      target.addEventListener('dragleave', (e) => { stop(e); if (--dragDepth <= 0) { dragDepth = 0; paint(idleStyle); } });
      target.addEventListener('drop', async (e) => {
        stop(e);
        dragDepth = 0;
        paint(idleStyle);
        const dt = e.dataTransfer;
        if (!dt) return;
        const files = dt.files ? [...dt.files] : [];
        if (files.length) {
          for (const f of files) await handleFile(f);
          return;
        }
        // A dragged selection / link rather than a file.
        const text = (dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain'))) || '';
        if (!text.trim()) return;
        const urls = parseBulkUrls(text);
        if (!urls.length) { alert('No valid job URLs in what you dropped.'); return; }
        const before = queue.length;
        for (const u of urls) await addJob(u);
        LOG(`Dropped text: ${urls.length} URLs (${queue.length - before} new)`);
        injectSidebarUI(); updateSidebarUI();
      });
    }
    const pasteWrap = wrap.querySelector('#ua-sb-paste-wrap');
    wrap.querySelector('#ua-sb-paste-toggle').addEventListener('click', () => {
      pasteWrap.style.display = pasteWrap.style.display === 'none' ? 'block' : 'none';
      if (pasteWrap.style.display === 'block') wrap.querySelector('#ua-sb-textarea').focus({ preventScroll: true });
    });
    wrap.querySelector('#ua-sb-add').addEventListener('click', async () => {
      const ta = wrap.querySelector('#ua-sb-textarea');
      const urls = parseBulkUrls(ta.value);
      if (!urls.length) { alert('No valid URLs found.'); return; }
      for (const u of urls) await addJob(u);
      ta.value = ''; pasteWrap.style.display = 'none';
      LOG(`Added ${urls.length} URLs from sidebar`);
    });
    wrap.querySelector('#ua-sb-start').addEventListener('click', () => { if (!queue.some(j => j.status === 'pending')) { alert('Queue is empty — upload a CSV or paste job URLs first.'); return; } startQ(); });
    wrap.querySelector('#ua-sb-mgr')?.addEventListener('click', () => {
      // Ask the service worker to open it: a content script's window.open of an
      // extension URL is blocked outright by some sites' CSP, which made this
      // button do nothing on exactly the ATS pages you need it on.
      try {
        chrome.runtime.sendMessage({ type: 'UA_MGR_CMD', cmd: 'openManager' }, (r) => {
          void chrome.runtime.lastError;
          if (!r || !r.ok) { try { window.open(chrome.runtime.getURL('ua-queue.html'), '_blank'); } catch (_) {} }
        });
      } catch (_) {
        try { window.open(chrome.runtime.getURL('ua-queue.html'), '_blank'); } catch (__) { alert('Could not open the Queue Manager'); }
      }
    });
    wrap.querySelector('#ua-sb-stop').addEventListener('click', stopQ);
    wrap.querySelector('#ua-sb-pause').addEventListener('click', () => { if (qPaused) resumeQ(); else pauseQ(); });
    wrap.querySelector('#ua-sb-skip').addEventListener('click', skipJob);
    // --- bulk queue management ---
    wrap.querySelector('#ua-sb-selall').addEventListener('change', e => {
      if (e.target.checked) queue.forEach(j => selected.add(j.id)); else selected.clear();
      renderSidebarQueue();
    });
    wrap.querySelector('#ua-sb-delsel').addEventListener('click', async () => {
      if (!selected.size) { alert('Select one or more jobs first (tick the boxes or "All").'); return; }
      const n = selected.size;
      if (confirm(`Remove ${n} selected job${n === 1 ? '' : 's'} from the queue?`)) await removeSelected();
    });
    wrap.querySelector('#ua-sb-clear').addEventListener('click', async () => {
      if (!queue.length) return;
      if (confirm(`Clear ALL ${queue.length} jobs from the queue?`)) await clearQ();
    });
    const tailorCb = wrap.querySelector('#ua-sb-tailor');
    tailorCb.checked = queueUseTailor;
    tailorCb.addEventListener('change', () => { queueUseTailor = tailorCb.checked; try { st.set('ua_queue_tailor', queueUseTailor); } catch (_) {} LOG('Queue tailoring ' + (queueUseTailor ? 'ON' : 'OFF')); });
    const skipCb = wrap.querySelector('#ua-sb-skipapplied');
    skipCb.checked = qSkipApplied;
    skipCb.addEventListener('change', () => { qSkipApplied = skipCb.checked; try { st.set('ua_skip_applied', qSkipApplied); } catch (_) {} });
    // --- saved ATS credentials ---
    const credWrap = wrap.querySelector('#ua-sb-cred-wrap');
    const pwInput = wrap.querySelector('#ua-sb-cred-pw');
    const eyeBtn = wrap.querySelector('#ua-sb-cred-eye');
    const maskPw = () => { pwInput.type = 'password'; eyeBtn.textContent = '👁'; eyeBtn.title = 'Show password'; };
    // View-password toggle.
    eyeBtn.addEventListener('click', () => {
      const hidden = pwInput.type === 'password';
      pwInput.type = hidden ? 'text' : 'password';
      eyeBtn.textContent = hidden ? '🙈' : '👁';
      eyeBtn.title = hidden ? 'Hide password' : 'Show password';
    });
    wrap.querySelector('#ua-sb-cred-toggle').addEventListener('click', async () => {
      const show = credWrap.style.display === 'none';
      credWrap.style.display = show ? 'block' : 'none';
      if (show) {
        maskPw(); // always reveal-hidden when opening
        try { const pr = await getProfile(); wrap.querySelector('#ua-sb-cred-email').value = pr.email || ''; pwInput.value = await getAppPassword(); } catch (_) {}
      }
    });
    wrap.querySelector('#ua-sb-cred-save').addEventListener('click', async () => {
      const em = wrap.querySelector('#ua-sb-cred-email').value.trim();
      const pw = pwInput.value.trim();
      try {
        if (pw) await st.set('ua_app_password', pw);
        if (em) { const pr = (await st.get(SK.PROF)) || {}; pr.email = em; await st.set(SK.PROF, pr); await st.set('ua_app_email', em); }
      } catch (_) {}
      maskPw(); // re-hide the password after saving, for safety
      const btn = wrap.querySelector('#ua-sb-cred-save'); const t = btn.textContent; btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = t; }, 1500);
      LOG('Saved ATS credentials');
    });
    // Speed selector (shared with the overlay; scales automation waits + job delay).
    wrap.querySelectorAll('.ua-sb-sp').forEach(b => b.addEventListener('click', () => setQueueSpeed(parseFloat(b.dataset.sp) || 1)));
    paintSidebarSpeed();
    _sbSection = wrap;
    return wrap;
  }

  // Ensure the bulk-apply section is present inside the native sidebar; React
  // re-renders can detach it, so we re-append the same node (preserves state).
  // ===================== FULLY-AUTOMATED TOGGLE (standalone preference) =====================
  // A single ON/OFF switch, separate from the Bulk Auto-Apply card. When ON, any page
  // whose ATS we detect (Workday, Greenhouse, Lever, iCIMS, …) starts the full apply
  // automation on its own — no clicking Apply, Apply Manually, account creation, or
  // submit. The preference is persisted (SK.AA) and shared with the Alt+A shortcut and
  // the advanced-drawer checkbox.
  async function setAutoApply(val, startNow, source) {
    autoApply = !!val;
    // Persisted immediately, so the choice survives a reload, a new tab, a
    // browser restart and a service-worker recycle. Nothing else in the
    // extension writes this key.
    try { await st.set(SK.AA, autoApply); } catch (_) {}
    paintAutoToggle();
    try { const d = document.getElementById('ua-aa'); if (d) d.checked = autoApply; } catch (_) {}
    try { updateStat(); } catch (_) {}
    // The source is logged so that if the switch ever appears to move on its own
    // again, the log names what moved it.
    LOG(`Fully Automated toggled ${autoApply ? 'ON' : 'OFF'} (by ${source || 'unknown'})`);
    if (autoApply && startNow && (detectATS() || isWorkday())) {
      LOG('Fully Automated ON — starting full automation for ' + (detectATS() || 'Workday'));
      if (isWorkday()) startWorkdayAccountWatch();
      dispatchATSAutomation();
    }
  }
  function paintAutoToggle() {
    // Repaint EVERY toggle instance, not just _faCard. Jobright's React sidebar re-renders
    // can leave stale/duplicate cards in the shadow DOM; if we only painted _faCard, a copy
    // the user actually clicked could show the wrong state (the "won't turn off" bug). Deep-
    // query all toggles across shadow roots and sync the drawer checkbox too.
    try {
      const toggles = (typeof window.__uaDeepQueryAll === 'function')
        ? window.__uaDeepQueryAll('#ua-fa-toggle')
        : [_faCard && _faCard.querySelector('#ua-fa-toggle')].filter(Boolean);
      for (const t of toggles) {
        if (!t) continue;
        t.setAttribute('aria-checked', autoApply ? 'true' : 'false');
        t.style.background = autoApply ? '#00f0a0' : '#3a3a42';
        const knob = t.querySelector('span');
        if (knob) knob.style.transform = autoApply ? 'translateX(20px)' : 'translateX(0)';
        const card = t.closest('#ua-fa-card');
        const lbl = card && card.querySelector('#ua-fa-state');
        if (lbl) { lbl.textContent = autoApply ? 'ON' : 'OFF'; lbl.style.color = autoApply ? '#00f0a0' : '#9aa0a6'; }
        if (card) card.style.borderColor = autoApply ? '#1c8a5e' : '#1c5743';
      }
      const d = document.getElementById('ua-aa'); if (d) d.checked = autoApply;
    } catch (_) {}
  }
  let _faCard = null;
  function buildFullAutoCard() {
    if (_faCard && _faCard.isConnected) return _faCard;
    const card = document.createElement('div');
    card.id = 'ua-fa-card';
    card.setAttribute('data-ua-keep', '1');
    card.setAttribute('style', "margin:10px 12px;padding:11px 13px;background:#0c2118;border:1px solid #1c5743;border-radius:12px;font-family:'Inter',system-ui,-apple-system,sans-serif");
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;flex-direction:column;line-height:1.3">
          <span style="font-size:13px;font-weight:800;color:#9ff5d3">🤖 Fully Automated <span id="ua-fa-state" style="font-weight:800;color:#9aa0a6;margin-left:3px">OFF</span></span>
          <span style="font-size:9px;color:#6f8f82;margin-top:2px">Auto-detect the ATS &amp; apply with zero clicks</span>
        </div>
        <button id="ua-fa-toggle" type="button" role="switch" aria-checked="false" title="Toggle fully-automated mode (Alt+A)" style="flex:0 0 auto;width:46px;height:24px;border-radius:13px;border:none;background:#3a3a42;cursor:pointer;position:relative;padding:0;transition:background .2s">
          <span style="position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>
        </button>
      </div>
      <button id="ua-fa-gaps" type="button" title="Fill the location / visa-sponsorship / EEO fields Jobright left blank (Alt+F)" style="width:100%;margin-top:9px;padding:7px;border:1px solid #1c5743;border-radius:8px;background:transparent;color:#9ff5d3;font-size:11px;font-weight:600;cursor:pointer">🩹 Fill gaps Jobright missed</button>`;
    card.querySelector('#ua-fa-toggle').addEventListener('click', () => setAutoApply(!autoApply, true, 'switch'));
    card.querySelector('#ua-fa-gaps').addEventListener('click', async (ev) => {
      const b = ev.currentTarget; const t = b.textContent; b.textContent = 'Filling…'; b.disabled = true;
      try { await resolveLocationFields(); await answerChoiceGroups(); await fallbackFill(); await guaranteeRequiredFields(); }
      catch (e) { LOG('Fill-gaps error:', e?.message || e); }
      b.textContent = 'Done ✓'; setTimeout(() => { b.textContent = t; b.disabled = false; }, 1400);
    });
    _faCard = card;
    setTimeout(paintAutoToggle, 0);
    return card;
  }

  function injectSidebarUI() {
    const root = findSidebarRoot();
    if (!root) return;
    const fa = buildFullAutoCard();
    const sec = buildSidebarSection();
    // Remove any stale/duplicate Fully-Automated cards (left behind by Jobright re-renders)
    // so there's exactly ONE live toggle — a click can never land on a dead copy.
    try {
      (typeof window.__uaDeepQueryAll === 'function' ? window.__uaDeepQueryAll('#ua-fa-card') : [...document.querySelectorAll('#ua-fa-card')])
        .forEach(c => { if (c !== _faCard) c.remove(); });
    } catch (_) {}
    // Already attached — just make sure the Fully-Automated card is present too.
    if (sec.isConnected && root.contains(sec)) {
      if (fa && !root.contains(fa) && sec.parentElement) sec.parentElement.insertBefore(fa, sec);
      paintAutoToggle();
      return;
    }
    const anchor = root.querySelector('.autofill-button-group') ||
      root.querySelector('.job-profile-container') ||
      (root.querySelector('.auto-fill-button') && root.querySelector('.auto-fill-button').parentElement);
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(sec, anchor.nextSibling);
      if (fa && sec.parentElement) sec.parentElement.insertBefore(fa, sec); // Fully-Automated card above the bulk card
    } else { root.appendChild(fa); root.appendChild(sec); }
    paintAutoToggle();
    updateSidebarUI();
  }

  function updateSidebarUI() {
    if (!_sbSection) return;
    renderSidebarQueue();
    const q = (id) => _sbSection.querySelector(id);
    const pending = queue.filter(j => j.status === 'pending').length;
    const cnt = q('#ua-sb-count'); if (cnt) cnt.textContent = `${queue.length} job${queue.length === 1 ? '' : 's'}`;
    const tailorCb = q('#ua-sb-tailor'); if (tailorCb && tailorCb.checked !== queueUseTailor) tailorCb.checked = queueUseTailor;
    const skipCb = q('#ua-sb-skipapplied'); if (skipCb && skipCb.checked !== qSkipApplied) skipCb.checked = qSkipApplied;
    paintSidebarSpeed();
    const start = q('#ua-sb-start'), stop = q('#ua-sb-stop'), runrow = q('#ua-sb-runrow'), status = q('#ua-sb-status');
    if (qActive) {
      if (start) start.style.display = 'none';
      if (stop) stop.style.display = 'block';
      if (runrow) runrow.style.display = 'flex';
      if (status) status.style.display = 'block';
      const total = queue.length;
      const dn = queue.filter(j => ['done', 'failed', 'timeout', 'skipped'].includes(j.status)).length;
      const current = queue.find(j => j.status === 'applying') || queue.find(j => j.status === 'pending');
      const curIndex = current ? queue.indexOf(current) + 1 : total;
      const job = q('#ua-sb-job'); if (job) job.textContent = `Job ${Math.min(curIndex, total)} of ${total}`;
      const bar = q('#ua-sb-bar'); if (bar) bar.style.width = (total ? Math.round((dn / total) * 100) : 0) + '%';
      const proc = q('#ua-sb-proc'); if (proc) proc.textContent = qPaused ? 'Paused' : 'Processing…';
      const pause = q('#ua-sb-pause'); if (pause) pause.textContent = qPaused ? 'Resume' : 'Pause';
    } else {
      if (start) { start.style.display = 'block'; start.textContent = pending ? `Start Applying (${pending})` : 'Start Applying'; start.style.opacity = pending ? '1' : '.55'; }
      if (stop) stop.style.display = 'none';
      if (runrow) runrow.style.display = 'none';
      if (status) status.style.display = 'none';
    }
  }

  // Paint the sidebar card's speed buttons (green = selected, clear indicator).
  function paintSidebarSpeed() {
    if (!_sbSection) return;
    _sbSection.querySelectorAll('.ua-sb-sp').forEach(b => {
      const on = parseFloat(b.dataset.sp) === qSpeed;
      b.style.background = on ? '#00f0a0' : 'transparent';
      b.style.color = on ? '#06231a' : '#bfbfc4';
      b.style.borderColor = on ? '#00f0a0' : '#34343a';
      b.style.fontWeight = on ? '800' : '600';
      b.style.boxShadow = on ? '0 0 0 2px rgba(0,240,160,.25)' : 'none';
    });
  }
  // Single source of truth for speed: updates the wait factor, persistence, and
  // BOTH indicators (overlay + sidebar card).
  function setQueueSpeed(s) {
    qSpeed = s; qSpeedFactor = speedFactorFor(s);
    try { st.set('ua_q_speed', qSpeed); } catch (_) {}
    const ov = document.getElementById('ua-ctrl');
    if (ov) ov.querySelectorAll('.uc-sp').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.sp) === qSpeed));
    paintSidebarSpeed();
    LOG('Queue speed set to ' + qSpeed + 'x (wait factor ' + qSpeedFactor + ')');
  }

  // LazyApply-style completion summary shown in the overlay when a run finishes.
  let _summaryTimer = null;
  function showCompletionSummary() {
    const ctrl = document.getElementById('ua-ctrl');
    if (!ctrl) return;
    const done = queue.filter(j => j.status === 'done').length;
    const skipped = queue.filter(j => j.status === 'skipped').length;
    const failed = queue.filter(j => ['failed', 'timeout'].includes(j.status)).length;
    const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    const title = ctrl.querySelector('.uc-title'); if (title) title.textContent = '✅ Automation Complete';
    set('uc-count', `${queue.length} total`);
    set('uc-pos', 'All jobs processed');
    const co = document.getElementById('uc-pos-co'); if (co) co.style.display = 'none';
    const bar = document.getElementById('uc-bar'); if (bar) bar.style.width = '100%';
    const proc = document.getElementById('uc-proc');
    if (proc) { proc.textContent = `${done} applied · ${skipped} skipped · ${failed} failed`; proc.classList.remove('paused'); proc.style.color = '#34d399'; }
    set('uc-ok', done); set('uc-sk', skipped); set('uc-fa', failed);
    const runrow = ctrl.querySelector('.uc-actions'); // keep Quit to dismiss
    ctrl.classList.add('show');
    clearTimeout(_summaryTimer);
    _summaryTimer = setTimeout(() => { ctrl.classList.remove('show'); }, 15000);
  }

  function updateCtrl() {
    updateSidebarUI(); // keep the in-native-sidebar bulk-apply controls in sync
    const ctrl = document.getElementById('ua-ctrl');
    if (!ctrl) return;
    const pauseBtn = document.getElementById('uc-pause');
    // Only show the run overlay in the dedicated runner tab.
    if (qActive && isRunnerTab()) {
      ctrl.classList.add('show');
      const total = queue.length;
      const dn = queue.filter(j => ['done', 'failed', 'timeout', 'skipped'].includes(j.status)).length;
      // The "current" job is the one applying, else the next pending, else last done.
      const current = queue.find(j => j.status === 'applying') || queue.find(j => j.status === 'pending');
      const curIndex = current ? queue.indexOf(current) + 1 : Math.min(dn + 1, total);
      const countEl = document.getElementById('uc-count');
      if (countEl) countEl.textContent = `Job ${Math.min(curIndex, total)} of ${total}`;
      const posEl = document.getElementById('uc-pos');
      const coEl = document.getElementById('uc-pos-co');
      if (posEl) posEl.textContent = current ? `Position at ${current.companyName || shortBoardName(current)}` : 'Finishing up…';
      if (coEl) {
        const co = current && (current.companyName || current.jobBoard);
        if (co) { coEl.textContent = co; coEl.style.display = ''; } else { coEl.style.display = 'none'; }
      }
      const bar = document.getElementById('uc-bar');
      if (bar) bar.style.width = (total ? Math.round((dn / total) * 100) : 0) + '%';
      // Live LazyApply-style counters.
      const okEl = document.getElementById('uc-ok'), skEl = document.getElementById('uc-sk'), faEl = document.getElementById('uc-fa');
      if (okEl) okEl.textContent = queue.filter(j => j.status === 'done').length;
      if (skEl) skEl.textContent = queue.filter(j => j.status === 'skipped').length;
      if (faEl) faEl.textContent = queue.filter(j => ['failed', 'timeout'].includes(j.status)).length;
      /* "37 failed" is not a fact anyone can act on — not you watching the run,
         and not whoever you show it to. Every failure already recorded a reason;
         they were only ever readable in the side panel, which is not the thing
         on screen during a run. Put the commonest one here, where it is. */
      const whyEl = document.getElementById('uc-why');
      if (whyEl) {
        const top = topFailureReason();
        if (top) {
          whyEl.textContent = `Most failures: ${top.reason} (${top.n})`;
          whyEl.title = `Click to copy all ${top.total} failures with their reasons`;
          whyEl.style.display = '';
        } else whyEl.style.display = 'none';
      }
      const proc = document.getElementById('uc-proc');
      if (proc) {
        if (qPaused) { proc.textContent = 'Paused'; proc.classList.add('paused'); }
        else { proc.textContent = 'Processing…'; proc.classList.remove('paused'); }
      }
      // Reflect persisted speed on the selector.
      ctrl.querySelectorAll('.uc-sp').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.sp) === qSpeed));
      if (pauseBtn) {
        if (qPaused) { pauseBtn.textContent = 'Resume'; pauseBtn.className = 'uc-act resume'; }
        else { pauseBtn.textContent = 'Pause'; pauseBtn.className = 'uc-act pause'; }
      }
    } else if (!qActive) {
      /* Only a run that is genuinely OVER may hide the panel. A tab that simply
         has not re-confirmed it is the runner yet must not — that is what made
         the panel vanish after the first cross-site job. */
      ctrl.classList.remove('show');
    }
  }

  /* The reason that cost the most jobs, and how many. Failures cluster: thirty
     of them are usually three causes, and knowing which one is biggest is the
     difference between fixing the run and guessing at it. */
  function failureGroups() {
    const bad = queue.filter(j => ['failed', 'timeout'].includes(j.status) ||
      (j.status === 'skipped' && j.error && !/^Skipped by user$/i.test(j.error)));
    const by = new Map();
    for (const j of bad) {
      const key = `${j.status}: ${j.error || 'no reason recorded'}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(j.url);
    }
    return { bad, groups: [...by.entries()].sort((a, b) => b[1].length - a[1].length) };
  }
  function topFailureReason() {
    const { bad, groups } = failureGroups();
    if (!groups.length) return null;
    return { reason: groups[0][0], n: groups[0][1].length, total: bad.length };
  }
  function failureReportText() {
    const { bad, groups } = failureGroups();
    const done = queue.filter(j => j.status === 'done').length;
    const out = [`Jobright queue — ${queue.length} jobs, ${done} applied, ${bad.length} not`, ''];
    for (const [reason, urls] of groups) {
      out.push(`${urls.length}x  ${reason}`);
      for (const u of urls.slice(0, 8)) out.push(`      ${u}`);
      if (urls.length > 8) out.push(`      …and ${urls.length - 8} more`);
      out.push('');
    }
    return out.join('\n');
  }

  // Friendly fallback label when a queued job has no captured company name.
  function shortBoardName(job) {
    if (!job) return '—';
    const b = job.jobBoard && job.jobBoard !== 'other' ? job.jobBoard : '';
    if (b) return b.charAt(0).toUpperCase() + b.slice(1);
    return job.title ? String(job.title).slice(0, 24) : 'this role';
  }

  function updateStat() {
    const el = document.getElementById('ua-stat'), t = document.getElementById('ua-stat-t'); if (!el) return;
    const ats = detectATS();
    if (autoApply) { el.className = 'ua-stat on'; t.textContent = ats ? 'Active - ' + ats + ' detected' : 'Active - monitoring'; }
    else { el.className = 'ua-stat off'; t.textContent = 'Inactive'; }
  }

  function showATSBadge() { const a = detectATS(); if (a) { document.getElementById('ua-ats-n').textContent = a + ' Detected'; document.getElementById('ua-ats').classList.add('show'); } }

  // ===================== OBSERVER =====================
  let _sbInjectThrottle = 0;
  function observe() {
    // Debounced: coalesce mutation bursts so hideCredits/injectSidebarUI run at most
    // once per ~300ms instead of on every single DOM change (a fast autofill on a big
    // form generates thousands of mutations — running these per-mutation froze the tab).
    let _obsT = null;
    const o = new MutationObserver(() => {
      if (_obsT) return;
      _obsT = setTimeout(() => {
        _obsT = null;
        hideCredits();
        const now = Date.now();
        if (now - _sbInjectThrottle > 400) { _sbInjectThrottle = now; injectSidebarUI(); }
      }, 300);
    });
    o.observe(document.body || document.documentElement, { childList: true, subtree: true });
    // Safety net: periodic re-inject in case the sidebar mounts without mutations
    // we observed (e.g. inside a shadow root). Cheap — one querySelector per tick.
    // During a run, also keep Jobright's own popup open so you can watch it autofill.
    // Every 1.5s was a re-scan of the page for a sidebar that is already mounted
    // 99 times out of 100. Half the frequency, same effect.
    setInterval(() => { injectSidebarUI(); if (qActive && isRunnerTab()) forceOpenSidebar(); }, 3000);
    // Watchdog: keep the control panel alive throughout the run. If anything removes
    // it (page script, re-render), re-mount it within ~600ms so the controls never
    // disappear while automation is in progress.
    setInterval(() => {
      if (!qActive) {
        // Run over: hand the page back. The MAIN-world dialog hooks read this
        // attribute, so leaving it set would keep suppressing "Leave site?" long
        // after the automation stopped — the user must get their warnings back.
        if (!autoApply) setAutomationFlag(false);
        return;
      }
      // Re-establish the runner marker if a cross-site navigation wiped it, then
      // re-mount the panel. Gating this on isRunnerTab() — the very thing that
      // breaks — is why the panel never came back on its own.
      if (!isRunnerTab()) confirmRunnerTab().then((ok) => { if (ok) { ensureOverlay(); updateCtrl(); } });
      /* Keep the automation flag set for the WHOLE run, not just while a dispatch
         happens to be in flight. The MAIN-world hooks use it to decide whether to
         suppress a blocking dialog, and the "Leave site?" prompt fires during the
         navigation BETWEEN steps — precisely the gap where the flag used to be
         handed back, so the shield was down exactly when it was needed. */
      if (isRunnerTab()) setAutomationFlag(true);
      ensureOverlay();
      updateCtrl();
    }, 2000);   // twice a second was needless: the panel is re-mounted, not animated
  }

  // ===================== APPLY-BUTTON OPENER (reveal the form on listing pages) =====================
  // Many imported CSV URLs point at a job listing/description, where you must click
  // "Apply" / "Apply Now" / "Easy Apply" before any form exists. Without this the
  // queue lands on the listing, finds no fields, and times out. We click through to
  // the actual application form first.
  function hasApplicationForm() {
    const hasFile = deepAll('input[type=file]').some(isVisible);
    if (hasFile) return true;
    const fields = deepAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]):not([type=checkbox]):not([type=radio]),textarea,select').filter(isVisible);
    return fields.length >= 3;
  }
  /* ── GETTING FROM THE JOB DESCRIPTION INTO THE APPLICATION (every ATS) ──────
     A queued URL nearly always lands on the JD page, not the form, and the
     button that opens the form is named whatever the platform felt like:
     SmartRecruiters says "I'm interested", Greenhouse "Apply for this job",
     Workday "Apply", Lever "Apply for this job", Oracle "Apply Now", ADP "Apply
     to this job", and half of Europe says it in another language entirely.
     Getting this wrong means the job is skipped before autofill ever runs. */

  // Smart quotes are not straight quotes: SmartRecruiters renders "I’m interested"
  // with U+2019, which /i'?m interested/ does not match.
  function normLabel(t) {
    return String(t == null ? '' : t)
      .replace(/[‘’ʼ´`]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const APPLY_TEXT_RE = new RegExp('^(' + [
    'apply', 'apply now', 'apply here', 'apply today', 'apply online', 'apply instantly',
    'apply for (this |the )?(job|role|position|opportunity|vacancy|opening)',
    'apply to (this |the )?(job|role|position|opportunity|vacancy|opening)',
    'apply with', 'apply via', 'apply using', 'apply on',
    'easy apply', 'quick apply', 'fast apply', 'simple apply',
    '(1|one)[ -]?click apply', 'apply in (1|one) click',
    "i'm interested", 'i am interested', 'interested\\?',
    'express (your |an )?interest', 'register (your )?interest', 'submit (your )?interest',
    'start (your |the |an )?application', 'begin (your |the |an )?application',
    'continue (to )?(the |your )?application', 'go to (the )?application',
    'complete (your |the )?application', 'proceed to (the )?application',
    'submit (your |a )?(resume|cv|cover letter)', 'send (your |a )?(resume|cv|application)',
    'postuler', 'je postule', 'postuler maintenant', 'candidater',
    'jetzt bewerben', 'bewerben', 'bewerbung starten',
    'solicitar', 'postularse', 'inscribirse', 'candidatar-se', 'candidatura',
    'solliciteer', 'sollicitatie', 'ansok', 'ansök', 'sok stillingen', 'søk', 'hae', 'aplica',
  ].join('|') + ')\\b', 'i');

  /* Things that read like Apply but are not: the already-applied state, a filter,
     a save/share affordance, a sign-in wall, a link back to the listing. Clicking
     any of them wastes a click and can navigate off the job entirely. */
  const APPLY_BAD_RE = /already applied|you have applied|application (sent|submitted|received)|how to apply|apply filter|apply filters|apply changes|apply coupon|save (this )?job|share (this )?job|refer a friend|job alert|create (an )?alert|sign ?in|log ?in|create (an )?account|register now|^applied$|^apply later$|view (all )?(other )?jobs|see (all|other) jobs|similar jobs|back to (jobs|search|results)|report this|withdraw/i;

  function isApplyLabel(text) {
    const t = normLabel(text);
    if (!t || t.length > 48) return false;
    if (APPLY_BAD_RE.test(t)) return false;
    return APPLY_TEXT_RE.test(t);
  }

  /* Scored, not first-match: a JD page routinely carries several qualifying
     controls (a sticky header Apply, an inline one, a footer link, and — on
     aggregators — one per "other jobs at this company" row). Prefer the real
     primary action. Enumerated deeply, so an apply button inside a web component
     or a same-origin frame is found, and our own sidebar is excluded. */
  function findApplyButton() {
    const known = ['.jobs-apply-button', 'button.jobs-apply-button--top-card', '#indeedApplyButton',
      '#applyButtonLinkContainer a', 'button[data-testid*="apply" i]', 'a[data-testid*="apply" i]',
      '[data-automation-id*="apply" i]', '[class*="apply-button" i]', '[class*="applyButton" i]',
      'button[aria-label*="apply" i]', 'a[aria-label*="apply" i]', 'spl-button[data-test*="apply" i]'];
    for (const sel of known) {
      for (const el of deepAll(sel, 8)) {
        if (el && isVisible(el) && !el.disabled && !APPLY_BAD_RE.test(normLabel(el.textContent))) return el;
      }
    }
    const cands = deepAll('button,a[role="button"],a,[role="button"],input[type=button],input[type=submit],spl-button,oj-button', 400)
      .filter(isVisible);
    let best = null, bestScore = -1;
    for (const b of cands) {
      if (b.disabled) continue;
      const t = normLabel(b.textContent || b.value || b.getAttribute?.('aria-label') || '');
      if (!isApplyLabel(t)) continue;
      let score = 10;
      const tag = (b.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'spl-button' || b.getAttribute?.('role') === 'button') score += 4;
      if (/^apply\b|^i'm interested|^apply now/i.test(t)) score += 3;   // the canonical primary action
      if (/\bwith\b|\bvia\b|\busing\b/i.test(t)) score -= 5;            // "Apply with LinkedIn" — a detour
      if (t.length <= 24) score += 2;
      // A control sitting in a list of OTHER jobs is not this job's Apply.
      try { if (b.closest('[class*="similar" i],[class*="other-job" i],[class*="related" i],footer,nav')) score -= 8; } catch (_) {}
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }
  function hasApplyButton() { return !!findApplyButton(); }
  async function waitForFormOrModal(ms) {
    const dl = Date.now() + (ms || 9000);
    while (Date.now() < dl) { if (hasApplicationForm()) return true; await sleep(400); }
    return hasApplicationForm();
  }
  function findButtonByText(re, exclude) {
    return deepAll('button,a,[role="button"],input[type=button],input[type=submit],spl-button,oj-button', 400).filter(isVisible)
      .find(b => { const t = normLabel(b.textContent || b.value || b.getAttribute?.('aria-label') || ''); return t && t.length < 60 && re.test(t) && (!exclude || !exclude.test(t)); }) || null;
  }
  // The "Apply Manually" choice on a Workday-style "Start Your Application" modal.
  // We never pick "Autofill with Resume" or "Use My Last Application".
  function findApplyManually() {
    return deepOne('[data-automation-id="applyManually"]') ||
      findButtonByText(/^\s*apply manually\s*$|^apply without (a )?(resume|sign)|^fill (it )?out manually|^continue manually|^enter manually/i);
  }
  async function clickApplyManually() {
    const am = findApplyManually();
    if (am && isVisible(am)) {
      LOG('Apply choice modal — clicking "Apply Manually"');
      scrollIfNeeded(am);
      clickEl(am);
      await sleep(800);
      return true;
    }
    return false;
  }
  // Resolve as soon as either a form OR the apply-choice modal appears (fast).
  async function waitForApplyTarget(ms) {
    const dl = Date.now() + (ms || 6000);
    while (Date.now() < dl) {
      if (hasApplicationForm()) return 'form';
      if (findApplyManually()) return 'choice';
      await sleep(250);
    }
    return hasApplicationForm() ? 'form' : null;
  }
  async function openApplicationForm__impl(maxClicks) {
    const limit = maxClicks || 3;
    let clicks = 0;
    while (clicks < limit) {
      if (hasApplicationForm()) return true;
      // If a "Start Your Application" choice modal is up, pick Apply Manually and WAIT
      // for the form to load. CRITICAL: once that modal has appeared we must NOT click
      // the page's "Apply" button again — doing so reopens the modal and makes it
      // flicker in and out (and fights Jobright's own "Choose Apply Manually" click).
      if (findApplyManually()) {
        await clickApplyManually();
        if ((await waitForApplyTarget(9000)) === 'form' || hasApplicationForm()) return true;
        // Give the form a little more time instead of re-clicking Apply.
        await sleep(1500);
        if (hasApplicationForm()) return true;
        // If the modal genuinely re-rendered, choose Apply Manually once more, then stop.
        if (findApplyManually()) { await clickApplyManually(); await waitForApplyTarget(9000); }
        return hasApplicationForm();
      }
      const btn = findApplyButton();
      if (!btn) return clicks > 0;
      // Keep apply links in the same tab so the queue can drive the form.
      if (btn.tagName === 'A' && btn.target === '_blank') btn.target = '_self';
      LOG('Clicking Apply: ' + (btn.textContent || btn.value || '').trim().slice(0, 30));
      scrollIfNeeded(btn);
      realClick(btn);
      noteProgress('clicked Apply');
      clicks++;
      // Condition-based wait — fires the moment a form OR the choice modal appears,
      // instead of a fixed multi-second delay (faster Apply on every ATS).
      await waitForApplyTarget(6000);
    }
    return clicks > 0;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function openApplicationForm(...a) { return withBusy('opening the application', () => openApplicationForm__impl(...a)); }

  // ===================== ACCOUNT CREATION / LOGIN (shared saved credentials) =====================
  // Many ATS (Workday, iCIMS, Taleo, SuccessFactors, ADP/BrassRing, Jobvite…) require
  // creating an account or signing in before you can apply. We reuse ONE saved
  // credential set across all of them: the profile email + a saved password.
  function generateStrongPassword() {
    const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lo = 'abcdefghijkmnpqrstuvwxyz', dg = '23456789', sp = '!@#$%';
    const pick = s => s[Math.floor(Math.random() * s.length)];
    let core = '';
    for (let i = 0; i < 8; i++) core += pick(lo + up + dg);
    // Guarantee complexity (upper/lower/digit/special, 12+ chars) for ATS rules.
    return 'Jb' + pick(up) + core + pick(dg) + pick(sp);
  }
  async function getAppPassword() {
    let pw = await st.get('ua_app_password');
    if (!pw) { pw = generateStrongPassword(); await st.set('ua_app_password', pw); LOG('Generated & saved a reusable ATS account password'); }
    return pw;
  }
  // Lock the email after first use so the SAME credentials are reused for every
  // future account/application (even if the profile email later changes).
  async function getAppEmail() {
    let e = await st.get('ua_app_email');
    if (!e) { e = ((await getProfile()).email || '').trim(); if (e) await st.set('ua_app_email', e); }
    return e;
  }
  /* Remember which employers already have an account, so a return visit signs in
     instead of trying to create a duplicate.

     Keyed per EMPLOYER, not per hostname. Workday serves one tenant from
     acme.wd1.myworkdayjobs.com AND acme.wd3.myworkdayjobs.com (and from
     myworkdaysite.com), so a record filed under one host was invisible from the
     other — the next job at that employer went straight back to Create Account.
     That is the "it creates the account, then asks me to create it again". */
  function accountKeyFor(host) {
    let h = String(host || location.hostname || '').toLowerCase();
    h = h.replace(/^www\./, '');
    h = h.replace(/\.wd\d+\./, '.');                  // acme.wd3.myworkdayjobs.com → acme.myworkdayjobs.com
    h = h.replace(/\.myworkdaysite\.com$/, '.myworkdayjobs.com');
    return h;
  }
  async function markAccountCreated(host) {
    try {
      const k = accountKeyFor(host);
      const m = (await st.get('ua_created_accounts')) || {};
      if (!m[k]) LOG('Account recorded for ' + k + ' — future jobs here will SIGN IN, not create again');
      m[k] = Date.now();
      await st.set('ua_created_accounts', m);
    } catch (_) {}
  }
  async function accountExistsFor(host) {
    try {
      const m = (await st.get('ua_created_accounts')) || {};
      if (m[accountKeyFor(host)]) return true;
      // Tolerate records written under a raw host before the key was normalised.
      return !!m[String(host || location.hostname || '').toLowerCase()];
    } catch (_) { return false; }
  }
  /* ── ATS ACCOUNT WALLS ─────────────────────────────────────────────────────
     The old test for "is this a sign-in screen?" was a single line:

         return $$('input[type=password]').some(isVisible);

     Two things were wrong with it, and together they stalled every job that hit
     a wall on ADP or Oracle.

     1. EMAIL-FIRST WALLS HAVE NO PASSWORD FIELD. ADP's myjobs /auth screen asks
        for an email and nothing else — "Welcome! Let's find your dream job! If we
        don't recognize your info, we'll prompt you to create a profile." — and
        only reveals a password (or sends a code) after Continue. Oracle
        Recruiting, iCIMS and Workday's newer flow all do the same. The test
        returned false, handleAccountAuth returned immediately, nothing was
        filled, and the job sat on the sign-in screen until the watchdog killed
        it. That is the "Email Address required." you can see under an empty box
        while the panel reports 0 applied.

     2. $$ IS BLIND TO SHADOW DOM. Oracle renders its fields as oj-* web
        components with the real <input> inside a shadow root, so even a page
        that DID have a password field was invisible here.

     So: enumerate deeply, recognise a wall by what it asks for rather than by one
     field type, and walk the steps rather than assuming there is only one. */
  const SOCIAL_AUTH_RE = /linkedin|google|facebook|apple|microsoft|indeed|xing|github|twitter|sso\b|single sign/i;
  /* The wall has to be recognised in the site's own language. BMW's careers
     portal is German — "Karrierechancen: Anmelden", "Haben Sie schon ein Konto?",
     "Kennwort" — and every word of it missed an English-only pattern, so a whole
     European tenant failed job after job. */
  const AUTH_COPY_RE = /(sign|log)\s?in\b|create (an )?(account|profile)|register|welcome back|let'?s find your dream job|prompt you to create a profile|enter your email|continue with (your )?email|existing candidate|returning (candidate|applicant)|already have an account|anmelden|einloggen|registrieren|konto erstellen|erstellen sie ein konto|ein konto erstellen|haben sie schon ein konto|kennwort|passwort|benutzerkonto|se connecter|connexion|cr[ée]er un compte|mot de passe|identifiant|iniciar sesi[óo]n|reg[íi]strate|crear (una )?cuenta|contrase[ñn]a|accedi|registrati|entrar|iniciar sess[ãa]o|palavra-passe|inloggen|aanmelden|account aanmaken|wachtwoord|logga in|skapa konto|l[øo]sen|logg inn|zaloguj|utw[óo]rz konto|has[łl]o/i;
  function safeClass(el) { try { return String(el && el.className || ''); } catch (_) { return ''; } }

  /* The box this wall wants an email or username in — native, or the real input
     inside a web component. */
  function authEmailField() {
    const byAttr = deepAll('input[type=email],input[autocomplete="username"],input[autocomplete="email"],' +
      'input[data-automation-id="email"],input[name*="email" i],input[id*="email" i],' +
      'input[name*="username" i],input[id*="username" i],oj-input-text,spl-input', 60)
      .map((el) => (el.tagName === 'INPUT' ? el : (innerNative(el, 'input') || el)))
      .filter((el) => el.tagName === 'INPUT' && el.type !== 'password' && isVisible(el) && !el.disabled && !el.readOnly);
    const named = byAttr.find((el) => /e-?mail|user.?name|user.?id|login/i.test(
      (el.name || '') + ' ' + (el.id || '') + ' ' + (el.autocomplete || '') + ' ' + (el.type || '')));
    if (named) return named;
    // Label-driven: it may be a plain text box whose only clue is its label.
    const labelled = deepAll('input[type=text],input:not([type]),input[type=email]', 80)
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly)
      .find((el) => /e-?mail|user.?name|user.?id|login/i.test(
        (getLabel(el) || '') + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' +
        (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')));
    return labelled || byAttr[0] || null;
  }
  function authPasswordFields() {
    return deepAll('input[type=password]', 12).filter((el) => isVisible(el) && !el.disabled);
  }
  function looksLikeAuthPage() {
    if (authPasswordFields().length) return true;
    const email = authEmailField();
    if (!email) return false;
    let copy = '';
    try { copy = (document.body && document.body.innerText || '').slice(0, 3000); } catch (_) {}
    /* iCIMS serves its form inside #icims_content_iframe and opens the account
       wall at /jobs/<id>/login with width/height query params, so the path test
       has to cover that shape too. */
    const urlSaysAuth = /\/(auth|login|signin|sign-in|register|account|candidate-?login)\b/i.test(location.pathname) ||
      /\/jobs\/\d+\/(login|register)\b/i.test(location.pathname);
    if (!urlSaysAuth && !AUTH_COPY_RE.test(copy)) return false;
    // An email box on a page that is ALREADY the application is not a wall.
    return !hasApplicationForm();
  }

  function findAuthSubmit(mode) {
    /* Localised too. BMW's button says "Anmelden"; an English-only pattern found
       nothing to click, so even a correctly filled wall went nowhere. */
    const SIGNIN = 'sign ?in|log ?in|continue|next|submit|get started|anmelden|einloggen|weiter|absenden|se connecter|connexion|continuer|suivant|valider|iniciar sesi[\u00f3o]n|entrar|continuar|siguiente|accedi|avanti|inloggen|aanmelden|volgende|verder|logga in|forts[\u00e4a]tt|logg inn|zaloguj|dalej';
    const CREATE = 'create (an? )?(account|profile)|create my account|register|sign ?up|konto erstellen|registrieren|cr[\u00e9e]er (un )?compte|s.inscrire|crear (una )?cuenta|reg[\u00edi]strate|registrati|crea account|account aanmaken|registreren|skapa konto|opprett konto|utw[\u00f3o]rz konto';
    const re = mode === 'signin' ? new RegExp('^(' + SIGNIN + ')\\b', 'i')
      : mode === 'create' ? new RegExp('^(' + CREATE + '|continue|next|submit|get started|weiter|continuer|continuar)\\b', 'i')
        : new RegExp('^(' + CREATE + '|' + SIGNIN + ')\\b', 'i');
    /* Never the social buttons. "Or sign in using social media" sits directly
       under ADP's Continue, and clicking one navigates to LinkedIn/Google and
       strands the job on a page the queue can do nothing with. */
    const isSocial = (el) => SOCIAL_AUTH_RE.test(
      (el.textContent || '') + ' ' + ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '') + ' ' + safeClass(el));
    const enabled = (el) => el && isVisible(el) && !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(safeClass(el)) && !isSocial(el);
    const known = deepOne('[data-automation-id="createAccountSubmitButton"],[data-automation-id="signInSubmitButton"]');
    if (enabled(known)) return known;
    const btns = deepAll('button,a[role="button"],[role="button"],input[type=submit],input[type=button],oj-button,spl-button', 250).filter(enabled);
    const label = (b) => normLabel(b.textContent || b.value || (b.getAttribute && b.getAttribute('aria-label')) || '');
    return btns.find((b) => re.test(label(b))) ||
      btns.find((b) => /^(submit|continue|next)\b/i.test(label(b))) || null;
  }

  /* ── EMAIL VERIFICATION WALLS ──────────────────────────────────────────────
     Several ATS stop mid-application: create an account, then go and click a
     link — or type a code — that has just been emailed to you. Workday does it
     per tenant, iCIMS and Taleo on some configurations, ADP when it does not
     recognise your details. A queue running unattended dies at every one.

     When a mailbox is connected (read-only — see ua-mailbox.js) we can get past
     these without you. When it is not, we say what is blocking the job and hand
     it to you rather than sitting there silently. */
  const VERIFY_WALL_RE = /verify your (email|account|address)|verification (email|code|link)|check your (inbox|email)|we('ve| have)? sent (you )?(an? )?(email|code|link)|confirm your email|enter the code we sent|activation (email|link)|one.?time (code|passcode)/i;

  function detectEmailVerificationWall() {
    try {
      const copy = (document.body && document.body.innerText || '').slice(0, 4000);
      if (!VERIFY_WALL_RE.test(copy)) return false;
      // A page that still has the application on it is not a verification wall.
      return !hasApplicationForm() || !!verificationCodeField();
    } catch (_) { return false; }
  }

  /* The box a one-time code goes into: short, numeric-ish, and labelled like a
     code rather than like a password. */
  function verificationCodeField() {
    return deepAll('input[type=text],input[type=tel],input[type=number],input:not([type])', 60)
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly && !(el.value || '').trim())
      .find((el) => {
        const hay = (getLabel(el) || '') + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' +
          (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.autocomplete || '');
        if (/password/i.test(hay)) return false;
        return /\b(code|otp|pin|one.?time|verification|passcode|token)\b/i.test(hay);
      }) || null;
  }

  /* Ask the service worker for the code or link. The worker's mailbox module is
     read-only and bounded to recent mail from THIS employer — see the header of
     ua-mailbox.js for why each of those limits is there. */
  function askMailboxForVerification(hosts, companies) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage({ type: 'UA_MAIL_FIND_VERIFICATION', hosts, companies }, (r) => {
          void chrome.runtime.lastError;
          res(r || { ok: false, reason: 'no-reply' });
        });
      } catch (_) { res({ ok: false, reason: 'no-worker' }); }
    });
  }

  async function resolveEmailVerification__impl(maxWaitMs) {
    if (!detectEmailVerificationWall()) return false;
    LOG('Email verification wall — checking the connected mailbox');
    noteProgress('waiting for the verification email');

    const hosts = [];
    try { hosts.push(location.hostname); } catch (_) {}
    // The employer's own domain too: the mail often comes from the company, not
    // from the ATS that rendered the page.
    const company = pageCompanyName();
    const deadline = Date.now() + (maxWaitMs || 90000);

    while (Date.now() < deadline) {
      if (autoStopped()) return false;
      const r = await askMailboxForVerification(hosts, company ? [company] : []);
      if (r && r.ok) {
        // Prefer typing a code: it keeps us on the page we are already on.
        const box = verificationCodeField();
        if (r.code && box) {
          LOG('Entering the verification code from your mailbox');
          box.focus({ preventScroll: true });
          nativeSet(box, r.code);
          noteProgress('entered the verification code');
          await sleep(400);
          const go = findAuthSubmit() || findSubmitControl();
          if (go) { realClick(go); await waitForStepChange(stepSignature(), 12000); }
          return true;
        }
        if (r.link) {
          /* The worker only ever returns a link whose host belongs to the ATS or
             employer we are already applying to — it will not hand back a link
             to somewhere else in the inbox. */
          LOG('Following the verification link from your mailbox');
          noteProgress('following the verification link');
          try { location.assign(r.link); } catch (_) {}
          return true;
        }
      } else if (r && (r.reason === 'disabled' || r.reason === 'not-connected')) {
        LOG('Email verification needed and no mailbox is connected — this job needs you. Connect one under 🔑 in the Queue Manager to clear these automatically.');
        try { reportNeedsHuman('email verification'); } catch (_) {}
        return false;
      }
      await sleep(4000);   // the mail has not landed yet
    }
    LOG('Verification email did not arrive within the wait — handing this job over');
    try { reportNeedsHuman('verification email did not arrive'); } catch (_) {}
    return false;
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function resolveEmailVerification(...a) { return withBusy('waiting for the verification email', () => resolveEmailVerification__impl(...a)); }

  async function handleAccountAuth__impl() {
    try {
      // Never auto-fill credentials on the user's personal job-board / social logins —
      // only on ATS account walls. (Their LinkedIn/Indeed password isn't ours to set.)
      if (/(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|dice|monster|google|facebook|apple|microsoft)\.[a-z.]+$/i.test(location.hostname)) return false;
      // Workday account creation is handled by Jobright's OWN native "Sign-up
      // Information" flow (Your Autofill information → Sign-up Information). Stay out
      // of the way entirely so it behaves exactly like the stock extension.
      if (isWorkday()) return false;
      // Same locked credentials for every ATS account/application.
      const email = await getAppEmail();
      if (!email) return false;
      // If nothing looks like a wall yet, try to open a "Create account" form.
      if (!looksLikeAuthPage()) {
        const createLink = deepAll('button,a,[role="button"]', 200).filter(isVisible)
          .find((b) => {
            const t = normLabel(b.textContent);
            // "Erstellen Sie ein Konto" is 24 characters and does not start with
            // any English word, so both halves of the old test failed on it.
            return t.length < 44 && /(create (an )?account|sign ?up|register|new user|konto erstellen|erstellen sie ein konto|registrieren|cr[ée]er un compte|s'inscrire|crear una cuenta|reg[íi]strate|registrati|account aanmaken|skapa konto)/i.test(t);
          });
        if (createLink) { LOG('Account: opening create-account form'); realClick(createLink); await sleep(1500); }
      }
      if (!looksLikeAuthPage()) return false;

      const pw = await getAppPassword();
      LOG('Account wall detected — filling saved credentials');

      /* Walk the wall's STEPS. An email-first wall needs at least two passes:
         email → Continue → password (or "create a profile"). Bounded, and it
         stops the moment the page stops being a wall. */
      let submittedOnce = false;
      for (let step = 1; step <= 4; step++) {
        if (autoStopped()) break;
        if (!looksLikeAuthPage()) break;                     // through the wall
        const before = stepSignature();

        const emailField = authEmailField();
        if (emailField && !(emailField.value || '').trim()) {
          emailField.focus({ preventScroll: true });
          nativeSet(emailField, email);
          noteProgress('entering the account email');
          await sleep(300);
        }
        const pwFields = authPasswordFields();
        for (const f of pwFields) { if (!(f.value || '').trim()) { f.focus({ preventScroll: true }); nativeSet(f, pw); } }
        await sleep(250);

        const isCreate = pwFields.length > 1
          || pwFields.some((f) => /confirm|verify|re-?enter|retype/i.test((getLabel(f) || '') + (f.name || '') + (f.id || '') + (f.getAttribute('data-automation-id') || '')))
          || /create (an )?(account|profile)|register|sign ?up/i.test((document.body && document.body.innerText || '').toLowerCase().slice(0, 4000));

        // Consent / "Agree to Privacy Notice" boxes keep the button disabled.
        const tickConsents = () => deepAll('input[type=checkbox]', 40).filter(isVisible)
          .forEach((c) => { if (!c.checked && !isMarketingCheckbox(c)) realClick(c); });
        tickConsents();
        await sleep(300);

        // Wait for the button to actually ENABLE — several ATS keep it disabled
        // until every field validates. Re-fill and re-tick on each pass.
        let submit = null;
        for (let i = 0; i < 10; i++) {
          submit = findAuthSubmit(isCreate ? 'create' : 'signin') || findAuthSubmit();
          if (submit) break;
          for (const f of authPasswordFields()) { if (!(f.value || '').trim()) nativeSet(f, pw); }
          tickConsents();
          const ef = authEmailField();
          if (ef && !(ef.value || '').trim()) { ef.focus({ preventScroll: true }); nativeSet(ef, email); }
          await sleep(400);
        }
        if (!submit) { LOG('Account: no usable Continue/Sign-in button — leaving the wall filled for you'); break; }

        LOG(`Account: step ${step} — ${isCreate ? 'create account' : 'sign in'} via "${normLabel(submit.textContent).slice(0, 24)}"`);
        scrollIfNeeded(submit);
        await sleep(200);
        clickEl(submit);
        submittedOnce = true;
        markAccountCreated(location.hostname);   // reuse these creds (sign in) on return
        await waitForStepChange(before, 12000);
        await sleep(600);

        // Account already exists → switch to sign-in with the same credentials.
        const bodyTxt = (document.body && document.body.innerText || '').toLowerCase();
        if (isCreate && /already (exists|in use|registered)|account.*exists|email.*taken|use a different email|already have an account/i.test(bodyTxt)) {
          LOG('Account exists — switching to sign-in');
          const toggle = deepAll('button,a,[role="button"]', 200).filter(isVisible)
            .find((b) => /^(sign ?in|log ?in|already have)/i.test(normLabel(b.textContent)));
          if (toggle) { realClick(toggle); await sleep(1500); }
        }
      }
      // Creating an account often lands straight on "check your inbox".
      if (detectEmailVerificationWall()) await resolveEmailVerification(90000);
      return submittedOnce;
    } catch (e) { LOG('handleAccountAuth error:', e?.message || e); return false; }
  }
  // Stall watchdog stands down while this runs — see withBusy.
  async function handleAccountAuth(...a) { return withBusy('signing in to the ATS', () => handleAccountAuth__impl(...a)); }

  // ===================== BLOCKING-DIALOG RESOLVER =====================
  // The MAIN-world hooks (ua-page-hooks.js) handle NATIVE confirm/alert. This
  // handles the other half: in-page modals that trap the flow the same way. A
  // destructive one ("Remove <file>?") is answered NO so the uploaded résumé
  // survives; a proceed-style one ("Submit your application?") is answered YES so
  // the run isn't stalled by a confirmation step.
  const DIALOG_SEL = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open],.modal.show,.modal.in,[class*="Modal" i][class*="open" i],spl-modal,spl-dialog';
  const DESTRUCTIVE_DIALOG_RE =
    /\b(remove|delete|discard|erase|clear|withdraw|revert|unattach)\b[^.?!]{0,80}[?]|^\s*(remove|delete|discard)\b/i;
  const NEGATIVE_BTN_RE = /^\s*(cancel|no|keep|don'?t|do not|dismiss|go back|nevermind|never mind|close)\s*$/i;
  const POSITIVE_BTN_RE = /^\s*(ok|okay|yes|confirm|continue|proceed|submit|accept|agree|got it|i understand)\s*$/i;

  function visibleDialogs() {
    return deepQueryAll(DIALOG_SEL).filter(d => {
      try { return isVisible(d) && (d.textContent || '').trim().length > 0; } catch (_) { return false; }
    });
  }
  function dialogButtons(d) {
    return deepQueryAll('button,[role="button"],a[role="button"],input[type="button"],input[type="submit"],spl-button', d)
      .filter(isVisible);
  }
  // Returns true if it resolved something (caller should re-check the page).
  async function resolveBlockingDialog() {
    let acted = false;
    for (const d of visibleDialogs()) {
      const text = (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!text) continue;
      const btns = dialogButtons(d);
      if (!btns.length) continue;
      const named = btns.map(b => ({ b, n: (b.textContent || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() }));
      const destructive = DESTRUCTIVE_DIALOG_RE.test(text);
      const want = destructive ? NEGATIVE_BTN_RE : POSITIVE_BTN_RE;
      const hit = named.find(x => want.test(x.n));
      if (hit) {
        LOG(`Blocking dialog resolved (${destructive ? 'declined' : 'accepted'}): "${text.slice(0, 80)}" → "${hit.n}"`);
        realClick(hit.b, { force: true });   // force: the button may be named "Cancel"/"Close"
        acted = true;
        await sleep(600);
        continue;
      }
      if (destructive) {
        // No explicit Cancel — Escape is the safe answer; never fall through to
        // whatever button happens to be first, which could be "Remove".
        try { d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, composed: true })); } catch (_) {}
        try { if (typeof d.close === 'function') d.close(); } catch (_) {}
        LOG(`Blocking dialog escaped: "${text.slice(0, 80)}"`);
        acted = true;
        await sleep(600);
      }
    }
    return acted;
  }

  /* Tell the MAIN-world hooks whether the automation currently owns this tab.
     While this is off, native dialogs behave exactly as the site intended.

     Turning it OFF starts a grace window instead of taking effect at once, and
     that is the whole point of this function. "Leave site? Changes you made may
     not be saved." fires DURING the navigation away from a page — which happens
     after the job has finished, i.e. after the flag would already have been
     handed back. The shield was therefore down at precisely the moment it was
     needed, and Oracle Cloud's HCM pages froze an entire 685-job run behind a
     dialog that nothing on the page could answer.

     The window only has to outlast a navigation, so it is short. Once it
     expires the page gets its own dialogs back, as it must. */
  const AUTO_FLAG_GRACE_MS = 20000;
  function setAutomationFlag(on) {
    try {
      const el = document.documentElement;
      if (!el) return;
      if (on) {
        el.setAttribute('data-ua-auto', '1');
        el.removeAttribute('data-ua-grace');
      } else {
        el.removeAttribute('data-ua-auto');
        el.setAttribute('data-ua-grace', String(Date.now() + AUTO_FLAG_GRACE_MS));
      }
    } catch (_) {}
  }
  // Surface anything the page tried to ask us, so a swallowed dialog shows up in
  // the log instead of being invisible.
  try {
    window.addEventListener('ua-native-dialog', (e) => {
      const d = (e && e.detail) || {};
      LOG(`Native ${d.kind} intercepted: "${String(d.message || '').slice(0, 100)}"` +
        (d.answer === null || d.answer === undefined ? ' (dismissed)' : ` → answered ${d.answer ? 'YES' : 'NO'}`));
    });
  } catch (_) {}

  // ===================== NEW-ATS SUPPORT PACK =====================
  // Detection for the platforms the CSV runs kept landing on. Kept as predicates
  // (not just URL regexes in one big list) so the dispatcher and the eligibility
  // gate agree on what a page is.
  function isSmartRecruiters() { return /(^|\.)smartrecruiters\.com$/i.test(location.hostname) || /smartrecruiters/i.test(location.href); }
  // Oracle Recruiting Cloud (Fusion). Served from *.oraclecloud.com AND white-labelled
  // onto company domains — the /hcmUI/CandidateExperience path is the reliable tell.
  function isOracleCloud() {
    return /(^|\.)oraclecloud\.com$/i.test(location.hostname) ||
      /\/hcmUI\/CandidateExperience/i.test(location.pathname) ||
      /oraclecloud\.com|\/hcmUI\/CandidateExperience/i.test(location.href);
  }
  function isTaleo() { return /(^|\.)taleo\.net$/i.test(location.hostname) || /\/careersection\//i.test(location.pathname); }
  // ADP's candidate portal (myjobs.adp.com) is a different application from the
  // recruiter-side workforcenow.adp.com flow the old driver targeted.
  function isAdpMyJobs() { return /(^|\.)myjobs\.adp\.com$/i.test(location.hostname); }
  function isAdpAny() { return isAdpMyJobs() || /(^|\.)(adp\.com|workforcenow\.adp\.com)$/i.test(location.hostname); }

  /* ── SmartRecruiters ───────────────────────────────────────────────────────
     Rewritten for the current Spark (`spl-*`) UI. The previous driver queried
     `#firstName` etc. against `document`, which cannot cross the shadow roots
     those components live in, so it filled nothing and then clicked around the
     page — which is how it reached the résumé's remove button in the first place.
     Everything here goes through the deep queries and a pointer sequence, because
     spl components ignore a bare .click(). */
  async function splSetInput(el, val) {
    if (!el || !val) return false;
    // spl-input wraps a real <input> in its shadow root.
    const inner = el.tagName && el.tagName.toLowerCase().startsWith('spl-')
      ? (el.shadowRoot && el.shadowRoot.querySelector('input,textarea')) || el.querySelector('input,textarea')
      : el;
    if (!inner) return false;
    try { inner.focus({ preventScroll: true }); } catch (_) {}
    nativeSet(inner, val);
    await sleep(120);
    return true;
  }
  // SmartRecruiters combobox: role="combobox" + aria-controls → a listbox of
  // <spl-select-option>. The option only commits when the pointer sequence lands
  // on its inner typography node.
  async function splPickOption(combo, wanted) {
    if (!combo) return false;
    const id = combo.getAttribute('aria-controls') || combo.getAttribute('ariacontrols') || combo.getAttribute('list');
    triggerMouse(combo);
    await sleep(700);
    let list = null;
    if (id) { try { list = deepQuery('#' + CSS.escape(id)); } catch (_) { list = null; } }
    const options = (list ? deepQueryAll('spl-select-option,[role="option"]', list) : deepQueryAll('spl-select-option,[role="option"]'))
      .filter(isVisible);
    if (!options.length) return false;
    const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(wanted);
    let pick = options.find(o => norm(o.innerText || o.textContent) === target);
    if (!pick && target) pick = options.find(o => norm(o.innerText || o.textContent).includes(target));
    if (!pick) return false;
    const inner = pick.querySelector('spl-typography-body') ||
      (pick.shadowRoot && pick.shadowRoot.querySelector('spl-typography-body,span,div')) || pick;
    triggerMouse(inner);
    await sleep(300);
    return true;
  }
  async function smartRecruitersAutomation() {
    LOG('SmartRecruiters automation starting (shadow-aware)...');
    const p = await getProfile();
    await loadAnswerBank();
    await resolveBlockingDialog();

    /* Job description page → application form. The JD lives at
       /<Company>/<id>-<slug> and its entry point is labelled "I'm interested"
       (with a curly apostrophe); the application itself is under
       /oneclick-ui/company/<Company>/publication/<uuid>/... — a different path
       AND a different page, so neither the old /apply|publication/ test nor the
       old literal label matched, and the job was skipped on the JD page. */
    const IN_APPLICATION = /\/(apply|application|publication|oneclick|oneclick-ui|screening|questions?)\b/i;
    if (!IN_APPLICATION.test(location.pathname) && !hasApplicationForm()) {
      const apply = findApplyButton() ||
        deepQueryAll('button,a,spl-button,[role="button"]').filter(isVisible)
          .find(b => isApplyLabel(b.textContent || b.getAttribute('aria-label') || ''));
      if (apply) {
        LOG('SmartRecruiters: opening the application via "' + normLabel(apply.textContent).slice(0, 30) + '"');
        const before = stepSignature();
        if (apply.tagName === 'A' && apply.target === '_blank') apply.target = '_self';
        realClick(apply);
        noteProgress('clicked Apply');
        // The JD page navigates to a different URL — wait for the form, don't guess.
        await waitForStepChange(before, 15000);
        await waitForFormStable(3000);
      } else {
        LOG('SmartRecruiters: no apply entry point found on this page');
      }
    }

    const loc = p.city ? [p.city, p.state || p.region || '', p.country || DEFAULTS.country].filter(Boolean).join(', ') : '';
    const byName = {
      firstName: p.first_name || p.firstName || '',
      lastName: p.last_name || p.lastName || '',
      email: p.email || '',
      phoneNumber: p.phone || '',
      phone: p.phone || '',
      location: loc,
    };

    const MAX_STEPS = 10;
    // A step that refuses to advance must not be re-filled for the rest of the
    // budget — that is the other half of "it autofills over and over".
    let stuckSteps = 0;
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (checkSuccess()) { LOG('SmartRecruiters: submission confirmed'); break; }
      await resolveBlockingDialog();
      // SmartRecruiters swaps the whole question set in place. Reading before the
      // new step has rendered is what made the fill report describe the PREVIOUS
      // page's fields while the real ones sat empty.
      await waitForFormStable(3000);
      const stepSig = stepSignature();
      LOG(`SmartRecruiters: step ${step}`);

      // Named fields, shadow-aware.
      for (const [name, val] of Object.entries(byName)) {
        if (!val) continue;
        const el = deepQuery(`spl-input[id="${name}"],spl-input[name="${name}"],#${name},input[name="${name}"],input[id="${name}"]`);
        if (el) {
          const inner = (el.shadowRoot && el.shadowRoot.querySelector('input')) || (el.querySelector && el.querySelector('input')) || el;
          if (inner && !(inner.value || '').trim()) await splSetInput(el, val);
        }
      }

      // Location typeahead needs its suggestion committed, or SmartRecruiters
      // rejects the step with "Please select a location from the list".
      if (loc) {
        const locCombo = deepQueryAll('[role="combobox"],spl-input[id="location"]').filter(isVisible)[0];
        if (locCombo) await splPickOption(locCombo, p.city || loc);
      }

      // Every remaining combobox: answer from the bank, else take the first real option
      // so a required dropdown can never be what blocks the submit.
      for (const combo of deepQueryAll('[role="combobox"][aria-haspopup="listbox"],[ariarole="combobox"]').filter(isVisible)) {
        const inner = (combo.shadowRoot && combo.shadowRoot.querySelector('input')) || combo.querySelector?.('input') || combo;
        if (inner && (inner.value || '').trim()) continue;      // already answered
        const q = getFullQuestionText(combo) || getLabel(combo) || '';
        const guess = q ? guessFieldValue(q, p, combo) : '';
        if (!(await splPickOption(combo, guess))) await splPickOption(combo, '');
        await sleep(200);
      }

      // spl-radio groups (Yes/No knockouts).
      for (const group of deepQueryAll('fieldset[role="radiogroup"],[role="radiogroup"]').filter(isVisible)) {
        const already = deepQueryAll('spl-radio[checked],input[type="radio"]:checked', group);
        if (already.length) continue;
        const q = (group.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const want = String(guessFieldValue(q, p, group) || 'yes').toLowerCase();
        const radios = deepQueryAll('spl-radio,input[type="radio"]', group).filter(isVisible);
        const labelOf = r => ((r.shadowRoot && r.shadowRoot.querySelector('label')?.textContent) || r.textContent || r.value || '').trim().toLowerCase();
        const pick = radios.find(r => labelOf(r) === want) || radios.find(r => labelOf(r).includes(want)) || radios[0];
        if (pick) { triggerMouse(pick); await sleep(150); }
      }

      // Consent boxes.
      for (const cb of deepQueryAll('input[type="checkbox"],spl-checkbox').filter(isVisible)) {
        const checked = cb.checked || cb.hasAttribute('checked');
        if (checked) continue;
        const lbl = getLabel(cb) || (cb.textContent || '');
        if (/consent|agree|privacy|gdpr|terms|data.?process|acknowledg/i.test(lbl)) { triggerMouse(cb); await sleep(120); }
      }

      // CV first: SmartRecruiters parses it and pre-fills from it, so attaching
      // before the field sweep means fewer fields left for us to guess at.
      const cv = await attachResume();
      if (cv === 'no-resume') LOG('SmartRecruiters: no résumé saved — the form will likely reject the step');

      await fallbackFill();
      await triggerAutofillQuick();
      await sleep(800);
      await guaranteeRequiredFields();
      await handleValidationErrors();
      await resolveBlockingDialog();

      // Never press Next/Submit mid-upload: SmartRecruiters then reports no
      // résumé attached, or drops the one that was in flight.
      if (resumeUploadInFlight()) { LOG('SmartRecruiters: waiting for the CV upload to finish'); await waitForResumeUpload(25000); }

      // Advance. Text-matched so it survives SmartRecruiters renaming its test ids.
      const buttons = deepQueryAll('button,spl-button,[role="button"]').filter(isVisible);
      const nameOf = b => (b.textContent || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const submit = findSubmitControl() || buttons.find(b => isSubmitLabel(nameOf(b)));
      if (submit) {
        LOG('SmartRecruiters: submitting via "' + controlLabel(submit) + '"');
        realClick(submit);
        markSubmitAttempt();
        await sleep(3500);
        await resolveBlockingDialog();
        break;
      }
      const next = buttons.find(b => /^\s*(next|continue|save (and|&) continue|proceed|review)\b/i.test(nameOf(b)));
      if (next) {
        LOG('SmartRecruiters: next step');
        realClick(next);
        // Wait for the questions to actually change instead of a flat sleep — a
        // fixed delay either read the old step (too short) or wasted time (too
        // long), and told us nothing when the step refused to advance.
        const moved = await waitForStepChange(stepSig, 15000);
        if (moved) { stuckSteps = 0; continue; }
        stuckSteps++;
        if (stuckSteps >= 2) {
          LOG('SmartRecruiters: the step will not advance after two attempts — handing over instead of re-filling it');
          break;
        }
        LOG('SmartRecruiters: step did not advance — fixing what is blocking it');
        await resolveBlockingDialog();
        await handleValidationErrors();
        await guaranteeRequiredFields();
        continue;
      }
      break;
    }
    learnFromFilledFields();
    LOG('SmartRecruiters automation complete');
  }

  /* ── Avature (Deloitte and many others) ────────────────────────────────────
     Avature's candidate portal is white-labelled onto the employer's own domain
     — apply.deloitte.com is one — so a host-based pattern finds almost none of
     them. Its ROUTE NAMES are the stable part, and they also tell us which step
     we are on, which matters because Avature puts an account wall in the middle
     of the flow rather than at the front:

       /careers/JobDetail/<slug>/<id>   the posting
       /careers/ApplicationMethods      "apply with resume / manually / LinkedIn"
       /careers/RegisterEdit?jobId=     register AND fill the application, together
       /careers/Register, /careers/Login
       /careers/SubmitApplication       the final step
       /careers/ApplicationConfirmation done

     RegisterEdit is the one the queue kept stalling on: it is not just an
     email/password box, it is the whole candidate profile plus the credentials,
     and until the credentials are in the rest of the page will not submit. */
  const AVATURE_ROUTE_RE = /\/careers\/(JobDetail|ApplicationMethods|QuickApply|RegisterEdit|SubmitApplication|Register|Login|MyProfile|SearchJobs|ForgotPassword|ApplicationConfirmation|EmailFriend)\b/i;
  function isAvature() {
    try {
      if (/(^|\.)avature\.net$/i.test(location.hostname)) return true;
      if (/(^|\.)apply\.deloitte\.com$/i.test(location.hostname)) return true;
      return AVATURE_ROUTE_RE.test(location.pathname);
    } catch (_) { return false; }
  }
  const avatureRoute = () => {
    try { const m = location.pathname.match(AVATURE_ROUTE_RE); return m ? m[1] : ''; } catch (_) { return ''; }
  };

  async function avatureAutomation() {
    LOG('Avature automation starting (route: ' + (avatureRoute() || 'unknown') + ')');
    await loadAnswerBank();
    await resolveBlockingDialog();

    /* The posting page. Avature's entry point is usually "Apply" or "Apply Now",
       but some tenants relabel it — the shared apply vocabulary covers those. */
    if (/JobDetail|SearchJobs/i.test(avatureRoute())) {
      const apply = findApplyButton();
      if (apply) {
        LOG('Avature: opening the application via "' + normLabel(apply.textContent).slice(0, 30) + '"');
        const before = stepSignature();
        if (apply.tagName === 'A' && apply.target === '_blank') apply.target = '_self';
        realClick(apply);
        noteProgress('clicked Apply');
        await waitForStepChange(before, 15000);
      }
    }

    /* ApplicationMethods offers a choice. Take the one that keeps us on Avature
       and lets us fill the form ourselves — never LinkedIn or another third
       party, which navigates off-site and strands the job. */
    if (/ApplicationMethods|QuickApply/i.test(avatureRoute()) ||
        /how would you like to apply|application method/i.test((document.body && document.body.innerText || '').slice(0, 3000))) {
      const methods = deepAll('a,button,[role="button"],input[type=submit],input[type=button]', 120).filter(isVisible);
      const nameOf = (b) => normLabel(b.textContent || b.value || b.getAttribute('aria-label') || '');
      const offsite = /linkedin|indeed|google|facebook|xing|seek\b|social/i;
      const preferred = methods.find(b => !offsite.test(nameOf(b)) && /^(apply (with|using) (my |your )?(resume|cv|profile)|upload (my |your )?(resume|cv)|use (my |your )?(resume|cv))\b/i.test(nameOf(b)))
        || methods.find(b => !offsite.test(nameOf(b)) && /^(apply manually|manual|fill (it )?(in|out) manually|enter (my )?details|complete the form|without (a )?(resume|cv))\b/i.test(nameOf(b)))
        || methods.find(b => !offsite.test(nameOf(b)) && /^(continue|next|proceed|apply)\b/i.test(nameOf(b)));
      if (preferred) {
        LOG('Avature: application method "' + nameOf(preferred).slice(0, 40) + '"');
        const before = stepSignature();
        realClick(preferred);
        await waitForStepChange(before, 15000);
      }
    }

    /* The main loop. RegisterEdit combines account creation with the application,
       so the credentials go in FIRST — otherwise every later pass re-fills a form
       the site will refuse anyway. */
    let stuckSteps = 0;
    for (let step = 1; step <= 12; step++) {
      if (autoStopped()) break;
      if (checkSuccess()) { LOG('Avature: submission confirmed'); break; }
      await resolveBlockingDialog();
      if (detectCaptcha()) await waitForCaptchaClear();
      await waitForFormStable(3000);
      const stepSig = stepSignature();
      LOG('Avature: step ' + step + ' (' + (avatureRoute() || 'form') + ')');

      // Credentials first on any register/login route, and on any page that has
      // grown a password field.
      if (/RegisterEdit|Register|Login/i.test(avatureRoute()) || deepAll('input[type=password]', 6).some(isVisible)) {
        await handleAccountAuth();
        await sleep(600);
      }

      // Avature parses the CV to prefill, so attach before the field sweep.
      const cv = await attachResume();
      if (cv === 'no-resume') LOG('Avature: no résumé saved — the form will likely reject the step');

      await triggerAutofillQuick();
      await fallbackFill();
      await guaranteeRequiredFields();
      await handleValidationErrors();
      await resolveBlockingDialog();
      if (resumeUploadInFlight()) { LOG('Avature: waiting for the CV upload to finish'); await waitForResumeUpload(25000); }

      const action = await autoSubmitOrNext();
      if (action === 'submitted') {
        await sleep(3000);
        if (confirmSubmitted()) { LOG('Avature: success confirmed'); break; }
        continue;
      }
      if (action === 'next_page') {
        if (await waitForStepChange(stepSig, 15000)) { stuckSteps = 0; continue; }
      }

      // Avature renders its own actions as <input type="submit" value="Next">,
      // which carries its label in .value rather than in text — controlLabel reads
      // both, so match on that rather than on textContent alone.
      const btn = deepAll('input[type=submit],input[type=button],button,a.button,[role="button"]', 150)
        .filter(isVisible)
        .find(b => /^\s*(next|continue|save (and|&) continue|proceed|review|submit|apply|finish|done)\b/i.test(controlLabel(b)));
      if (btn) {
        LOG('Avature: advancing via "' + controlLabel(btn).slice(0, 30) + '"');
        realClick(btn);
        if (isSubmitLabel(controlLabel(btn))) markSubmitAttempt();
        if (await waitForStepChange(stepSig, 15000)) { stuckSteps = 0; continue; }
      }

      stuckSteps++;
      if (stuckSteps >= 2) { LOG('Avature: the step will not advance after two attempts — handing over'); break; }
    }
    learnFromFilledFields();
    LOG('Avature automation complete');
  }

  /* ── Oracle Recruiting Cloud (Fusion) + Taleo ──────────────────────────────
     Oracle ships two unrelated candidate products and a CSV run hits both:
       • Oracle Recruiting Cloud / Fusion — *.oraclecloud.com/hcmUI/CandidateExperience,
         an Oracle JET app (oj-* components, some in shadow roots).
       • Classic Taleo — *.taleo.net/careersection, server-rendered, frames, and
         numeric field ids that differ per tenant, so it has to be label-driven. */
  async function oracleCloudAutomation() {
    LOG('Oracle Recruiting Cloud automation starting...');
    await loadAnswerBank();
    await resolveBlockingDialog();

    // Requisition page → application. Shared apply-label vocabulary, so Oracle
    // gets every wording (and every language) the other drivers understand.
    for (let i = 0; i < 3; i++) {
      if (/\/apply/i.test(location.href) || deepQuery('input,select,textarea,oj-input-text')) break;
      const apply = findApplyButton() || deepQueryAll('button,a,oj-button,[role="button"]').filter(isVisible)
        .find(b => isApplyLabel(b.textContent || b.getAttribute('title') || b.getAttribute('aria-label') || ''));
      if (!apply) break;
      LOG('Oracle: opening the application via "' + normLabel(apply.textContent).slice(0, 30) + '"');
      const before = stepSignature();
      realClick(apply);
      noteProgress('clicked Apply');
      await waitForStepChange(before, 12000);
    }

    // Oracle asks for an account before the form on many tenants; the shared
    // credential flow already knows how to satisfy that.
    await handleAccountAuth();
    await resolveBlockingDialog();

    // Oracle's flow is a train of numbered blocks with one primary action; the
    // universal multi-page driver handles it once fields are filled.
    for (let step = 1; step <= 12; step++) {
      if (checkSuccess()) break;
      await resolveBlockingDialog();
      await waitForFormStable(2500);
      // Read the step that is on screen NOW — Oracle JET and ADP CX both swap the
      // question set in place, so a flat sleep left us filling the previous one.
      const stepSig = stepSignature();
      await triggerAutofillQuick();
      await fallbackFill();
      await guaranteeRequiredFields();
      await handleValidationErrors();

      const r = await autoSubmitOrNext();
      if (r === 'submitted') { await sleep(3000); break; }
      if (r === 'next_page') { await waitForStepChange(stepSig, 15000); continue; }

      // Oracle's own wording, when the generic pass found nothing to click.
      const sub = findSubmitControl();
      if (sub) { LOG('Oracle: submitting via "' + controlLabel(sub) + '"'); realClick(sub); markSubmitAttempt(); await sleep(3000); continue; }
      const btn = deepQueryAll('button,oj-button,a[role="button"]').filter(isVisible)
        .find(b => /^\s*(continue|next|review|save and continue)\b/i.test((b.textContent || '').trim()));
      if (!btn) break;
      realClick(btn);
      await sleep(2500);
    }
    learnFromFilledFields();
    LOG('Oracle Recruiting Cloud automation complete');
  }

  /* ── ADP myjobs.adp.com ────────────────────────────────────────────────────
     ADP's candidate experience (CX) app — a different product from the
     workforcenow.adp.com flow the old adpAutomation() targeted, which is why
     myjobs links fell through to the generic path and stalled. */
  async function adpMyJobsAutomation() {
    LOG('ADP myjobs automation starting...');
    await loadAnswerBank();
    await resolveBlockingDialog();

    // Listing / preview → application.
    for (let i = 0; i < 3; i++) {
      if (/\/(apply|application)/i.test(location.pathname) || hasApplicationForm()) break;
      const apply = findApplyButton() || deepQueryAll('button,a,[role="button"]').filter(isVisible)
        .find(b => isApplyLabel(b.textContent || b.getAttribute('aria-label') || ''));
      if (!apply) break;
      LOG('ADP: opening the application via "' + normLabel(apply.textContent).slice(0, 30) + '"');
      const before = stepSignature();
      realClick(apply);
      noteProgress('clicked Apply');
      await waitForStepChange(before, 12000);
    }
    await handleAccountAuth();

    for (let step = 1; step <= 12; step++) {
      if (checkSuccess()) break;
      await resolveBlockingDialog();
      await waitForFormStable(2500);
      // Read the step that is on screen NOW — Oracle JET and ADP CX both swap the
      // question set in place, so a flat sleep left us filling the previous one.
      const stepSig = stepSignature();
      await triggerAutofillQuick();
      await fallbackFill();
      await guaranteeRequiredFields();
      await handleValidationErrors();

      const r = await autoSubmitOrNext();
      if (r === 'submitted') { await sleep(3000); break; }
      if (r === 'next_page') { await waitForStepChange(stepSig, 15000); continue; }

      const sub = findSubmitControl();
      if (sub) { LOG('ADP: submitting via "' + controlLabel(sub) + '"'); realClick(sub); markSubmitAttempt(); await sleep(3000); continue; }
      const btn = deepQueryAll('button,a[role="button"]').filter(isVisible)
        .find(b => /^\s*(next|continue|review)\b/i.test((b.textContent || '').trim()));
      if (!btn) break;
      realClick(btn);
      await sleep(2500);
    }
    learnFromFilledFields();
    LOG('ADP myjobs automation complete');
  }

  // ===================== ATS DISPATCHER =====================
  async function dispatchATSAutomation() {
    if (autoStopped()) { LOG(`dispatchATSAutomation: not running (${window.__uaAutoReason ? window.__uaAutoReason() : 'automation off'})`); return; }
    // A queue job or the in-page runner owns the flag for its whole lifetime; a
    // Fully-Automated dispatch only borrows it and must hand it back. Leaving it
    // set kept the automation gate open on this page even after the toggle was
    // switched off, which is one of the ways automation "kept firing".
    const ownedElsewhere = (() => {
      try { return document.documentElement.getAttribute('data-ua-auto') === '1'; } catch (_) { return false; }
    })();
    setAutomationFlag(true);
    try {
    // A modal left open by a previous step swallows every click that follows, so
    // clear one before doing anything else.
    await resolveBlockingDialog();
    // Reveal the application form first if we're on a listing/landing page.
    await openApplicationForm();
    // Create an account / sign in with saved credentials if the ATS requires it.
    await handleAccountAuth();
    const url = location.href;
    /* Route to the platform-specific flow. The URL tests below only recognise a
       platform served from its own domain; detectATS() also reads the page's own
       markers, which is what routes a white-labelled employer domain (Deloitte →
       Avature, JPMorgan → Oracle) to the right driver instead of the generic
       fallback. Host/route tests win where they match, because they are the more
       confident evidence; the fingerprint fills in the rest. */
    const platform = detectATS();
    if (isWorkday() || platform === 'Workday') await workdayAutomation();
    else if (/greenhouse\.io|boards\.greenhouse/i.test(url) || platform === 'Greenhouse' || platform === 'Greenhouse EU') await greenhouseAutomation();
    else if (/lever\.co|jobs\.lever/i.test(url) || platform === 'Lever') await leverAutomation();
    else if (/icims\.com/i.test(url) || platform === 'iCIMS') await icimsAutomation();
    else if (/linkedin\.com.*\/jobs/i.test(url)) await linkedinEasyApply();
    else if (/ashbyhq\.com/i.test(url) || platform === 'Ashby') await ashbyAutomation();
    else if (/bamboohr\.com/i.test(url)) await bamboohrAutomation();
    else if (isSmartRecruiters() || platform === 'SmartRecruiters') await smartRecruitersAutomation();
    // Avature — white-labelled onto the employer's domain, so this is routed by
    // its route names, not by host. Must come before the generic fallbacks.
    else if (isAvature() || platform === 'Avature') await avatureAutomation();
    // Oracle ships two different candidate products — route each to its own driver
    // instead of sending every oraclecloud URL through the classic-Taleo flow.
    else if (isOracleCloud() || platform === 'Oracle Recruiting') await oracleCloudAutomation();
    else if (isTaleo() || platform === 'Taleo') await taleoAutomation();
    else if (isAdpMyJobs()) await adpMyJobsAutomation();
    else if (/jobvite\.com/i.test(url)) await jobviteAutomation();
    else if (/workable\.com/i.test(url)) await workableAutomation();
    else if (/indeed\.com/i.test(url)) await indeedEasyApply();
    else if (/breezy\.hr|breezyhr\.com/i.test(url)) await breezyhrAutomation();
    else if (/ats\.rippling\.com/i.test(url)) await ripplingAutomation();
    else if (/adp\.com|workforcenow\.adp/i.test(url)) await adpAutomation();
    else if (/successfactors\.com/i.test(url) || platform === 'SuccessFactors') await successFactorsAutomation();
    else if (/jazz\.co|applytojob\.com/i.test(url)) await jazzhrAutomation();
    else if (/joinhandshake\.com/i.test(url)) await handshakeAutomation();
    else if (/governmentjobs\.com|usajobs\.gov/i.test(url)) await usajobsAutomation();
    else if (/eightfold\.ai/i.test(url) || platform === 'Eightfold') await eightfoldAutomation();
    else await tailorFirstFlow();
    // …then a UNIVERSAL completion driver for EVERY ATS: if the application isn't
    // confirmed submitted yet, self-navigate the remaining steps (account walls,
    // multi-page forms, review/confirm screens) until it is. Gated on
    // confirmSubmitted(), not checkSuccess(): a confirmation-looking URL alone is
    // not a reason to skip pressing Submit.
    if (!confirmSubmitted()) await multiPageLoop();
    } finally {
      if (!ownedElsewhere) setAutomationFlag(false);
    }
  }

  // ===================== INIT =====================
  // QUIET MODE: on a page that is NOT a job application (and with no queue running) the
  // extension should be INVISIBLE. Our own UI already doesn't mount there, but Jobright's
  // native content scripts still inject their floating widget on every site — that's the
  // "annoying on random websites" complaint. Hide those hosts with a CSS kill-switch and
  // lift it automatically if an SPA navigation turns the page into a real application.
  function engageQuietMode() {
    try {
      if (isJobright() || /(^|\.)linkedin\.com$/i.test(location.hostname)) return; // never touch these
      const CSS_ID = 'ua-quiet-css';
      const add = () => {
        if (document.getElementById(CSS_ID)) return;
        const s = document.createElement('style');
        s.id = CSS_ID;
        s.textContent = 'plasmo-csui,[id^="plasmo-"],[data-plasmo]{display:none !important;pointer-events:none !important}';
        (document.head || document.documentElement).appendChild(s);
      };
      add();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true });
      const iv = setInterval(() => {
        try {
          // Eligibility cache clears on SPA URL changes, so this picks up a genuine
          // navigation into an application page and un-hides the native UI.
          if (typeof window.__uaIsEligiblePage === 'function' && window.__uaIsEligiblePage()) {
            clearInterval(iv);
            document.getElementById(CSS_ID)?.remove();
            LOG('Quiet mode lifted — page now reads like a job application');
          } else add();
        } catch (_) {}
      }, 3000);
      LOG('Quiet mode: Jobright UI hidden on this non-job page');
    } catch (_) {}
  }

  /* A frame that is NOT the top frame runs a fill-only path. Greenhouse embeds,
     iCIMS, SuccessFactors, Taleo and BrassRing put the real application form in a
     CROSS-ORIGIN iframe, which the top document cannot reach at all — no shadow or
     same-origin walk gets there. The orchestrator injects this script into those
     frames for queue jobs; here we fill what is in front of us and let the top
     frame own navigation and submission. */
  async function initSubframe() {
    if (!window.__uaAutoAllowed || !window.__uaAutoAllowed()) return;   // never during manual use
    // Only frames that actually hold form fields — not ad or tracking frames.
    const fields = () => deepAll('input:not([type=hidden]),textarea,select').filter(isVisible);
    if (fields().length < 2) return;
    LOG(`Sub-frame fill mode (${location.hostname}) — ${fields().length} fields`);
    try { await load(); } catch (_) {}
    try { await loadAnswerBank(); await loadSavedResponses(); await loadAppHistory(); await loadCustomDefaults(); } catch (_) {}
    // A few bounded passes: the embedded form may mount its fields late, and the
    // top frame may advance it to a second page inside the same frame.
    for (let pass = 0; pass < 6; pass++) {
      if (!window.__uaAutoAllowed()) return;
      try {
        await fallbackFill();
        await guaranteeRequiredFields();
        await handleValidationErrors();
        logFillReport('Sub-frame pass ' + (pass + 1));
      } catch (e) { LOG('Sub-frame fill error:', e?.message || e); }
      await sleep(4000);
    }
  }

  async function init() {
    if (window.self !== window.top) { initSubframe().catch(() => {}); return; }
    // Show the control panel IMMEDIATELY in the runner tab (before any awaits), so
    // Skip/Pause/Quit are available the instant each job page renders — no gap.
    if (isRunnerTab()) ensureOverlay();
    // Load queue state FIRST so we know whether a bulk run is in progress.
    await load();
    /* Re-establish the runner marker before anything reads it. A cross-site
       navigation wipes window.name, and every "am I driving this run?" decision
       below — mounting the panel, mounting the observers, driving the queue —
       depends on the answer. */
    if (qActive && !isRunnerTab()) { await confirmRunnerTab(); if (isRunnerTab()) { ensureOverlay(); updateCtrl(); } }
    // Master gate: don't mount the sidebar UI / observers on heavy non-application
    // pages. BUT never skip when a queue is running — we must mount the controls
    // and drive automation on every imported job URL (listing pages included,
    // where we click "Apply" to reveal the form). Skipping was the #1 reason the
    // CSV queue "did nothing" on many sites.
    const runnerActive = qActive && isRunnerTab();
    // Manager mode: this tab was opened by the Queue Manager for a specific job.
    // Ask the service worker by tab id first (authoritative, redirect-proof); fall
    // back to the legacy window.name / URL-matching path only if it can't answer.
    const mgrAssignment = await askManagerForJob();
    const mgrJob = (mgrAssignment && mgrAssignment.job) || await findManagedJob();
    const mgrSettings = mgrAssignment && mgrAssignment.settings;
    // Whether this page is genuinely a job application (known ATS host, or a page that
    // actually READS like a job application — not just a "/apply" URL or a PDF upload).
    const eligible = typeof window.__uaIsEligiblePage !== 'function' || window.__uaIsEligiblePage();
    // Never bail when a queue is running here, or when Fully Automated is ON AND the page
    // is a real job application. We deliberately require `eligible` here now — a bare
    // detectATS() 'Career' match on a /apply URL is NOT enough — so Fully Automated can't
    // mount+drive on non-job forms (loan/membership/contact pages) and hallucinate answers.
    const fullAutoOnATS = autoApply && eligible && (detectATS() || isWorkday());
    if (!runnerActive && !fullAutoOnATS && !eligible && !mgrJob) { engageQuietMode(); return; }
    await loadAnswerBank(); await loadSavedResponses(); await loadAppHistory(); await loadResumes(); await loadCustomDefaults(); await loadRateLimitDelay(); injectCSS(); buildUI(); setupKeyboardShortcuts();
    [500, 1500, 3000, 5000, 8000, 12000].forEach(ms => setTimeout(hideCredits, ms));
    observe(); injectSidebarUI(); showATSBadge(); renderQ(); updateStat(); updateCtrl();
    // When a queue is active IN THIS (runner) tab, keep Jobright's own sidebar open
    // and our control overlay visible for the whole run.
    if (runnerActive) { forceOpenSidebar(); updateCtrl(); }
    // Update answer bank count in UI
    const ansCntEl = document.getElementById('ua-ans-cnt');
    if (ansCntEl) ansCntEl.textContent = `(${Object.keys(_answerBank).length} answers)`;

    const ats = detectATS();
    if (ats) LOG(`ATS detected: ${ats}`);
    // FULLY AUTOMATED: on any detected ATS (incl. Workday), start the whole apply flow
    // automatically — no clicks. dispatchATSAutomation reveals the form (Apply / Apply
    // Manually), creates/sign-ins the account, fills, and self-navigates to submit.
    // IMPORTANT: skip this when a bulk queue job is running in THIS tab — processQ()
    // below already drives dispatchATSAutomation itself (with its own verify/retry
    // loop). Running both would fire the whole apply flow TWICE on the same page,
    // risking a double submit / race between the two runs.
    // Gate the auto-run on `eligible` too: on a real ATS host / genuine job-application
    // page only. Without this, detectATS()'s broad generic "Career" pattern (any URL with
    // /apply, /jobs, /careers) would let Fully Automated fill non-job forms.
    if (autoApply && !runnerActive && !mgrJob && eligible && (ats || isWorkday())) {
      LOG(`Fully Automated: starting full automation for ${ats || 'Workday'}`);
      await sleep(1500);
      await dispatchATSAutomation();
    }
    if (runnerActive) {
      // Resumes after a manual reload too: window.name carries the runner tag
      // across the navigation and ua_qa is in storage, so the job in flight is
      // picked straight back up rather than the run appearing to stop.
      LOG('Queue runner tab resumed' + (document.referrer ? ' (after navigation)' : ''));
      await sleep(1000);
      processQ();
    }
    // Manager-driven tab: run this ONE job to a verified terminal status and report.
    // runManagedAssignment owns the _mgrHandledJobId guard, so this and the pushed
    // UA_ASSIGN_JOB message can both fire without ever double-driving a job.
    if (mgrJob) {
      runManagedAssignment(mgrJob, mgrSettings);
    } else if (!runnerActive && (await st.get('ua_mgr_active')) === true) {
      // A run is active but this tab has no assignment yet — the worker may have been
      // asleep. Re-ask a couple of times before giving up and behaving as a normal page.
      setTimeout(() => { pullManagedAssignment().catch(() => {}); }, 3000);
      setTimeout(() => { pullManagedAssignment().catch(() => {}); }, 9000);
    }
    // Workday: when Fully Automated is ON (or a bulk run is active), auto-fill + submit
    // the Create Account / Sign In step. When OFF we stay out of the way and let
    // Jobright's native flow handle it, so the toggle is the single source of truth.
    if (isWorkday() && (autoApply || runnerActive || mgrJob)) startWorkdayAccountWatch();
    if (isJobright()) {
      await sleep(2000); resumeTailoringAutomation();
      // Capture Jobright's Insider Connections (recruiter/hiring manager for this role) so a
      // follow-up can be aimed at the exact person. Re-capture as the panel loads/expands.
      const roleGuess = ((document.querySelector('h1, [class*="job-title"], [class*="jobTitle"]')?.textContent) || '').trim().slice(0, 80);
      [1500, 4000, 8000].forEach(ms => setTimeout(() => stashInsidersFromJobright(roleGuess), ms));
    }
    // Auto-learn (MANUAL answers only): whenever YOU answer a question the autofill left
    // blank, remember question→answer and auto-apply it the next time it appears.
    // e.isTrusted filters out our own synthetic fills so we never cement our own guesses;
    // composedPath() reaches inside open shadow DOM (Jobright sidebar, embedded widgets).
    const _learnFrom = (e) => {
      try {
        if (!e.isTrusted) return;
        const el = (e.composedPath ? e.composedPath()[0] : e.target);
        if (!el || !el.tagName) return;
        const tag = el.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
        if (/^(hidden|file|submit|button|password)$/.test(el.type || '')) return;
        if (el.type === 'radio' || el.type === 'checkbox') {
          // Question = the GROUP's question, answer = the option label you picked.
          if (e.type === 'change' && el.checked) learnManualAnswer(getQuestionForInput(el), (getLabel(el) || el.value || '').trim());
          return;
        }
        if (!hasFieldValue(el)) return;
        const val = tag === 'SELECT' ? (el.options[el.selectedIndex]?.text || el.value) : el.value;
        if (val && val.trim().length > 1) learnManualAnswer(getLabel(el), val.trim());
      } catch (_) {}
    };
    window.addEventListener('change', _learnFrom, true);
    window.addEventListener('focusout', _learnFrom, true);
    // Custom dropdowns (react-select / Workday / Greenhouse comboboxes): remember which
    // question's dropdown you opened, then learn the option you click as its answer.
    let _lastComboQ = '', _lastComboAt = 0;
    window.addEventListener('click', (e) => {
      try {
        if (!e.isTrusted) return;
        const t = (e.composedPath ? e.composedPath()[0] : e.target);
        if (!t || !t.closest) return;
        const opt = t.closest('[role="option"],.select__option,li[data-value]');
        if (opt) {
          const ans = (opt.textContent || '').replace(/\s+/g, ' ').trim();
          if (ans && ans.length <= 120 && _lastComboQ && Date.now() - _lastComboAt < 20000) learnManualAnswer(_lastComboQ, ans);
          return;
        }
        const combo = t.closest('[role="combobox"],[aria-haspopup="listbox"],input[aria-autocomplete],[class*="select__control"]');
        if (combo) {
          const inp = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(combo.tagName) ? combo : (combo.querySelector('input,button') || combo);
          const q = getLabel(inp) || getFullQuestionText(inp);
          if (q) { _lastComboQ = q; _lastComboAt = Date.now(); }
        }
      } catch (_) {}
    }, true);
    window.addEventListener('beforeunload', () => { try { learnFromFilledFields(); } catch (_) {} });
  }
  // Runner tab: show the control panel at document_start and keep retrying for the
  // first few seconds until init's watchdog takes over — removes the blank gap that
  // appeared right after each job navigation.
  if (isRunnerTab()) {
    ensureOverlay();
    let _earlyTries = 0;
    const _early = setInterval(() => {
      ensureOverlay();
      const el = document.getElementById('ua-ctrl');
      if (++_earlyTries > 25 || (el && el.isConnected)) clearInterval(_early);
    }, 150);
  } else {
    /* window.name says nothing — but a cross-site hop wipes it, so this may well
       be the runner tab mid-run. Ask, and mount the panel the moment we know. */
    confirmRunnerTab().then((ok) => { if (ok) ensureOverlay(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

// === ICON CLICK HANDLER: Toggle Plasmo CSUI Sidebar ===
(function () {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.message === 'iconClicked') {
      // Find all Plasmo CSUI containers (custom elements injected by Plasmo framework)
      var containers = document.querySelectorAll('[id^="plasmo-"], [class*="plasmo"], plasmo-csui, [data-plasmo]');
      // Also try to find by common Plasmo shadow host patterns
      if (containers.length === 0) {
        containers = document.querySelectorAll('[style*="position: fixed"]');
        // Filter to only extension-injected elements (they often have shadow roots)
        containers = Array.from(containers).filter(function (el) {
          return el.shadowRoot || el.tagName.toLowerCase().includes('plasmo');
        });
      }
      // If still no containers found, look for any element with a shadow root that contains Jobright UI
      if (containers.length === 0) {
        var allElements = document.querySelectorAll('*');
        containers = Array.from(allElements).filter(function (el) {
          return el.shadowRoot && (
            el.id && el.id.toLowerCase().includes('plasmo') ||
            el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('plasmo') ||
            el.tagName && el.tagName.toLowerCase().includes('plasmo')
          );
        });
      }
      if (containers.length > 0) {
        containers.forEach(function (c) {
          if (c.style.display === 'none') {
            c.style.display = '';
          } else {
            c.style.display = 'none';
          }
        });
        console.log('[UA] Toggled', containers.length, 'Plasmo CSUI container(s)');
      } else {
        console.log('[UA] No Plasmo CSUI containers found to toggle');
      }
    }
  });
})();

// === AUTO-DISMISS "Are you sure to autofill again" CONFIRMATION POPUP ===
// Jobright asks this before re-running autofill. Auto-answering "Yes" is only
// correct while WE are driving: during manual use it silently starts an autofill
// the user never asked for, which is exactly the "fires without me clicking it"
// complaint. Gated on the master automation gate, and the watcher is not even
// installed when automation is off.
(function () {
  function findAndDismissPopup(root) {
    // Check all shadow roots for the popup
    var allEls = root.querySelectorAll('*');
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      // Check text content for the confirmation message
      if (el.textContent && /Are you sure to autofill again/i.test(el.textContent) && !/function/.test(el.textContent)) {
        // Found the popup container — click "Yes" button
        var buttons = el.querySelectorAll('button, [role="button"], div[class*="btn"], span[class*="btn"]');
        for (var j = 0; j < buttons.length; j++) {
          var btnText = (buttons[j].textContent || '').trim();
          if (/^Yes$/i.test(btnText)) {
            buttons[j].click();
            console.log('[UA] Auto-dismissed autofill confirmation popup');
            return true;
          }
        }
      }
      // Also check shadow roots
      if (el.shadowRoot) {
        if (findAndDismissPopup(el.shadowRoot)) return true;
      }
    }
    return false;
  }

  // Monitor for the popup appearing — ONLY on job-related pages so we don't
  // hammer every site with a 1s full-tree scan.
  function eligible() {
    try { return typeof window.__uaIsEligiblePage === 'function' ? window.__uaIsEligiblePage() : true; }
    catch (_) { return false; }
  }
  function startWatch() {
    if (!eligible()) return;
    if (!window.__uaAutoAllowed || !window.__uaAutoAllowed()) {
      console.log('[UA] autofill-confirm watcher not installed (' +
        (window.__uaAutoReason ? window.__uaAutoReason() : 'automation off') + ')');
      return;
    }
    var popupObserver = new MutationObserver(function () {
      if (window.__uaAutoAllowed()) findAndDismissPopup(document);
    });
    try { popupObserver.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    // Periodic sweep throttled to 2.5s (was 1s on every site) and auto-stops
    // after 2 minutes if nothing happened, to avoid forever-polling on idle tabs.
    var ticks = 0;
    var iv = setInterval(function () {
      if (++ticks > 48) { clearInterval(iv); try { popupObserver.disconnect(); } catch (_) {} return; }
      if (window.__uaAutoAllowed()) findAndDismissPopup(document);
    }, 2500);
  }
  var _watching = false;
  function startWatchOnce() { if (_watching) return; if (!window.__uaAutoAllowed || !window.__uaAutoAllowed()) return; _watching = true; startWatch(); }
  if (document.body) startWatchOnce();
  else document.addEventListener('DOMContentLoaded', startWatchOnce, { once: true });
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && (changes.ua_aa || changes.ua_qa)) startWatchOnce();
    });
  } catch (_) {}
})();

// === SMARTRECRUITERS MULTI-PAGE AUTOFILL SUPPORT ===
// Re-enables autofill button on page navigation within SmartRecruiters
(function () {
  if (!/smartrecruiters/i.test(location.href)) return;
  var lastUrl = location.href;
  var urlObserver = new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[UA] SmartRecruiters page changed, re-enabling autofill');
      // Dispatch a custom event that the autofill system can listen for
      window.dispatchEvent(new CustomEvent('ua-page-changed', { detail: { url: lastUrl } }));
      // Reset any "already filled" flags by clearing the page-level fill state
      try { chrome.storage.local.remove('ua_sr_filled_' + lastUrl); } catch (e) { }
    }
  });
  urlObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();

// ============================================================================
// === v1.5.4 MASTER PAGE-ELIGIBILITY GATE ===
// Single source of truth for "should our heavy v1.5.4 modules run on this
// page?". Prevents timers, observers, and DOM scanners from attaching on
// random browsing pages (YouTube, Twitter, docs, Gmail, etc.) — which was
// the primary source of glitches on non-job sites.
// ============================================================================
(function () {
  'use strict';
  // Hosts that ARE an ATS end-to-end — safe to activate anywhere on the site.
  const ATS_HOSTS = /(^|\.)(jobright\.ai|greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|taleo\.net|bamboohr\.com|successfactors\.com|avature\.net|recruitee\.com|workable\.com|personio\.com|rippling\.com|jobvite\.com|jazzhr\.com|applytojob\.com|brassring\.com|ukg\.com|oraclecloud\.com|paylocity\.com|gusto\.com|breezy\.hr|breezyhr\.com|teamtailor\.com|manatal\.com|pinpointhq\.com|eightfold\.ai|phenom\.com|phenompeople\.com|paradox\.ai|hirevue\.com|modernhire\.com|mya\.com|beamery\.com|joinhandshake\.com|governmentjobs\.com|usajobs\.gov|adp\.com|workforcenow\.adp\.com|dover\.com|pinpoint\.dev|polymer\.co|jobscore\.com|recruiterflow\.com|zohorecruit\.com|myjobs\.adp\.com|apply\.deloitte\.com|sapsf\.com|sapsf\.eu|talentbrew\.com|radancy\.com|join\.com|softgarden\.io|softgarden\.de|hrmdirect\.com|csod\.com|cornerstoneondemand\.com|myworkdaysite\.com|smartrecruiters\.com)$/i;
  // Generic path pattern — only relevant OUTSIDE of mixed-use hosts like
  // LinkedIn / Indeed where /jobs/ is primarily browsing.
  const CAREER_PATH = /(^|\/)(apply|application|applications|careers|career|job-application|submit-application|opportunities|vacancies|openings|employment|hiring|recruit|recruiting|candidate|applicant)(\/|\?|-|_|$)/i;
  // Mixed-use hosts: only activate when the apply UI is actually open
  // (file input present). Pure browsing paths stay inert.
  const MIXED_USE_HOSTS = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|monster\.com|ziprecruiter\.com|dice\.com|simplyhired\.com|wellfound\.com|angel\.co|builtin\.com|otta\.com|welcometothejungle\.com)$/i;
  let cached = null;
  // A resume/CV upload input — but ONLY when it's specifically a resume/CV field, not any
  // generic PDF/DOC upload (a tax form, an ID upload, a "supporting document" dropzone).
  // A bare accept="pdf" input is NOT enough on its own — it must name resume/cv, or the
  // page must otherwise read like a job application (see jobTextSignal below).
  function hasResumeFileInput() {
    try {
      return !!document.querySelector('input[type=file][name*="resume" i], input[type=file][name*="cv" i], input[type=file][id*="resume" i], input[type=file][id*="cv" i], input[type=file][aria-label*="resume" i], input[type=file][aria-label*="cv" i], input[type=file][data-automation-id*="resume" i]');
    } catch (_) { return false; }
  }
  function hasGenericFileUpload() {
    try { return !!document.querySelector('input[type=file][accept*="pdf" i], input[type=file][accept*="doc" i]'); } catch (_) { return false; }
  }
  // Does the page CONTENT actually read like a JOB application? This is what stops us
  // treating a loan/membership/"apply" form, a contact form, or any generic PDF-upload
  // page as a job application and hallucinating job answers into it. Requires real
  // job-application phrasing, not just a "/apply" in the URL.
  function jobTextSignal() {
    try {
      const t = ((document.body && document.body.innerText) || '').toLowerCase().slice(0, 30000);
      if (!t) return false;
      return /(apply for (this|the) (job|position|role|opening|vacancy)|cover letter|work authoriz|authoriz(ed|ation) to work|require (visa )?sponsorship|visa sponsorship|years of (relevant |related )?experience|equal employment opportunity|\beeo\b|veteran status|disability status|voluntary self.?identif|desired salary|salary expectation|salary requirement|notice period|willing to relocate|how did you hear about (us|this)|position (applied|being applied) for|are you legally (authorized|eligible)|upload (your )?(resume|cv|c\.v\.)|attach (your )?(resume|cv)|employment history|work experience|job title|hiring manager|job requisition|req(uisition)? (id|number))/.test(t);
    } catch (_) { return false; }
  }
  window.__uaIsEligiblePage = function () {
    if (cached !== null) return cached;
    try {
      const h = (location.hostname || '').toLowerCase();
      // Known end-to-end ATS hosts are definitely job sites — always eligible.
      if (ATS_HOSTS.test(h)) { cached = true; return true; }
      if (MIXED_USE_HOSTS.test(h)) {
        // LinkedIn/Indeed/etc. — only inside an actual apply flow (resume field + job text).
        cached = (hasResumeFileInput() || hasGenericFileUpload()) && jobTextSignal();
        return cached;
      }
      // Everywhere else: a career-ish URL OR a resume upload is a HINT, but we require the
      // page to actually READ like a job application before activating. This is the fix for
      // the extension filling non-job forms (loan/membership "apply" pages, contact forms,
      // generic document-upload pages) that merely had "/apply" in the URL or a PDF input.
      const hint = CAREER_PATH.test(location.pathname || '') || hasResumeFileInput() || hasGenericFileUpload();
      cached = (hint && jobTextSignal()) || (hasResumeFileInput() && CAREER_PATH.test(location.pathname || ''));
      return cached;
    } catch (_) { cached = false; return false; }
  };
  // Recompute once the DOM has been parsed (document_start content scripts run
  // before <body>, so the file-input probe above may miss on the first call).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { cached = null; }, { once: true });
  }
  // SPA navigation: clear the cache when the URL changes so a navigation into
  // an application page inside a single-page app re-enables the gate.
  let __uaLastHref = location.href;
  setInterval(function () {
    if (location.href !== __uaLastHref) { __uaLastHref = location.href; cached = null; }
  }, 2000);
})();

// ============================================================================
// === v1.5.4 ULTIMATE EDITION: PRE-SEEDED KNOCKOUT Q&A BANK (500+ entries) ===
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-v1.5.4]', ...a);
  const SEED_KEY = 'ua_saved_responses';
  const SEEDED_FLAG = 'ua_v154_seeded';

  // Massive pre-seeded response library covering common ATS knockout questions.
  // Format: { keywords: [...], response: '...' }  — higher keyword overlap = higher score.
  const SEED = [
    // ===== WORK AUTHORIZATION =====
    { keywords: ['authorized', 'work', 'united', 'states'], response: 'Yes' },
    { keywords: ['legally', 'authorized', 'work'], response: 'Yes' },
    { keywords: ['eligible', 'work', 'country'], response: 'Yes' },
    { keywords: ['right', 'work', 'ireland'], response: 'Yes' },
    { keywords: ['right', 'work', 'uk'], response: 'Yes' },
    { keywords: ['right', 'work', 'eu'], response: 'Yes' },
    { keywords: ['work', 'permit', 'valid'], response: 'Yes' },
    { keywords: ['citizen', 'permanent', 'resident'], response: 'Yes' },
    { keywords: ['visa', 'status'], response: 'Authorized to work without sponsorship' },

    // ===== SPONSORSHIP =====
    { keywords: ['require', 'sponsorship'], response: 'No' },
    { keywords: ['need', 'sponsorship'], response: 'No' },
    { keywords: ['require', 'visa', 'sponsorship'], response: 'No' },
    { keywords: ['will', 'require', 'sponsorship'], response: 'No' },
    { keywords: ['now', 'future', 'sponsorship'], response: 'No' },
    { keywords: ['immigration', 'sponsorship', 'required'], response: 'No' },
    { keywords: ['h1b', 'sponsorship'], response: 'No' },

    // ===== EEO / DIVERSITY =====
    { keywords: ['gender', 'identity'], response: 'Prefer not to say' },
    { keywords: ['race', 'ethnicity'], response: 'Prefer not to say' },
    { keywords: ['hispanic', 'latino'], response: 'No' },
    { keywords: ['disability', 'status'], response: 'I do not have a disability' },
    { keywords: ['veteran', 'status'], response: 'I am not a protected veteran' },
    { keywords: ['protected', 'veteran'], response: 'I am not a protected veteran' },
    { keywords: ['military', 'service'], response: 'No' },
    { keywords: ['pronouns'], response: 'Prefer not to say' },
    { keywords: ['sexual', 'orientation'], response: 'Prefer not to say' },

    // ===== BACKGROUND / LEGAL =====
    { keywords: ['convicted', 'felony'], response: 'No' },
    { keywords: ['criminal', 'record'], response: 'No' },
    { keywords: ['background', 'check', 'consent'], response: 'Yes' },
    { keywords: ['background', 'check', 'willing'], response: 'Yes' },
    { keywords: ['drug', 'test', 'consent'], response: 'Yes' },
    { keywords: ['drug', 'screening'], response: 'Yes' },
    { keywords: ['non', 'compete', 'agreement'], response: 'No' },
    { keywords: ['pending', 'charges'], response: 'No' },
    { keywords: ['terminated', 'previous', 'employer'], response: 'No' },

    // ===== COMPANY RELATIONSHIP =====
    { keywords: ['previously', 'worked', 'company'], response: 'No' },
    { keywords: ['former', 'employee'], response: 'No' },
    { keywords: ['current', 'employee', 'company'], response: 'No' },
    { keywords: ['applied', 'before'], response: 'No' },
    { keywords: ['family', 'member', 'company'], response: 'No' },
    { keywords: ['relative', 'work', 'company'], response: 'No' },
    { keywords: ['conflict', 'interest'], response: 'No' },
    { keywords: ['referred', 'employee'], response: 'No' },
    { keywords: ['how', 'hear', 'about', 'us'], response: 'LinkedIn' },
    { keywords: ['how', 'find', 'job'], response: 'LinkedIn' },
    { keywords: ['referral', 'source'], response: 'LinkedIn' },
    { keywords: ['where', 'hear', 'position'], response: 'LinkedIn' },
    { keywords: ['job', 'source'], response: 'LinkedIn' },

    // ===== AGE / ELIGIBILITY =====
    { keywords: ['at', 'least', '18'], response: 'Yes' },
    { keywords: ['over', '18', 'years'], response: 'Yes' },
    { keywords: ['18', 'years', 'age'], response: 'Yes' },
    { keywords: ['legal', 'age', 'work'], response: 'Yes' },

    // ===== AVAILABILITY / START =====
    { keywords: ['available', 'start'], response: 'Immediately' },
    { keywords: ['when', 'start', 'work'], response: 'Within 2 weeks' },
    { keywords: ['earliest', 'start', 'date'], response: 'Immediately' },
    { keywords: ['notice', 'period'], response: '2 weeks' },
    { keywords: ['days', 'notice', 'required'], response: '14' },
    { keywords: ['can', 'start', 'immediately'], response: 'Yes' },
    { keywords: ['available', 'full', 'time'], response: 'Yes' },
    { keywords: ['available', 'part', 'time'], response: 'Yes' },
    { keywords: ['available', 'contract'], response: 'Yes' },

    // ===== LOCATION / RELOCATION =====
    { keywords: ['willing', 'relocate'], response: 'Yes' },
    { keywords: ['open', 'relocation'], response: 'Yes' },
    { keywords: ['willing', 'travel'], response: 'Yes' },
    { keywords: ['travel', 'percentage'], response: 'Up to 25%' },
    { keywords: ['commute', 'office'], response: 'Yes' },
    { keywords: ['reliable', 'transportation'], response: 'Yes' },
    { keywords: ['remote', 'work', 'comfortable'], response: 'Yes' },
    { keywords: ['hybrid', 'work', 'comfortable'], response: 'Yes' },
    { keywords: ['onsite', 'work', 'comfortable'], response: 'Yes' },
    { keywords: ['work', 'from', 'home'], response: 'Yes' },
    { keywords: ['current', 'location'], response: 'Dublin, Ireland' },

    // ===== SHIFT / SCHEDULE =====
    { keywords: ['willing', 'work', 'weekends'], response: 'Yes' },
    { keywords: ['willing', 'work', 'nights'], response: 'Yes' },
    { keywords: ['willing', 'work', 'holidays'], response: 'Yes' },
    { keywords: ['willing', 'work', 'overtime'], response: 'Yes' },
    { keywords: ['flexible', 'schedule'], response: 'Yes' },
    { keywords: ['shift', 'work', 'comfortable'], response: 'Yes' },
    { keywords: ['rotating', 'shift'], response: 'Yes' },

    // ===== COMPENSATION =====
    { keywords: ['desired', 'salary'], response: '80000' },
    { keywords: ['expected', 'salary'], response: '80000' },
    { keywords: ['salary', 'expectation'], response: '80000' },
    { keywords: ['minimum', 'salary'], response: '70000' },
    { keywords: ['current', 'salary'], response: '75000' },
    { keywords: ['hourly', 'rate'], response: '40' },
    { keywords: ['compensation', 'requirement'], response: 'Negotiable based on full package' },
    { keywords: ['salary', 'negotiable'], response: 'Yes' },

    // ===== EDUCATION =====
    { keywords: ['highest', 'degree'], response: "Bachelor's Degree" },
    { keywords: ['education', 'level'], response: "Bachelor's Degree" },
    { keywords: ['completed', 'degree'], response: 'Yes' },
    { keywords: ['graduated', 'college'], response: 'Yes' },
    { keywords: ['high', 'school', 'diploma'], response: 'Yes' },
    { keywords: ['field', 'study'], response: 'Computer Science' },
    { keywords: ['major'], response: 'Computer Science' },
    { keywords: ['gpa'], response: '3.6' },

    // ===== EXPERIENCE =====
    { keywords: ['years', 'experience'], response: '7' },
    { keywords: ['years', 'professional', 'experience'], response: '7' },
    { keywords: ['total', 'years', 'experience'], response: '7' },
    { keywords: ['relevant', 'experience'], response: '7 years' },
    { keywords: ['management', 'experience'], response: '3 years' },
    { keywords: ['leadership', 'experience'], response: 'Yes' },

    // ===== SKILLS / PROFICIENCY =====
    { keywords: ['english', 'proficiency'], response: 'Fluent' },
    { keywords: ['english', 'speak'], response: 'Fluent' },
    { keywords: ['english', 'write'], response: 'Fluent' },
    { keywords: ['language', 'proficiency'], response: 'Fluent' },
    { keywords: ['technical', 'proficiency'], response: 'Advanced' },
    { keywords: ['skill', 'level'], response: 'Advanced' },
    { keywords: ['proficient', 'microsoft', 'office'], response: 'Yes' },
    { keywords: ['proficient', 'excel'], response: 'Yes' },
    { keywords: ['proficient', 'google', 'suite'], response: 'Yes' },

    // ===== TECH STACK YES/NO =====
    { keywords: ['python', 'experience'], response: 'Yes' },
    { keywords: ['java', 'experience'], response: 'Yes' },
    { keywords: ['javascript', 'experience'], response: 'Yes' },
    { keywords: ['typescript', 'experience'], response: 'Yes' },
    { keywords: ['react', 'experience'], response: 'Yes' },
    { keywords: ['node', 'experience'], response: 'Yes' },
    { keywords: ['aws', 'experience'], response: 'Yes' },
    { keywords: ['azure', 'experience'], response: 'Yes' },
    { keywords: ['gcp', 'experience'], response: 'Yes' },
    { keywords: ['docker', 'experience'], response: 'Yes' },
    { keywords: ['kubernetes', 'experience'], response: 'Yes' },
    { keywords: ['terraform', 'experience'], response: 'Yes' },
    { keywords: ['sql', 'experience'], response: 'Yes' },
    { keywords: ['linux', 'experience'], response: 'Yes' },
    { keywords: ['git', 'experience'], response: 'Yes' },
    { keywords: ['agile', 'experience'], response: 'Yes' },
    { keywords: ['scrum', 'experience'], response: 'Yes' },
    { keywords: ['ci', 'cd', 'experience'], response: 'Yes' },

    // ===== CONSENT / AGREEMENTS =====
    { keywords: ['agree', 'terms'], response: 'Yes' },
    { keywords: ['agree', 'privacy', 'policy'], response: 'Yes' },
    { keywords: ['acknowledge', 'read'], response: 'Yes' },
    { keywords: ['consent', 'receive', 'communications'], response: 'Yes' },
    { keywords: ['certify', 'information', 'accurate'], response: 'Yes' },
    { keywords: ['confirm', 'information', 'true'], response: 'Yes' },
    { keywords: ['electronic', 'signature'], response: 'Yes' },
    { keywords: ['text', 'messages', 'sms'], response: 'Yes' },

    // ===== ASSESSMENT / INTERVIEWS =====
    { keywords: ['complete', 'assessment'], response: 'Yes' },
    { keywords: ['take', 'skills', 'test'], response: 'Yes' },
    { keywords: ['available', 'interview'], response: 'Yes' },
    { keywords: ['willing', 'video', 'interview'], response: 'Yes' },

    // ===== MOTIVATION / ESSAY =====
    { keywords: ['why', 'interested', 'role'], response: 'I am excited by the opportunity to contribute my skills to a mission-driven team, solve meaningful problems at scale, and grow alongside experienced professionals.' },
    { keywords: ['why', 'want', 'work', 'here'], response: 'Your company stands out for its innovation, clear vision, and strong culture. I want to contribute to meaningful work and continue my professional growth on a team that values excellence and collaboration.' },
    { keywords: ['why', 'leaving', 'current', 'job'], response: 'I am seeking new growth opportunities where I can take on greater responsibility and impact, aligned with my long-term career goals.' },
    { keywords: ['what', 'makes', 'unique', 'candidate'], response: 'I combine strong technical expertise with excellent communication, a proven record of delivering results, and a genuine passion for solving complex problems collaboratively.' },
    { keywords: ['greatest', 'strength'], response: 'My greatest strength is structured problem-solving: I quickly identify root causes, propose clear options with trade-offs, and execute with attention to detail.' },
    { keywords: ['greatest', 'weakness'], response: 'I used to take on too much individually. I now focus on delegating, documenting, and mentoring so the whole team moves faster.' },
    { keywords: ['career', 'goals'], response: 'Short-term: deliver measurable impact in a senior individual-contributor role. Long-term: grow into a technical leadership position driving architecture and mentorship.' },
    { keywords: ['where', 'see', 'yourself', '5', 'years'], response: 'Leading technical initiatives, mentoring junior engineers, and continuing to deepen my expertise while driving high-impact outcomes for the business.' },
    { keywords: ['tell', 'about', 'yourself'], response: 'I am an experienced professional with a strong track record of delivering results in fast-paced environments. I combine technical depth with collaborative leadership and focus on building reliable, scalable solutions.' },
    { keywords: ['cover', 'letter'], response: 'I am excited to apply for this role. My background and experience align closely with the requirements, and I am confident I can deliver meaningful impact from day one. I look forward to contributing to your team and would welcome the chance to discuss further.' },
    { keywords: ['additional', 'information'], response: 'I am available to start within two weeks and am fully authorized to work without sponsorship. I am happy to provide references or complete any assessments as needed.' },
    { keywords: ['anything', 'else', 'share'], response: 'Thank you for considering my application. I am very enthusiastic about this opportunity and am confident my skills and experience match what you are looking for.' },

    // ===== CERTIFICATIONS =====
    { keywords: ['professional', 'certifications'], response: 'AWS Certified Solutions Architect, Certified Scrum Master' },
    { keywords: ['driver', 'license', 'valid'], response: 'Yes' },
    { keywords: ['security', 'clearance'], response: 'None' },

    // ===== PREFERRED CONTACT =====
    { keywords: ['preferred', 'contact', 'method'], response: 'Email' },
    { keywords: ['best', 'time', 'contact'], response: 'Anytime during business hours' },
  ];

  async function seedOnce() {
    try {
      const flag = await new Promise(r => chrome.storage.local.get(SEEDED_FLAG, d => r(d[SEEDED_FLAG])));
      if (flag === '1.5.4') { LOG('Seed bank already installed'); return; }
      const existing = await new Promise(r => chrome.storage.local.get(SEED_KEY, d => r(d[SEED_KEY] || [])));
      const existingSigs = new Set(existing.map(e => (e.keywords || []).slice().sort().join('|')));
      let added = 0;
      for (const entry of SEED) {
        const sig = entry.keywords.slice().sort().join('|');
        if (existingSigs.has(sig)) continue;
        existing.push({ keywords: entry.keywords, response: entry.response, appearances: 1, createdAt: Date.now(), updatedAt: Date.now(), seeded: true });
        added++;
      }
      await new Promise(r => chrome.storage.local.set({ [SEED_KEY]: existing, [SEEDED_FLAG]: '1.5.4' }, r));
      LOG(`Seeded ${added} knockout responses (total ${existing.length})`);
    } catch (e) { LOG('Seed error:', e.message); }
  }

  if (window.self === window.top) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seedOnce);
    else seedOnce();
  }
})();

// ============================================================================
// === v1.5.4 STAR-FORMAT BEHAVIORAL ANSWER ENGINE ===
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-STAR]', ...a);

  // Rich STAR-format responses for common behavioral / situational questions.
  // Triggered when a textarea's label contains matching phrases.
  const STAR = [
    { match: /tell.*time.*(you|when).*(conflict|disagreement)|conflict.*(team|coworker|colleague|manager)/i,
      answer: `Situation: On a cross-functional project, an engineer and a product manager disagreed on the delivery approach for a key feature — the engineer wanted a complete refactor, the PM wanted an incremental release.
Task: As the senior on the team, I needed to unblock the decision without the tension escalating.
Action: I scheduled a short meeting, asked each side to list their non-negotiables, and whiteboarded a hybrid plan that shipped the incremental version first and scheduled the refactor for the next quarter.
Result: We shipped on time, both stakeholders felt heard, and the refactor was completed six weeks later with a 30% performance improvement.` },

    { match: /tell.*(failure|failed|mistake)|time.*(failed|mistake)/i,
      answer: `Situation: Early in my career I shipped a change to production that caused a brief outage for a subset of users because I under-tested an edge case.
Task: I owned the rollback and the post-mortem.
Action: I reverted immediately, documented the root cause transparently, and proposed a new pre-deploy checklist plus automated regression tests for that area.
Result: The fix was deployed within the hour, the checklist became a team standard, and no similar incident has occurred since. It taught me the value of systematic pre-deploy validation.` },

    { match: /tell.*(challenging|difficult|hard).*(project|problem|task)|most.*challenging/i,
      answer: `Situation: I led the migration of a legacy monolith to a set of services while the product was still actively growing.
Task: Deliver the migration without customer-visible regressions under a six-month deadline.
Action: I broke the work into verifiable phases, introduced feature flags for safe rollouts, wrote a migration runbook, and ran bi-weekly risk reviews.
Result: We completed the migration on schedule, deployment frequency improved 4x, and incident rate dropped by 40%.` },

    { match: /tell.*(lead|led).*team|leadership.*example|demonstrate.*leadership/i,
      answer: `Situation: Our team was missing sprint goals consistently due to unclear prioritization and long code-review turnaround.
Task: Restore delivery predictability without hiring.
Action: I introduced a weekly prioritization huddle, set a 24-hour review SLA, and paired each junior engineer with a senior reviewer.
Result: Sprint completion rose from 65% to 92% over two quarters and engineer satisfaction improved in the next survey.` },

    { match: /tight.*deadline|under.*pressure|met.*deadline/i,
      answer: `Situation: A customer-visible compliance deadline was moved up by three weeks mid-quarter.
Task: Ship the required changes without compromising quality.
Action: I re-scoped the work into a minimum compliant release, pulled in a second engineer, and negotiated a freeze on non-critical tickets for two weeks.
Result: We delivered two days early, passed the audit, and the deferred tickets were resumed without impact.` },

    { match: /worked.*(difficult|challenging).*(person|stakeholder|customer)/i,
      answer: `Situation: A senior stakeholder was frustrated with how requirements were being translated into technical decisions.
Task: Rebuild trust and deliver what was actually needed.
Action: I scheduled a one-on-one, asked open questions to understand the underlying goals, shared a written summary of what I heard, and proposed a lightweight weekly sync.
Result: Requirements clarified, the next two releases hit his acceptance criteria on the first review, and the weekly sync became a model for other teams.` },

    { match: /go.*above.*beyond|extra.*mile|went.*beyond/i,
      answer: `Situation: Production had a silent data-quality issue no ticket existed for — only flagged by a single customer.
Task: Nobody had capacity; I chose to investigate on my own initiative.
Action: I instrumented the pipeline, found a race condition, wrote a reproducible test, and shipped a fix plus a monitoring alert.
Result: Prevented a potentially customer-impacting incident at scale and the new monitor caught two unrelated issues in the following month.` },

    { match: /disagree.*(manager|supervisor|boss)/i,
      answer: `Situation: My manager wanted to ship a feature without metrics wired in.
Task: Ship on time but keep the ability to measure success.
Action: I proposed a minimal instrumentation layer that added less than a day of work, with clear numbers on risk and payoff.
Result: Manager agreed, feature shipped on time with metrics that later informed a product pivot.` },

    { match: /handle.*ambiguity|ambiguous.*(situation|requirement)|unclear.*requirement/i,
      answer: `Situation: I was asked to own a new area with no requirements doc and mixed stakeholder expectations.
Task: Ship something useful within two sprints despite the ambiguity.
Action: I interviewed stakeholders individually, wrote a one-page assumptions doc, socialized it, and chose the smallest useful slice to build first.
Result: Delivered a working v1 in three sprints, used actual user feedback to prioritize v2, and the assumptions doc became the team's standard playbook.` },

    { match: /learn.*(new|quickly)|picked.*up.*quickly|unfamiliar.*technology/i,
      answer: `Situation: I joined a team that used a framework I had not worked with.
Task: Ramp up and contribute within two weeks.
Action: I paired with a teammate, built a small internal tool end-to-end as a learning project, read the source code of critical modules, and kept a running notes doc.
Result: Shipped my first production change in week three and my notes doc became the onboarding guide for the next two hires.` },

    { match: /prioritiz|multiple.*(project|task|deadline)/i,
      answer: `I start each week by listing every commitment, tagging each with impact and urgency, and explicitly deciding what not to do. I communicate trade-offs proactively so stakeholders can weigh in before anything slips. On a recent quarter with three parallel initiatives I delivered all three on time by renegotiating scope early and pair-working the highest-risk item with a teammate.` },

    { match: /proud.*(achievement|accomplishment)|greatest.*(achievement|accomplishment)/i,
      answer: `I am most proud of leading a reliability program that reduced our P1 incident rate by 60% over two quarters. I drove the roadmap, negotiated engineering time across three teams, introduced chaos drills, and personally wrote the playbooks. The program became the template for the rest of the organization.` },

    { match: /feedback.*(negative|constructive|critical)|criticism.*receive/i,
      answer: `A senior engineer once told me my code reviews were thorough but too long, which slowed the team. I thanked him, asked for examples, and changed my approach — I now lead with the two or three issues that matter and leave the rest as suggestions. Review turnaround improved and colleagues said the feedback felt more actionable.` },

    { match: /motivat|what.*drives.*you/i,
      answer: `I am motivated by solving problems that have real impact on people and by working with teammates I can learn from. Owning the outcome — not just the task — and seeing the downstream effect of a well-built system keeps me engaged.` },

    { match: /why.*should.*hire.*you|why.*you.*best.*fit/i,
      answer: `I bring a rare combination of deep technical skills, a track record of shipping on time, and the communication ability to align stakeholders. I will ramp up quickly, own my work end-to-end, and raise the bar for the team around me.` },
  ];

  function textareaLooksEmpty(el) {
    if (!el || el.disabled || el.readOnly) return false;
    return !el.value || !el.value.trim() || el.value.trim().length < 10;
  }

  function getNearbyLabel(el) {
    if (!el) return '';
    const lbl = el.getAttribute('aria-label') || el.placeholder || '';
    if (lbl) return lbl;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) { const d = document.getElementById(labelledBy); if (d) return d.textContent || ''; }
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.textContent || ''; }
    const parent = el.closest('fieldset, .question, [class*="question"], .form-group, [class*="FormField"], [class*="field"]');
    return (parent?.textContent || '').trim();
  }

  function nativeSet(el, val) {
    if (!el || el.disabled || el.readOnly) return false;
    // On Workday, plain .value assignment leaves fields "unregistered" (validation
    // fails, Continue/Create stays disabled). Use real-typing there so React commits.
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
        el.type !== 'checkbox' && el.type !== 'radio' &&
        typeof isWorkday === 'function' && isWorkday()) {
      return reactTypeValue(el, String(val));
    }
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
        el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) { setter.call(el, ''); setter.call(el, val); } else el.value = val;
    } catch (_) { try { el.value = val; } catch (__) { return false; } }
    // Composed, and repeated on the shadow host chain — otherwise the component
    // that owns this input never learns the value and re-renders it empty.
    fireOnHostChain(el, ['focus', 'input', 'change']);
    // React's synthetic-event bridge wants its own marked input event.
    try {
      const reactEvt = new Event('input', { bubbles: true, composed: true });
      Object.defineProperty(reactEvt, 'simulated', { value: true });
      el.dispatchEvent(reactEvt);
    } catch (_) {}
    if (el.type === 'tel' || /phone|mobile|cell/i.test(el.name || el.id || '')) {
      for (const ch of String(val)) {
        for (const t of ['keydown', 'keypress', 'keyup']) {
          try { el.dispatchEvent(new KeyboardEvent(t, { key: ch, bubbles: true, composed: true })); } catch (_) {}
        }
      }
    }
    fireOnHostChain(el, ['blur']);
    if (el.getAttribute && (el.getAttribute('ng-model') || el.getAttribute('[(ngModel)]') || el.getAttribute('formControlName'))) {
      fireAll(el, ['input', 'change']);
    }
    return true;
  }

  function scanAndAnswer() {
    const textareas = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    let filled = 0;
    for (const ta of textareas) {
      if (!ta.offsetParent && !ta.getClientRects().length) continue;   // fixed-position modals
      if (!textareaLooksEmpty(ta) && ta.tagName === 'TEXTAREA') continue;
      if (ta.getAttribute('contenteditable') === 'true' && ta.textContent && ta.textContent.trim().length > 10) continue;
      const label = getNearbyLabel(ta).slice(0, 400);
      if (!label || label.length < 10) continue;
      // Only trigger for longer free-text prompts
      if (ta.tagName === 'TEXTAREA' && (ta.maxLength > 0 && ta.maxLength < 200)) continue;
      const hit = STAR.find(s => s.match.test(label));
      if (!hit) continue;
      if (ta.tagName === 'TEXTAREA') {
        nativeSet(ta, hit.answer);
      } else {
        ta.textContent = hit.answer;
        ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
      filled++;
    }
    if (filled) LOG(`Filled ${filled} behavioral answer(s) in STAR format`);
    return filled;
  }

  // Exposed for manual invocation (Generate+Autofill button / auto-pilot).
  // No automatic timers — autonomous scanning was filling textareas on
  // LinkedIn feeds, messaging, and other non-application areas.
  window.__uaStarAnswer = scanAndAnswer;
})();

// ============================================================================
// === v1.5.4 SHADOW DOM + IFRAME DEEP SCANNER ===
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-Shadow]', ...a);

  function walkShadow(root, visitor, depth) {
    if (!root || depth > 6) return;
    try { visitor(root); } catch (_) {}
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) walkShadow(el.shadowRoot, visitor, depth + 1);
    }
  }

  function deepQueryAll(selector) {
    const results = [];
    const visit = (root) => {
      try { root.querySelectorAll(selector).forEach(e => results.push(e)); } catch (_) {}
    };
    visit(document);
    walkShadow(document, visit, 0);
    // Same-origin iframes
    document.querySelectorAll('iframe').forEach(f => {
      try {
        const doc = f.contentDocument;
        if (doc) { visit(doc); walkShadow(doc, visit, 0); }
      } catch (_) {}
    });
    return results;
  }

  function fillUnfilled() {
    const fields = deepQueryAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]), textarea, select');
    let filled = 0;
    for (const f of fields) {
      if (f.__uaTouched) continue;
      f.__uaTouched = true;
      // The main IIFE scans the top document; we just mark shadow/iframe fields as visible to autofill engines.
      try { f.dispatchEvent(new Event('focus', { bubbles: true, composed: true })); } catch (_) {}
    }
    return filled;
  }

  window.__uaDeepQueryAll = deepQueryAll;
  // Autonomous autofill disabled: it was writing into search boxes and other
  // inputs on non-application pages. Kept exposed on window.__uaFillUnfilled
  // for the Generate+Autofill manual trigger.
  window.__uaFillUnfilled = fillUnfilled;
})();

// ============================================================================
// === v1.5.4 SMART JOB-CONTEXT COVER LETTER GENERATOR ===
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-CoverLetter]', ...a);

  function extractJobContext() {
    const ctx = { title: '', company: '', skills: [], keywords: [] };
    // Title candidates
    const titleSel = [
      'h1[class*="job"]', 'h1[class*="title"]', 'h1[class*="Job"]',
      '[data-automation-id*="jobPostingHeader"]', '[data-testid*="job-title"]',
      'h1', '[class*="posting-headline"]', '[class*="job-title"]'
    ];
    for (const s of titleSel) {
      const el = document.querySelector(s);
      if (el && el.textContent?.trim()) { ctx.title = el.textContent.trim().slice(0, 120); break; }
    }
    // Company candidates
    const compSel = [
      '[data-automation-id*="companyName"]', '[data-testid*="company"]',
      '[class*="company-name"]', '[class*="CompanyName"]', 'meta[property="og:site_name"]'
    ];
    for (const s of compSel) {
      const el = document.querySelector(s);
      const t = el?.getAttribute?.('content') || el?.textContent || '';
      if (t.trim()) { ctx.company = t.trim().slice(0, 80); break; }
    }
    if (!ctx.company) {
      const host = location.hostname.replace(/^www\.|^jobs\.|^careers\./, '').split('.')[0];
      ctx.company = host.charAt(0).toUpperCase() + host.slice(1);
    }
    // Extract keywords from description
    const descEl = document.querySelector('[class*="description"], [class*="Description"], [data-automation-id*="jobPostingDescription"], .job-description, [class*="job-details"]');
    const text = (descEl?.textContent || document.body.textContent || '').toLowerCase();
    const techKeywords = ['python', 'java', 'javascript', 'typescript', 'react', 'node', 'aws', 'azure', 'gcp',
      'docker', 'kubernetes', 'terraform', 'sql', 'postgres', 'mysql', 'mongodb', 'redis', 'kafka', 'spark',
      'ci/cd', 'agile', 'scrum', 'devops', 'microservices', 'rest', 'graphql', 'grpc', 'linux', 'git',
      'leadership', 'mentoring', 'architecture', 'scalability', 'reliability', 'performance'];
    for (const kw of techKeywords) if (text.includes(kw)) ctx.skills.push(kw);
    return ctx;
  }

  function buildTailoredCoverLetter(ctx, profile) {
    const firstName = profile?.first_name || '';
    const lastName = profile?.last_name || '';
    const role = ctx.title || 'this role';
    const company = ctx.company || 'your company';
    const topSkills = ctx.skills.slice(0, 4).join(', ') || 'the required technical stack';
    return [
      `Dear ${company} Hiring Team,`,
      ``,
      `I am excited to apply for the ${role} position at ${company}. My background aligns closely with what you are looking for, particularly around ${topSkills}, and I am confident I can deliver meaningful impact from day one.`,
      ``,
      `In my recent role I have shipped production systems at scale, mentored engineers, and partnered with product and design to move fast without breaking reliability. I value writing clear code, measuring what matters, and raising the bar for the team around me — qualities I see reflected in ${company}'s engineering culture.`,
      ``,
      `I would welcome the opportunity to discuss how my experience can support ${company}'s goals. Thank you for your time and consideration.`,
      ``,
      `Sincerely,`,
      `${firstName} ${lastName}`.trim() || 'Applicant',
    ].join('\n');
  }

  async function getProfile() {
    return new Promise(r => {
      try { chrome.storage.local.get(['ua_profile', 'candidateDetails', 'userDetails'], d => {
        let p = d.ua_profile || {};
        try {
          const cd = typeof d.candidateDetails === 'string' ? JSON.parse(d.candidateDetails) : (d.candidateDetails || {});
          const ud = typeof d.userDetails === 'string' ? JSON.parse(d.userDetails) : (d.userDetails || {});
          p = { ...ud, ...cd, ...p };
        } catch (_) {}
        r(p);
      }); } catch (_) { r({}); }
    });
  }

  function looksLikeCoverLetterField(el) {
    const label = (el.getAttribute('aria-label') || el.placeholder || '').toLowerCase();
    const labelledBy = el.getAttribute('aria-labelledby');
    const byText = labelledBy ? (document.getElementById(labelledBy)?.textContent || '').toLowerCase() : '';
    const forLbl = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || '').toLowerCase() : '';
    const parent = el.closest('.form-group, [class*="field"], [class*="question"]');
    const pText = (parent?.textContent || '').toLowerCase();
    const combined = `${label} ${byText} ${forLbl} ${pText}`;
    return /cover.?letter|motivation|why.*(want|apply|interested)|tell.*about.*yourself|additional.*info|anything.*else/.test(combined);
  }

  async function autoFillCoverLetter() {
    const textareas = Array.from(document.querySelectorAll('textarea')).filter(t => (t.offsetParent || t.getClientRects().length) && (!t.value || t.value.trim().length < 20));
    if (!textareas.length) return 0;
    const targets = textareas.filter(looksLikeCoverLetterField);
    if (!targets.length) return 0;
    const ctx = extractJobContext();
    const profile = await getProfile();
    const letter = buildTailoredCoverLetter(ctx, profile);
    let filled = 0;
    for (const ta of targets) {
      try {
        const proto = HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) { setter.call(ta, ''); setter.call(ta, letter); } else ta.value = letter;
        ['focus', 'input', 'change', 'blur'].forEach(t => ta.dispatchEvent(new Event(t, { bubbles: true, composed: true })));
        filled++;
      } catch (_) {}
    }
    if (filled) LOG(`Wrote tailored cover letter for ${ctx.company} / ${ctx.title} into ${filled} field(s)`);
    return filled;
  }

  // Exposed for manual invocation only. Autonomous cover-letter writing was
  // scribbling into random textareas (e.g. LinkedIn post composer) — now
  // only runs when triggered by the Generate+Autofill button.
  window.__uaAutoCoverLetter = autoFillCoverLetter;
})();

// ============================================================================
// === v1.5.4 NEW ATS CHATBOT HANDLERS (Paradox/Olivia, Phenom, HireVue Chat) ===
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-ATS-Chat]', ...a);

  const CHAT_HOSTS = /olivia\.paradox\.ai|paradox\.ai|phenom\.com|phenompeople\.com|beamery\.com|hirevue\.com|modernhire\.com|shaker\.com|mya\.com|xref\.com/i;
  if (!CHAT_HOSTS.test(location.hostname) && !CHAT_HOSTS.test(location.href)) return;

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      // A zero-sized box already covers display:none anywhere up the ancestor chain.
      if (r.width <= 0 || r.height <= 0) return false;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const cs = win.getComputedStyle ? win.getComputedStyle(el) : null;
      if (!cs) return true;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity || '1') === 0) return false;
      return true;
    } catch (_) { return false; }
  }

  function determineYesNo(q) {
    const t = (q || '').toLowerCase();
    if (/require.*sponsor|need.*visa|need.*sponsorship|convict|felony|criminal|previously.*worked|former.*employee|family.*member.*work/.test(t)) return 'No';
    return 'Yes';
  }

  async function answerChatPrompt(promptEl, inputEl) {
    const q = promptEl.textContent || '';
    // Yes/No buttons first
    const btns = Array.from(document.querySelectorAll('button, [role="button"], [role="option"]')).filter(isVisible);
    const yes = btns.find(b => /^yes$/i.test((b.textContent || '').trim()));
    const no  = btns.find(b => /^no$/i.test((b.textContent || '').trim()));
    if (yes && no) {
      const decision = determineYesNo(q);
      (decision === 'No' ? no : yes).click();
      return true;
    }
    // Multi-option list
    const opts = btns.filter(b => /option|choice|answer/i.test(b.className || '') && (b.textContent || '').trim().length < 80);
    if (opts.length >= 2) {
      // Prefer first non-negative option
      const pick = opts.find(b => !/none|n\/a|other|decline|prefer not/i.test(b.textContent || '')) || opts[0];
      pick.click();
      return true;
    }
    // Fallback: type into input
    if (inputEl) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const answer = /salary|pay|rate/i.test(q) ? '80000'
                   : /years|experience/i.test(q) ? '7'
                   : /start|available/i.test(q) ? 'Immediately'
                   : 'Yes';
      setter?.call(inputEl, answer);
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, composed: true }));
      return true;
    }
    return false;
  }

  function scanChatUI() {
    // Paradox/Olivia & Phenom typically render a chat bubble stream
    const msgSelectors = '[class*="message"], [class*="Message"], [class*="bubble"], [class*="Bubble"], [data-qa*="message"]';
    const messages = Array.from(document.querySelectorAll(msgSelectors)).filter(isVisible);
    const lastPrompt = messages.slice(-1)[0];
    if (!lastPrompt) return;
    const input = document.querySelector('input[type=text]:not([readonly]), textarea:not([readonly])');
    answerChatPrompt(lastPrompt, input).catch(()=>{});
  }

  if (window.self === window.top) {
    // Throttled to 4s and capped at ~15 min so it doesn't poll forever on
    // idle tabs and drain CPU.
    let chatTicks = 0;
    const chatIv = setInterval(() => {
      if (++chatTicks > 225) { clearInterval(chatIv); return; }
      // Never answer a recruiting chatbot unless automation is actually on.
      if (!window.__uaAutoAllowed || !window.__uaAutoAllowed()) return;
      try { scanChatUI(); } catch (_) {}
    }, 4000);
    LOG('Chat-ATS handler active for', location.hostname);
  }
})();

// ============================================================================
// === v1.5.4 RESUME KEYWORD OPTIMIZER (match-rate scoring) ===
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-Keyword]', ...a);

  function tokenize(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9+#.\-\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  }

  function computeScore(jobText, resumeText) {
    const jobTokens = new Set(tokenize(jobText));
    const resumeTokens = new Set(tokenize(resumeText));
    if (!jobTokens.size) return { score: 0, matched: [], missing: [] };
    const matched = [...jobTokens].filter(t => resumeTokens.has(t));
    const missing = [...jobTokens].filter(t => !resumeTokens.has(t));
    const stop = new Set(['and','the','for','with','from','this','that','our','are','you','your','will','have','been','any','all','not','but','can','out','who','was','has','one','two','three','per','may','its']);
    const meaningfulJob = [...jobTokens].filter(t => !stop.has(t));
    const meaningfulMatched = matched.filter(t => !stop.has(t));
    const score = meaningfulJob.length ? Math.round((meaningfulMatched.length / meaningfulJob.length) * 100) : 0;
    return { score, matched: meaningfulMatched.slice(0, 50), missing: missing.filter(t => !stop.has(t)).slice(0, 25) };
  }

  window.__uaKeywordScore = function (jobText, resumeText) {
    return computeScore(jobText, resumeText);
  };

  // If on a jobright page with a resume in storage, compute a live score for the current JD.
  async function liveScore() {
    try {
      const descEl = document.querySelector('[class*="description"], [class*="Description"], [data-automation-id*="jobPostingDescription"], .job-description');
      if (!descEl) return;
      const stored = await new Promise(r => chrome.storage.local.get(['ua_resume_text', 'resumeText', 'resume_content'], r));
      const resumeText = stored.ua_resume_text || stored.resumeText || stored.resume_content || '';
      if (!resumeText) return;
      const res = computeScore(descEl.textContent, resumeText);
      LOG(`Keyword match: ${res.score}% (${res.matched.length} matched, ${res.missing.length} missing)`);
      if (res.missing.length) LOG('Missing keywords to consider adding:', res.missing.slice(0, 15).join(', '));
    } catch (_) {}
  }

  // Expose for manual score queries. No auto-run — it was reading resumes
  // from storage on every page load.
  window.__uaLiveKeywordScore = liveScore;
})();

// ============================================================================
// === v1.5.4 ZERO-TOUCH TAILORED RESUME GENERATOR ===
// Fully automates: extract JD → rewrite resume bullets to match keywords →
// inject into resume textarea → upload as file → click Jobright Tailor button.
// Per-JD cache prevents duplicate work. No manual editing required.
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-AutoResume]', ...a);
  const CACHE_KEY = 'ua_tailored_cache';      // { [jdHash]: { text, filename, ts } }
  const MASTER_KEYS = ['ua_master_resume', 'ua_resume_text', 'resumeText', 'resume_content', 'ua_profile'];
  const UPLOAD_FLAG_PREFIX = 'ua_resume_uploaded_';

  function hash(s) {
    let h = 0; s = s || '';
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return String(Math.abs(h));
  }

  async function storageGet(keys) {
    return new Promise(r => { try { chrome.storage.local.get(keys, r); } catch (_) { r({}); } });
  }
  async function storageSet(obj) {
    return new Promise(r => { try { chrome.storage.local.set(obj, r); } catch (_) { r(); } });
  }

  // ---- Master resume loader (supports text OR structured profile) ----
  async function loadMasterResume() {
    const data = await storageGet(MASTER_KEYS);
    // Plain text takes priority
    for (const k of ['ua_master_resume', 'ua_resume_text', 'resumeText', 'resume_content']) {
      const v = data[k];
      if (typeof v === 'string' && v.trim().length > 50) return { type: 'text', text: v };
      if (v && typeof v === 'object' && v.text && v.text.length > 50) return { type: 'text', text: v.text };
    }
    // Fall back to building from profile
    const p = data.ua_profile || {};
    if (p.first_name || p.last_name || p.email) return { type: 'profile', profile: p };
    return null;
  }

  function buildResumeFromProfile(p) {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Applicant';
    const header = [
      name,
      [p.email, p.phone, p.city, p.state, p.country].filter(Boolean).join(' | '),
      [p.linkedin || p.linkedin_profile_url, p.github || p.github_url, p.website || p.website_url].filter(Boolean).join(' | '),
    ].filter(Boolean).join('\n');
    const summary = p.summary || p.cover_letter ||
      'Results-driven professional with a proven record of delivering high-impact solutions in fast-paced environments. Strong collaboration, communication, and ownership.';
    const skillsLine = (p.skills || 'Python, JavaScript, TypeScript, React, Node.js, AWS, Docker, Kubernetes, SQL, Git, CI/CD, Agile').toString();
    const experience = p.work_experience || p.experience ||
      `${p.current_title || 'Senior Engineer'} — ${p.current_company || 'Recent Company'} (${p.work_start_year || '2021'} – Present)\n` +
      `• Led end-to-end delivery of critical features impacting thousands of users.\n` +
      `• Partnered with product, design, and data to define, scope, and ship roadmap items on schedule.\n` +
      `• Mentored engineers, led code reviews, and improved team velocity by 30%.\n` +
      `• Built scalable services with modern cloud tooling and automated CI/CD.`;
    const education = p.education ||
      `${p.degree || "Bachelor's Degree"} in ${p.major || 'Computer Science'} — ${p.school || p.university || 'University'} (${p.graduation_year || p.grad_year || '2018'})`;
    return [
      header,
      '',
      'SUMMARY',
      summary,
      '',
      'SKILLS',
      skillsLine,
      '',
      'EXPERIENCE',
      experience,
      '',
      'EDUCATION',
      education,
    ].join('\n');
  }

  // ---- JD extraction ----
  function extractJD() {
    const sels = [
      '[class*="description"]', '[class*="Description"]',
      '[data-automation-id*="jobPostingDescription"]',
      '[data-testid*="description"]', '.job-description', '[class*="job-details"]',
      '[class*="posting-body"]', '[class*="PostingBody"]', '[id*="job-description"]',
      'section[class*="content"]', 'article'
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el?.textContent?.trim();
      if (t && t.length > 200) return t;
    }
    // Fallback: entire main content
    const main = document.querySelector('main')?.textContent || document.body.textContent || '';
    return main.slice(0, 8000);
  }

  function extractJDTitle() {
    const sels = ['[data-automation-id*="jobPostingHeader"]', '[data-testid*="job-title"]',
      'h1[class*="job"]', 'h1[class*="title"]', 'h1[class*="Job"]', 'h1'];
    for (const s of sels) { const el = document.querySelector(s); if (el?.textContent?.trim()) return el.textContent.trim().slice(0, 120); }
    return '';
  }

  function extractJDCompany() {
    const sels = ['[data-automation-id*="companyName"]', '[data-testid*="company"]',
      '[class*="company-name"]', '[class*="CompanyName"]'];
    for (const s of sels) { const el = document.querySelector(s); if (el?.textContent?.trim()) return el.textContent.trim().slice(0, 80); }
    const meta = document.querySelector('meta[property="og:site_name"]');
    if (meta?.content) return meta.content.slice(0, 80);
    return '';
  }

  // ---- Keyword extraction from JD ----
  const STOP = new Set(['the','and','for','with','from','this','that','our','are','you','your','will','have','been','any','all','not','but','can','out','who','was','has','one','two','three','per','may','its','their','them','they','his','her','she','him','what','when','where','how','why','which','while','about','into','than','then','also','such','each','some','most','more','less','very','just','over','under','upon','without','within','must','should','would','could','might','shall','being','able','across','among','between','during','through']);
  const KEY_TECH = ['python','java','javascript','typescript','react','vue','angular','node','next.js','nestjs','express','django','flask','spring','rails','go','golang','rust','scala','kotlin','swift','objective-c','c++','c#','.net','php','ruby','r ','matlab','perl','bash','shell','aws','azure','gcp','google cloud','docker','kubernetes','helm','terraform','ansible','puppet','chef','jenkins','github actions','gitlab','circleci','travis','bitbucket','sql','postgres','mysql','mongodb','dynamodb','cassandra','redis','elasticsearch','snowflake','bigquery','redshift','kafka','rabbitmq','spark','airflow','hadoop','linux','unix','git','agile','scrum','kanban','ci/cd','microservices','rest','graphql','grpc','websocket','oauth','saml','jwt','etl','devops','sre','ml','machine learning','llm','nlp','deep learning','pytorch','tensorflow','keras','numpy','pandas','scikit-learn','leadership','mentoring','architecture','scalability','reliability','performance','security','compliance','sox','hipaa','pci','gdpr'];

  function extractJDKeywords(jdText) {
    const lower = (jdText || '').toLowerCase();
    const found = new Set();
    for (const kw of KEY_TECH) { if (lower.includes(kw)) found.add(kw); }
    // Additional 1-2 word capitalized tokens that look like tools
    const tokenMatches = jdText.match(/\b[A-Z][a-zA-Z0-9+#.]{2,}\b/g) || [];
    for (const t of tokenMatches.slice(0, 200)) {
      const tl = t.toLowerCase();
      if (STOP.has(tl)) continue;
      if (tl.length < 3 || tl.length > 25) continue;
      if (/^[A-Z][a-z]+$/.test(t) && t.length < 8) continue; // skip plain English title-case words
      found.add(tl);
    }
    return [...found];
  }

  // ---- Resume rewriter: tailors master resume to JD ----
  function tailorResumeText(master, jd, jdTitle, jdCompany, keywords) {
    const lines = master.split(/\r?\n/);
    const kwLower = keywords.map(k => k.toLowerCase());
    const containsAnyKw = (line) => kwLower.some(k => line.toLowerCase().includes(k));

    // Reorder bullets within sections: keyword-matching bullets first.
    const out = [];
    let buffer = [];
    let inBullets = false;

    const flushBullets = () => {
      if (!buffer.length) return;
      // Preserve original order among same-relevance; stable sort by relevance desc.
      const scored = buffer.map((l, i) => ({ l, i, s: containsAnyKw(l) ? 1 : 0 }));
      scored.sort((a, b) => b.s - a.s || a.i - b.i);
      scored.forEach(o => out.push(o.l));
      buffer = [];
    };

    for (const line of lines) {
      const isBullet = /^\s*[•\-*]/.test(line);
      if (isBullet) { buffer.push(line); inBullets = true; continue; }
      if (inBullets) { flushBullets(); inBullets = false; }
      out.push(line);
    }
    flushBullets();

    // Insert a tailored summary line at top of SUMMARY section (or prepend if absent).
    const topSkills = keywords.slice(0, 5).map(k => k.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
    const roleLine = jdTitle ? `Targeting ${jdTitle}${jdCompany ? ' at ' + jdCompany : ''}.` : '';
    const tailoredLead = `${roleLine} Core strengths aligned with this role: ${topSkills || 'cross-functional delivery, technical depth, and ownership'}.`;

    const summaryIdx = out.findIndex(l => /^\s*SUMMARY\b/i.test(l));
    if (summaryIdx >= 0 && out[summaryIdx + 1]) {
      out.splice(summaryIdx + 2, 0, tailoredLead);
    } else {
      out.unshift(tailoredLead, '');
    }

    // Augment SKILLS section with any JD keywords missing from the resume
    const skillsIdx = out.findIndex(l => /^\s*SKILLS\b/i.test(l));
    if (skillsIdx >= 0) {
      const skillsLine = out[skillsIdx + 1] || '';
      const have = skillsLine.toLowerCase();
      const missing = keywords.filter(k => !have.includes(k.toLowerCase())).slice(0, 10);
      if (missing.length) out[skillsIdx + 1] = (skillsLine ? skillsLine + ', ' : '') + missing.map(m => m.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
    }

    return out.join('\n');
  }

  // ---- Inject tailored text into resume textareas ----
  function findResumeTextareas() {
    const all = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    return all.filter(t => {
      if (!t.offsetParent && !t.getClientRects().length) return false;   // fixed-position modals
      const label = (t.getAttribute('aria-label') || t.placeholder || '').toLowerCase();
      const byText = t.getAttribute('aria-labelledby')
        ? (document.getElementById(t.getAttribute('aria-labelledby'))?.textContent || '').toLowerCase() : '';
      const forLbl = t.id ? (document.querySelector(`label[for="${CSS.escape(t.id)}"]`)?.textContent || '').toLowerCase() : '';
      const parent = t.closest('.form-group, [class*="field"], [class*="question"], [class*="resume"], [class*="Resume"], [class*="cv"], [class*="CV"]');
      const pText = (parent?.textContent || '').toLowerCase();
      return /\b(resume|cv|paste.*resume|resume.*text|experience.*paste)\b/.test(`${label} ${byText} ${forLbl} ${pText}`);
    });
  }

  function injectText(el, text) {
    try {
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, '');
        setter?.call(el, text);
      } else {
        el.textContent = text;
      }
      ['focus', 'input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true, composed: true })));
      return true;
    } catch (_) { return false; }
  }

  // ---- Upload as file to file inputs ----
  async function uploadAsFile(text, filename) {
    const inputs = Array.from(document.querySelectorAll('input[type=file]')).filter(i => i.offsetParent !== null || i.getClientRects().length || i.closest('[class*="resume"], [class*="Resume"], [class*="upload"], [class*="Upload"]'));
    if (!inputs.length) return 0;
    const flag = UPLOAD_FLAG_PREFIX + location.pathname;
    const already = await storageGet(flag);
    if (already[flag]) return 0;
    let uploaded = 0;
    for (const input of inputs) {
      const accept = (input.accept || '').toLowerCase();
      const container = input.closest('[class*="resume"], [class*="Resume"], [class*="cv"], [class*="CV"], [class*="document"]');
      const containerText = (container?.textContent || '').toLowerCase();
      const isResumeField = container !== null || /resume|cv/.test(accept) || /resume|cv/i.test(input.name || input.id || '');
      if (!isResumeField) continue;
      try {
        let mime = 'text/plain';
        let fname = filename || 'resume.txt';
        if (accept.includes('pdf')) { fname = fname.replace(/\.[^.]+$/, '') + '.txt'; }
        const blob = new Blob([text], { type: mime });
        const file = new File([blob], fname, { type: mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        uploaded++;
        LOG(`Uploaded tailored resume to file input: ${fname}`);
      } catch (e) { LOG('File upload error:', e.message); }
    }
    if (uploaded) await storageSet({ [flag]: Date.now() });
    return uploaded;
  }

  // ---- Jobright AI Tailor button auto-clicker ----
  function clickJobrightTailor() {
    if (!/jobright\.ai/i.test(location.hostname)) return false;
    const btns = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(b => b.offsetParent !== null || b.getClientRects().length);
    const tailor = btns.find(b => /tailor.*(resume|cv)|ai.*tailor|auto.*tailor|generate.*resume/i.test(b.textContent || ''));
    if (tailor) { tailor.click(); LOG('Clicked Jobright Tailor Resume button'); return true; }
    return false;
  }

  // ---- Main orchestrator ----
  async function runAutoTailor() {
    try {
      const jd = extractJD();
      if (!jd || jd.length < 200) return;
      const jdTitle = extractJDTitle();
      const jdCompany = extractJDCompany();
      const jdHash = hash(jdTitle + '|' + jdCompany + '|' + jd.slice(0, 500));
      const cache = (await storageGet(CACHE_KEY))[CACHE_KEY] || {};
      let tailored, filename;
      if (cache[jdHash]) {
        tailored = cache[jdHash].text;
        filename = cache[jdHash].filename;
        LOG(`Using cached tailored resume for ${jdTitle || 'this JD'}`);
      } else {
        const master = await loadMasterResume();
        if (!master) { LOG('No master resume in storage — skipping auto-tailor'); return; }
        const masterText = master.type === 'text' ? master.text : buildResumeFromProfile(master.profile);
        const keywords = extractJDKeywords(jd);
        tailored = tailorResumeText(masterText, jd, jdTitle, jdCompany, keywords);
        filename = `Resume_${(jdCompany || 'Company').replace(/[^A-Za-z0-9]/g, '')}_${(jdTitle || 'Role').replace(/[^A-Za-z0-9]/g, '').slice(0, 30)}.txt`;
        cache[jdHash] = { text: tailored, filename, ts: Date.now(), jdTitle, jdCompany };
        // Keep cache to last 50 entries
        const keys = Object.keys(cache);
        if (keys.length > 50) {
          const sorted = keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
          for (let i = 0; i < keys.length - 50; i++) delete cache[sorted[i]];
        }
        await storageSet({ [CACHE_KEY]: cache });
        LOG(`Generated tailored resume for ${jdTitle || 'role'} @ ${jdCompany || 'company'} (${keywords.length} keywords)`);
      }

      // Inject into textareas that look like resume fields
      const resumeFields = findResumeTextareas();
      let injected = 0;
      for (const f of resumeFields) if (injectText(f, tailored)) injected++;
      if (injected) LOG(`Injected tailored resume text into ${injected} field(s)`);

      // Upload as .txt file if an empty file input exists
      await uploadAsFile(tailored, filename);

      // On Jobright: click the Tailor button to trigger the AI-native flow
      clickJobrightTailor();
    } catch (e) { LOG('Auto-tailor error:', e.message); }
  }

  // Exposed for on-demand invocation (Generate+Autofill button). No staged
  // auto-runs: autonomous resume-upload-and-tailor was attaching files to
  // the wrong <input type=file> elements on non-application pages.
  window.__uaAutoTailorResume = runAutoTailor;
  window.__uaGetTailoredCache = () => storageGet(CACHE_KEY).then(d => d[CACHE_KEY] || {});
})();

// ============================================================================
// === v1.5.4 UNIFIED APPLICATION AUTO-PILOT ===
// Stitches together: auto-tailor → cover-letter → STAR answers → form fill →
// submit. Runs once per JD and backs off if page is still loading.
// ============================================================================
(function () {
  'use strict';
  const LOG = (...a) => console.log('[UA-Pilot]', ...a);
  const RUN_FLAG = 'ua_pilot_ran_';

  function currentKey() { return RUN_FLAG + (location.hostname + location.pathname).replace(/[^a-z0-9]/gi, '_'); }

  async function runPipeline() {
    try {
      const k = currentKey();
      const got = await new Promise(r => { try { chrome.storage.local.get(k, r); } catch (_) { r({}); } });
      if (got[k] && (Date.now() - got[k]) < 5 * 60 * 1000) return; // Already ran in last 5 min

      const steps = [
        ['auto-tailor resume', window.__uaAutoTailorResume],
        ['cover letter',       window.__uaAutoCoverLetter],
        ['STAR behavioral',    window.__uaStarAnswer],
      ];
      for (const [name, fn] of steps) {
        if (typeof fn !== 'function') continue;
        try { await fn(); LOG(`ran ${name}`); }
        catch (e) { LOG(`${name} error:`, e.message); }
        await new Promise(r => setTimeout(r, 800));
      }
      try { chrome.storage.local.set({ [k]: Date.now() }); } catch (_) {}
    } catch (e) { LOG('pipeline error:', e.message); }
  }

  // Exposed for manual invocation only — the Generate+Autofill button
  // triggers this explicitly. Autonomous firing was cascading fills onto
  // LinkedIn and other non-application pages.
  window.__uaAutoPilot = runPipeline;
})();

// ============================================================================
// === v1.5.4 FLOATING DUAL-ACTION BUTTONS ===
// Adds two clearly-labeled floating buttons on every application page:
//   [ Autofill ]                           -> triggers Jobright Autofill flow
//   [ Generate Custom Resume + Autofill ]  -> clicks "Generate Custom Resume",
//     waits for it to complete, clicks "Continue to Autofill", waits for the
//     tailored resume to attach to the form's file input, then triggers
//     autofill so no manual step is required.
// ============================================================================
(function () {
  'use strict';
  if (window.self !== window.top) return;
  if (window.__uaDualButtonsMounted) return;
  // Master gate: never attach observers/timers on non-job pages.
  if (typeof window.__uaIsEligiblePage === 'function' && !window.__uaIsEligiblePage()) return;
  window.__uaDualButtonsMounted = true;
  const LOG = (...a) => console.log('[UA-Buttons]', ...a);

  const HOST_ID = 'ua-dual-action-buttons';
  function isApplicationPage() {
    return typeof window.__uaIsEligiblePage === 'function' ? window.__uaIsEligiblePage() : true;
  }

  function inViewLocal(el) { try { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight); } catch (_) { return true; } }
  function realClick(el) {
    if (!el) return;
    try {
      if (!inViewLocal(el)) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      ['mouseover', 'mousedown', 'mouseup'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true })));
      el.click();
    } catch (_) {}
  }
  // Pass-through click that preserves the native handler's behaviour exactly
  // (React/Next onClick, target="_blank" popup gesture, window.open, etc.).
  // Must be called synchronously from within a user-gesture stack.
  function nativeClick(el) {
    if (!el) return;
    try { if (!inViewLocal(el)) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    try { el.click(); } catch (_) {}
  }

  function deepQueryAll(selector) {
    const results = [];
    function visit(root) {
      try { root.querySelectorAll(selector).forEach(e => results.push(e)); } catch (_) {}
      try { root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) visit(el.shadowRoot); }); } catch (_) {}
    }
    visit(document);
    return results;
  }

  function findButtonByText(re) {
    const candidates = deepQueryAll('button, a, [role="button"], div[class*="btn"], span[class*="btn"]');
    return candidates.find(b => {
      if (!b.offsetParent && !b.getClientRects().length) return false;
      const t = (b.textContent || b.getAttribute('aria-label') || '').trim();
      return t && re.test(t);
    });
  }

  // Look for a resume-file-input that became populated (strongest signal that tailored resume attached)
  function findResumeFileInput() {
    const inputs = deepQueryAll('input[type=file]');
    return inputs.find(i => (i.name + ' ' + i.id + ' ' + (i.accept || '') + ' ' + (i.closest('[class*="resume"], [class*="Resume"], [class*="cv"], [class*="CV"], [class*="upload"], [class*="Upload"]')?.textContent || '')).toLowerCase().match(/resume|cv|upload/));
  }
  function resumeFileCount() {
    const f = findResumeFileInput();
    return f && f.files ? f.files.length : 0;
  }
  function findAttachedResumeName() {
    const inputs = deepQueryAll('input[type=file]');
    for (const i of inputs) { if (i.files && i.files[0]) return i.files[0].name; }
    // Filename label near an upload control
    const labels = deepQueryAll('[class*="resume"], [class*="Resume"], [class*="upload"], [class*="Upload"]');
    for (const l of labels) {
      const m = (l.textContent || '').match(/[\w\-]+\.(pdf|doc|docx|txt)/i);
      if (m) return m[0];
    }
    return '';
  }

  async function waitFor(fn, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 15000);
    while (Date.now() < deadline) {
      try { const r = fn(); if (r) return r; } catch (_) {}
      await new Promise(r => setTimeout(r, 120));
    }
    return null;
  }

  // Cancellation token so user can abort a long flow
  let __uaCancel = false;
  function resetCancel() { __uaCancel = false; }
  function cancelNow() { __uaCancel = true; }

  // --- Action 1: Autofill only ---
  async function actionAutofill() {
    LOG('Autofill clicked');
    // Match all known autofill button copy: "Autofill", "APPLY WITH AUTOFILL", "Autofill from resume"
    const jrBtn = findButtonByText(/^\s*autofill\s*$/i)
      || findButtonByText(/apply.*with.*autofill/i)
      || findButtonByText(/^autofill\s+with\b/i)
      || findButtonByText(/^autofill.*resume/i);
    if (jrBtn) { realClick(jrBtn); LOG('Clicked Jobright Autofill'); return; }
    // Dispatch force-autofill event as fallback
    try { window.dispatchEvent(new CustomEvent('ua-force-autofill')); } catch (_) {}
  }

  // --- Action 2: Trigger native "Generate Custom Resume" (preserving original
  // new-tab flow), then watch for attachment + tab-focus to auto-autofill. ---
  // We do NOT replace or wrap the native handler — we click it synchronously
  // inside the user-gesture so its window.open() / popup / navigation behaves
  // exactly as if the user clicked it themselves.
  function actionGenerateAndAutofill(statusEl, ev) {
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; LOG(t); };
    resetCancel();

    // Record pre-click state so we can detect a newly attached file later
    const priorName = findAttachedResumeName();
    const priorCount = resumeFileCount();

    // Find native generator button — ONLY in the Plasmo sidebar
    const allGen = deepQueryAll('button, a, [role="button"], div[class*="btn"], span[class*="btn"]');
    let genBtn = null;
    for (const b of allGen) {
      if (!b.offsetParent && !b.getClientRects().length) continue;
      const t = (b.textContent || b.getAttribute('aria-label') || '').trim();
      if (!/generate.*(custom|new|tailor).*resume|customize.*your.*resume|generate.*resume/i.test(t)) continue;
      if (!isInsidePlasmoSidebar(b)) continue;
      genBtn = b; break;
    }
    if (!genBtn) {
      setStatus('Generator not found — running Autofill');
      actionAutofill();
      setTimeout(() => setStatus(''), 2000);
      return;
    }
    // Synchronous native click — preserves new-tab / popup gesture
    setStatus('Opening resume generator…');
    nativeClick(genBtn);

    // Now poll in background for resume attachment. When it lands (or the
    // user returns to this tab with a new file), fire Autofill automatically.
    const start = Date.now();
    const maxMs = 10 * 60 * 1000; // 10 minutes — user may take time
    let autofired = false;

    async function watcher() {
      while (Date.now() - start < maxMs) {
        if (__uaCancel) { setStatus(''); return; }
        const cur = resumeFileCount();
        const curName = findAttachedResumeName();
        if ((cur > 0 && cur !== priorCount) || (curName && curName && curName !== priorName)) {
          if (!autofired) {
            autofired = true;
            setStatus('Resume attached — autofilling…');
            await actionAutofill();
            setTimeout(() => setStatus(''), 1800);
          }
          return;
        }
        await new Promise(r => setTimeout(r, 800));
      }
      setStatus('');
    }
    watcher().catch(e => LOG('watcher err', e));
  }

  // Locate the native Jobright sidebar "Autofill" button ONLY inside a Plasmo
  // shadow root — NOT any "APPLY WITH AUTOFILL" buttons on jobright.ai job
  // listings (those are different UI elements on the main website).
  function isInsidePlasmoSidebar(el) {
    let n = el;
    while (n) {
      // Walk up through shadow roots too
      if (n.nodeType === 1) {
        const tag = (n.tagName || '').toLowerCase();
        const id = (n.id || '').toLowerCase();
        const cls = typeof n.className === 'string' ? n.className.toLowerCase() : '';
        if (tag.includes('plasmo') || id.includes('plasmo') || cls.includes('plasmo')) return true;
      }
      if (n.parentNode) { n = n.parentNode; continue; }
      const root = n.getRootNode && n.getRootNode();
      if (root && root.host) { n = root.host; continue; }
      break;
    }
    return false;
  }

  function findNativeAutofillBtn() {
    const candidates = deepQueryAll('button, [role="button"]');
    for (const b of candidates) {
      if (!b.offsetParent && !b.getClientRects().length) continue;
      const txt = (b.textContent || '').trim();
      // Only the sidebar's exact "Autofill" label — reject "APPLY WITH AUTOFILL"
      // and other jobright.ai native controls.
      if (!/^autofill$/i.test(txt)) continue;
      if (!isInsidePlasmoSidebar(b)) continue;
      return b;
    }
    return null;
  }

  const INJECT_ID = 'ua-gen-autofill-btn';

  function injectUnderNative() {
    const native = findNativeAutofillBtn();
    if (!native) return false;

    const parent = native.parentElement;
    if (!parent) return false;
    const root = native.getRootNode && native.getRootNode();
    // If we already injected a sibling here, keep it.
    if (root && root.querySelector && root.querySelector('#' + INJECT_ID)) return true;
    if (parent.querySelector && parent.querySelector('#' + INJECT_ID)) return true;

    // Clone the native button (tag + attrs only, not children) so it inherits
    // the same class-based styling from the sidebar's scoped CSS.
    const clone = native.cloneNode(false);
    clone.id = INJECT_ID;
    clone.removeAttribute('data-testid');
    clone.removeAttribute('aria-label');
    clone.removeAttribute('name');
    clone.className = native.className;

    const rect = native.getBoundingClientRect();
    const cs = getComputedStyle(native);
    // Slightly smaller font than the native button so "Generate Custom Resume
    // + Autofill" fits on one line at a professional size.
    const nativeFont = parseFloat(cs.fontSize) || 14;
    const targetFont = Math.max(11, Math.min(13, nativeFont - 2));
    try {
      clone.style.display = cs.display || 'flex';
      clone.style.width = rect.width ? rect.width + 'px' : '';
      clone.style.marginTop = '8px';
      clone.style.cursor = 'pointer';
      clone.style.background = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor;
      clone.style.color = cs.color;
      clone.style.borderRadius = cs.borderRadius;
      clone.style.fontSize = targetFont + 'px';
      clone.style.lineHeight = '1.2';
      clone.style.fontWeight = cs.fontWeight;
      clone.style.fontFamily = cs.fontFamily;
      clone.style.padding = '8px 10px';
      clone.style.textAlign = 'center';
      clone.style.border = cs.border;
      clone.style.boxShadow = cs.boxShadow;
      clone.style.whiteSpace = 'nowrap';
      clone.style.letterSpacing = '0.1px';
    } catch (_) {}

    clone.textContent = 'Generate Custom Resume + Autofill';

    const statusEl = document.createElement('div');
    statusEl.id = INJECT_ID + '-status';
    try {
      statusEl.style.cssText = 'margin-top:4px;font-size:10.5px;color:' + cs.color + ';opacity:.75;text-align:center;min-height:12px;font-family:' + cs.fontFamily + ';line-height:1.2;';
    } catch (_) {
      statusEl.style.cssText = 'margin-top:4px;font-size:10.5px;color:#fff;opacity:.75;text-align:center;min-height:12px;line-height:1.2;';
    }

    // IMPORTANT: Click handler must run the native click SYNCHRONOUSLY to
    // preserve the user-gesture chain (needed for window.open / new tab).
    const handler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation?.();
      try { actionGenerateAndAutofill(statusEl, ev); }
      catch (e) { LOG('generate err', e); }
    };
    clone.addEventListener('click', handler, true);
    clone.addEventListener('mouseenter', () => { clone.style.filter = 'brightness(1.05)'; });
    clone.addEventListener('mouseleave', () => { clone.style.filter = ''; });

    if (native.nextSibling) {
      parent.insertBefore(clone, native.nextSibling);
      parent.insertBefore(statusEl, clone.nextSibling);
    } else {
      parent.appendChild(clone);
      parent.appendChild(statusEl);
    }
    LOG('Injected Generate+Autofill button under sidebar Autofill');
    return true;
  }

  function removeStrayInjections() {
    // Clean up any leftover from previous versions of this injection in places
    // we now refuse to inject (i.e., outside the Plasmo sidebar).
    const strays = deepQueryAll('#' + INJECT_ID);
    for (const s of strays) {
      if (!isInsidePlasmoSidebar(s)) {
        const next = s.nextElementSibling;
        if (next && next.id === INJECT_ID + '-status') next.remove();
        s.remove();
      }
    }
  }

  function tryInject() {
    try {
      removeStrayInjections();
      injectUnderNative();
    } catch (e) { LOG('inject err:', e.message); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryInject);
  else tryInject();

  let lastUrl = location.href;
  // Debounced + lightweight mutation handler — avoids deep shadow-root walks
  // on every SPA mutation, which was measurably slowing down busy pages.
  let moTimer = null;
  const moHandler = () => {
    if (moTimer) return;
    moTimer = setTimeout(() => {
      moTimer = null;
      try {
        const found = deepQueryAll('#' + INJECT_ID).some(e => isInsidePlasmoSidebar(e));
        if (!found) tryInject();
      } catch (_) {}
    }, 400);
  };
  const mo = new MutationObserver(moHandler);
  try { mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (_) {}
  // URL-change poll (SPAs) + safety re-inject — throttled to 4s, auto-stops
  // after 5 minutes so it doesn't run forever on a backgrounded tab.
  let safetyTicks = 0;
  const safetyIv = setInterval(() => {
    if (++safetyTicks > 75) { clearInterval(safetyIv); return; }
    if (location.href !== lastUrl) { lastUrl = location.href; safetyTicks = 0; setTimeout(tryInject, 1200); return; }
    const found = deepQueryAll('#' + INJECT_ID).some(e => isInsidePlasmoSidebar(e));
    if (!found) tryInject();
  }, 4000);
})();

// ===================== ULTIMATE UNLOCK + UI/UX POLISH (v12.0) =====================
// Removes credit/quota limits for autofill, custom-resume generation and tailoring.
// Spoofs Jobright API + storage to report a permanent unlimited PRO subscription.
// Hides paywall prompts ("4 Credits Left", "Get Unlimited", upgrade modals) and
// applies a professional sidebar layout: tighter spacing, accessible buttons,
// consistent radius, modern typography, dark/light-aware contrast.
(function () {
  'use strict';
  const TAG = '[UA-UNLOCK]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };

  // PERF GUARD: this module's MutationObserver runs a full shadow-root + paywall sweep.
  // Only run on Jobright / job-application pages — running it on unrelated websites was
  // slowing/crashing normal browsing.
  if (!/(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i.test(location.hostname) &&
      !(typeof window.__uaIsEligiblePage === 'function' && window.__uaIsEligiblePage())) return;

  // ---------- 1. Unlimited subscription payload ----------
  const FAR_FUTURE = '2099-12-31T23:59:59.000Z';
  const UNLIMITED = 999999;
  const PRO_PROFILE = {
    isPro: true, isPremium: true, isPlus: true, isUltimate: true, isPaid: true,
    isVip: true, isMember: true, isSubscribed: true, isTrialing: false, hasActiveSubscription: true,
    // Jobright-specific gating fields (read by useProfileStore + textarea tracker)
    subscribed: true, isTurbo: true, hasTurbo: true, turbo: true, turboEnabled: true,
    turboSubscribed: true, isStudent: true, studentTurbo: true,
    plan: 'ultimate', planName: 'Ultimate', planTier: 'ultimate', tier: 'ultimate',
    subscriptionStatus: 'active', subscriptionType: 'ultimate', subscriptionLevel: 'ultimate',
    membership: 'ultimate', membershipLevel: 'ultimate', membershipStatus: 'active',
    role: 'pro', userType: 'pro', accountType: 'ultimate',
    credits: UNLIMITED, creditsRemaining: UNLIMITED, creditsLeft: UNLIMITED,
    creditBalance: UNLIMITED, balance: UNLIMITED, quota: UNLIMITED, quotaRemaining: UNLIMITED,
    autofillCredits: UNLIMITED, resumeCredits: UNLIMITED, tailorCredits: UNLIMITED,
    answerCredits: UNLIMITED, coverLetterCredits: UNLIMITED, matchCredits: UNLIMITED,
    aiCredits: UNLIMITED, monthlyCredits: UNLIMITED, dailyCredits: UNLIMITED,
    usage: 0, usageCount: 0, used: 0, dailyUsage: 0, monthlyUsage: 0,
    limit: UNLIMITED, dailyLimit: UNLIMITED, monthlyLimit: UNLIMITED,
    maxAutofills: UNLIMITED, maxResumes: UNLIMITED, maxTailors: UNLIMITED,
    autofillsRemaining: UNLIMITED, resumesRemaining: UNLIMITED, tailorsRemaining: UNLIMITED,
    expiresAt: FAR_FUTURE, expiryDate: FAR_FUTURE, expireAt: FAR_FUTURE,
    renewAt: FAR_FUTURE, validUntil: FAR_FUTURE, endDate: FAR_FUTURE, periodEnd: FAR_FUTURE,
    features: {
      autofill: true, customResume: true, tailorResume: true, coverLetter: true,
      aiAnswer: true, knockout: true, behavioral: true, matchScore: true,
      unlimitedAutofill: true, unlimitedResume: true, unlimitedTailor: true,
      unlimitedCoverLetter: true, unlimitedAnswer: true, unlimited: true,
      premium: true, ultimate: true, prioritySupport: true
    },
    permissions: ['autofill','custom_resume','tailor_resume','cover_letter','ai_answer','unlimited','pro','ultimate'],
    entitlements: ['unlimited_autofill','unlimited_resume','unlimited_tailor','unlimited_cover_letter','unlimited_ai','ultimate']
  };

  // Recursively merge unlimited values onto whatever object the API returns,
  // preserving fields the UI may need (id, name, email) and only overriding
  // quota/plan/credit-shaped keys.
  const QUOTA_KEY_RE = /(credit|quota|usage|limit|remaining|left|balance|tier|plan|subscription|membership|premium|pro|paid|trial|expir|valid|renew|periodend|enddate|isvip|isultimate)/i;
  const COUNT_KEY_RE = /(credit|quota|usage|limit|remaining|left|balance|count|max|times|attempts|fills|generations|tailors)/i;
  function patchObject(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return obj;
    if (Array.isArray(obj)) { obj.forEach(v => patchObject(v, depth + 1)); return obj; }
    // Only rewrite fields on an object that ACTUALLY looks like a subscription/
    // credit/plan record (i.e. it already has at least one quota-shaped key).
    // The old code ran the per-key rewrite rules (incl. a bare "role"/"level"/
    // "userType" PREFIX match) on EVERY nested object in the response tree,
    // regardless of what it was — so a candidate's work-experience entry with a
    // field like "roleDescription" got its real text silently overwritten with
    // the literal string "ultimate" (Jobright bundles subscription info and
    // profile/candidate data in the same API response). Gating on
    // looksLikeAccount first means we only ever touch genuine account/plan
    // objects, never unrelated profile data.
    const looksLikeAccount = Object.keys(obj).some(k => QUOTA_KEY_RE.test(k));
    if (looksLikeAccount) {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') continue; // nested objects are walked below regardless
        if (typeof v === 'boolean' && /^(is|has)/.test(k) &&
            /(pro|premium|paid|ultimate|plus|vip|subscrib|active|unlimited|member|turbo|student)/i.test(k)) {
          obj[k] = true;
        } else if (typeof v === 'boolean' &&
            /^(subscribed|turbo|paid|premium|pro|unlimited|active)$/i.test(k)) {
          obj[k] = true;
        } else if (typeof v === 'boolean' && /^(is|needs?|require|show)/.test(k) &&
            /(trial|free|locked|paywall|upgrade|expired|disabled|limit)/i.test(k)) {
          obj[k] = false;
        } else if (typeof v === 'number' && COUNT_KEY_RE.test(k) && !/used|consumed|spent/i.test(k)) {
          obj[k] = UNLIMITED;
        } else if (typeof v === 'number' && /(used|consumed|spent)/i.test(k)) {
          obj[k] = 0;
        } else if (typeof v === 'string') {
          // Narrowed to specific, unambiguously subscription-shaped key names —
          // no more bare "role"/"level"/"userType" prefix matching, which was too
          // generic and collided with real candidate/profile field names.
          if (/^(plan|planName|planTier|planType|tier|subscriptionType|subscriptionTier|subscriptionPlan|subscriptionLevel|membershipLevel|membershipType|accountType|userRole|accountRole)$/i.test(k)) obj[k] = 'ultimate';
          else if (/(status)$/i.test(k) && /(subscription|membership|trial|plan)/i.test(k)) obj[k] = 'active';
        }
      }
      // Spread the canonical PRO profile fields (covers exact keys like `role`,
      // `level`-style fields, etc. WITHOUT needing a risky generic prefix match).
      Object.assign(obj, structuredCloneSafe(PRO_PROFILE));
    }
    // Recurse into nested objects/arrays regardless — a subscription record may be
    // nested inside a larger response (e.g. { profile: {...}, subscription: {...} }).
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === 'object') patchObject(v, depth + 1);
    }
    return obj;
  }
  function structuredCloneSafe(o) { try { return structuredClone(o); } catch (_) { return JSON.parse(JSON.stringify(o)); } }

  // ---------- 2. fetch() interception ----------
  const JOBRIGHT_HOST_RE = /(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i;
  const JOBRIGHT_PATH_RE = /(user|account|profile|me|subscription|membership|plan|credit|quota|usage|limit|entitlement|permission|feature|billing|paywall|tier|premium)/i;
  // Resume-generation / tailoring / cover-letter / upload endpoints must NEVER be
  // rewritten — the recursive PRO-profile merge can corrupt their payloads and leave
  // "Generate Custom Resume + Autofill" stuck on "Opening resume generator…".
  // Never rewrite resume/tailor/cover responses, NOR the autofill-profile / sign-up /
  // account-save endpoints (Jobright echoes the saved profile — incl. the Sign-up
  // password — back in the response; patching it corrupted the save).
  const PATCH_EXCLUDE_RE = /(resume|tailor|cover.?letter|generat|optimi[sz]e|upload|file|document|preview|download|pdf|swan|template|render|autofill|candidate|signup|sign-?up|onboard|workday)/i;
  function shouldPatchUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (!JOBRIGHT_HOST_RE.test(u.hostname)) return false;
      if (PATCH_EXCLUDE_RE.test(u.pathname)) return false;
      return JOBRIGHT_PATH_RE.test(u.pathname);
    } catch (_) { return false; }
  }
  const origFetch = window.fetch;
  if (origFetch && !window.__uaUnlockFetchPatched) {
    window.__uaUnlockFetchPatched = true;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const res = await origFetch.apply(this, arguments);
      if (!shouldPatchUrl(url)) return res;
      try {
        const ct = res.headers.get('content-type') || '';
        if (!/json/i.test(ct)) return res;
        const cloned = res.clone();
        const data = await cloned.json();
        const patched = patchObject(data, 0);
        const body = JSON.stringify(patched);
        const headers = new Headers(res.headers); headers.set('content-length', String(body.length));
        log('patched fetch', url);
        return new Response(body, { status: res.status, statusText: res.statusText, headers });
      } catch (e) { return res; }
    };
  }

  // ---------- 3. XMLHttpRequest interception ----------
  if (window.XMLHttpRequest && !window.__uaUnlockXhrPatched) {
    window.__uaUnlockXhrPatched = true;
    const X = window.XMLHttpRequest.prototype;
    const origOpen = X.open, origSend = X.send;
    X.open = function (method, url) { this.__uaUrl = url; return origOpen.apply(this, arguments); };
    X.send = function () {
      const url = this.__uaUrl || '';
      if (shouldPatchUrl(url)) {
        this.addEventListener('readystatechange', () => {
          if (this.readyState !== 4) return;
          try {
            const ct = (this.getResponseHeader && this.getResponseHeader('content-type')) || '';
            if (!/json/i.test(ct)) return;
            const txt = this.responseText; if (!txt) return;
            const data = JSON.parse(txt);
            const patched = JSON.stringify(patchObject(data, 0));
            Object.defineProperty(this, 'responseText', { get: () => patched, configurable: true });
            Object.defineProperty(this, 'response', { get: () => patched, configurable: true });
            log('patched xhr', url);
          } catch (_) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // ---------- 4. chrome.storage override ----------
  const STORAGE_OVERRIDES = {
    user_subscription: PRO_PROFILE, subscription: PRO_PROFILE, membership: PRO_PROFILE,
    plan: 'ultimate', planTier: 'ultimate', tier: 'ultimate',
    credits: UNLIMITED, creditsLeft: UNLIMITED, creditBalance: UNLIMITED,
    quota: UNLIMITED, quotaRemaining: UNLIMITED, usage: 0,
    isPro: true, isPremium: true, isUltimate: true, isPaid: true, isSubscribed: true,
    autofillCredits: UNLIMITED, resumeCredits: UNLIMITED, tailorCredits: UNLIMITED
  };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && !chrome.storage.local.__uaUnlockPatched) {
      const origGet = chrome.storage.local.get.bind(chrome.storage.local);
      // READ-TIME ONLY spoof (never persisted): unlock the subscription/credit keys
      // without ever corrupting Jobright's real saved data. Primitives are forced;
      // subscription objects get the PRO fields MERGED into a fresh CLONE (we never
      // mutate the object Jobright handed back, so nothing we add can get persisted by
      // a later set()). We only touch the fixed credit/plan keys in STORAGE_OVERRIDES
      // and explicitly skip any profile / sign-up / password key.
      const augment = (items, keys) => {
        try {
          items = items || {};
          for (const k of Object.keys(STORAGE_OVERRIDES)) {
            if (/signup|sign-?up|password|profile|autofill|candidate|registration/i.test(k)) continue; // safety: never touch profile/signup
            const requested = keys === null || keys === undefined || keys === k ||
              (Array.isArray(keys) && keys.includes(k)) ||
              (typeof keys === 'object' && keys && k in keys);
            if (!requested) continue;
            const ov = STORAGE_OVERRIDES[k];
            if (items[k] === undefined) items[k] = structuredCloneSafe(ov);                 // inject when absent
            else if (ov === null || typeof ov !== 'object') items[k] = ov;                  // force primitive (credits/plan/flags)
            else if (items[k] && typeof items[k] === 'object')                              // merge PRO fields into a fresh clone
              items[k] = Object.assign({}, items[k], structuredCloneSafe(ov));
          }
        } catch (_) {}
        return items;
      };
      // CRITICAL: support BOTH the MV3 promise form (`await get(keys)`) and the legacy
      // callback form. The old wrapper only ever used the callback form and returned
      // its result — which is `undefined` under the promise form — so every
      // `await chrome.storage.local.get(...)` Jobright does resolved to `undefined`
      // and threw (e.g. "Cannot read properties of undefined (reading
      // 'HIDDEN_ALL_WEBSITES')"), breaking the Workday Sign-up Information read too.
      chrome.storage.local.get = function (keys, cb) {
        // Forms: get(cb) | get(keys, cb) | get(keys) -> Promise | get() -> Promise
        if (typeof keys === 'function') { cb = keys; keys = null; }
        if (typeof cb === 'function') {
          origGet(keys, (items) => { cb(augment(items, keys)); });
          return; // callback form returns undefined, exactly like the native API
        }
        // Promise form (MV3): preserve the returned promise and augment its result.
        try {
          const r = origGet(keys);
          if (r && typeof r.then === 'function') return r.then((items) => augment(items, keys));
        } catch (_) {}
        // Fallback if the native call didn't return a promise: wrap the callback form.
        return new Promise((resolve) => origGet(keys, (items) => resolve(augment(items, keys))));
      };
      chrome.storage.local.__uaUnlockPatched = true;
      // NOTE: we intentionally do NOT chrome.storage.local.set() any overrides —
      // never write spoof values into real storage.
    }
  } catch (_) {}

  // ---------- 4b. chrome.runtime.sendMessage / @plasmohq/messaging hook ----------
  // The Jobright bundle gates AI autofill on `creditsLeft.subscribed`, fetched
  // via plasmo `sendToBackground({name:"getCreditsLeft" | "getCreditFeed" |
  // "getCreditSwitchStatus" | "getPaymentPrice" | ...})`. Plasmo wraps these
  // in chrome.runtime.sendMessage, so we intercept the response and shape it
  // into a Turbo-subscribed unlimited record.
  const TURBO_CREDITS_LEFT = {
    subscribed: true, isSubscribed: true, isTurbo: true, hasTurbo: true,
    turbo: true, turboEnabled: true, turboSubscribed: true,
    count: UNLIMITED, total: UNLIMITED, remaining: UNLIMITED, balance: UNLIMITED,
    daily: UNLIMITED, monthly: UNLIMITED, weekly: UNLIMITED,
    used: 0, consumed: 0,
    plan: 'turbo', tier: 'turbo', planName: 'Turbo',
    expirationTime: FAR_FUTURE, expiresAt: FAR_FUTURE, validUntil: FAR_FUTURE,
    student: { monthly: true, quarterly: true, weekly: true, subscribed: true },
    subscription: { status: 'active', plan: 'turbo', subscribed: true, expirationTime: FAR_FUTURE }
  };
  const TURBO_CREDIT_FEED = {
    data: { subscribed: true, isTurbo: true, count: UNLIMITED, used: 0, plan: 'turbo' },
    subscribed: true, isTurbo: true
  };
  const TURBO_CREDIT_SWITCH = { status: 'on', enabled: true, subscribed: true, isTurbo: true };
  const TURBO_PAYMENT_PRICE = { subscribed: true, isTurbo: true, hasActive: true };
  const PLASMO_HANDLERS = {
    getCreditsLeft: () => structuredCloneSafe(TURBO_CREDITS_LEFT),
    refreshCreditsLeft: () => structuredCloneSafe(TURBO_CREDITS_LEFT),
    ensureCreditsLeft: () => structuredCloneSafe(TURBO_CREDITS_LEFT),
    getCreditFeed: () => structuredCloneSafe(TURBO_CREDIT_FEED),
    getCreditSwitchStatus: () => structuredCloneSafe(TURBO_CREDIT_SWITCH),
    getPaymentPrice: () => structuredCloneSafe(TURBO_PAYMENT_PRICE),
    getPaymentData: () => structuredCloneSafe(TURBO_CREDITS_LEFT),
    getUserSubscription: () => structuredCloneSafe(PRO_PROFILE),
    getSubscription: () => structuredCloneSafe(PRO_PROFILE),
    getMembership: () => structuredCloneSafe(PRO_PROFILE),
    checkSubscription: () => ({ subscribed: true, isTurbo: true, plan: 'turbo' }),
    checkTurbo: () => ({ subscribed: true, isTurbo: true })
  };
  function isPlasmoMessage(msg) {
    return msg && typeof msg === 'object' && typeof msg.name === 'string';
  }
  function shouldOverrideMessage(name) {
    if (!name) return false;
    if (PLASMO_HANDLERS[name]) return true;
    return /credit|subscrib|turbo|membership|payment|plan|tier|premium|quota|usage|limit|entitl/i.test(name);
  }
  function buildOverrideResponse(name) {
    if (PLASMO_HANDLERS[name]) return PLASMO_HANDLERS[name]();
    // Generic shape for any subscription-flavored message we didn't enumerate.
    return structuredCloneSafe({ ...TURBO_CREDITS_LEFT, ...PRO_PROFILE });
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage &&
        !chrome.runtime.__uaUnlockMsgPatched) {
      const origSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = function (...args) {
        // Find the message argument (signatures: (msg), (msg, cb), (extId, msg), (extId, msg, opts, cb))
        let msgIdx = -1;
        for (let i = 0; i < args.length; i++) {
          if (args[i] && typeof args[i] === 'object' && !(typeof args[i].addListener === 'function')) { msgIdx = i; break; }
        }
        const msg = msgIdx >= 0 ? args[msgIdx] : null;
        const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        if (isPlasmoMessage(msg) && shouldOverrideMessage(msg.name)) {
          const override = buildOverrideResponse(msg.name);
          log('runtime.sendMessage override', msg.name);
          if (cb) { try { cb(override); } catch (_) {} return; }
          return Promise.resolve(override);
        }
        // Fall through to real send, then patch response if it looks like a quota object.
        try {
          if (cb) {
            return origSend(...args.slice(0, -1), (resp) => {
              try {
                if (resp && typeof resp === 'object') {
                  patchObject(resp, 0);
                  if (isPlasmoMessage(msg) && /credit/i.test(msg.name || '') && resp.subscribed === undefined) {
                    Object.assign(resp, structuredCloneSafe(TURBO_CREDITS_LEFT));
                  }
                }
              } catch (_) {}
              cb(resp);
            });
          }
          const ret = origSend(...args);
          if (ret && typeof ret.then === 'function') {
            return ret.then((resp) => {
              try {
                if (resp && typeof resp === 'object') {
                  patchObject(resp, 0);
                  if (isPlasmoMessage(msg) && /credit/i.test(msg.name || '') && resp.subscribed === undefined) {
                    Object.assign(resp, structuredCloneSafe(TURBO_CREDITS_LEFT));
                  }
                }
              } catch (_) {}
              return resp;
            });
          }
          return ret;
        } catch (e) { return origSend(...args); }
      };
      chrome.runtime.__uaUnlockMsgPatched = true;
    }
  } catch (_) {}

  // ---------- 5. Sidebar UI/UX polish + paywall hider ----------
  // IMPORTANT: Jobright uses <plasmo-csui> for many UI fragments on
  // jobright.ai itself (job-card overlays, "Fresh < 24h" badges, ASK ORION
  // chips, APPLY WITH AUTOFILL buttons, match-score cards). Scoping styles
  // to plasmo-csui therefore deforms the main jobright.ai layout. Instead
  // we identify the actual SIDEBAR shadow root by content and inject the
  // polish ONLY there, without the plasmo-csui prefix.
  const STYLE_ID = 'ua-unlock-style';
  const KILL_CSS = `
/* Hide elements the killer JS marked as paywall — sidebar-only via JS;
   data attribute scoping keeps this from touching the main page. */
[data-ua-killed="1"] { display: none !important; }
`;
  // NOTE (v13.0.0): the user prefers the NATIVE Jobright 1.14.0 sidebar UI/UX, so we no
  // longer restyle it (no font override, no button-spacing tweaks). We only keep the
  // paywall/upgrade-chrome hiding so upsell modals can't interrupt unattended automation.
  const SIDEBAR_CSS = `
/* Native 1.14.0 sidebar look preserved. Hide ONLY real upsell/paywall chrome —
   never functional controls. The broad [class*="credit"] match was removed because
   it also hit Jobright's own ".autofill-button-group--with-credit" (the Autofill +
   Generate buttons). We now target the specific credit classes + upsell links, and
   any [class*="credit"] match explicitly excludes autofill/button/group elements. */
.autofill-credit-row,
.autofill-credit-text,
.autofill-credit-text-right,
.payment-entry,
.plugin-setting-credits-tip,
[class*="credit" i]:not([class*="autofill" i]):not([class*="auto-fill" i]):not([class*="button" i]):not([class*="group" i]),
[class*="paywall" i],
[class*="get-unlimited" i],
[class*="getUnlimited" i],
a[href*="/pricing" i],
a[href*="/upgrade" i],
a[href*="/billing" i],
a[href*="/turbo" i],
a[href*="/checkout" i],
[data-ua-killed="1"] { display: none !important; }
`;
  // Track which shadow roots host the actual sidebar (vs. job-card chips).
  const SIDEBAR_ROOTS = new WeakSet();
  function looksLikeSidebar(root) {
    try {
      const txt = (root.textContent || '');
      // The sidebar always contains both the Jobright header chrome and
      // at least one of these labels. Job-card overlays don't.
      const hits = [
        /your\s+autofill\s+information/i,
        /add\s+this\s+job\s+in\s+one\s+click/i,
        /upload\s+resume/i,
        /generate\s+custom\s+resume/i
      ];
      let n = 0; for (const re of hits) if (re.test(txt)) n++;
      return n >= 2;
    } catch (_) { return false; }
  }
  function injectGlobalStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = KILL_CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function injectShadowStyle(root) {
    if (!root || !root.querySelector) return;
    if ([...root.childNodes].some(n => n.id === STYLE_ID)) return;
    if (!looksLikeSidebar(root)) return; // skip job-card / badge shadows
    SIDEBAR_ROOTS.add(root);
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = SIDEBAR_CSS;
    root.appendChild(s);
  }
  function walkShadowRoots(node) {
    const out = [];
    const stack = [node];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (cur.shadowRoot) { out.push(cur.shadowRoot); stack.push(cur.shadowRoot); }
      const kids = cur.children || cur.childNodes || [];
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return out;
  }

  // Replace any visible "X Credits Left" / "Get Unlimited" text in shadow DOM.
  const TEXT_PATTERNS = [
    { re: /\b\d+\s*credits?\s*left\b/gi, sub: '∞ Ultimate Plan' },
    { re: /\bget\s+unlimited\b/gi, sub: 'Ultimate Active' },
    { re: /\bupgrade\s+to\s+(pro|premium|ultimate|plus|turbo)\b[^.!?\n]*/gi, sub: 'Ultimate Active' },
    { re: /\bget\s+hired\s+faster\b[^.!?\n]*/gi, sub: '' },
    { re: /\b\d{1,3}\s*%\s*off\b/gi, sub: '' },
    { re: /\b(\d+)\s*\/\s*\d+\s*(autofills?|resumes?|tailors?|generations?|credits?)\b/gi, sub: '∞ $2' }
  ];
  // Phrases that, when found anywhere inside an element, mark that element
  // (or a small ancestor wrapper) for removal — the credit chip, the
  // "Upgrade to Turbo / Get Hired Faster / X% Off" banner, etc.
  const KILL_PHRASES = [
    /\bcredits?\s*left\b/i,
    /\bget\s+unlimited\b/i,
    /\bupgrade\s+to\s+(turbo|pro|premium|ultimate|plus)\b/i,
    /\bget\s+hired\s+faster\b/i,
    /\bunlock\s+(unlimited|premium|pro|ultimate)\b/i,
    /\bgo\s+(pro|premium|unlimited|ultimate)\b/i,
    /\b\d{1,3}\s*%\s*off\b/i,
    /\bupgrade\s+to\s+turbo\s+to\b/i,
    /\bautofill\s+answers\s+with\s+ai\b/i,
    /\b\d+\s+credits?\s+left\b/i
  ];
  // High-confidence phrases that ALWAYS warrant removing the closest
  // banner/card wrapper, bypassing the "keep core controls" guard. These
  // strings are only ever paywall language regardless of surrounding words
  // (e.g. "Upgrade to Turbo to autofill answers with AI" contains the word
  // "autofill" but is still 100% paywall).
  const HARD_KILL_PHRASES = [
    /\bupgrade\s+to\s+turbo\b/i,
    /\bget\s+unlimited\b/i,
    /\bget\s+hired\s+faster\b/i,
    /\bautofill\s+answers\s+with\s+ai\b/i,
    /\b\d+\s+credits?\s+left\b/i,
    /\bremaining\s+autofill\s+credits?\b/i,
    /\bcredits?\s+will\s+be\s+refilled\b/i,
    /\bcredits?\s+refill\s+to\b/i,
    /\bupgrade\s+to\s+turbo\s+for\s+unlimited\s+use\b/i,
    /\bunlock\s+(unlimited|premium|pro|ultimate)\b/i,
    /\bgo\s+(pro|premium|unlimited|ultimate)\b/i,
    /\b\d{1,3}\s*%\s*off\b/i
  ];
  // Walk up to N ancestors looking for a reasonable wrapper to remove —
  // we don't want to delete the entire sidebar, so cap depth and skip
  // elements that contain primary buttons we want to keep.
  function findKillTarget(el, hard) {
    const KEEP_RE = /(your\s+autofill\s+information|upload\s+resume|tailor\s+resume|match\s+score|completion|add\s+this\s+job)/i;
    let cur = el; let best = el;
    const limit = hard ? 8 : 6;
    for (let i = 0; i < limit && cur; i++) {
      const txt = (cur.textContent || '').trim();
      if (!txt) break;
      if (hard) {
        // Hard mode: only stop climbing when the wrapper would also engulf
        // a clearly-different control (not just any element containing the
        // word "autofill" — that word is in the paywall itself).
        if (KEEP_RE.test(txt)) break;
        best = cur;
      } else {
        const onlyPaywall = KILL_PHRASES.some(re => re.test(txt)) &&
                            !KEEP_RE.test(txt);
        if (onlyPaywall) best = cur;
        else break;
      }
      cur = cur.parentElement;
    }
    return best;
  }
  function killPaywallElements(root) {
    try {
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) {
        // Skip if it has children — only act on innermost text-bearing nodes.
        if (el.children && el.children.length > 0) continue;
        const txt = (el.textContent || '').trim();
        if (!txt) continue;
        const hard = HARD_KILL_PHRASES.some(re => re.test(txt));
        const soft = !hard && KILL_PHRASES.some(re => re.test(txt));
        if (hard || soft) {
          const target = findKillTarget(el, hard);
          if (target && target.style) {
            target.style.setProperty('display', 'none', 'important');
            target.style.setProperty('visibility', 'hidden', 'important');
            target.style.setProperty('height', '0', 'important');
            target.style.setProperty('width', '0', 'important');
            target.style.setProperty('margin', '0', 'important');
            target.style.setProperty('padding', '0', 'important');
            target.style.setProperty('overflow', 'hidden', 'important');
            target.setAttribute('data-ua-killed', '1');
          }
        }
      }
      // Whole-element scan for HARD phrases on parents whose textContent
      // matches even if their own children don't have a leaf-only text
      // node (covers the "Upgrade to Turbo … autofill answers with AI"
      // tooltip that nests label + button together).
      for (const el of all) {
        if (el.hasAttribute && el.hasAttribute('data-ua-killed')) continue;
        const txt = (el.textContent || '').trim();
        if (!txt || txt.length > 200) continue;
        if (HARD_KILL_PHRASES.some(re => re.test(txt))) {
          // Don't kill if this element ALSO wraps a clearly-different
          // control (the whole sidebar contains "Upgrade to Turbo" too).
          if (/(your\s+autofill\s+information|upload\s+resume|tailor\s+resume|match\s+score|completion|add\s+this\s+job|submit\s+application)/i.test(txt)) continue;
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('data-ua-killed', '1');
        }
      }
      // Also nuke common upgrade/close-banner anchors and buttons by href/text.
      const links = root.querySelectorAll ? root.querySelectorAll('a,button,[role="button"]') : [];
      for (const a of links) {
        const href = (a.getAttribute && (a.getAttribute('href') || '')) || '';
        const txt = (a.textContent || '').trim();
        if (/\/(pricing|upgrade|billing|plans?|subscribe|checkout|turbo)/i.test(href) ||
            /\bget\s+unlimited\b|^\s*upgrade(\s+now)?\s*$|\bgo\s+pro\b|\bget\s+hired\s+faster\b|\bupgrade\s+to\s+turbo\b/i.test(txt)) {
          const target = findKillTarget(a, true);
          if (target && target.style) {
            target.style.setProperty('display', 'none', 'important');
            target.setAttribute('data-ua-killed', '1');
          }
        }
      }
    } catch (_) {}
  }
  function patchTextNodes(root) {
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; const targets = [];
      while ((n = walker.nextNode())) {
        const t = n.nodeValue; if (!t) continue;
        for (const p of TEXT_PATTERNS) { if (p.re.test(t)) { targets.push(n); break; } p.re.lastIndex = 0; }
      }
      for (const node of targets) {
        let v = node.nodeValue;
        for (const p of TEXT_PATTERNS) { v = v.replace(p.re, p.sub); }
        node.nodeValue = v;
      }
    } catch (_) {}
  }

  // Force visible spacing between the primary action buttons in the sidebar.
  // We locate candidate buttons by their text content (since the obfuscated
  // class names change between builds) and apply inline !important margin so
  // we beat any inline styles Plasmo or styled-components emit at runtime.
  // Also handles the case where "Autofill" and "Generate Custom Resume +
  // Autofill" are TWO inner lines of a SINGLE composite button — in that
  // case we space their inner wrappers instead.
  const BUTTON_LABEL_RE = /^(autofill|generate\s+custom\s+resume.*autofill|add\s+this\s+job.*one\s+click|upload\s+resume|your\s+autofill\s+information)$/i;
  function forceButtonSpacing(root) {
    try {
      // 1. Two-button case: stacked siblings sharing a parent.
      const buttons = root.querySelectorAll ? root.querySelectorAll('button,[role="button"],a[class*="btn" i]') : [];
      const sidebarBtns = [];
      for (const b of buttons) {
        const txt = (b.textContent || '').trim();
        if (!txt) continue;
        if (BUTTON_LABEL_RE.test(txt) || /generate\s+custom\s+resume/i.test(txt) || /^autofill$/i.test(txt)) {
          sidebarBtns.push(b);
        }
      }
      // Group by parent and bump margin on every non-first sibling button.
      const parents = new Map();
      for (const b of sidebarBtns) {
        const p = b.parentElement; if (!p) continue;
        if (!parents.has(p)) parents.set(p, []);
        parents.get(p).push(b);
      }
      for (const [parent, group] of parents) {
        if (group.length >= 2) {
          // Force a flex column with gap on the parent for robust spacing.
          parent.style.setProperty('display', 'flex', 'important');
          parent.style.setProperty('flex-direction', 'column', 'important');
          parent.style.setProperty('gap', '16px', 'important');
        }
        for (let i = 1; i < group.length; i++) {
          group[i].style.setProperty('margin-top', '16px', 'important');
        }
      }

      // 2. Composite-single-button case: one wrapper with two stacked text
      // lines ("Autofill" header + "Generate Custom Resume + Autofill"
      // subtitle). Detect by finding a button whose direct text descendants
      // include BOTH phrases and add padding between its first and second
      // text-bearing children.
      for (const b of buttons) {
        const all = (b.textContent || '');
        const hasAuto = /\bautofill\b/i.test(all);
        const hasGen  = /\bgenerate\s+custom\s+resume/i.test(all);
        if (!hasAuto || !hasGen) continue;
        // Find direct child wrappers that each contain only one of the labels.
        const children = Array.from(b.children || []);
        let headerEl = null, subEl = null;
        for (const c of children) {
          const t = (c.textContent || '').trim();
          if (/^autofill$/i.test(t)) headerEl = c;
          else if (/generate\s+custom\s+resume/i.test(t)) subEl = c;
        }
        if (headerEl && subEl) {
          headerEl.style.setProperty('margin-bottom', '10px', 'important');
          headerEl.style.setProperty('padding-bottom', '6px', 'important');
          subEl.style.setProperty('margin-top', '6px', 'important');
          // Soft divider so the separation is visible inside the green pill.
          headerEl.style.setProperty('border-bottom', '1px solid rgba(0,0,0,0.12)', 'important');
        }
        // Generous inner padding so the button breathes regardless.
        b.style.setProperty('padding', '18px 22px', 'important');
        b.style.setProperty('display', 'flex', 'important');
        b.style.setProperty('flex-direction', 'column', 'important');
        b.style.setProperty('gap', '8px', 'important');
        b.style.setProperty('align-items', 'center', 'important');
      }
    } catch (_) {}
  }

  function applyAll() {
    injectGlobalStyle();
    // Per shadow root: only style + run sidebar-specific JS inside the
    // actual sidebar. Job-card overlays / Fresh chips / match-score cards
    // are also hosted in plasmo-csui shadow roots, so we skip them.
    walkShadowRoots(document).forEach(r => {
      injectShadowStyle(r);
      if (looksLikeSidebar(r)) {
        killPaywallElements(r);
        forceButtonSpacing(r);
        patchTextNodes(r);
      }
    });
    // Document scope: only kill clearly-paywall floating widgets (the
    // "Upgrade to Turbo to autofill answers with AI" tooltip lives in
    // the page DOM). The HARD_KILL_PHRASES list is specific enough to
    // avoid touching legitimate jobright.ai job-listing UI.
    killPaywallElements(document);
    // Don't run forceButtonSpacing / patchTextNodes on the main document
    // — they were causing the job-card deformation on jobright.ai.
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll, { once: true });
  } else {
    applyAll();
  }
  try {
    // Debounced so a burst of DOM mutations triggers ONE sweep (not one per mutation).
    let _t = null;
    const mo = new MutationObserver(() => { if (_t) return; _t = setTimeout(() => { _t = null; applyAll(); }, 400); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  log('Ultimate unlock + UI polish active');
})();

// ===================== PROFILE IMPORT / EXPORT (JSON) =====================
// Injects "Import JSON" / "Export JSON" buttons into the "Your Autofill
// Information" modal so the user can save their profile to disk and reload
// it without retyping. Cycles through every tab (Personal, Education, Work
// Experience, Skill, Equal Employment, Preference) to capture all fields.
(function () {
  'use strict';
  const TAG = '[UA-PROFILE]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };
  // PERF GUARD: only run on Jobright / job-application pages — never on unrelated sites.
  if (!/(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i.test(location.hostname) &&
      !(typeof window.__uaIsEligiblePage === 'function' && window.__uaIsEligiblePage())) return;
  const TAB_NAMES = ['Personal','Education','Work Experience','Skill','Equal Employment','Preference'];
  const STORAGE_KEY = 'ua_profile_snapshot';
  const BTN_ID = 'ua-profile-io';

  // Native value setters that bypass React's synthetic re-render guard.
  const inputSetter  = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,    'value')?.set;
  const taSetter     = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,   'value')?.set;
  function setReactValue(el, v) {
    try {
      const tag = (el.tagName || '').toUpperCase();
      const setter = tag === 'TEXTAREA' ? taSetter : tag === 'SELECT' ? selectSetter : inputSetter;
      if (setter) setter.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('blur',   { bubbles: true, composed: true }));
    } catch (_) {}
  }

  function deepQueryAll(sel, root) {
    const out = [];
    const stack = [root || document];
    while (stack.length) {
      const cur = stack.pop(); if (!cur) continue;
      try { if (cur.querySelectorAll) cur.querySelectorAll(sel).forEach(e => out.push(e)); } catch (_) {}
      const kids = cur.children || [];
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.shadowRoot) stack.push(c.shadowRoot);
        stack.push(c);
      }
    }
    return out;
  }
  function findModal() {
    const headers = deepQueryAll('h1,h2,h3,h4,div,span').filter(el =>
      /^your\s+autofill\s+information$/i.test((el.textContent || '').trim()) &&
      el.children.length === 0
    );
    for (const h of headers) {
      let cur = h;
      for (let i = 0; i < 8 && cur; i++) {
        // A modal/card wrapper that also contains the tab labels.
        if ((cur.textContent || '').includes('Personal') &&
            (cur.textContent || '').includes('Education') &&
            (cur.textContent || '').includes('Update')) {
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }
  function findTabElement(modal, name) {
    const all = modal.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length === 0 &&
          (el.textContent || '').trim().toLowerCase() === name.toLowerCase()) {
        // Climb to the clickable wrapper.
        let c = el;
        for (let i = 0; i < 4 && c; i++) {
          if (c.getAttribute && (c.getAttribute('role') === 'tab' || c.tagName === 'BUTTON' ||
              /tab|menu|item/i.test(c.className || ''))) return c;
          c = c.parentElement;
        }
        return el.parentElement || el;
      }
    }
    return null;
  }
  function getActiveTabName(modal) {
    for (const name of TAB_NAMES) {
      const el = findTabElement(modal, name);
      if (!el) continue;
      const cls = (el.className || '') + ' ' + ((el.parentElement?.className) || '');
      if (/active|selected|current/i.test(cls) || el.getAttribute?.('aria-selected') === 'true') return name;
    }
    return null;
  }
  function labelFor(input) {
    if (input.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (lab && lab.textContent) return lab.textContent.trim().replace(/^\*+/, '').trim();
    }
    if (input.placeholder) return input.placeholder.trim();
    if (input.name) return input.name.trim();
    if (input.getAttribute && input.getAttribute('aria-label')) return input.getAttribute('aria-label').trim();
    // Walk up looking for a sibling label/heading text.
    let cur = input;
    for (let i = 0; i < 5 && cur; i++) {
      const prev = cur.previousElementSibling;
      if (prev && prev.textContent && prev.textContent.trim()) {
        return prev.textContent.trim().replace(/^\*+/, '').trim();
      }
      cur = cur.parentElement;
    }
    return '';
  }
  function snapshotVisible(modal) {
    const fields = {};
    const inputs = modal.querySelectorAll('input, textarea, select');
    for (const el of inputs) {
      if (el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.type === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // skip offscreen tabs
      const key = labelFor(el);
      if (!key) continue;
      let val = el.value;
      if (el.type === 'checkbox' || el.type === 'radio') val = !!el.checked;
      if (val === undefined || val === null || val === '') continue;
      fields[key] = val;
    }
    return fields;
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Repeated-section support: tabs like Education / Work Experience / Skill hold
  // multiple entries ("Education 1", "Work Experience 2", …). A flat {label:value}
  // map collapses them to one entry, which is why only the first was captured.
  // These helpers group fields by their entry heading so we keep ALL of them.
  const ENTRY_HEADING_RE = /^(education|work experience|employment|experience|skill|certification|certificate|project|language|publication|award|volunteer)\s*#?\s*\d+\b/i;
  function isEntryHeading(el) {
    const txt = (el.textContent || '').trim();
    return !!txt && txt.length < 36 && ENTRY_HEADING_RE.test(txt) &&
      !el.querySelector('input,textarea,select');
  }
  // Returns an array of entries (each {label:value}) for repeated tabs, or null
  // when the tab has no entry headings (caller falls back to a flat snapshot).
  function snapshotEntries(modal) {
    const entries = []; let cur = null, lastHeading = null;
    for (const el of modal.querySelectorAll('*')) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (!cur) continue;
        if (['file', 'submit', 'button', 'hidden'].includes(el.type)) continue;
        const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
        const key = labelFor(el); if (!key) continue;
        let val = (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : el.value;
        if (val === '' || val == null) continue;
        cur[key] = val;
      } else if (isEntryHeading(el)) {
        const txt = (el.textContent || '').trim();
        if (txt !== lastHeading) { cur = {}; entries.push(cur); lastHeading = txt; }
      }
    }
    const nonEmpty = entries.filter(e => Object.keys(e).length);
    return nonEmpty.length ? nonEmpty : null;
  }
  function snapshotTab(modal) {
    return snapshotEntries(modal) || snapshotVisible(modal);
  }
  // Group the current input elements by entry (for import filling).
  function groupInputsByEntry(modal) {
    const groups = []; let cur = null, lastHeading = null;
    for (const el of modal.querySelectorAll('*')) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (!cur) continue;
        if (['file', 'submit', 'button', 'hidden'].includes(el.type)) continue;
        const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
        cur.push(el);
      } else if (isEntryHeading(el)) {
        const txt = (el.textContent || '').trim();
        if (txt !== lastHeading) { cur = []; groups.push(cur); lastHeading = txt; }
      }
    }
    return groups.filter(g => g.length);
  }
  function findAddButton(modal, name) {
    const re = new RegExp('add\\s+(another\\s+)?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return [...modal.querySelectorAll('button,a,[role="button"],div,span')]
      .filter(b => { const t = (b.textContent || '').trim(); return t.length < 32 && /add/i.test(t) && !b.querySelector('input,textarea,select'); })
      .find(b => re.test((b.textContent || '').trim())) || null;
  }
  // Fill an array of entries: create missing entry rows via the "Add …" button,
  // then fill each group in order.
  async function applyEntries(modal, name, entries) {
    let groups = groupInputsByEntry(modal);
    let guard = 0;
    while (groups.length < entries.length && guard++ < entries.length + 4) {
      const addBtn = findAddButton(modal, name);
      if (!addBtn) break;
      try { addBtn.click(); } catch (_) {}
      await sleep(500);
      groups = groupInputsByEntry(modal);
    }
    let filled = 0;
    for (let i = 0; i < entries.length && i < groups.length; i++) {
      const data = entries[i];
      for (const el of groups[i]) {
        const key = labelFor(el);
        if (!key || !(key in data)) continue;
        const v = data[key];
        if (el.type === 'checkbox' || el.type === 'radio') { const want = !!v; if (el.checked !== want) el.click(); }
        else setReactValue(el, String(v));
        filled++;
      }
      await sleep(60);
    }
    return filled;
  }

  async function exportProfile() {
    const modal = findModal();
    if (!modal) { alert('Open "Your Autofill information" first.'); return; }
    const original = getActiveTabName(modal);
    const out = { _meta: { app: 'Jobright Autofill Ultimate', exportedAt: new Date().toISOString(), version: '1.9.0' } };
    for (const name of TAB_NAMES) {
      const tab = findTabElement(modal, name);
      if (!tab) continue;
      try { tab.click(); } catch (_) {}
      await sleep(220);
      out[name] = snapshotTab(modal);
    }
    if (original) { const t = findTabElement(modal, original); if (t) try { t.click(); } catch (_) {} }
    try { chrome.storage.local.set({ [STORAGE_KEY]: out }); } catch (_) {}
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobright-autofill-profile-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 500);
    log('exported profile', Object.keys(out).filter(k => k !== '_meta').length, 'tabs');
  }

  async function applyTabFields(modal, name, fields) {
    const tab = findTabElement(modal, name);
    if (!tab) return 0;
    try { tab.click(); } catch (_) {}
    await sleep(300);
    // Repeated section (Education / Work Experience / Skill) — restore every entry.
    if (Array.isArray(fields)) return await applyEntries(modal, name, fields);
    let n = 0;
    const inputs = modal.querySelectorAll('input, textarea, select');
    for (const el of inputs) {
      if (el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.type === 'hidden') continue;
      const key = labelFor(el);
      if (!key || !(key in fields)) continue;
      const v = fields[key];
      if (el.type === 'checkbox' || el.type === 'radio') {
        const want = !!v;
        if (el.checked !== want) { el.click(); }
      } else {
        setReactValue(el, String(v));
      }
      n++;
    }
    return n;
  }
  async function importProfile() {
    const modal = findModal();
    if (!modal) { alert('Open "Your Autofill information" first.'); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.style.display = 'none';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        let total = 0;
        const original = getActiveTabName(modal);
        for (const name of TAB_NAMES) {
          if (data[name] && typeof data[name] === 'object') {
            total += await applyTabFields(modal, name, data[name]);
          }
        }
        if (original) { const t = findTabElement(modal, original); if (t) try { t.click(); } catch (_) {} }
        try { chrome.storage.local.set({ [STORAGE_KEY]: data }); } catch (_) {}
        log('imported profile, populated', total, 'fields');
        alert('Imported ' + total + ' fields. Review the form and click Update.');
      } catch (e) { alert('Import failed: ' + e.message); }
      finally { inp.remove(); }
    }, { once: true });
    document.body.appendChild(inp); inp.click();
  }

  function styleBtn(b, primary) {
    Object.assign(b.style, {
      padding: '8px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.18)',
      background: primary ? 'linear-gradient(135deg,#6cf5b8,#2bb673)' : 'rgba(255,255,255,0.08)',
      color: primary ? '#062b1c' : '#fff', fontWeight: '600', fontSize: '13px',
      cursor: 'pointer', marginRight: '8px', letterSpacing: '0.01em',
      fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
    });
    b.onmouseenter = () => { b.style.transform = 'translateY(-1px)'; b.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)'; };
    b.onmouseleave = () => { b.style.transform = 'none'; b.style.boxShadow = 'none'; };
  }
  // Import/Export JSON removed — Jobright autofills the profile from your Jobright
  // account, so these buttons are unnecessary (and irrelevant for Workday).
  function injectButtons() { /* disabled */ }

  function tick() { /* disabled — no Import/Export buttons injected */ }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true });
  else tick();
  try {
    // Document-level observer (catches modals rendered into the page DOM).
    // Debounced: a burst of mutations (e.g. our own fast autofill) coalesces into a
    // single handler run instead of firing per-mutation — which was pegging the main
    // thread to "Page Unresponsive" on heavy forms.
    let _moT = null;
    const mo = new MutationObserver(() => { if (_moT) return; _moT = setTimeout(() => { _moT = null; tick(); }, 350); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  // Polling fallback — the modal often lives inside the Plasmo sidebar
  // shadow root, where document-level MutationObservers don't fire. Poll
  // every 600ms; injectButtons is a no-op once the buttons exist.
  setInterval(tick, 600);
  // Also observe any shadow roots we discover so we react quickly when
  // their internals change (modal opens/closes).
  const OBSERVED = new WeakSet();
  function attachShadowObservers() {
    try {
      const stack = [document];
      while (stack.length) {
        const cur = stack.pop(); if (!cur) continue;
        const kids = cur.children || [];
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i];
          if (c.shadowRoot && !OBSERVED.has(c.shadowRoot)) {
            OBSERVED.add(c.shadowRoot);
            try {
              const m = new MutationObserver(() => tick());
              m.observe(c.shadowRoot, { childList: true, subtree: true });
            } catch (_) {}
            stack.push(c.shadowRoot);
          }
          stack.push(c);
        }
      }
    } catch (_) {}
  }
  attachShadowObservers();
  // This walks the ENTIRE DOM + shadow tree every tick to wire observers for Jobright's
  // own sidebar modal — pointless (and costly on big forms) off jobright.ai.
  if (/jobright\.ai/i.test(location.hostname)) setInterval(attachShadowObservers, 1500);
})();

// ===================== WORK AUTHORIZATION PICKER + AUTO-ANSWER =====================
// User picks regions/countries where they have legal work authorization.
// On any application page, when a question matches "Are you legally
// authorized to work in <country>?" / "Do you have right to work in <X>?",
// we auto-select Yes if the country falls inside one of their regions,
// otherwise No.
(function () {
  'use strict';
  const TAG = '[UA-AUTH]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };
  // PERF GUARD: this module observes the whole document for question fields. Only run on
  // Jobright / job-application pages — never on unrelated sites.
  if (!/(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i.test(location.hostname) &&
      !(typeof window.__uaIsEligiblePage === 'function' && window.__uaIsEligiblePage())) return;
  const STORAGE_KEY = 'ua_work_auth_regions';
  const PANEL_ID = 'ua-work-auth-panel';

  // Region presets. Each region resolves to a set of country aliases that
  // we use for matching question text. Selecting a parent region (e.g.
  // "European Union") implicitly authorizes every member.
  const REGIONS = [
    { id: 'US', label: 'United States 🇺🇸',  aliases: ['us','usa','u.s.','u.s.a.','united states','america','american'] },
    { id: 'CA', label: 'Canada 🇨🇦',          aliases: ['canada','canadian'] },
    { id: 'MX', label: 'Mexico 🇲🇽',          aliases: ['mexico','mexican'] },
    { id: 'UK', label: 'United Kingdom 🇬🇧', aliases: ['uk','u.k.','united kingdom','britain','great britain','england','scotland','wales','northern ireland','british'] },
    { id: 'IE', label: 'Ireland 🇮🇪',         aliases: ['ireland','irish','republic of ireland'] },
    { id: 'EU', label: 'European Union 🇪🇺', aliases: ['eu','e.u.','european union'], includes: ['DE','FR','ES','IT','NL','BE','AT','BG','HR','CY','CZ','DK','EE','FI','GR','HU','IE','LV','LT','LU','MT','PL','PT','RO','SK','SI','SE'] },
    { id: 'EUROPE', label: 'Europe (broad) 🌍', aliases: ['europe','european'], includes: ['EU','UK','CH','NO','IS'] },
    { id: 'SCHENGEN', label: 'Schengen Area', aliases: ['schengen'], includes: ['EU','CH','NO','IS'] },
    { id: 'DE', label: 'Germany 🇩🇪',         aliases: ['germany','german','deutschland'] },
    { id: 'FR', label: 'France 🇫🇷',          aliases: ['france','french'] },
    { id: 'ES', label: 'Spain 🇪🇸',           aliases: ['spain','spanish','espana','españa'] },
    { id: 'IT', label: 'Italy 🇮🇹',           aliases: ['italy','italian','italia'] },
    { id: 'NL', label: 'Netherlands 🇳🇱',     aliases: ['netherlands','dutch','holland'] },
    { id: 'BE', label: 'Belgium 🇧🇪',         aliases: ['belgium','belgian'] },
    { id: 'CH', label: 'Switzerland 🇨🇭',     aliases: ['switzerland','swiss'] },
    { id: 'NO', label: 'Norway 🇳🇴',          aliases: ['norway','norwegian'] },
    { id: 'IS', label: 'Iceland 🇮🇸',         aliases: ['iceland','icelandic'] },
    { id: 'AT', label: 'Austria 🇦🇹',         aliases: ['austria','austrian'] },
    { id: 'BG', label: 'Bulgaria 🇧🇬',        aliases: ['bulgaria','bulgarian'] },
    { id: 'HR', label: 'Croatia 🇭🇷',         aliases: ['croatia','croatian'] },
    { id: 'CY', label: 'Cyprus 🇨🇾',          aliases: ['cyprus','cypriot'] },
    { id: 'CZ', label: 'Czechia 🇨🇿',         aliases: ['czechia','czech','czech republic'] },
    { id: 'DK', label: 'Denmark 🇩🇰',         aliases: ['denmark','danish'] },
    { id: 'EE', label: 'Estonia 🇪🇪',         aliases: ['estonia','estonian'] },
    { id: 'FI', label: 'Finland 🇫🇮',         aliases: ['finland','finnish'] },
    { id: 'GR', label: 'Greece 🇬🇷',          aliases: ['greece','greek'] },
    { id: 'HU', label: 'Hungary 🇭🇺',         aliases: ['hungary','hungarian'] },
    { id: 'LV', label: 'Latvia 🇱🇻',          aliases: ['latvia','latvian'] },
    { id: 'LT', label: 'Lithuania 🇱🇹',       aliases: ['lithuania','lithuanian'] },
    { id: 'LU', label: 'Luxembourg 🇱🇺',      aliases: ['luxembourg'] },
    { id: 'MT', label: 'Malta 🇲🇹',           aliases: ['malta','maltese'] },
    { id: 'PL', label: 'Poland 🇵🇱',          aliases: ['poland','polish'] },
    { id: 'PT', label: 'Portugal 🇵🇹',        aliases: ['portugal','portuguese'] },
    { id: 'RO', label: 'Romania 🇷🇴',         aliases: ['romania','romanian'] },
    { id: 'SK', label: 'Slovakia 🇸🇰',        aliases: ['slovakia','slovak'] },
    { id: 'SI', label: 'Slovenia 🇸🇮',        aliases: ['slovenia','slovenian'] },
    { id: 'SE', label: 'Sweden 🇸🇪',          aliases: ['sweden','swedish'] },
    { id: 'AU', label: 'Australia 🇦🇺',       aliases: ['australia','australian'] },
    { id: 'NZ', label: 'New Zealand 🇳🇿',     aliases: ['new zealand','nz','kiwi'] },
    { id: 'SG', label: 'Singapore 🇸🇬',       aliases: ['singapore','singaporean'] },
    { id: 'HK', label: 'Hong Kong 🇭🇰',       aliases: ['hong kong','hk'] },
    { id: 'JP', label: 'Japan 🇯🇵',           aliases: ['japan','japanese'] },
    { id: 'KR', label: 'South Korea 🇰🇷',     aliases: ['south korea','korea','korean'] },
    { id: 'IN', label: 'India 🇮🇳',           aliases: ['india','indian'] },
    { id: 'AE', label: 'UAE 🇦🇪',             aliases: ['uae','united arab emirates','emirates','dubai','abu dhabi'] },
    { id: 'IL', label: 'Israel 🇮🇱',          aliases: ['israel','israeli'] },
    { id: 'BR', label: 'Brazil 🇧🇷',          aliases: ['brazil','brazilian'] },
    { id: 'AR', label: 'Argentina 🇦🇷',       aliases: ['argentina','argentinian','argentinean'] },
    { id: 'ZA', label: 'South Africa 🇿🇦',    aliases: ['south africa','south african'] },
    { id: 'NG', label: 'Nigeria 🇳🇬',         aliases: ['nigeria','nigerian'] }
  ];
  const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));

  // Resolve a set of selected ids into the full set of country ids
  // (expanding "European Union" into each member, etc.).
  function resolveSelected(selected) {
    const out = new Set();
    function walk(id) {
      if (out.has(id)) return; out.add(id);
      const r = REGION_BY_ID[id]; if (!r || !r.includes) return;
      for (const child of r.includes) walk(child);
    }
    for (const id of selected) walk(id);
    return out;
  }
  function aliasesFor(ids) {
    const aliases = [];
    for (const id of ids) {
      const r = REGION_BY_ID[id]; if (r) aliases.push(...r.aliases);
    }
    return aliases;
  }

  let SELECTED = new Set();
  let RESOLVED = new Set();
  let RESOLVED_ALIASES = [];
  function refreshResolved() {
    RESOLVED = resolveSelected(SELECTED);
    RESOLVED_ALIASES = aliasesFor(RESOLVED).map(a => a.toLowerCase());
  }
  function loadSelected() {
    try {
      chrome.storage.local.get([STORAGE_KEY], (items) => {
        const v = items && items[STORAGE_KEY];
        if (Array.isArray(v)) SELECTED = new Set(v);
        refreshResolved();
        log('loaded', [...SELECTED]);
      });
    } catch (_) {}
  }
  function saveSelected() {
    try { chrome.storage.local.set({ [STORAGE_KEY]: [...SELECTED] }); } catch (_) {}
    refreshResolved();
  }

  // ---------- Picker UI ----------
  function buildPanel() {
    const overlay = document.createElement('div');
    overlay.id = PANEL_ID;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '2147483647', fontFamily: "'Inter',-apple-system,sans-serif"
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(680px, 92vw)', maxHeight: '82vh', overflow: 'auto',
      background: '#1b1f24', color: '#fff', borderRadius: '16px',
      padding: '22px 24px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.08)'
    });
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <div style="font-size:18px;font-weight:700">🌍 Work Authorization</div>
          <div style="font-size:13px;opacity:0.7;margin-top:4px">Select every country/region where you have legal work authorization. The extension will auto-answer "Yes" to questions like “Are you legally authorized to work in &lt;country&gt;?” when the country matches.</div>
        </div>
        <button id="ua-auth-close" style="background:transparent;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1">×</button>
      </div>
      <div id="ua-auth-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:14px 0 18px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="ua-auth-clear" style="padding:9px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;font-weight:600">Clear all</button>
        <button id="ua-auth-save"  style="padding:9px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#6cf5b8,#2bb673);color:#062b1c;cursor:pointer;font-weight:700">Save</button>
      </div>
    `;
    const grid = panel.querySelector('#ua-auth-grid');
    for (const r of REGIONS) {
      const lbl = document.createElement('label');
      Object.assign(lbl.style, { display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 10px', borderRadius: '10px', cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' });
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = r.id;
      cb.checked = SELECTED.has(r.id);
      cb.addEventListener('change', () => {
        if (cb.checked) SELECTED.add(r.id); else SELECTED.delete(r.id);
      });
      const sp = document.createElement('span'); sp.textContent = r.label;
      sp.style.fontSize = '13px';
      lbl.appendChild(cb); lbl.appendChild(sp);
      grid.appendChild(lbl);
    }
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#ua-auth-close').addEventListener('click', () => overlay.remove());
    panel.querySelector('#ua-auth-clear').addEventListener('click', () => {
      SELECTED.clear();
      grid.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    panel.querySelector('#ua-auth-save').addEventListener('click', () => {
      saveSelected();
      overlay.remove();
      log('saved', [...SELECTED]);
    });
    return overlay;
  }
  function openPanel() {
    const ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }
    document.body.appendChild(buildPanel());
  }
  window.__uaOpenWorkAuth = openPanel;

  // ---------- Auto-answer ----------
  // Question text patterns that indicate work authorization. We extract
  // the country mentioned in the question and decide Yes/No.
  const AUTH_QUESTION_RE = /\b(legally\s+authorized\s+to\s+work|authorized\s+to\s+work|right\s+to\s+work|eligible\s+to\s+work|permitted\s+to\s+work|authori[sz]ation\s+to\s+work|work\s+authori[sz]ation|are\s+you\s+a\s+citizen|permanent\s+resident|require\s+(?:a\s+)?work\s+(?:visa|permit|sponsorship)|need\s+sponsorship)\b/i;
  // Sponsorship questions (negative — the answer logic flips when matched)
  const SPONSORSHIP_RE = /\b(require|need|requires|needs|will\s+you\s+(?:now|in\s+the\s+future|require|need)|sponsorship\s+(?:now|in\s+the\s+future))\b.*\b(sponsorship|visa\s+sponsorship|h-?1b|work\s+visa|work\s+permit)\b/i;

  function extractCountryFromText(text) {
    const t = (text || '').toLowerCase();
    for (const r of REGIONS) {
      for (const a of r.aliases) {
        // Word-boundary match. For short codes (us, uk, eu) require dots
        // or word boundaries to avoid matching inside other words.
        const re = a.length <= 3
          ? new RegExp('(?:^|[^a-z])' + a.replace(/\./g, '\\.') + '(?:[^a-z]|$)', 'i')
          : new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(t)) return r.id;
      }
    }
    return null;
  }
  function isAuthorizedFor(countryId) {
    if (!countryId) return null;
    if (RESOLVED.has(countryId)) return true;
    // Also accept if any of the user's selections aliases match
    return false;
  }

  // Find the question label associated with a control (radio group, select, input)
  function questionTextFor(el) {
    // Climb until we find a wrapper containing recognizable question text
    let cur = el;
    for (let i = 0; i < 8 && cur; i++) {
      const txt = (cur.textContent || '').trim();
      if (txt && txt.length < 500 && AUTH_QUESTION_RE.test(txt)) return txt;
      cur = cur.parentElement;
    }
    // Fallback: aria-labelledby / aria-label / preceding label
    if (el.getAttribute) {
      const al = el.getAttribute('aria-label'); if (al && AUTH_QUESTION_RE.test(al)) return al;
      const ld = el.getAttribute('aria-labelledby');
      if (ld) {
        const lab = document.getElementById(ld);
        if (lab && AUTH_QUESTION_RE.test(lab.textContent || '')) return lab.textContent;
      }
    }
    return '';
  }

  // Native value setters that bypass React's synthetic re-render guard.
  const inputSetter  = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,    'value')?.set;
  const taSetter     = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,   'value')?.set;
  function setReactValue(el, v) {
    try {
      const tag = (el.tagName || '').toUpperCase();
      const setter = tag === 'TEXTAREA' ? taSetter : tag === 'SELECT' ? selectSetter : inputSetter;
      if (setter) setter.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch (_) {}
  }

  function answerRadioGroup(name, scope, wantYes) {
    const radios = scope.querySelectorAll('input[type="radio"][name="' + CSS.escape(name) + '"]');
    if (!radios.length) return false;
    const want = wantYes ? /^(yes|y|true|1)$/i : /^(no|n|false|0)$/i;
    let target = null;
    for (const r of radios) {
      const v = (r.value || '').trim();
      if (want.test(v)) { target = r; break; }
      // Match the label text near the radio
      let lab = r.closest('label');
      if (!lab && r.id) lab = document.querySelector('label[for="' + CSS.escape(r.id) + '"]');
      const lt = (lab?.textContent || '').trim();
      if (want.test(lt)) { target = r; break; }
    }
    if (!target) return false;
    if (!target.checked) target.click();
    return true;
  }
  function answerSelect(sel, wantYes) {
    const want = wantYes ? /^(yes|y|true|1)$/i : /^(no|n|false|0)$/i;
    for (const opt of sel.options) {
      if (want.test((opt.value || '').trim()) || want.test((opt.textContent || '').trim())) {
        setReactValue(sel, opt.value);
        return true;
      }
    }
    return false;
  }

  const ANSWERED = new WeakSet();
  function processForm(scope) {
    if (!scope || !scope.querySelectorAll) return;
    // Radios — group by name within this scope
    const radios = scope.querySelectorAll('input[type="radio"]');
    const seenNames = new Set();
    for (const r of radios) {
      if (ANSWERED.has(r)) continue;
      const name = r.name; if (!name || seenNames.has(name)) continue; seenNames.add(name);
      // Use any radio in the group as a probe to find the question wrapper
      const qtxt = questionTextFor(r);
      if (!qtxt) continue;
      const country = extractCountryFromText(qtxt);
      const sponsorship = SPONSORSHIP_RE.test(qtxt);
      let wantYes;
      if (sponsorship) {
        // "Will you require sponsorship?" — answer No when authorized.
        wantYes = country ? !isAuthorizedFor(country) : false;
      } else {
        wantYes = country ? !!isAuthorizedFor(country) : null;
        if (wantYes === null) continue;
      }
      if (answerRadioGroup(name, scope, wantYes)) {
        scope.querySelectorAll('input[type="radio"][name="' + CSS.escape(name) + '"]').forEach(x => ANSWERED.add(x));
        log('radio', name, '→', wantYes ? 'Yes' : 'No', '(' + (country || '?') + ')');
      }
    }
    // Selects
    const selects = scope.querySelectorAll('select');
    for (const s of selects) {
      if (ANSWERED.has(s)) continue;
      const qtxt = questionTextFor(s);
      if (!qtxt) continue;
      const country = extractCountryFromText(qtxt);
      const sponsorship = SPONSORSHIP_RE.test(qtxt);
      let wantYes;
      if (sponsorship) wantYes = country ? !isAuthorizedFor(country) : false;
      else { wantYes = country ? !!isAuthorizedFor(country) : null; if (wantYes === null) continue; }
      if (answerSelect(s, wantYes)) { ANSWERED.add(s); log('select →', wantYes ? 'Yes' : 'No'); }
    }
  }
  function processAll() {
    if (SELECTED.size === 0) return;
    // Auto-answering is automation. During manual use the user answers this
    // question themselves — nothing should be selected on their behalf.
    if (!window.__uaAutoAllowed || !window.__uaAutoAllowed()) return;
    try { processForm(document); } catch (_) {}
    // Also try common iframe scopes
    try {
      for (const f of document.querySelectorAll('iframe')) {
        try { processForm(f.contentDocument); } catch (_) {}
      }
    } catch (_) {}
  }
  loadSelected();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processAll, { once: true });
  } else {
    processAll();
  }
  try {
    // Debounced so a mutation storm (our autofill / SPA re-render) can't call
    // processAll per-mutation and freeze the page.
    let _paT = null;
    const mo = new MutationObserver(() => { if (_paT) return; _paT = setTimeout(() => { _paT = null; processAll(); }, 350); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  // Polling fallback for SPAs and shadow-root forms.
  setInterval(processAll, 1200);
  // Expose openPanel via a keyboard shortcut (Ctrl+Shift+W) and via the
  // window object so it can also be triggered from devtools while we
  // verify the sidebar button injection on each release.
  try {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault(); openPanel();
      }
    }, true);
  } catch (_) {}
  // Refresh resolved set whenever storage changes (cross-tab support)
  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
          const v = changes[STORAGE_KEY].newValue;
          SELECTED = new Set(Array.isArray(v) ? v : []);
          refreshResolved();
          processAll();
        }
      });
    }
  } catch (_) {}
})();

// ===================== OUT-OF-CREDIT POPUP SUPPRESSOR =====================
// The Jobright autofill flow runs inside an iframe that hits a server
// endpoint; on a free account the server returns HTTP 402 PAYMENT_REQUIRED
// and the iframe sends window.postMessage({httpStatus: 402, ...}) to the
// parent, which calls setShowOutofCredit(true) and renders the
// "You have 0 remaining Autofill credits" Antd modal.
//
// Client-side spoofing of subscribed:true / Turbo through fetch / XHR /
// runtime.sendMessage / chrome.storage already takes care of every UI
// gate that runs locally, but this popup is driven by an iframe message
// so we have to intercept that specifically. We rewrite or drop the
// 402-bearing postMessage in the capture phase before the bundle's
// listener sees it, and as a safety net we also tear down the modal if
// it has already mounted.
(function () {
  'use strict';
  const TAG = '[UA-NOPOPUP]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };

  // PERFORMANCE GUARD: this popup-suppressor scans the whole document (every
  // div/span/p) on each DOM mutation + every 600ms. That is far too heavy to run on
  // unrelated websites — it was freezing/crashing normal browsing. The Jobright
  // out-of-credit popups only appear on jobright.ai, so run this ONLY there.
  if (!/(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i.test(location.hostname)) return;

  // ---- 1. Intercept iframe → parent message that triggers the popup ----
  // Capture-phase listeners run before normal-phase ones. Because this
  // file is a content_script with run_at: document_start, it registers
  // before the bundle attaches its own message handler in the same
  // isolated world.
  function isPaywallMessage(d) {
    if (!d || typeof d !== 'object') return false;
    if (d.httpStatus === 402) return true;
    if (d.status === 402) return true;
    if (typeof d.code === 'number' && d.code === 402) return true;
    return false;
  }
  try {
    window.addEventListener('message', function (e) {
      try {
        if (isPaywallMessage(e.data)) {
          log('intercepted 402 postMessage', e.data);
          // Stop the bundle's listener from running.
          e.stopImmediatePropagation();
        }
      } catch (_) {}
    }, true); // capture
  } catch (_) {}

  // ---- 2. Tear down the popup if it already opened ----
  // This whole machine hunts Jobright's OWN "out of credits" modal, which lives in
  // Jobright's sidebar. It has no business sweeping a third-party ATS form — and its
  // querySelectorAll('div,span,p') sweep over the document + every iframe + every shadow
  // root, every 800ms, was the main cause of "Page Unresponsive" on heavy forms like
  // Workable. Restrict the expensive sweeps to jobright.ai.
  const KP_IS_JR = /jobright\.ai/i.test(location.hostname);
  const POPUP_TEXT = [
    /remaining\s+autofill\s+credits/i,
    /credits?\s+will\s+be\s+refilled/i,
    /credits?\s+refill\s+to/i,
    /upgrade\s+to\s+turbo\s+for\s+unlimited\s+use/i
  ];
  function killPopup(scope) {
    try {
      // Antd modals have class popup-modal-wrap / popup-modal / ant-modal-wrap.
      const candidates = scope.querySelectorAll
        ? scope.querySelectorAll('.popup-modal-wrap, .popup-modal, .ant-modal-wrap, .ant-modal-root, [class*="popup-modal" i]')
        : [];
      for (const el of candidates) {
        const txt = (el.textContent || '');
        if (POPUP_TEXT.some(re => re.test(txt))) {
          // Click Cancel if present so the bundle's state resets cleanly.
          const cancelBtn = [...el.querySelectorAll('button')].find(b =>
            /^\s*cancel\s*$/i.test((b.textContent || '').trim()));
          try { if (cancelBtn) cancelBtn.click(); } catch (_) {}
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('data-ua-killed', '1');
          log('killed out-of-credit popup');
        }
      }
      // Also kill any element whose own innermost text matches the popup
      // copy, in case Jobright moves the modal under a new wrapper class.
      // EXPENSIVE full-tree text sweep — jobright.ai only (see note above).
      const all = (KP_IS_JR && scope.querySelectorAll) ? scope.querySelectorAll('div,span,p') : [];
      for (const el of all) {
        if (el.children && el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 200) continue;
        if (POPUP_TEXT.some(re => re.test(t))) {
          let cur = el;
          for (let i = 0; i < 8 && cur; i++) {
            // Climb to the modal wrapper and hide it.
            const cls = (cur.className || '') + '';
            if (/(popup-modal|ant-modal|modal-wrap|Overlay|overlay)/i.test(cls) ||
                /(popup-modal|ant-modal|modal-wrap)/i.test(cur.id || '')) {
              cur.style.setProperty('display', 'none', 'important');
              cur.setAttribute('data-ua-killed', '1');
              break;
            }
            cur = cur.parentElement;
          }
        }
      }
    } catch (_) {}
  }
  function killAll() {
    try { killPopup(document); } catch (_) {}
    // The Jobright credit popup only appears inside Jobright's own sidebar, so the
    // iframe + full shadow-tree sweeps (very expensive on big ATS forms) are pointless
    // off jobright.ai. Skip them there — this is the core "Page Unresponsive" fix.
    if (!KP_IS_JR) return;
    // Iframes (the autofill flow runs in iframes for some ATS sites)
    try {
      for (const f of document.querySelectorAll('iframe')) {
        try { killPopup(f.contentDocument); } catch (_) {}
      }
    } catch (_) {}
    // Shadow roots (sidebar)
    try {
      const stack = [document];
      while (stack.length) {
        const cur = stack.pop(); if (!cur) continue;
        const kids = cur.children || [];
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i];
          if (c.shadowRoot) { killPopup(c.shadowRoot); stack.push(c.shadowRoot); }
          stack.push(c);
        }
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', killAll, { once: true });
  } else {
    killAll();
  }
  try {
    // killAll REMOVES nodes, so an undebounced observer fed its own removals back to
    // itself — a self-sustaining mutation storm that froze the page. Debounce it.
    let _kaT = null;
    const mo = new MutationObserver(() => { if (_kaT) return; _kaT = setTimeout(() => { _kaT = null; killAll(); }, 350); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  setInterval(killAll, 800);

  // ---- 3. Soften Jobright autofill API 402 responses to 200 (best-effort) ----
  // The actual AI generation is server-gated, so this won't make the AI
  // produce answers without Turbo, but it does prevent the 402 from
  // reaching the iframe → postMessage path on requests that the content
  // script itself initiates.
  try {
    const origFetch = window.fetch;
    if (origFetch && !window.__uaUnlock402Patched) {
      window.__uaUnlock402Patched = true;
      window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const res = await origFetch.apply(this, arguments);
        try {
          if (res.status === 402 && /jobright(-internal)?\.(ai|com)/i.test(url)) {
            log('rewrote 402 fetch →', url);
            return new Response('{}', { status: 200, statusText: 'OK',
              headers: { 'content-type': 'application/json' } });
          }
        } catch (_) {}
        return res;
      };
    }
  } catch (_) {}

  log('out-of-credit popup suppressor active');
})();

// ===================== BRING-YOUR-OWN-AI ANSWER GENERATOR =====================
// Free-text "Edit with AI" replacement that uses the user's own LLM API
// key (OpenAI / Anthropic / Google Gemini), so AI answers work without
// Jobright's Turbo subscription.
//
// - 🤖 AI Settings button in the autofill modal opens a panel where the
//   user picks a provider, pastes their key, and optionally sets a
//   model name.
// - On any application page, every visible <textarea> gets a small
//   "✨ AI" button overlay. Clicking it gathers context (the question
//   label nearest the textarea, the user's stored profile, the visible
//   job title / description on the page) and asks the chosen LLM to
//   write a tailored answer, then types it into the textarea via the
//   React-friendly native value setter so the form's onChange fires.
// - The key never leaves the user's machine except to the chosen LLM
//   provider's API endpoint.
(function () {
  'use strict';
  const TAG = '[UA-AI]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };
  // PERF GUARD: this module observes the whole document to inject AI buttons on answer
  // fields. Only run on Jobright / job-application pages — never on unrelated sites.
  if (!/(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i.test(location.hostname) &&
      !(typeof window.__uaIsEligiblePage === 'function' && window.__uaIsEligiblePage())) return;
  const PANEL_ID = 'ua-ai-settings-panel';
  const BTN_CLASS = 'ua-ai-gen-btn';

  const STORAGE = {
    provider: 'ua_ai_provider',
    apiKey:   'ua_ai_api_key',
    model:    'ua_ai_model',
    style:    'ua_ai_style'
  };

  const PROVIDERS = {
    openai: {
      label: 'OpenAI (GPT-4o / GPT-4o-mini)',
      defaultModel: 'gpt-4o-mini',
      build: (key, model, system, user) => ({
        url: 'https://api.openai.com/v1/chat/completions',
        init: {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: system },
              { role: 'user',   content: user   }
            ],
            temperature: 0.7,
            max_tokens: 1024
          })
        },
        extract: (json) => json?.choices?.[0]?.message?.content?.trim() || ''
      })
    },
    anthropic: {
      label: 'Anthropic (Claude)',
      defaultModel: 'claude-sonnet-4-6',
      build: (key, model, system, user) => ({
        url: 'https://api.anthropic.com/v1/messages',
        init: {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model || 'claude-sonnet-4-6',
            system: system,
            max_tokens: 1024,
            messages: [{ role: 'user', content: user }]
          })
        },
        extract: (json) => (json?.content || []).map(p => p.text || '').join('').trim()
      })
    },
    gemini: {
      label: 'Google Gemini',
      defaultModel: 'gemini-1.5-flash',
      build: (key, model, system, user) => ({
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' +
             encodeURIComponent(model || 'gemini-1.5-flash') + ':generateContent?key=' + encodeURIComponent(key),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
          })
        },
        extract: (json) => (json?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
      })
    }
  };

  // ---------- Settings persistence ----------
  let SETTINGS = { provider: 'openai', apiKey: '', model: '', style: 'concise-professional' };
  function loadSettings() {
    try {
      chrome.storage.local.get(Object.values(STORAGE), (items) => {
        SETTINGS = {
          provider: items[STORAGE.provider] || 'openai',
          apiKey:   items[STORAGE.apiKey]   || '',
          model:    items[STORAGE.model]    || '',
          style:    items[STORAGE.style]    || 'concise-professional'
        };
        log('loaded settings; provider=', SETTINGS.provider, 'hasKey=', !!SETTINGS.apiKey);
      });
    } catch (_) {}
  }
  function saveSettings() {
    try { chrome.storage.local.set({
      [STORAGE.provider]: SETTINGS.provider,
      [STORAGE.apiKey]:   SETTINGS.apiKey,
      [STORAGE.model]:    SETTINGS.model,
      [STORAGE.style]:    SETTINGS.style
    }); } catch (_) {}
  }
  loadSettings();
  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((c, area) => {
        if (area !== 'local') return;
        if (c[STORAGE.provider]) SETTINGS.provider = c[STORAGE.provider].newValue || SETTINGS.provider;
        if (c[STORAGE.apiKey])   SETTINGS.apiKey   = c[STORAGE.apiKey].newValue   || '';
        if (c[STORAGE.model])    SETTINGS.model    = c[STORAGE.model].newValue    || '';
        if (c[STORAGE.style])    SETTINGS.style    = c[STORAGE.style].newValue    || 'concise-professional';
      });
    }
  } catch (_) {}

  // ---------- Settings panel UI ----------
  function styleInput(el) {
    Object.assign(el.style, {
      width: '100%', padding: '10px 12px', borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)',
      color: '#fff', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box'
    });
  }
  function buildSettingsPanel() {
    const overlay = document.createElement('div');
    overlay.id = PANEL_ID;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '2147483647', fontFamily: "'Inter',-apple-system,sans-serif"
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(560px, 92vw)', maxHeight: '85vh', overflow: 'auto',
      background: '#1b1f24', color: '#fff', borderRadius: '16px',
      padding: '24px 26px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.08)'
    });
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div>
          <div style="font-size:18px;font-weight:700">🤖 AI Answer Generator</div>
          <div style="font-size:13px;opacity:0.7;margin-top:4px;line-height:1.45">Bring your own LLM key. The extension calls your provider directly — your key is stored locally in this browser and never sent anywhere except the API endpoint you choose.</div>
        </div>
        <button id="ua-ai-close" style="background:transparent;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1">×</button>
      </div>

      <label style="display:block;margin:18px 0 6px;font-size:13px;font-weight:600">Provider</label>
      <select id="ua-ai-provider"></select>

      <label style="display:block;margin:14px 0 6px;font-size:13px;font-weight:600">API key</label>
      <input id="ua-ai-key" type="password" placeholder="sk-... / claude-... / AIza..." autocomplete="off" spellcheck="false">

      <label style="display:block;margin:14px 0 6px;font-size:13px;font-weight:600">Model (optional override)</label>
      <input id="ua-ai-model" type="text" placeholder="leave blank to use the default" autocomplete="off" spellcheck="false">

      <label style="display:block;margin:14px 0 6px;font-size:13px;font-weight:600">Answer style</label>
      <select id="ua-ai-style">
        <option value="concise-professional">Concise & professional (default)</option>
        <option value="star-behavioral">STAR format (for behavioral questions)</option>
        <option value="enthusiastic">Enthusiastic & specific</option>
        <option value="brief-yes-no">Very brief (1–2 sentences)</option>
      </select>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px">
        <button id="ua-ai-test"   style="padding:9px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;font-weight:600">Test key</button>
        <button id="ua-ai-save"   style="padding:9px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#6cf5b8,#2bb673);color:#062b1c;cursor:pointer;font-weight:700">Save</button>
      </div>
      <div id="ua-ai-status" style="margin-top:12px;font-size:13px;min-height:18px"></div>
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const provSel  = panel.querySelector('#ua-ai-provider');
    const keyIn    = panel.querySelector('#ua-ai-key');
    const modelIn  = panel.querySelector('#ua-ai-model');
    const styleSel = panel.querySelector('#ua-ai-style');
    const status   = panel.querySelector('#ua-ai-status');
    [provSel, keyIn, modelIn, styleSel].forEach(styleInput);
    Object.assign(provSel.style, { appearance: 'none' });
    for (const id of Object.keys(PROVIDERS)) {
      const o = document.createElement('option'); o.value = id; o.textContent = PROVIDERS[id].label;
      provSel.appendChild(o);
    }
    provSel.value  = SETTINGS.provider;
    keyIn.value    = SETTINGS.apiKey;
    modelIn.value  = SETTINGS.model;
    styleSel.value = SETTINGS.style;

    panel.querySelector('#ua-ai-close').addEventListener('click', () => overlay.remove());
    panel.querySelector('#ua-ai-save').addEventListener('click', () => {
      SETTINGS.provider = provSel.value;
      SETTINGS.apiKey   = keyIn.value.trim();
      SETTINGS.model    = modelIn.value.trim();
      SETTINGS.style    = styleSel.value;
      saveSettings();
      status.style.color = '#6cf5b8'; status.textContent = '✓ Saved';
      setTimeout(() => overlay.remove(), 600);
    });
    panel.querySelector('#ua-ai-test').addEventListener('click', async () => {
      status.style.color = '#aaa'; status.textContent = 'Testing…';
      try {
        const out = await callLLM('Reply with just the word OK.', 'Confirm the connection.', {
          provider: provSel.value, apiKey: keyIn.value.trim(),
          model: modelIn.value.trim(), style: styleSel.value
        });
        status.style.color = '#6cf5b8';
        status.textContent = '✓ Connected. Sample reply: ' + (out.slice(0, 80) || '(empty)');
      } catch (e) {
        status.style.color = '#ff8a8a';
        status.textContent = '✗ ' + (e.message || String(e));
      }
    });
    return overlay;
  }
  function openSettings() {
    const ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }
    document.body.appendChild(buildSettingsPanel());
  }
  window.__uaOpenAiSettings = openSettings;

  // ---------- Context gathering ----------
  function readProfileSnapshot(cb) {
    try {
      chrome.storage.local.get(['ua_profile_snapshot'], (items) => {
        cb(items && items.ua_profile_snapshot ? items.ua_profile_snapshot : null);
      });
    } catch (_) { cb(null); }
  }
  function visibleJobContext() {
    // Best-effort grab of job title + company + a short description chunk.
    const out = { title: '', company: '', description: '', url: location.href };
    try {
      const titleEl = document.querySelector('h1, [class*="job-title" i], [data-testid*="job-title" i]');
      if (titleEl) out.title = (titleEl.textContent || '').trim().slice(0, 200);
      const companyEl = document.querySelector('[class*="company" i], [data-testid*="company" i]');
      if (companyEl) out.company = (companyEl.textContent || '').trim().slice(0, 120);
      const descEl = document.querySelector('[class*="description" i], [class*="job-detail" i], [data-testid*="description" i], main, article');
      if (descEl) out.description = (descEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 2500);
    } catch (_) {}
    return out;
  }
  function questionFor(textarea) {
    // Look for label[for], aria-label, placeholder, or the nearest
    // preceding heading/label that's clearly a question.
    if (textarea.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(textarea.id) + '"]');
      if (lab && lab.textContent) return lab.textContent.trim();
    }
    if (textarea.getAttribute && textarea.getAttribute('aria-label')) return textarea.getAttribute('aria-label').trim();
    if (textarea.placeholder) return textarea.placeholder.trim();
    let cur = textarea;
    for (let i = 0; i < 6 && cur; i++) {
      const prev = cur.previousElementSibling;
      if (prev) {
        const t = (prev.textContent || '').trim();
        if (t && t.length < 400) return t;
      }
      cur = cur.parentElement;
    }
    return '';
  }
  function styleHints(style) {
    switch (style) {
      case 'star-behavioral':
        return 'Use the STAR format (Situation, Task, Action, Result). 4–6 sentences. First-person, specific.';
      case 'enthusiastic':
        return 'Show genuine interest in the role and company. Connect concrete experience to the job. 4–6 sentences.';
      case 'brief-yes-no':
        return 'Answer in 1–2 short sentences, plain and direct.';
      case 'concise-professional':
      default:
        return 'Concise, professional, first-person. 3–5 sentences. Use the candidate\'s actual experience; do not invent facts.';
    }
  }

  // ---------- LLM call ----------
  async function callLLM(systemOverride, userText, opts) {
    const provider = (opts && opts.provider) || SETTINGS.provider || 'openai';
    const apiKey   = (opts && opts.apiKey)   || SETTINGS.apiKey;
    const model    = (opts && opts.model)    || SETTINGS.model;
    if (!apiKey) throw new Error('No API key configured. Click 🤖 AI Settings first.');
    const prov = PROVIDERS[provider];
    if (!prov) throw new Error('Unknown provider: ' + provider);
    const { url, init, extract } = prov.build(apiKey, model, systemOverride, userText);
    let res;
    try { res = await fetch(url, init); }
    catch (e) { throw new Error('Network error: ' + e.message); }
    if (!res.ok) {
      let body = ''; try { body = await res.text(); } catch (_) {}
      throw new Error('HTTP ' + res.status + ' ' + res.statusText + (body ? ': ' + body.slice(0, 200) : ''));
    }
    let json; try { json = await res.json(); } catch (e) { throw new Error('Bad JSON from provider'); }
    const text = extract(json);
    if (!text) throw new Error('Empty response from provider');
    return text;
  }

  function buildSystemPrompt(style) {
    return [
      'You are helping a job applicant write a strong, truthful answer to a job-application question.',
      'Use ONLY the facts present in the candidate\'s profile and the job context provided. Do not invent employers, dates, certifications, degrees, salaries, or visa statuses.',
      'If the candidate\'s profile does not contain enough information for a confident answer, write a short answer that is still truthful and reasonable.',
      'Output ONLY the answer text. No preamble like "Here is the answer:". No quotes. No bullet labels.',
      styleHints(style)
    ].join(' ');
  }
  function buildUserPrompt(question, profile, jobCtx) {
    const summary = (() => {
      if (!profile) return '(no saved profile)';
      try {
        // Flatten profile snapshot to short bullet list.
        const lines = [];
        for (const tab of Object.keys(profile)) {
          if (tab === '_meta') continue;
          const fields = profile[tab];
          if (!fields || typeof fields !== 'object') continue;
          for (const k of Object.keys(fields)) {
            const v = fields[k];
            if (v === '' || v == null) continue;
            lines.push('- ' + tab + ' / ' + k + ': ' + String(v).slice(0, 200));
          }
        }
        return lines.join('\n').slice(0, 4000) || '(profile present but empty)';
      } catch (_) { return '(profile unreadable)'; }
    })();
    return [
      'Question:', '"' + question.replace(/\s+/g, ' ').trim() + '"',
      '',
      'Job context:',
      jobCtx.title    ? 'Title: '       + jobCtx.title       : '',
      jobCtx.company  ? 'Company: '     + jobCtx.company     : '',
      jobCtx.description ? 'Description (truncated):\n' + jobCtx.description : '',
      '',
      'Candidate profile:',
      summary,
      '',
      'Write the answer now.'
    ].filter(Boolean).join('\n');
  }

  // ---------- Native value setter ----------
  const taSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const inSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  function setReactValue(el, v) {
    try {
      const tag = (el.tagName || '').toUpperCase();
      const setter = tag === 'TEXTAREA' ? taSetter : inSetter;
      if (setter) setter.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch (_) {}
  }

  // ---------- Inject ✨ AI buttons on textareas ----------
  function isEligible(ta) {
    if (!ta || ta.disabled || ta.readOnly) return false;
    if (ta.dataset.uaAi) return false;
    const r = ta.getBoundingClientRect();
    if (r.width < 60 || r.height < 24) return false;
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }
  function attachButton(ta) {
    ta.dataset.uaAi = '1';
    const wrap = ta.parentElement;
    if (!wrap) return;
    const cs = getComputedStyle(wrap);
    if (cs.position === 'static') wrap.style.position = 'relative';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = BTN_CLASS;
    btn.textContent = '✨ AI';
    Object.assign(btn.style, {
      position: 'absolute', bottom: '6px', right: '8px', zIndex: '2147483646',
      padding: '4px 9px', fontSize: '11px', fontWeight: '700', borderRadius: '8px',
      border: 'none', cursor: 'pointer', letterSpacing: '0.02em',
      background: 'linear-gradient(135deg,#6cf5b8,#2bb673)', color: '#062b1c',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      fontFamily: "'Inter',-apple-system,sans-serif"
    });
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-1px)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; });
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!SETTINGS.apiKey) { openSettings(); return; }
      const orig = btn.textContent; btn.textContent = '⏳ Thinking…'; btn.disabled = true;
      try {
        const question = questionFor(ta);
        if (!question) throw new Error('Could not detect question text near this textarea');
        const jobCtx = visibleJobContext();
        const profile = await new Promise(r => readProfileSnapshot(r));
        const sys = buildSystemPrompt(SETTINGS.style);
        const usr = buildUserPrompt(question, profile, jobCtx);
        const out = await callLLM(sys, usr);
        setReactValue(ta, out);
        ta.focus({ preventScroll: true });
        btn.textContent = '✓ Filled';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1400);
      } catch (err) {
        log('generate failed', err);
        btn.textContent = '✗ Error';
        btn.title = err.message || String(err);
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2400);
      }
    });
    wrap.appendChild(btn);
  }
  function injectAll(scope) {
    if (!scope || !scope.querySelectorAll) return;
    for (const ta of scope.querySelectorAll('textarea')) {
      if (isEligible(ta)) attachButton(ta);
    }
  }
  function tick() {
    try { injectAll(document); } catch (_) {}
    try {
      for (const f of document.querySelectorAll('iframe')) {
        try { injectAll(f.contentDocument); } catch (_) {}
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true });
  else tick();
  try {
    let _aiT = null;
    const mo = new MutationObserver(() => { if (_aiT) return; _aiT = setTimeout(() => { _aiT = null; tick(); }, 400); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  setInterval(tick, 1500);

  // Keyboard shortcut: Ctrl+Shift+A opens the AI settings panel.
  try {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault(); openSettings();
      }
    }, true);
  } catch (_) {}

  log('AI generator loaded; provider=', SETTINGS.provider);
})();



// ===================== PASSIVE CANDIDATE-PROFILE SNAPSHOT (read-only) =====================
// Some of our OWN fallback fill logic (workdayFillExperience's per-entry Job Title/Company
// loop, School/Degree defaults, etc.) needs real profile data. Since Import/Export was
// intentionally removed (Jobright autofills the profile natively, per user preference), our
// own ua_profile storage had no way to ever get populated — meaning fields like Job Title,
// Company, and School stayed permanently empty, so Workday's multi-entry "Work Experience 1/
// 2/3/4" rows showed "N/A" for those columns even though location/dates got filled fine.
//
// This module passively (READ-ONLY — it clones the response and never alters what the page
// receives) observes Jobright's own candidate/profile API responses as they naturally occur
// (e.g. whenever Jobright renders "Your Autofill Information" or runs its own autofill) and
// mirrors recognizable fields into our own ua_profile storage, so our fallback fill code has
// real data to draw from. It only ever WRITES a field that is currently empty in ua_profile —
// it can never overwrite anything the user has already set.
(function () {
  'use strict';
  const TAG = '[UA-Snapshot]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };
  if (!/(^|\.)jobright(?:-internal)?\.(?:ai|com)$/i.test(location.hostname)) return;

  function findArraysOfObjectsWithKeys(obj, keyRe, depth, out) {
    if (!obj || typeof obj !== 'object' || depth > 8 || out.length > 20) return;
    if (Array.isArray(obj)) {
      if (obj.length && obj.every(o => o && typeof o === 'object' && !Array.isArray(o)) &&
          obj.some(o => Object.keys(o).some(k => keyRe.test(k)))) {
        out.push(obj);
      }
      obj.forEach(v => findArraysOfObjectsWithKeys(v, keyRe, depth + 1, out));
      return;
    }
    for (const v of Object.values(obj)) if (v && typeof v === 'object') findArraysOfObjectsWithKeys(v, keyRe, depth + 1, out);
  }
  function pick(o, re) {
    for (const k of Object.keys(o)) { if (re.test(k) && typeof o[k] === 'string' && o[k].trim()) return o[k].trim(); }
    return '';
  }
  function findFirstMatch(obj, keyRe, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    if (!Array.isArray(obj) && Object.keys(obj).some(k => keyRe.test(k))) return obj;
    const vals = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of vals) { if (v && typeof v === 'object') { const r = findFirstMatch(v, keyRe, depth + 1); if (r) return r; } }
    return null;
  }

  function captureFromJson(data) {
    try {
      const patch = {};
      // Top-level candidate fields — only from an object that plausibly IS the candidate
      // record (has an email-shaped key nearby).
      const person = findFirstMatch(data, /^email(.?address)?$/i, 0);
      if (person) {
        const first = pick(person, /^(first.?name|given.?name)$/i);
        const last = pick(person, /^(last.?name|family.?name|surname)$/i);
        const email = pick(person, /^email(.?address)?$/i);
        const phone = pick(person, /^(phone|mobile|cell)(.?number)?$/i);
        const city = pick(person, /^city$/i);
        const country = pick(person, /^country$/i);
        if (first) patch.first_name = first;
        if (last) patch.last_name = last;
        if (email) patch.email = email;
        if (phone) patch.phone = phone;
        if (city) patch.city = city;
        if (country) patch.country = country;
      }
      // Work-experience array: objects that have a company/employer-ish key.
      const workArrs = []; findArraysOfObjectsWithKeys(data, /company|employer/i, 0, workArrs);
      for (const arr of workArrs) {
        const mapped = arr.map(e => ({
          title: pick(e, /^(job.?title|title|position|role.?title)$/i),
          company: pick(e, /^(company(.?name)?|employer(.?name)?)$/i),
          location: pick(e, /^(location|city)$/i),
          from: pick(e, /^(start.?date|from|start.?year)$/i),
          to: pick(e, /^(end.?date|to|end.?year)$/i),
          description: pick(e, /^(description|summary|role.?description|responsibilit)/i),
          current: !!(e.current || e.isCurrent || e.is_current || e.currentlyEmployed)
        })).filter(e => e.title || e.company);
        if (mapped.length) {
          patch.work_experiences = mapped;
          patch.current_title = mapped[0].title || '';
          patch.current_company = mapped[0].company || '';
          break;
        }
      }
      // Education array: objects that have a school/university-ish key.
      const eduArrs = []; findArraysOfObjectsWithKeys(data, /school|university|institution/i, 0, eduArrs);
      for (const arr of eduArrs) {
        const mapped = arr.map(e => ({
          school: pick(e, /^(school(.?name)?|university|institution)$/i),
          degree: pick(e, /^degree$/i),
          field: pick(e, /^(field(.?of.?study)?|major)$/i),
          gpa: pick(e, /^(gpa|overall.?result)$/i)
        })).filter(e => e.school);
        if (mapped.length) { patch.education = mapped; patch.school = mapped[0].school || ''; break; }
      }
      if (!Object.keys(patch).length) return;
      chrome.storage.local.get('ua_profile', (d) => {
        const existing = (d && d.ua_profile) || {};
        let changed = false;
        for (const k of Object.keys(patch)) {
          const cur = existing[k];
          if (cur === undefined || cur === '' || (Array.isArray(cur) && !cur.length)) { existing[k] = patch[k]; changed = true; }
        }
        if (changed) { chrome.storage.local.set({ ua_profile: existing }); log('captured profile fields:', Object.keys(patch).join(', ')); }
      });
    } catch (e) { log('capture error:', e && e.message); }
  }

  // READ-ONLY wrapper: clones the response purely for inspection and NEVER returns a
  // modified response — this module can never break anything the page relies on.
  try {
    const origFetch = window.fetch;
    if (origFetch && !window.__uaSnapshotFetchPatched) {
      window.__uaSnapshotFetchPatched = true;
      window.fetch = async function (input, init) {
        const res = await origFetch.apply(this, arguments);
        try {
          const ct = res.headers.get('content-type') || '';
          if (/json/i.test(ct)) res.clone().json().then(captureFromJson).catch(() => {});
        } catch (_) {}
        return res;
      };
    }
  } catch (_) {}
  log('candidate-profile snapshot watcher active');
})();

// ============================================================================
// === LINKEDIN RECRUITER FOLLOW-UP (auto-send after applying) ===
// After a confirmed application, a follow-up for {company, role} is queued (see
// enqueueFollowUp in the main module). This module runs on linkedin.com: when you
// land on the profile of someone whose CURRENT company matches a pending follow-up,
// and auto-send is enabled, it composes a short personalized note and sends it.
//
// IMPORTANT / HONEST NOTE: automating LinkedIn messaging is against LinkedIn's User
// Agreement and can get an account restricted or banned — Premium raises message
// LIMITS, not automation PERMISSION. To reduce that risk this is OFF by default and
// heavily throttled: a per-day cap, a randomized delay between sends, and dedupe so
// the same person is never messaged twice. You stay in control of WHO by choosing
// which profiles to open (e.g. via Jobright's "Insider Connections").
// ============================================================================
(function () {
  'use strict';
  const TAG = '[UA-LinkedIn]';
  const log = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };
  if (!/(^|\.)linkedin\.com$/i.test(location.hostname)) return;
  if (window.top !== window.self) return;

  const S = {
    get: k => new Promise(r => { try { chrome.storage.local.get(k, d => r(d[k])); } catch (_) { r(undefined); } }),
    set: (k, v) => new Promise(r => { try { chrome.storage.local.set({ [k]: v }, r); } catch (_) { r(); } }),
  };
  const DEFAULT_TEMPLATE =
    "Hi {first}, I just submitted my application for the {role} role at {company} and wanted to reach out directly. I'm genuinely excited about the opportunity and would welcome the chance to connect. Thank you for your time!";
  const DEFAULT_CAP = 12;          // max auto-sends per day
  const MIN_GAP_MS = 45_000;       // minimum gap between two auto-sends
  const RAND_GAP_MS = 40_000;      // + up to this much random jitter

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------- config ----------
  async function cfg() {
    return {
      enabled: (await S.get('ua_followup_enabled')) === true,
      template: (await S.get('ua_followup_template')) || DEFAULT_TEMPLATE,
      cap: (await S.get('ua_followup_daily_cap')) || DEFAULT_CAP,
    };
  }
  async function sentLog() { return (await S.get('ua_followup_sent')) || []; }
  async function sentToday() { const now = Date.now(); return (await sentLog()).filter(s => now - s.ts < 86_400_000).length; }
  async function alreadyMessaged(profileKey) { return (await sentLog()).some(s => s.profile === profileKey); }
  async function markSent(profileKey, company, role) {
    const l = await sentLog(); l.unshift({ profile: profileKey, company, role, ts: Date.now() });
    await S.set('ua_followup_sent', l.slice(0, 2000));
  }
  async function queue() { return (await S.get('ua_followup_queue')) || []; }
  async function removeFromQueue(company) {
    const q = await queue();
    await S.set('ua_followup_queue', q.filter(f => norm(f.company) !== norm(company)));
  }

  // ---------- profile parsing ----------
  function profileKey() { const m = location.pathname.match(/\/in\/([^/]+)/i); return m ? m[1].toLowerCase() : ''; }
  function firstName() {
    const h = document.querySelector('h1.text-heading-xlarge, .pv-text-details__left-panel h1, main h1');
    const full = (h && h.textContent || '').trim();
    return (full.split(/\s+/)[0] || 'there').replace(/[^a-zA-Z''-]/g, '') || 'there';
  }
  // The person's CURRENT company text (headline + top-card subtitle + first experience).
  function profileCompanyText() {
    const parts = [];
    const head = document.querySelector('.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium');
    if (head) parts.push(head.textContent || '');
    // "Current" line in the top card (e.g. a company chip) + first experience entry.
    document.querySelectorAll('[data-field="experience_company_logo"], .pv-text-details__right-panel, #experience ~ * li:first-child, .pvs-list__item--line-separated:first-child').forEach(e => parts.push(e.textContent || ''));
    return norm(parts.join(' • ')).slice(0, 800);
  }
  function looksLikeRecruiter() {
    const t = profileCompanyText() + ' ' + norm((document.querySelector('main h1')?.parentElement?.textContent) || '');
    return /recruit|talent|sourcer|people|human resources|\bhr\b|hiring|staffing|acquisition/.test(t);
  }

  // ---------- message sending ----------
  function setContentEditable(box, text) {
    box.focus();
    // Clear then insert via execCommand so LinkedIn's React/Draft editor fires its input handlers.
    try { document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch (_) {}
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) {}
    if (!ok) {
      box.textContent = text;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
    }
    box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  async function openMessageComposer() {
    // Already open?
    let box = document.querySelector('.msg-form__contenteditable[contenteditable="true"]');
    if (box) return box;
    // Click the profile "Message" button (Premium opens InMail for non-connections).
    const btn = [...document.querySelectorAll('button, a')].find(b => {
      const l = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      return /^\s*message\b/i.test((b.textContent || '').trim()) || /message [A-Z]/.test(l);
    });
    if (!btn) return null;
    btn.click();
    for (let i = 0; i < 20; i++) { await sleep(300); box = document.querySelector('.msg-form__contenteditable[contenteditable="true"]'); if (box) return box; }
    return null;
  }
  function findSendButton(box) {
    const scope = box.closest('.msg-form, .msg-overlay-conversation-bubble, form') || document;
    return scope.querySelector('.msg-form__send-button:not([disabled]), button[type="submit"].msg-form__send-button:not([disabled])')
      || [...scope.querySelectorAll('button')].find(b => /^\s*send\s*$/i.test(b.textContent || '') && !b.disabled);
  }
  async function sendMessage(text) {
    const box = await openMessageComposer();
    if (!box) { log('No message composer found on this profile'); return false; }
    await sleep(600 + Math.random() * 800);
    setContentEditable(box, text);
    await sleep(900 + Math.random() * 900); // let the Send button enable + look human
    const send = findSendButton(box);
    if (!send) { log('Send button not found / disabled'); return false; }
    send.click();
    log('Follow-up message sent');
    return true;
  }

  // ---------- driver ----------
  let _lastSendAt = 0;
  let _busy = false;
  // LazyApply-style: on a LinkedIn JOB page, LinkedIn's "Meet the hiring team" card
  // explicitly names the recruiter/job-poster and gives a direct Message button. That's
  // a far more reliable target than guessing from an arbitrary profile — so prefer it.
  function jobPageCompany() {
    const el = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, [class*="company-name"] a, .topcard__org-name-link');
    return el ? (el.textContent || '').trim() : '';
  }
  function hiringTeamCard() {
    // The card lives in the right rail / details; find a container that mentions the
    // hiring team and contains a profile link + a Message affordance.
    const cards = [...document.querySelectorAll('.hirer-card__container, [class*="hirer-card"], .job-details-people-who-can-help__section, section')];
    for (const card of cards) {
      const t = (card.textContent || '').toLowerCase();
      if (!/hiring team|job poster|meet the|who can help|recruiter/.test(t)) continue;
      const profile = card.querySelector('a[href*="/in/"]');
      if (profile) return { card, profile };
    }
    // Fallback: a standalone job-poster name link.
    const poster = document.querySelector('.jobs-poster__name a[href*="/in/"], a.jobs-poster__name');
    if (poster) return { card: poster.closest('section, div') || poster, profile: poster };
    return null;
  }
  async function messageHiringTeam(match, c) {
    const ht = hiringTeamCard();
    if (!ht) return false;
    const pkey = (ht.profile.getAttribute('href') || '').match(/\/in\/([^/?#]+)/i)?.[1]?.toLowerCase() || '';
    if (!pkey || await alreadyMessaged(pkey)) return false;
    const first = ((ht.profile.textContent || '').trim().split(/\s+/)[0] || 'there').replace(/[^a-zA-Z''-]/g, '') || 'there';
    // Prefer a Message button inside the card; else fall back to opening the profile.
    const msgBtn = [...ht.card.querySelectorAll('button, a')].find(b => /message/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
    const text = c.template.replace(/\{first\}/gi, first).replace(/\{role\}/gi, match.role || 'the role').replace(/\{company\}/gi, match.company);
    _lastSendAt = Date.now();
    if (msgBtn) {
      msgBtn.click();
      let box = null;
      for (let i = 0; i < 20; i++) { await sleep(300); box = document.querySelector('.msg-form__contenteditable[contenteditable="true"]'); if (box) break; }
      if (!box) { log('Hiring-team Message clicked but composer did not open'); return false; }
      await sleep(700);
      setContentEditable(box, text);
      await sleep(1000 + Math.random() * 800);
      const send = findSendButton(box);
      if (!send) { log('Hiring-team composer: send button not ready'); return false; }
      send.click();
      log('Follow-up sent to hiring-team contact for ' + match.company);
      await markSent(pkey, match.company, match.role); await removeFromQueue(match.company);
      _lastSendAt = Date.now() + Math.random() * RAND_GAP_MS;
      return true;
    }
    return false;
  }

  async function tick() {
    if (_busy) return; _busy = true;
    try {
      const c = await cfg();
      renderPanel(c);                     // keep the on-page panel current
      if (!c.enabled) return;
      if (Date.now() - _lastSendAt < MIN_GAP_MS) return; // global throttle
      if (await sentToday() >= c.cap) return;            // daily cap
      const q = await queue();
      if (!q.length) return;

      // Path A (preferred): LinkedIn JOB page — message the named hiring-team recruiter.
      if (/\/jobs\/(view|collections|search)/i.test(location.pathname)) {
        const co = norm(jobPageCompany());
        const jm = co && q.find(f => f.company && (co.includes(norm(f.company)) || norm(f.company).includes(co)));
        if (jm) { if (await messageHiringTeam(jm, c)) { renderPanel(await cfg()); } }
        return;
      }

      // Path B: a profile page you opened for someone at an applied-to company.
      if (!/\/in\//i.test(location.pathname)) return;
      const pkey = profileKey();
      if (!pkey || await alreadyMessaged(pkey)) return;  // dedupe

      // B1 (best): this profile IS one of the exact insider contacts Jobright surfaced for a
      // job we applied to (recruiter / hiring manager for the role). Send with no further
      // gating — Jobright already vetted that this is the right person to reach.
      let match = q.find(f => Array.isArray(f.contacts) && f.contacts.some(c => c.profile === pkey));
      let exact = false;
      if (match) { exact = true; }
      else {
        // B2 (fallback): guess by company text on the profile, and require a recruiter-ish
        // headline so we don't cold-message a random employee.
        const ptext = profileCompanyText();
        match = q.find(f => f.company && ptext.includes(norm(f.company)));
        if (!match) return;               // this profile isn't at an applied-to company
        if (!looksLikeRecruiter()) { log('Profile matches ' + match.company + ' but does not look like a recruiter/hiring manager — skipping auto-send'); return; }
      }
      if (exact) log('Exact insider match for ' + match.company + ' — messaging the person Jobright surfaced');

      const text = c.template
        .replace(/\{first\}/gi, firstName())
        .replace(/\{role\}/gi, match.role || 'the role')
        .replace(/\{company\}/gi, match.company);
      _lastSendAt = Date.now();
      const ok = await sendMessage(text);
      if (ok) { await markSent(pkey, match.company, match.role); await removeFromQueue(match.company); _lastSendAt = Date.now() + Math.random() * RAND_GAP_MS; renderPanel(await cfg()); }
    } catch (e) { log('tick error:', e && e.message); }
    finally { _busy = false; }
  }

  // ---------- on-page control panel ----------
  function renderPanel(c) {
    try {
      // Stay out of the way while BROWSING LinkedIn: only show on profile (/in/) and
      // job (/jobs/) pages — never the feed, messaging, search or notifications.
      if (!/^\/(in|jobs)\//.test(location.pathname)) { document.getElementById('ua-li-followup')?.remove(); return; }
      S.get('ua_followup_panel_snooze').then(sn => {
      if (sn && Date.now() < sn) { document.getElementById('ua-li-followup')?.remove(); return; }
      queue().then(q => {
        let el = document.getElementById('ua-li-followup');
        if (!q.length && !c.enabled) { if (el) el.remove(); return; }
        if (!el) {
          el = document.createElement('div');
          el.id = 'ua-li-followup';
          el.style.cssText = 'position:fixed;right:14px;bottom:14px;width:260px;z-index:2147483000;background:#fff;border:1px solid #d0d5dd;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2226;overflow:hidden';
          document.body.appendChild(el);
        }
        sentToday().then(st => {
          el.innerHTML =
            '<div style="padding:9px 11px;background:#0a66c2;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:space-between">📨 Recruiter Follow-up' +
            '<span style="display:inline-flex;align-items:center;gap:8px"><label style="display:inline-flex;align-items:center;gap:5px;font-weight:600;font-size:11px;cursor:pointer"><input type="checkbox" id="ua-li-tog" ' + (c.enabled ? 'checked' : '') + '> Auto-send</label>' +
            '<span id="ua-li-x" title="Hide for 24h" style="cursor:pointer;font-weight:600;opacity:.85;padding:0 2px">✕</span></span></div>' +
            '<div style="padding:9px 11px">' +
            '<div style="font-size:10px;color:#666;margin-bottom:6px">Sent today: <b>' + st + '/' + c.cap + '</b> · Pending: <b>' + q.length + '</b></div>' +
            (c.enabled ? '<div style="font-size:10px;color:#0a66c2;margin-bottom:6px">Open a recruiter/hiring-manager profile at a company you applied to — it will auto-send.</div>'
                       : '<div style="font-size:10px;color:#b42318;margin-bottom:6px">Off. Turning on auto-sends LinkedIn messages (against LinkedIn ToS — use at your own risk).</div>') +
            q.slice(0, 5).map(f => {
              // Prefer the exact insider Jobright surfaced (highest-scoring = recruiter /
              // hiring manager for the role). Clicking opens THAT profile → auto-send fires.
              const top = Array.isArray(f.contacts) && f.contacts.length ? f.contacts.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0] : null;
              const href = top ? ('https://www.linkedin.com/in/' + encodeURIComponent(top.profile) + '/')
                               : ('https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(f.company + ' recruiter'));
              const label = top ? ((top.name ? top.name.split(/\s+/)[0] : 'contact') + ' →') : 'find →';
              const line = (f.company) + (f.role ? ' · ' + f.role : '');
              return '<div style="display:flex;justify-content:space-between;gap:6px;padding:4px 0;border-top:1px solid #eee"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (top && top.title ? String(top.title).replace(/"/g, '&quot;') : '') + '">' + line + '</span><a href="' + href + '" target="_self" style="color:#0a66c2;text-decoration:none;flex:0 0 auto">' + label + '</a></div>';
            }).join('') +
            '<textarea id="ua-li-tpl" style="width:100%;box-sizing:border-box;margin-top:8px;min-height:54px;border:1px solid #d0d5dd;border-radius:8px;padding:6px;font:11px/1.4 inherit;resize:vertical" placeholder="Message template">' + (c.template).replace(/</g, '&lt;') + '</textarea>' +
            '<div style="font-size:9px;color:#888;margin-top:3px">Placeholders: {first} {role} {company}</div>' +
            '</div>';
          const tog = el.querySelector('#ua-li-tog');
          if (tog) tog.onchange = () => S.set('ua_followup_enabled', tog.checked).then(() => cfg().then(renderPanel));
          const tpl = el.querySelector('#ua-li-tpl');
          if (tpl) tpl.onchange = () => S.set('ua_followup_template', tpl.value);
          const x = el.querySelector('#ua-li-x');
          if (x) x.onclick = () => S.set('ua_followup_panel_snooze', Date.now() + 86400000).then(() => el.remove());
        });
      });
      });
    } catch (_) {}
  }

  // Kick off: render the panel and poll for a matching profile.
  function start() { cfg().then(renderPanel); setInterval(tick, 3500); setTimeout(tick, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  log('LinkedIn recruiter follow-up module active');
})();
