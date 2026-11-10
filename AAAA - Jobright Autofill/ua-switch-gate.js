/* ua-switch-gate.js — the one autofill switch, applied to SpeedyApply.

   The switch (storage key `ua_aa`, shown as "Autofill ON / OFF" on the toolbar
   icon, in its popup and as "🤖 Fully Automated" in the sidebar) already gates
   this extension's own autofill. SpeedyApply, embedded unchanged, has its own
   setting (`autofillEnabled`) and acted on its own whenever that was on: its
   content script filled the form, and its Workflow Add-on clicked Apply,
   uploaded the CV and held "Next" until required fields were filled — with the
   switch OFF.

   SpeedyApply's files stay unchanged. It asks two questions before it acts,
   both from this isolated world, so both are answered here:
     • content-scripts/content.js sends { type: "getAutofillConfig" } and reads
       `enabled` from the reply;
     • sa-enhancement.js reads `autofillEnabled` from chrome.storage.local.
   While the switch is OFF, and no run of ours owns this tab, the answer is
   "disabled". SpeedyApply's own stored setting is never changed, and its
   popup and options pages (not content scripts) still show it as it is.

   It also marks the frame with data-ua-on="1" while the switch is ON or a run
   owns the tab, for ua-page-hooks.js (MAIN world, cannot read storage): with
   the switch OFF, "Leave site?" warnings work as the site intended.

   Runs in every frame at document_start, before SpeedyApply's scripts. */
(() => {
  'use strict';
  if (window.__uaSwitchGate) return;

  const KEYS = ['ua_aa', 'ua_mgr_active', 'ua_mgr_tabs', 'ua_qa', 'ua_runner_tab'];
  const s = { on: false, mgrActive: false, mgrTabs: {}, qa: false, runnerTab: null };
  let myTab = null;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const TOP = (() => { try { return window.top === window; } catch (_) { return false; } })();

  // A run of ours owns this tab (Queue Manager job tab, or the single-tab runner).
  const runOwnsTab = () => myTab != null && (
    (s.mgrActive && Object.values(s.mgrTabs || {}).includes(myTab)) ||
    (s.qa && s.runnerTab === myTab));

  function allowed() {
    // The top frame has the full gate (queue jobs, your own Autofill press on
    // Workday, the runner tab, another tool already applying here).
    try { if (TOP && typeof window.__uaAutoAllowed === 'function') return !!window.__uaAutoAllowed(); } catch (_) {}
    return s.on || runOwnsTab();
  }
  const allowedAsync = () => ready.then(allowed, () => false);
  window.__uaSwitchGate = { allowed, allowedAsync, state: () => Object.assign({ myTab }, s) };

  function mark() {
    try {
      const de = document.documentElement;
      if (!de) return;
      if (s.on || runOwnsTab()) de.setAttribute('data-ua-on', '1');
      else de.removeAttribute('data-ua-on');
    } catch (_) {}
  }

  try {
    chrome.storage.local.get(KEYS, (d) => {
      void chrome.runtime.lastError;
      d = d || {};
      s.on = d.ua_aa === true;
      s.mgrActive = d.ua_mgr_active === true;
      s.mgrTabs = d.ua_mgr_tabs || {};
      s.qa = d.ua_qa === true;
      s.runnerTab = typeof d.ua_runner_tab === 'number' ? d.ua_runner_tab : null;
      mark();
      // Which tab this frame is in: asked once, but never waited on for long.
      let done = false;
      const finish = () => { if (!done) { done = true; mark(); readyResolve(); } };
      try {
        chrome.runtime.sendMessage({ type: 'UA_WHICH_TAB' }, (r) => {
          void chrome.runtime.lastError;
          if (r && typeof r.tabId === 'number') myTab = r.tabId;
          finish();
        });
      } catch (_) { finish(); }
      setTimeout(finish, 1500);
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local') return;
      if (c.ua_aa) s.on = c.ua_aa.newValue === true;
      if (c.ua_mgr_active) s.mgrActive = c.ua_mgr_active.newValue === true;
      if (c.ua_mgr_tabs) s.mgrTabs = c.ua_mgr_tabs.newValue || {};
      if (c.ua_qa) s.qa = c.ua_qa.newValue === true;
      if (c.ua_runner_tab) s.runnerTab = typeof c.ua_runner_tab.newValue === 'number' ? c.ua_runner_tab.newValue : null;
      if (KEYS.some((k) => k in c)) mark();
    });
  } catch (_) { try { readyResolve(); } catch (_e) {} }

  /* sa-enhancement.js: chrome.storage.local.get('autofillEnabled'). Only a read
     that returns that key is touched, and only its value in what comes back. */
  try {
    const area = chrome.storage.local;
    const rawGet = area.get.bind(area);
    const asksForIt = (k) => k == null || k === 'autofillEnabled' ||
      (Array.isArray(k) && k.includes('autofillEnabled')) ||
      (typeof k === 'object' && !Array.isArray(k) && Object.prototype.hasOwnProperty.call(k, 'autofillEnabled'));
    area.get = function (keys, cb) {
      if (!asksForIt(keys)) return cb === undefined ? rawGet(keys) : rawGet(keys, cb);
      const p = new Promise((res) => rawGet(keys, (d) => res(d || {}))).then(async (d) => {
        if (Object.prototype.hasOwnProperty.call(d, 'autofillEnabled') && !(await allowedAsync())) return Object.assign({}, d, { autofillEnabled: false });
        return d;
      });
      if (typeof cb === 'function') { p.then((d) => cb(d)); return undefined; }
      return p;
    };
  } catch (_) {}

  /* content-scripts/content.js: sendMessage({ type: "getAutofillConfig" }).
     Jobright's own message of that name is { name: … } and is not touched. */
  try {
    const rt = chrome.runtime;
    const rawSend = rt.sendMessage.bind(rt);
    rt.sendMessage = function (...args) {
      const msg = typeof args[0] === 'string' ? args[1] : args[0];
      if (!msg || typeof msg !== 'object' || msg.type !== 'getAutofillConfig') return rawSend(...args);
      const cbAt = args.findIndex((a) => typeof a === 'function');
      const cb = cbAt >= 0 ? args[cbAt] : null;
      const pass = cbAt >= 0 ? args.slice(0, cbAt) : args;
      const p = Promise.resolve(rawSend(...pass)).then(async (r) => {
        if (r && typeof r === 'object' && !('error' in r) && !(await allowedAsync())) return Object.assign({}, r, { enabled: false });
        return r;
      });
      if (cb) { p.then((r) => cb(r), () => cb(undefined)); return undefined; }
      return p;
    };
  } catch (_) {}
})();
