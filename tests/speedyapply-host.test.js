/* SpeedyApply embedded in Jobright: ua-speedyapply-host.js loads SpeedyApply's
   own background.js into Jobright's worker and keeps four of its calls to what
   is SpeedyApply's. Driven here against a fake chrome.*, with a stand-in
   background.js run under that file name so its calls carry SpeedyApply's
   stack exactly as in the browser. Also checks SpeedyApply's files are the
   ones it shipped, byte for byte.

   Usage: node tests/speedyapply-host.test.js "<extension dir>" */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const EXT = process.argv[2];
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function fakeChrome() {
  const store = {};
  const menus = new Set();
  const msgListeners = [], installed = [];
  let uninstallUrl = 'https://jobright.ai/uninstall';
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const local = {
    get(keys, cb) {
      const out = {};
      const ks = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
      for (const k of ks) if (k in store) out[k] = clone(store[k]);
      setTimeout(() => cb(out), 0);
    },
    set(items, cb) { Object.assign(store, clone(items)); setTimeout(() => cb && cb(), 0); },
    remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); setTimeout(() => cb && cb(), 0); },
    clear(cb) { for (const k of Object.keys(store)) delete store[k]; setTimeout(() => cb && cb(), 0); },
  };
  const chrome = {
    storage: { local },
    runtime: {
      lastError: undefined,
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
      onMessage: { addListener: (fn) => msgListeners.push(fn) },
      onInstalled: { addListener: (fn) => installed.push(fn) },
      setUninstallURL: (u, cb) => { uninstallUrl = u; cb && cb(); },
    },
    contextMenus: {
      create: (o, cb) => { menus.add(o.id); cb && cb(); },
      remove: (id, cb) => { menus.delete(id); cb && cb(); },
      removeAll: (cb) => { menus.clear(); cb && cb(); },
    },
  };
  return { chrome, store, menus, msgListeners, installed, get uninstallUrl() { return uninstallUrl; } };
}

// A stand-in for SpeedyApply's background.js: the calls that matter, made the
// way 2.28.2 makes them (from its own file, so its stack says background.js).
const SA_STANDIN = `
  chrome.runtime.onInstalled.addListener(function (e) {
    if (e.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      chrome.runtime.setUninstallURL('https://www.speedyapply.com/uninstall');
      chrome.storage.local.set({ autofillEnabled: true, settings: { configName: 'Default' }, configList: [], autofillAccount: { accountEmail: '', accountPassword: '', useProfileEmail: false }, appliedList: [], responseList: [], dailyGoal: 10, initialSyncComplete: false });
    }
    chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create({ id: 'link-save-application' });
      chrome.contextMenus.create({ id: 'page-save-application' });
    });
  });
  chrome.runtime.onMessage.addListener(function (e, t, n) {
    globalThis.__saGot = (globalThis.__saGot || []).concat(e.type || e.name || '?');
    switch (e.type) { case 'getAutofillConfig': n({ enabled: true }); break; default: console.warn('Unhandled message type: ' + e.type); }
    return true;                                   // SpeedyApply returns true for every message
  });
  globalThis.__saSignOut = function () { chrome.storage.local.clear(function () { chrome.storage.local.set({ autofillEnabled: true }); }); };
  globalThis.__saWriteNewKey = function () { chrome.storage.local.set({ saFutureKey: 1 }); };
`;

