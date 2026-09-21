/* "Leave site? Changes you made may not be saved." — a beforeunload dialog is not
   a confirm(): the page cannot dismiss it, nothing runs while it is up, and it
   waits for a human to click Leave. It was stopping the run dead between steps on
   Deloitte's /careers/ProfileEdit.

   The previous attempt registered a capture-phase listener that cleared
   returnValue. That cannot work — a capture listener runs BEFORE the page's own
   handler, which sets it again afterwards — and it does nothing about
   preventDefault(), which arms the dialog on its own and cannot be un-set.

   These run the real hook file in a sandbox with a working EventTarget, then ask
   the question that actually matters: after every listener has run, would Chrome
   raise the dialog?

   Usage: node tests/beforeunload.test.js "<ua-page-hooks.js>" */
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const src = fs.readFileSync(process.argv[2], 'utf8');

/* A beforeunload event faithful enough to answer the only question that counts.
   Chrome shows the prompt when the handler called preventDefault(), assigned a
   non-empty returnValue, or returned a string. */
function makeEnv({ automating }) {
  const listeners = new Map();
  class Ev {
    constructor(type) { this.type = type; this.defaultPrevented = false; this.returnValue = ''; this.stopped = false; }
    preventDefault() { this.defaultPrevented = true; }
    /* The browser really does stop every later listener on the same target.
       Without modelling that, the capture interceptor would look like it does
       nothing here while working perfectly in Chrome. */
    stopImmediatePropagation() { this.stopped = true; }
    stopPropagation() {}
  }
  const EventTarget = function () {};
  EventTarget.prototype.addEventListener = function (type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  EventTarget.prototype.removeEventListener = function (type, fn) {
    const l = listeners.get(type) || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
  const root = { getAttribute: (k) => (k === 'data-ua-auto' && automating() ? '1' : null) };
  const win = {
    document: { documentElement: root },
    EventTarget,
    Proxy, Reflect, WeakMap, CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    confirm: () => true, alert: () => {}, prompt: () => '',
    dispatchEvent: () => true,
  };
  // window IS an EventTarget in a browser; the hook shims the prototype, so the
  // window's own methods must resolve through it for the test to mean anything.
  win.addEventListener = function (...a) { return win.EventTarget.prototype.addEventListener.apply(win, a); };
  win.removeEventListener = function (...a) { return win.EventTarget.prototype.removeEventListener.apply(win, a); };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(src, ctx);
  // Whatever the hooks registered for themselves at load. Anything beyond this
  // count belongs to the page.
  const ownListeners = (listeners.get('beforeunload') || []).length;

  /* Fire beforeunload exactly as the browser would, and report whether the
     prompt would appear. */
  const fire = () => {
    const e = new Ev('beforeunload');
    let returned;
    for (const fn of (listeners.get('beforeunload') || []).slice()) {
      const r = fn.call(win, e);
      if (typeof r === 'string' && r) returned = r;
      if (e.stopped) break;   // exactly what stopImmediatePropagation does
    }
    return e.defaultPrevented || (e.returnValue !== '' && e.returnValue != null) || !!returned;
  };
  return { win, fire, listeners, ownListeners };
}

/* The three ways a site arms the dialog — Deloitte's ProfileEdit form uses the
   first, most sites use one of these. */
const ARMERS = {
  'preventDefault()': (e) => { e.preventDefault(); },
  'returnValue = string': (e) => { e.returnValue = 'Changes you made may not be saved.'; },
  'return a string': () => 'Changes you made may not be saved.',
  'all three at once': (e) => { e.preventDefault(); e.returnValue = 'x'; return 'x'; },
};

/* Everything registered on beforeunload minus the hooks' own capture-phase
   interceptor, which is installed at load and is never the site's. */
function pageListeners(env) {
  const all = env.listeners.get('beforeunload') || [];
  return Math.max(0, all.length - env.ownListeners);
}

console.log('while automating, no "Leave site?" prompt can be raised');
for (const [how, handler] of Object.entries(ARMERS)) {
  const env = makeEnv({ automating: () => true });
  env.win.addEventListener('beforeunload', handler);
  eq(`addEventListener + ${how} → suppressed`, env.fire(), false);
}
for (const [how, handler] of Object.entries(ARMERS)) {
  const env = makeEnv({ automating: () => true });
  env.win.onbeforeunload = handler;
  eq(`window.onbeforeunload = fn + ${how} → suppressed`, env.fire(), false);
}

/* This used to stand down whenever a job was not in flight, and that is exactly
   how the prompt kept coming back: in the gap before a job claims the tab, on a
   page the run had already handed back, on a tab the queue skipped. Each one is
   a frozen page waiting for a human to click Leave.

   It is unconditional now, and the cost is named rather than hidden: a form you
   were filling in BY HAND in one of these tabs will no longer warn you before
   you navigate away from it. */
console.log('and it stays off when no job is running — that is the point');
for (const [how, handler] of Object.entries(ARMERS)) {
  const env = makeEnv({ automating: () => false });
  env.win.addEventListener('beforeunload', handler);
  eq(`idle, addEventListener + ${how} → still no prompt`, env.fire(), false);
}
for (const [how, handler] of Object.entries(ARMERS)) {
  const env = makeEnv({ automating: () => false });
  env.win.onbeforeunload = handler;
  eq(`idle, window.onbeforeunload = fn + ${how} → still no prompt`, env.fire(), false);
}

console.log('no state can bring it back');
{
  let automating = false;
  const env = makeEnv({ automating: () => automating });
  env.win.addEventListener('beforeunload', (e) => { e.preventDefault(); });
  eq('registered and fired while idle', env.fire(), false);
  automating = true;
  eq('fired mid-run', env.fire(), false);
  automating = false;
  eq('and fired again after the run ends', env.fire(), false);
}
eq('the gate is a constant, not a flag that can flip back',
  /const beforeUnloadSilenced = \(\) => true;/.test(src), true);
eq('and the wrapper asks it, not the automation flag',
  /if \(!beforeUnloadSilenced\(\)\) return listener\.apply\(this, arguments\);/.test(src), true);
/* confirm/alert/prompt are NOT unconditional — those must still behave normally
   while you are browsing, or you would lose real dialogs you asked for. */
eq('confirm still stands down when the automation is not driving',
  /if \(automating\(\)\) \{\n      \/\/ Answering "no" to a destructive prompt/.test(src), true);
eq('and so does alert', /if \(!automating\(\)\) return orig\.alert\.apply\(window, arguments\);/.test(src), true);

/* ── what the interceptor costs, stated rather than hidden ──────────────────
   The capture-phase interceptor calls stopImmediatePropagation, so the page's
   own beforeunload handler does not run at all. That is a deliberate trade and
   it is not free: sites do real work in there — saving a draft, flushing
   analytics, releasing a lock — and none of it happens now.

   It was chosen over the wrapper-only approach because the wrapper is a race
   (it covers only listeners registered after it installs, and anything that
   re-patches addEventListener undoes it) and that race was being lost in the
   field: the prompt returned after every application. A bulk run that stops
   dead for a human click every time is worse than an ATS losing a draft it
   would have re-created from the server anyway. */
console.log('the page is stopped from asking, which costs it its handler');
{
  let ran = 0;
  const env = makeEnv({ automating: () => true });
  env.win.addEventListener('beforeunload', (e) => { ran++; e.preventDefault(); });
  eq('no prompt is raised', env.fire(), false);
  eq('and the page\'s handler did not run at all — the cost of that', ran, 0);
}
{
  /* The wrapper is still there underneath, and still does its job: a handler
     that DOES get to run is handed a shielded event rather than a broken one. */
  let sawEvent = null;
  const env = makeEnv({ automating: () => true });
  env.win.addEventListener('beforeunload', (e) => { sawEvent = e; e.preventDefault(); });
  // Reach past the interceptor to the wrapped listener, as a page would if the
  // interceptor were ever absent.
  const all = env.listeners.get('beforeunload') || [];
  all[all.length - 1].call(env.win, { preventDefault() {}, returnValue: '' });
  eq('a handler that runs is handed an event, not undefined',
    sawEvent !== null && typeof sawEvent === 'object', true);
  eq('preventDefault is available to call, it just does nothing',
    typeof sawEvent.preventDefault, 'function');
  eq('and reading returnValue does not throw', sawEvent.returnValue, '');
}
{
  const env = makeEnv({ automating: () => true });
  const h = (e) => { e.preventDefault(); };
  env.win.addEventListener('beforeunload', h);
  env.win.removeEventListener('beforeunload', h);
  eq('removeEventListener still removes the wrapped listener', env.fire(), false);
  /* The hooks register one beforeunload listener of their own — the capture
     interceptor that stops the page's handlers running at all. It is not the
     site's and must not be counted as one left behind. */
  eq('and nothing of the page\'s is left registered', pageListeners(env), 0);
}
{
  const env = makeEnv({ automating: () => true });
  const h = (e) => { e.preventDefault(); };
  env.win.onbeforeunload = h;
  eq('the onbeforeunload property reads back what was assigned', env.win.onbeforeunload, h);
  env.win.onbeforeunload = null;
  eq('and assigning null unregisters it', pageListeners(env), 0);
}
{
  // Only beforeunload is touched — every other listener must pass through
  // untouched, or the shim becomes a liability on every page you visit.
  const env = makeEnv({ automating: () => true });
  let clicks = 0;
  env.win.addEventListener('click', () => clicks++);
  for (const fn of env.listeners.get('click')) fn.call(env.win, {});
  eq('other event types are not wrapped', clicks, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
