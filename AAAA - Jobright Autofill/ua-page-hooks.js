/**
 * ua-page-hooks.js — MAIN-world hooks. Runs in the PAGE's JavaScript context
 * (manifest `"world": "MAIN"`), not the isolated content-script world.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A native `window.confirm()` blocks the page's JavaScript thread until a human
 * answers it. Nothing the automation does can run while one is up — not the
 * filler, not the submit, not the per-page timeout. A SmartRecruiters run died
 * exactly this way: something opened
 *
 *     Remove "Maxmilliam_Okafor_CV"?
 *
 * and the whole queue sat frozen behind that dialog until the manager's watchdog
 * killed the tab six minutes later.
 *
 * A content script cannot fix this from the isolated world: overriding
 * `window.confirm` there replaces the *isolated* world's copy, and the page keeps
 * calling its own. Only a MAIN-world script sees the same `window` the page does.
 * Injecting a <script> tag would be blocked by most ATS content-security policies,
 * so this is declared as a MAIN-world content script instead.
 *
 * SAFETY
 * ------
 * The hooks are inert unless the automation is actually driving this tab. The
 * isolated content script sets `data-ua-auto="1"` on <html> for the lifetime of a
 * job and removes it afterwards; while that attribute is absent, every dialog
 * behaves exactly as the site intended. That matters because these overrides are
 * page-wide — you must still get a real confirm box when you are browsing.
 *
 * ANSWER POLICY
 * -------------
 * Destructive prompts ("Remove …?", "Delete …?", "Discard …?") are answered NO,
 * so the résumé you already uploaded stays attached. Everything else ("Submit
 * your application?", "Are you sure you want to continue?") is answered YES, so a
 * confirm step can't stall the run. Every dialog is reported back to the content
 * script so it lands in the queue log rather than vanishing silently.
 */
(function () {
  'use strict';

  if (window.__uaPageHooksInstalled) return;
  window.__uaPageHooksInstalled = true;

  const root = document.documentElement;
  const automating = () => {
    try { return root && root.getAttribute('data-ua-auto') === '1'; } catch (_) { return false; }
  };

  // "Remove X?", "Delete this attachment?", "Discard your changes?" — anything
  // whose effect is to throw away work already done on the page.
  const DESTRUCTIVE_RE =
    /^\s*(remove|delete|discard|erase|clear|reset|withdraw|revert|unattach|detach)\b|\b(remove|delete|discard)\s+(this|the|your)?\s*(file|resume|résumé|cv|attachment|document|upload|application|answers?|changes?)\b|\bare you sure you want to (remove|delete|discard|clear|withdraw|cancel)\b/i;

  const orig = {
    confirm: window.confirm,
    alert: window.alert,
    prompt: window.prompt,
  };

  function report(kind, message, answer) {
    try {
      window.dispatchEvent(new CustomEvent('ua-native-dialog', {
        detail: { kind, message: String(message == null ? '' : message).slice(0, 300), answer, ts: Date.now() },
      }));
    } catch (_) {}
  }

  window.confirm = function (message) {
    if (!automating()) return orig.confirm.apply(window, arguments);
    const text = String(message == null ? '' : message).trim();
    // Answering "no" to a destructive prompt keeps the uploaded file / entered
    // answers; answering "yes" to anything else lets a confirm-to-proceed step
    // through instead of stalling on it.
    const answer = !DESTRUCTIVE_RE.test(text);
    report('confirm', text, answer);
    return answer;
  };

  window.alert = function (message) {
    if (!automating()) return orig.alert.apply(window, arguments);
    report('alert', message, null);   // swallowed: an alert would block just as hard
  };

  window.prompt = function (message, defaultValue) {
    if (!automating()) return orig.prompt.apply(window, arguments);
    report('prompt', message, null);
    return defaultValue == null ? '' : defaultValue;
  };

  /* `beforeunload` handlers turn a navigation into another blocking dialog
     ("Leave site?"). Chrome only raises it after a user gesture in the tab, which
     a background job tab normally never has — but a stray gesture is enough to
     wedge a run, so while automating we neutralise the return value that triggers
     it. The listener itself is left alone; only the prompt is suppressed. */
  window.addEventListener('beforeunload', function (e) {
    if (!automating()) return;
    try { e.returnValue = undefined; delete e.returnValue; } catch (_) {}
  }, true);
})();