(async () => {
  console.log('SpeedyApply inside Jobright: its background is kept to its own data, messages and menus');
  {
    const env = fakeChrome();
    const ctx = { chrome: env.chrome, console: { log() {}, warn() {} }, setTimeout, clearTimeout, Promise, Object, Array, JSON, String, Set, Error, Date };
    ctx.globalThis = ctx;
    ctx.importScripts = (p) => {
      if (p !== '/background.js') throw new Error('unexpected import ' + p);
      vm.runInContext(SA_STANDIN, ctx, { filename: 'chrome-extension://abc/background.js' });
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(EXT, 'ua-speedyapply-host.js'), 'utf8'), ctx, { filename: 'chrome-extension://abc/ua-speedyapply-host.js' });

    // Jobright's and the extension's own data, and our menu.
    env.store.ua_profile = { first_name: 'Max' };
    env.store.ua_q = [{ id: 'j1' }];
    env.store.AUTOFILL_INFO_SNAPSHOT = '{"personalInfo":{}}';
    env.store.ua_ats_logins = { acme: { email: 'x', password: 'y' } };
    env.chrome.contextMenus.create({ id: 'ua-open-panel' });

    // First run: SpeedyApply has never set itself up (Jobright was reloaded, an UPDATE).
    await new Promise((r) => setTimeout(r, 3300));
    eq('SpeedyApply\'s own install step ran once (its defaults are there)', !!env.store.settings && env.store.autofillEnabled === true, true);
    eq('…without pointing the extension\'s uninstall page at speedyapply.com', env.uninstallUrl, 'https://jobright.ai/uninstall');
    eq('its menu reset added its two items and kept ours', [...env.menus].sort(), ['link-save-application', 'page-save-application', 'ua-open-panel']);

    // Messages: only SpeedyApply's own types reach it.
    const deliver = (msg) => { let answered; const kept = env.msgListeners.map((l) => l(msg, { tab: { id: 7 } }, (v) => { answered = v; })); return { kept, answered }; };
    const jr = deliver({ name: 'openAgentApplyTab', body: { url: 'https://x' } });
    const ua = deliver({ type: 'UA_MGR_WHOAMI' });
    const sa = deliver({ type: 'getAutofillConfig' });
    eq('a Jobright message never reaches SpeedyApply (it would claim it and log "Unhandled")', ctx.__saGot, ['getAutofillConfig']);
    eq('…and is not held open by it', [jr.kept[0], ua.kept[0]], [false, false]);
    eq('SpeedyApply still answers its own', sa.answered, { enabled: true });

    // Sign-out: SpeedyApply clears "everything" — here, only its own.
    ctx.__saWriteNewKey();
    await tick(30);
    env.store.ignored = 1;
    ctx.__saSignOut();
    await tick(60);
    eq('signing out of SpeedyApply keeps your Jobright data, queue and saved logins', ['AUTOFILL_INFO_SNAPSHOT', 'ua_ats_logins', 'ua_profile', 'ua_q'].every((k) => k in env.store), true);
    eq('…and removes SpeedyApply\'s, including keys it wrote at run time', ['settings', 'configList', 'appliedList', 'saFutureKey'].some((k) => k in env.store), false);
    eq('…then SpeedyApply writes its fresh defaults as it would', env.store.autofillEnabled, true);

    // Anyone else's clear() / removeAll() is untouched.
    env.chrome.storage.local.clear();
    await tick(20);
    eq('a clear() that is not SpeedyApply\'s still clears everything', Object.keys(env.store).length, 0);
    env.chrome.contextMenus.removeAll();
    eq('…and so does removeAll()', env.menus.size, 0);
  }

  console.log('\nSpeedyApply\'s files are embedded exactly as shipped');
  {
    const list = fs.readFileSync(path.join(__dirname, 'speedyapply.sha256'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/));
    const changed = list.filter(([h, f]) => {
      try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(EXT, f))).digest('hex') !== h; } catch (_) { return true; }
    }).map(([, f]) => f);
    eq(`all ${list.length} SpeedyApply files unchanged`, changed, []);
    const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const cs = m.content_scripts.map((c) => c.js.join(','));
    eq('its content scripts are declared as it declares them', cs.includes('content-scripts/content.js') && cs.includes('sa-enhancement.js'), true);
    eq('its background is loaded by Jobright\'s worker through the host', /importScripts\("\/ua-speedyapply-host\.js"\)/.test(fs.readFileSync(path.join(EXT, 'static/background/index.js'), 'utf8')), true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
