/* v17.81 — Workday, from AIHawk's Workday notes (feder-cr/Jobs_Applier_AI_Agent, MIT):
   the engine reads the page's visible text (a script's "Application Submitted"
   no longer counts), never types into the "beecatcher" honeypot, one posting
   is one job whatever its address (tenant + requisition id), and Submit is not
   pressed again while the Review page lingers after it.

   Usage: node tests/v1781.test.js "<extension dir>" */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const enh = read('ua-enhancement.js');
const orch = read('ua-orchestrator.js');
const queue = read('ua-queue.js');
const eng = read('ua-wd-engine.js');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const body = (code, name) => {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l));
  if (start < 0) throw new Error('no ' + name);
  const end = lines.findIndex((l, i) => i > start && l === '  }');
  return lines.slice(start, end + 1).join('\n');
};
const run = (code, extra = {}) => { const c = Object.assign({ URL, String, RegExp }, extra); vm.createContext(c); vm.runInContext(code, c); return c; };

/* ── one posting, one job ── */
const R = 'https://acme.wd1.myworkdayjobs.com/en-US/External/job/London/Senior-Engineer_R100';
const SAME = [
  R,
  R + '/apply',
  R + '/apply/applyManually',
  R + '/apply/autofillWithResume?source=LinkedIn',
  'https://acme.wd1.myworkdayjobs.com/External/job/London/Senior-Engineer_R100/',
  'https://acme.wd1.myworkdayjobs.com/en-GB/Careers/job/London-Office/Senior-Engineer_r100',
  'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Senior-Engineer_R100',
];
for (const [file, code] of [['ua-orchestrator.js', orch], ['ua-queue.js', queue], ['ua-enhancement.js', enh]]) {
  console.log(`\n${file}: which addresses are the same Workday posting`);
  const c = run(body(code, 'postingKey') + '\nthis.k = postingKey;');
  const keys = SAME.map(c.k);
  eq('every form of one posting has one key', [...new Set(keys)], ['workday:acme:r100']);
  eq('another requisition is another posting', c.k(R.replace('R100', 'R101')), 'workday:acme:r101');
  eq('another tenant is another posting', c.k(R.replace('acme.', 'globex.')), 'workday:globex:r100');
  eq('myworkdaysite.com: tenant from /recruiting/<tenant>/', c.k('https://wd3.myworkdaysite.com/en-US/recruiting/acme/External/job/London/Engineer_R100/apply'), 'workday:acme:r100');
  eq('not Workday: no key (the normal address rule applies)', [c.k('https://job-boards.greenhouse.io/acme/jobs/44'), c.k('https://jobs.lever.co/acme/abc_def')], ['', '']);
  eq('a Workday page that is not a posting: no key', c.k('https://acme.wd1.myworkdayjobs.com/en-US/External'), '');
  eq('rubbish never throws', [c.k(''), c.k(null), c.k('not a url')], ['', '', '']);
  eq('jobIdentity falls back to the normal address rule', /const jobIdentity = \(u\) => postingKey\(u\) \|\| norm(al)?(ize)?Url\(u\);/.test(code), true);
}
console.log('\nwhere the key is used');
eq('Queue Manager: a posting already queued is not added again', /jobIdentity\(j\.url\) === jobIdentity\(norm\)/.test(orch), true);
eq('CSV import: applied / already queued checked by posting', /jobIdentity\(/.test(queue.slice(queue.indexOf('function postingKey') + 1200)), true);
eq('single-tab runner: addJob and alreadyApplied by posting', (enh.match(/jobIdentity\(/g) || []).length >= 3, true);

/* ── the engine reads what is on screen ── */
console.log('\nWorkday engine: the page as a person sees it');
const pt = (b) => run(body(eng, 'pageText') + '\nthis.f = pageText;', { document: { body: b } }).f();
eq('visible text, spaces collapsed', pt({ innerText: '  Sign In\n\n Email  ', textContent: 'Sign In Email window.x="Application Submitted"' }), 'Sign In Email');
eq('a script\'s words are not read as the page', /Submitted/.test(pt({ innerText: 'Sign in with email', textContent: 'Sign in with email "Application Submitted"' })), false);
eq('no body: empty', pt(null), '');
eq('no innerText (old engines): textContent', pt({ textContent: 'Review' }), 'Review');
eq('detectPage reads pageText, not textContent', /const body = pageText\(\)\.slice\(0, 5e3\);/.test(eng), true);
eq('the verify-email check reads pageText', /VERIFY_EMAIL_RX\.test\(pageText\(\)/.test(eng), true);
eq('…and the source matches the bundle', /export function pageText\(\)/.test(fs.readFileSync(path.join(EXT, '../workday-engine/src/workday/dom.ts'), 'utf8')), true);

console.log('\nWorkday engine: the honeypot');
const hp = run(body(eng, 'isHoneypot') + '\nthis.f = isHoneypot;').f;
const el = (o) => ({ getAttribute: (k) => (o.attrs || {})[k] ?? null, id: o.id || '', name: o.name || '', placeholder: '', labels: (o.labels || []).map((t) => ({ textContent: t })) });
eq('data-automation-id="beecatcher"', hp(el({ attrs: { 'data-automation-id': 'beecatcher' } })), true);
eq('labelled "This input is for robots only"', hp(el({ name: 'website', labels: ['This input is for robots only'] })), true);
eq('a real Website field is not one', hp(el({ name: 'website', labels: ['Website'] })), false);
eq('a normal field is not one', hp(el({ attrs: { 'data-automation-id': 'legalNameSection_firstName' } })), false);
eq('never typed into', /if \(isHoneypot\(el\)\) return false;/.test(body(eng, 'setText')), true);
eq('…and the source matches the bundle', /isHoneypot/.test(fs.readFileSync(path.join(EXT, '../workday-engine/src/workday/controls.ts'), 'utf8')), true);

/* ── Submit is pressed once ── */
console.log('\nWorkday Review: Submit is not pressed again while the page lingers');
const guard = (st) => run('const WD_SUBMIT_SETTLE_MS = 20000;\n' + body(enh, 'wdSubmitJustPressed') + '\nthis.f = wdSubmitJustPressed;', {
  submitAttempted: () => st.at != null, submitAttemptAge: () => (st.at == null ? Infinity : st.at),
  workdayAuthErrorText: () => st.auth || '', wdPageErrors: () => !!st.errors,
}).f();
eq('never pressed: free to press', guard({}), false);
eq('pressed 4s ago, no error: wait', guard({ at: 4000 }), true);
eq('pressed 19s ago, no error: still wait', guard({ at: 19000 }), true);
eq('pressed 21s ago with no confirmation: may press again', guard({ at: 21000 }), false);
eq('Workday shows an error: may press again at once', guard({ at: 2000, errors: true }), false);
const sa = enh.slice(enh.indexOf('// A finished, quiet step SpeedyApply did not move on'), enh.indexOf('// A finished, quiet step SpeedyApply did not move on') + 1200);
eq('SpeedyApply loop: checked before its Submit press', /\/submit\/i\.test\(n\.textContent \|\| ''\) && wdSubmitJustPressed\(\)\) \{ await sleep\(400\); continue; \}[\s\S]*realClick\(n\)/.test(sa), true);
const oc = enh.slice(enh.indexOf("LOG('Workday one-click: Review — pressing Submit');"), enh.indexOf("LOG('Workday one-click: Review — pressing Submit');") + 800);
eq('one-click Autofill: waits out the lingering Review before another pass', /!wdSubmitJustPressed\(\), WD_SUBMIT_SETTLE_MS \+ 1000/.test(oc), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
