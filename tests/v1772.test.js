/* v17.72 — two Workday questions answered Yes that are No for you (23 Nov):
   • "Do you hold an ADDITIONAL citizenship, nationality, or permanent residency
     of any other country that is NOT Iran, Cuba, Syria, or North Korea?"
   • "Will you now or could you in the future require sponsorship to obtain work
     authorization or to transfer or extend your current visa? (You must answer
     "Yes" if your current visa is tied to your spouse or partner's visa …)"
   The Workday engine now asks our rules first for such questions, and reads
   "I don't need sponsorship" in the profile as not needing it.

   Usage: node tests/v1772.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const src = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
function body(name) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '[(]').test(l));
  if (start < 0) throw new Error('missing ' + name);
  const end = lines.findIndex((l, i) => i > start && l === '  }');
  return lines.slice(start, end + 1).join('\n');
}
const reLines = (src.match(/^  const [A-Z][A-Z0-9_]*_RE = \/.*\/[a-z]*;$/gm) || []).join('\n  ');
const make = (profile) => {
  const x = {};
  new Function('exports', 'profile', `${reLines}
    const DEFAULTS = { years: '7' }; const _policyProfile = profile;
    ${body('yearsAnswer')}${body('knockoutPolicy')}${body('workAuthorisationAnswer')}${body('workAuthOptionIndex')}
    ${body('additionalCitizenshipAnswer')}${body('packKnockoutNo')}${body('determineYesNo')}
    exports.d = (q) => determineYesNo(q.toLowerCase());`)(x, profile);
  return x.d;
};
const d = make({});
const ADDL = 'Do you hold an ADDITIONAL citizenship, nationality, or permanent residency of any other country that is NOT Iran, Cuba, Syria, or North Korea?';
const SPON = 'Will you now or could you in the future require sponsorship to obtain work authorization or to transfer or extend your current visa? (You must answer “Yes” if your current visa is tied to your spouse or partner’s visa or if you are on a bridging visa or working holiday visa)';

console.log('The two questions');
ok(d(ADDL) === 'no', 'additional citizenship (not Iran/Cuba/…) → No');
ok(d(SPON) === 'no', 'sponsorship with "(You must answer Yes if …)" → No');
ok(d('Do you have dual citizenship?') === 'no' && d('Are you a citizen of more than one country?') === 'no', 'dual / more than one country → No');
ok(make({ second_nationality: 'Nigeria' })(ADDL) === 'yes', '…Yes when your profile names a second nationality');
ok(d('Are you legally authorized to work in Ireland?') === 'yes', 'right to work is still Yes');
ok(d('Are you a citizen, national or permanent resident of Cuba, Iran, North Korea or Syria?') === 'no', 'export control still No');

console.log('The Workday engine asks our rules first');
ok(/window\.__uaWdKnockout = \(label\) => \{/.test(src) && /if \(isManualAnswer\(label, null\)\) return null;/.test(src.slice(src.indexOf('window.__uaWdKnockout'))), 'host hook, leaving hand-typed answers alone');
const ra = eng.slice(eng.indexOf('async function resolveAnswer('));
ok(ra.indexOf('hooks.knockout') > 0 && ra.indexOf('hooks.knockout') < ra.indexOf('getAnswerBank()'), 'resolveAnswer: knockout before the saved answers (and the AI)');
ok(/knockout: \(label\) => \{\s*try \{ return typeof W\.__uaWdKnockout === "function"/.test(eng), 'installHooks wires it');

console.log('"needs sponsorship" read from your profile');
const m = eng.match(/needsSponsorship: (\/require\|need\|yes\/\.test\(visa\) && !\/[^\n]*\/\.test\(visa\)),/);
ok(!!m, 'rule found');
const needs = m && new Function('visa', 'return ' + m[1]);
for (const v of ["i don't need sponsorship", 'no visa required', 'authorised to work, no sponsorship required', 'not required', 'stamp 4 - no sponsorship needed'])
  ok(needs && !needs(v), 'not needed: ' + v);
for (const v of ['will require sponsorship', 'yes', 'need visa sponsorship'])
  ok(needs && needs(v), 'needed: ' + v);

console.log('v17.73 — no sponsorship needed in any country');
{
  for (const q of ['Will you now or in the future require visa sponsorship to work in the United States?',
    'Do you require sponsorship to work in Canada?', 'Will you need a work permit to work in Australia?'])
    ok(d(q) === 'no', 'No: ' + q);
  for (const q of ['Are you legally authorized to work in the United States?', 'Do you have the right to work in Singapore?'])
    ok(d(q) === 'yes', 'Yes: ' + q);
  ok(/\[Q\.sponsorship, \(\) => "No"\],\s*\n\s*\[Q\.authorized, \(\) => "Yes"\],/.test(eng), 'Workday engine: sponsorship No, authorised Yes, for every country');
  const m2 = /function isAuthorizedFor\(countryId\) \{[\s\S]*?\n  \}/.exec(src);
  ok(!!m2 && /return true;\s*\}$/.test(m2[0]) && !/return false/.test(m2[0]), 'the Work Authorization picker counts every country as authorised');
}

console.log(`  v17.72/73: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
