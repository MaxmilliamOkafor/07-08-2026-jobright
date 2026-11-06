/* ua-switch-gate.js: with the autofill switch OFF, SpeedyApply (embedded
   unchanged) is told autofill is disabled — through the two questions it asks
   before acting — and the frame is not marked for the "Leave site?" shield.
   Driven against a fake chrome.* and document.

   Usage: node tests/switch-gate.test.js "<ua-switch-gate.js>" */
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(process.argv[2], 'utf8');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function page({ store, tabId = 7, top = true, autoAllowed }) {
  const changed = [];
  const attrs = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const chrome = {
    runtime: {
      lastError: undefined,
      // SpeedyApply's background answers getAutofillConfig with its own setting.
      sendMessage(msg, cb) {
        let reply;
        if (msg && msg.type === 'UA_WHICH_TAB') reply = { tabId };
        else if (msg && msg.type === 'getAutofillConfig') reply = { enabled: store.autofillEnabled !== false, premium: true, hasProfile: true };
        else if (msg && msg.name === 'getAutofillConfig') reply = { jobright: true, enabled: true };
        else reply = { echo: msg };
        if (typeof cb === 'function') { setTimeout(() => cb(clone(reply)), 0); return undefined; }
        return new Promise((r) => setTimeout(() => r(clone(reply)), 0));
      },
    },
    storage: {
      onChanged: { addListener: (l) => changed.push(l) },
      local: {
        get(keys, cb) {
          const ks = keys == null ? Object.keys(store) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of ks) if (k in store) out[k] = clone(store[k]);
          setTimeout(() => cb(out), 0);
        },
        set(obj) {
          const c = {};
          for (const k of Object.keys(obj)) { c[k] = { oldValue: store[k], newValue: obj[k] }; store[k] = obj[k]; }
          setTimeout(() => changed.forEach((l) => l(c, 'local')), 0);
        },
      },
    },
  };
  const documentElement = {
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
  const win = { chrome, document: { documentElement }, setTimeout, clearTimeout, Promise, Object, Array, JSON, String };
  win.window = win;
  win.top = top ? win : {};
  if (autoAllowed) win.__uaAutoAllowed = autoAllowed;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  // What SpeedyApply's two scripts do, from the same isolated world.
  const saConfig = () => win.chrome.runtime.sendMessage({ type: 'getAutofillConfig' });
  const saAddonEnabled = () => new Promise((r) => win.chrome.storage.local.get('autofillEnabled', (d) => r(d.autofillEnabled)));
  return { win, attrs, saConfig, saAddonEnabled, flip: (o) => chrome.storage.local.set(o) };
}

(async () => {
  console.log('autofill switch OFF: SpeedyApply is told autofill is disabled');
  {
    const store = { ua_aa: false, autofillEnabled: true, profile: { x: 1 } };
    const p = page({ store, top: false });
    eq('its content script: getAutofillConfig → enabled: false', (await p.saConfig()).enabled, false);
    eq('…the rest of its reply is untouched', (await p.saConfig()).hasProfile, true);
    eq('its Workflow Add-on: autofillEnabled → false', await p.saAddonEnabled(), false);
    eq('…in callback form too', await new Promise((r) => p.win.chrome.runtime.sendMessage({ type: 'getAutofillConfig' }, (v) => r(v.enabled))), false);
    eq('SpeedyApply\'s own stored setting is not changed', store.autofillEnabled, true);
    eq('other storage reads are untouched', await new Promise((r) => p.win.chrome.storage.local.get(['profile'], (d) => r(d.profile))), { x: 1 });
    eq('Jobright\'s own { name: "getAutofillConfig" } is not touched', (await p.win.chrome.runtime.sendMessage({ name: 'getAutofillConfig' })).enabled, true);
    eq('other messages pass through', (await p.win.chrome.runtime.sendMessage({ type: 'X' })).echo, { type: 'X' });
    await tick(40);
    eq('the frame is not marked (the site\'s "Leave site?" works)', 'data-ua-on' in p.attrs, false);

    p.flip({ ua_aa: true });
    await tick(30);
    eq('switched ON: SpeedyApply gets its real setting back at once', [(await p.saConfig()).enabled, await p.saAddonEnabled()], [true, true]);
    eq('…and the frame is marked', p.attrs['data-ua-on'], '1');
    p.flip({ ua_aa: false });
    await tick(30);
    eq('switched OFF again: disabled again', (await p.saConfig()).enabled, false);
  }

  console.log('\na run of ours owns the tab: SpeedyApply works even with the switch OFF');
  {
    const store = { ua_aa: false, autofillEnabled: true, ua_mgr_active: true, ua_mgr_tabs: { job1: 7 } };
    const p = page({ store, tabId: 7, top: false });
    eq('a Queue Manager job tab (in a frame of it)', (await p.saConfig()).enabled, true);
    await tick(40);
    eq('…and the frame is marked for the shield', p.attrs['data-ua-on'], '1');
    const other = page({ store, tabId: 8, top: false });
    eq('…but not any other tab', (await other.saConfig()).enabled, false);
    const runner = page({ store: { ua_aa: false, autofillEnabled: true, ua_qa: true, ua_runner_tab: 9 }, tabId: 9, top: false });
    eq('the single-tab runner\'s tab', (await runner.saConfig()).enabled, true);
  }

  console.log('\nthe top frame asks the full gate (queue jobs, your own Autofill press, another tool running)');
  {
    let allowed = false;
    const p = page({ store: { ua_aa: true, autofillEnabled: true }, top: true, autoAllowed: () => allowed });
    eq('switch ON but the gate says no (e.g. LazyApply is applying here) → disabled', (await p.saConfig()).enabled, false);
    allowed = true;
    eq('the gate says yes (e.g. you pressed Autofill on this Workday application) → its setting', (await p.saConfig()).enabled, true);
  }

  console.log('\nSpeedyApply switched off in its own settings stays off');
  {
    const p = page({ store: { ua_aa: true, autofillEnabled: false }, top: false });
    eq('switch ON, SpeedyApply\'s own setting OFF → off', [(await p.saConfig()).enabled, await p.saAddonEnabled()], [false, false]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
