/* v17.83 — two fixes.
   1. Workday: SpeedyApply's Workflow Add-on, with no SpeedyApply profile, pressed
      "Save and Continue" under the Workday engine (My Experience moved on while the
      engine checked its entries, and it paused). It is now told autofill is off on
      Workday while SpeedyApply has no profile.
   2. "Salary Expectation in Local Currency" as a dropdown of currencies was given
      the salary figure (60000); it now gets your currency.

   Usage: node tests/v1783.test.js "<extension dir>" */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = process.argv[2];
const enh = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const GATE = fs.readFileSync(path.join(EXT, 'ua-switch-gate.js'), 'utf8');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const between = (a, b) => enh.slice(enh.indexOf(a), enh.indexOf(b));

/* ── the currency ── */
const cur = (() => {
  const c = { DEFAULTS: { country: 'Ireland' } };
  vm.createContext(c);
  vm.runInContext(between('  function profileCurrency(p) {', '  // Salary in a free-text box with no figure') + '\nthis.pc = profileCurrency; this.co = currencyOption; this.names = CURRENCY_NAME; this.q = CURRENCY_Q_RE;', c);
  return c;
})();
const LIST = ['Euro', 'Pound Sterling', 'Irish Pound', 'Indian Rupee', 'UAE Dirham', 'Australian Dollar', 'Brazilian Real', 'Canadian Dollar', 'US Dollar', 'Polish Zloty'];
const pick = (country, opts = LIST) => cur.co(opts, { country }, (o) => o);
console.log('which currency');
eq('Ireland (your profile) → Euro', pick('Ireland'), 'Euro');
eq('no country → your default (Ireland) → Euro', cur.co(LIST, {}, (o) => o), 'Euro');
eq('United Kingdom → Pound Sterling, never Irish Pound', pick('United Kingdom'), 'Pound Sterling');
eq('…from a list with Irish Pound first', pick('United Kingdom', ['Irish Pound', 'Pound Sterling']), 'Pound Sterling');
eq('United States → US Dollar, not Australian or Canadian', pick('United States'), 'US Dollar');
eq('codes: EUR / GBP / USD', [pick('Ireland', ['GBP', 'EUR', 'USD']), pick('UK', ['USD - US Dollar', 'GBP - British Pound']), pick('USA', ['CAD', 'USD'])], ['EUR', 'GBP - British Pound', 'USD']);
eq('Poland → Polish Zloty', pick('Poland'), 'Polish Zloty');
eq('not in the list → nothing chosen (no guess)', pick('Ireland', ['Indian Rupee', 'UAE Dirham']), null);
eq('names typed into a custom dropdown', [cur.names[cur.pc({ country: 'Ireland' })], cur.names[cur.pc({ country: 'United Kingdom' })]], ['Euro', 'Pound Sterling']);
eq('"Salary Expectation in Local Currency" asks for a currency', cur.q.test('Salary Expectation in Local Currency'), true);
eq('"What are your salary expectations?" does not', cur.q.test('What are your salary expectations?'), false);

console.log('\nwhere it is used');
eq('a plain <select>: the shared rule', /if \(\/\\bcurrenc\/\.test\(ql\)\) \{\s*const hit = currencyOption\(opts, p, \(o\) => o\.text\);/.test(enh), true);
eq('custom dropdowns: the currency, not the salary figure', /if \(q && CURRENCY_Q_RE\.test\(q\)\) guess = CURRENCY_NAME\[profileCurrency\(profile \|\| _policyProfile\)\] \|\| guess;/.test(enh), true);
eq('the Workday engine: picked from its options', /window\.__uaWdAnswer = \(label, kind, options\) => \{\s*try \{\s*\/\/ v17\.83[^\n]*\n\s*if \(CURRENCY_Q_RE\.test/.test(enh), true);

/* ── SpeedyApply's add-on on Workday with no profile ── */
function gatePage({ store, saAllowed }) {
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const chrome = {
    runtime: { lastError: undefined, sendMessage(msg, cb) { const r = msg && msg.type === 'UA_WHICH_TAB' ? { tabId: 7 } : {}; if (cb) setTimeout(() => cb(r), 0); else return Promise.resolve(r); } },
    storage: { onChanged: { addListener() {} }, local: {
      get(keys, cb) { const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || store); const o = {}; for (const k of ks) if (k in store) o[k] = clone(store[k]); setTimeout(() => cb(o), 0); },
      set() {},
    } },
  };
  const de = { setAttribute() {}, removeAttribute() {} };
  const win = { chrome, document: { documentElement: de, getElementById: () => null, addEventListener() {} }, setTimeout, clearTimeout, Promise, Object, Array, JSON, String, MutationObserver: function () { this.observe = () => {}; } };
  win.window = win; win.top = win;
  win.__uaAutoAllowed = () => true;                // a queue job owns this tab
  if (saAllowed !== undefined) win.__uaSaAddonAllowed = async () => saAllowed;
  vm.createContext(win);
  vm.runInContext(GATE, win);
  return () => new Promise((r) => win.chrome.storage.local.get('autofillEnabled', (d) => r(d.autofillEnabled)));
}
(async () => {
  console.log('\nSpeedyApply\'s Workflow Add-on on a queue job\'s Workday tab');
  eq('SpeedyApply has a profile → it runs (its own setting)', await gatePage({ store: { autofillEnabled: true }, saAllowed: true })(), true);
  eq('no SpeedyApply profile → told autofill is off (the engine fills)', await gatePage({ store: { autofillEnabled: true }, saAllowed: false })(), false);
  eq('not Workday / no answer from the page → unchanged', await gatePage({ store: { autofillEnabled: true } })(), true);
  eq('switched off in its own settings stays off', await gatePage({ store: { autofillEnabled: false }, saAllowed: true })(), false);
  const rule = between('  window.__uaSaAddonAllowed = async function () {', '  /* SpeedyApply with no profile kept showing');
  eq('decided on Workday only, by SpeedyApply\'s profile', /if \(!isWorkday\(\) \|\| !saEmbedded\(\)\) return true;/.test(rule) && /return !\(sa && !sa\.hasProfile\);/.test(rule), true);
  eq('SpeedyApply\'s own files are not edited for it', /__uaSaAddonAllowed/.test(fs.readFileSync(path.join(EXT, 'sa-enhancement.js'), 'utf8')), false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
