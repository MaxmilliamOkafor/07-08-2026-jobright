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
 * The confirm/alert/prompt hooks are inert unless the automation is actually
 * driving this tab. The isolated content script sets `data-ua-auto="1"` on <html>
 * for the lifetime of a job and removes it afterwards; while that attribute is
 * absent, those dialogs behave exactly as the site intended. That matters because
 * these overrides are page-wide — you must still get a real confirm box when you
 * are browsing.
 *
 * `beforeunload` is the exception, and it is unconditional. "Leave site? Changes
 * you made may not be saved." is never useful here and freezes the page until a
 * human clicks Leave. Gating it on the automation flag meant it kept returning in
 * the gaps — before a job claims the tab, after the run hands it back, on a tab
 * the queue skipped. The cost is that this browser tab will not warn you about
 * losing an unsaved form you were filling in by hand.
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
  /* `data-ua-auto` is set for the lifetime of a job. `data-ua-grace` carries the
     timestamp the shield may come down at, and exists because the dialog that
     matters most — "Leave site?" — fires during the navigation AWAY from the
     page, after the job is over. Honouring the grace window keeps the shield up
     across that navigation; see setAutomationFlag in ua-enhancement.js.

     This gates the confirm/alert/prompt hooks, which SHOULD stand down when the
     automation is not driving — you must still get a real confirm box while
     browsing. beforeunload is deliberately not gated on it any more; see
     beforeUnloadSilenced. */
  const automating = () => {
    try {
      if (!root) return false;
      if (root.getAttribute('data-ua-auto') === '1') return true;
      const until = Number(root.getAttribute('data-ua-grace') || 0);
      return until > 0 && Date.now() < until;
    } catch (_) { return false; }
  };

  /* ── "Leave site?" is off, full stop ───────────────────────────────────────
     This was gated on the automation flag, which meant it kept coming back:
     during the gap before a job claims the tab, on a page the run had already
     handed back, on a tab the queue skipped. Every one of those is a frozen page
     waiting for a human to click Leave, and there is no version of this prompt
     that helps someone running hundreds of applications.

     So it is unconditional. The trade is real and worth naming: if you are
     typing into a form in a tab this extension is loaded in, and you navigate
     away, the browser will no longer warn you that you would lose it. That is
     the behaviour asked for, and the one the other bulk-apply tools ship.

     Everything else the page does in its beforeunload handler still runs —
     analytics, cleanup, saving a draft. Only its ability to raise the prompt is
     taken away. */
  const beforeUnloadSilenced = () => true;

  // "Remove X?", "Delete this attachment?", "Discard your changes?" — anything
  // whose effect is to throw away work already done on the page.
  const DESTRUCTIVE_RE =
    /^\s*(remove|delete|discard|erase|clear|reset|withdraw|revert|unattach|detach)\b|\b(remove|delete|discard)\s+(this|the|your)?\s*(file|resume|résumé|cv|attachment|document|upload|application|answers?|changes?)\b|\bare you sure you want to (remove|delete|discard|clear|withdraw|cancel)\b/i;

  const orig = {
    confirm: window.confirm,
    alert: window.alert,
    prompt: window.prompt,
  };

  /* Was this dialog caused by a REAL click from the person at the keyboard?
     Only a trusted event counts — a click dispatched by script (ours, or
     Jobright's own bundle) is not one. This is what tells "the user pressed
     Remove and means it" apart from "something clicked Remove on its own".

     It matters because the automation flag alone was not enough. The flag is
     only set for the lifetime of a queue job, so on a manual apply — or in the
     gap after a Fully-Automated pass hands the flag back — a script-driven
     Remove "…_CV"? confirm still froze the whole page with nothing able to
     answer it. */
  let lastTrustedAt = 0;
  for (const evt of ['pointerdown', 'mousedown', 'click', 'keydown']) {
    try {
      window.addEventListener(evt, (e) => { if (e && e.isTrusted) lastTrustedAt = Date.now(); }, true);
    } catch (_) {}
  }
  const humanJustActed = () => Date.now() - lastTrustedAt < 1200;

  function report(kind, message, answer) {
    try {
      window.dispatchEvent(new CustomEvent('ua-native-dialog', {
        detail: { kind, message: String(message == null ? '' : message).slice(0, 300), answer, ts: Date.now() },
      }));
    } catch (_) {}
  }

  window.confirm = function (message) {
    const text = String(message == null ? '' : message).trim();
    const destructive = DESTRUCTIVE_RE.test(text);

    if (automating()) {
      // Answering "no" to a destructive prompt keeps the uploaded file / entered
      // answers; answering "yes" to anything else lets a confirm-to-proceed step
      // through instead of stalling on it.
      const answer = !destructive;
      report('confirm', text, answer);
      return answer;
    }

    /* Not automating. A destructive confirm that NO human click caused was
       raised by script, and it blocks the page's JavaScript thread until it is
       answered. Decline it — declining "Remove <file>?" keeps the file, so this
       can never lose anything — and let the page carry on instead of freezing.

       A confirm the user actually triggered still goes through to the real
       dialog, so pressing Remove yourself works exactly as it always did. */
    if (destructive && !humanJustActed()) {
      report('confirm', text, false);
      return false;
    }
    return orig.confirm.apply(window, arguments);
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

  /* ── "Leave site? Changes you made may not be saved." ──────────────────────
     A `beforeunload` dialog is not a confirm() — the page cannot dismiss it and
     nothing on the page runs while it is up. It stops the run dead and waits for
     a human to click Leave, which is exactly what it was doing on Deloitte's
     /careers/ProfileEdit between application steps.

     The previous attempt here registered a capture-phase listener that cleared
     `returnValue`. That cannot work: a capture listener runs BEFORE the page's
     own handler, which then sets `returnValue` again afterwards. And clearing
     `returnValue` does nothing about `preventDefault()`, which arms the dialog
     on its own and cannot be un-set once called.

     So the handler must never be able to arm it in the first place. Every
     beforeunload listener is wrapped, and while automating it is handed a
     SHIELDED event whose preventDefault() does nothing and whose returnValue
     cannot be assigned. The handler still runs — sites do real bookkeeping in
     there — it simply comes out unable to raise a prompt. The wrapper also
     returns undefined, because returning a string arms the dialog too.

     Gated at DISPATCH time, not at registration: the page registers its handler
     once at load, long before a job starts. The gate itself is now always open —
     see beforeUnloadSilenced — so no navigation in this tab raises the prompt. */
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  function shieldEvent(e) {
    try {
      return new Proxy(e, {
        get(t, p) {
          if (p === 'preventDefault') return function () {};   // cannot arm the dialog
          if (p === 'returnValue') return '';
          const v = Reflect.get(t, p, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, p, v) {
          // Belt and braces — the wrapper clears the real event afterwards too,
          // so this alone is not what suppresses the prompt.
          if (p === 'returnValue') return true;
          try { t[p] = v; } catch (_) {}
          return true;
        },
      });
    } catch (_) { return e; }
  }

  const wrapped = new WeakMap();
  function wrapBeforeUnload(listener) {
    if (typeof listener !== 'function') return listener;
    const already = wrapped.get(listener);
    if (already) return already;
    const w = function (e) {
      if (!beforeUnloadSilenced()) return listener.apply(this, arguments);
      let r;
      try { r = listener.call(this, shieldEvent(e)); } catch (_) {}
      // Belt and braces: clear anything the handler managed to set on the real
      // event, and never pass a string back — either would raise the prompt.
      try { e.returnValue = undefined; } catch (_) {}
      report('beforeunload', 'Leave site? suppressed', true);
      return undefined;
    };
    wrapped.set(listener, w);
    return w;
  }

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'beforeunload' && typeof listener === 'function') {
      return origAdd.call(this, type, wrapBeforeUnload(listener), options);
    }
    return origAdd.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (type === 'beforeunload' && typeof listener === 'function' && wrapped.has(listener)) {
      return origRemove.call(this, type, wrapped.get(listener), options);
    }
    return origRemove.apply(this, arguments);
  };

  /* The other way a page arms it: `window.onbeforeunload = fn`. Assigning the
     property bypasses addEventListener entirely, so it needs its own shim. */
  try {
    let handler = null;
    let registered = null;
    Object.defineProperty(window, 'onbeforeunload', {
      configurable: true,
      enumerable: true,
      get() { return handler; },
      set(fn) {
        if (registered) { try { origRemove.call(window, 'beforeunload', registered); } catch (_) {} }
        handler = typeof fn === 'function' ? fn : null;
        registered = handler ? wrapBeforeUnload(handler) : null;
        if (registered) { try { origAdd.call(window, 'beforeunload', registered); } catch (_) {} }
      },
    });
  } catch (_) {}
})();
