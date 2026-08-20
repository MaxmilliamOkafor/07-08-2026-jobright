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
    constructor(type) { this.type = type; this.defaultPrevented = false; this.returnValue = ''; }
    preventDefault() { this.defaultPrevented = true; }
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

  /* Fire beforeunload exactly as the browser would, and report whether the
     prompt would appear. */
  const fire = () => {
    const e = new Ev('beforeunload');
    let returned;
    for (const fn of (listeners.get('beforeunload') || []).slice()) {
      const r = fn.call(win, e);
      if (typeof r === 'string' && r) returned = r;
    }
    return e.defaultPrevented || (e.returnValue !== '' && e.returnValue != null) || !!returned;
  };
  return { win, fire, listeners };
}

/* The three ways a site arms the dialog — Deloitte's ProfileEdit form uses the
   first, most sites use one of these. */
const ARMERS = {
  'preventDefault()': (e) => { e.preventDefault(); },
  'returnValue = string': (e) => { e.returnValue = 'Changes you made may not be saved.'; },
  'return a string': () => 'Changes you made may not be saved.',
  'all three at once': (e) => { e.preventDefault(); e.returnValue = 'x'; return 'x'; },
};

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

console.log('while browsing manually, the site behaves exactly as it intended');
for (const [how, handler] of Object.entries(ARMERS)) {
  const env = makeEnv({ automating: () => false });
  env.win.addEventListener('beforeunload', handler);
  eq(`addEventListener + ${how} → still warns you`, env.fire(), true);
}
for (const [how, handler] of Object.entries(ARMERS)) {
  const env = makeEnv({ automating: () => false });
  env.win.onbeforeunload = handler;
  eq(`window.onbeforeunload = fn + ${how} → still warns you`, env.fire(), true);
}

console.log('the decision is made when the event fires, not when it is registered');
{
  // The page registers its handler at load, long before a job starts.
  let automating = false;
  const env = makeEnv({ automating: () => automating });
  env.win.addEventListener('beforeunload', (e) => { e.preventDefault(); });
  eq('registered while idle, fired while idle → warns', env.fire(), true);
  automating = true;
  eq('same listener, fired mid-run → suppressed', env.fire(), false);
  automating = false;
  eq('and it warns again the moment the run ends', env.fire(), true);
}

console.log('the page keeps working');
{
  let ran = 0, sawEvent = null;
  const env = makeEnv({ automating: () => true });
  env.win.addEventListener('beforeunload', (e) => { ran++; sawEvent = e; e.preventDefault(); });
  env.fire();
  eq('the site\'s own handler still runs (sites do real bookkeeping there)', ran, 1);
  eq('it is handed an event, not undefined', sawEvent !== null && typeof sawEvent === 'object', true);
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
  eq('and nothing is left registered', (env.listeners.get('beforeunload') || []).length, 0);
}
{
  const env = makeEnv({ automating: () => true });
  const h = (e) => { e.preventDefault(); };
  env.win.onbeforeunload = h;
  eq('the onbeforeunload property reads back what was assigned', env.win.onbeforeunload, h);
  env.win.onbeforeunload = null;
  eq('and assigning null unregisters it', (env.listeners.get('beforeunload') || []).length, 0);
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
