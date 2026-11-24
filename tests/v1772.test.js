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
function locLib() {
  const lines = src.split('\n');
  const a = lines.findIndex((l) => l.startsWith('  const LOC_COUNTRY_ALIASES = {'));
  const b = lines.findIndex((l, i) => i > a && l === '  };');
  const eu = lines.find((l) => l.startsWith('  const LOC_EU = '));
  return lines.slice(a, b + 1).join('\n') + '\n' + eu + '\n' + body('locatedInAnswer');
}
const make = (profile) => {
  const x = {};
  new Function('exports', 'profile', `${reLines}
    const DEFAULTS = { years: '7', country: 'Ireland' }; const _policyProfile = profile;
    ${body('yearsAnswer')}${body('knockoutPolicy')}${body('workAuthorisationAnswer')}${body('workAuthOptionIndex')}
    ${locLib()}
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

console.log('v17.74 — lessons from LazyApply\'s 17 Nov log');
{
  const CARRIER = 'Do you now work or have you ever worked at or for Carrier or any of its subsidiaries?';
  ok(d(CARRIER) === 'no', 'Carrier "now work or ever worked at or for" → No (was Yes)');
  ok(d('Have you ever worked for Thales before?') === 'no' && d('Are you currently a Zendesk Employee?') === 'no', 'Thales / Zendesk → No');
  const mine = make({ work_experience: [{ company: 'Accenture' }, { company: 'Carrier Global' }] });
  ok(mine(CARRIER) === 'yes', '…Yes when Carrier is in your work history');
  ok(mine('Have you ever worked at Accenture?') === 'yes' && mine('Have you ever worked at Deloitte?') === 'no', 'checked against every employer, not just the current one');
  ok(d('Have you ever worked for this company?') === 'no', '"this company" is still No');

  for (const [file, label] of [[src, 'ua-enhancement'], [eng, 'Workday engine']]) {
    const lines = file.split('\n');
    const pick = (re) => { const i = lines.findIndex((l) => re.test(l)); return lines[i]; };
    const fnStart = lines.findIndex((l) => /^  function irishCountyFor\(/.test(l));
    const fnEnd = lines.findIndex((l, i) => i > fnStart && l === '  }');
    const cf = fnStart > 0 && new Function(pick(/^  const IE_SAME_NAME_COUNTIES = /) + pick(/^  const IE_DUBLIN_TOWNS = /) + lines.slice(fnStart, fnEnd + 1).join('\n') + '\nreturn irishCountyFor;')();
    ok(cf && cf('Ireland', 'Lucan') === 'Dublin' && cf('IE', 'Dublin 15') === 'Dublin' && cf('Ireland', 'Cork') === 'Cork' && cf('Ireland', 'Galway') === 'Galway', label + ': Lucan / Dublin 15 → Dublin, Cork, Galway');
    ok(cf && cf('Ireland', 'Athlone') === '' && cf('United Kingdom', 'Dublin') === '', label + ': unknown town or not Ireland → nothing guessed');
  }
  ok(/irishCountyFor\(p\.country \|\| DEFAULTS\.country, p\.city, p\.address_line_2\)/.test(src), 'your profile gets the county only when it has none');
  ok(/region: pick\(s, "state", "region", "province", "county"\) \|\| irishCountyFor\(/.test(eng), 'the Workday engine too');
}

console.log('v17.75 — six Yes answers from LazyApply\'s 23 Nov log that are No for you');
{
  const NO = [
    'Did someone within Axis recommend this job to you?',
    'Have you been referred to us by an employee of a government agency or state-owned entity?',
    'Are you aware of any ongoing negotiations, tenders, RFPs, or other procurements involving Marsh businesses and your current employer?',
    '5. Within the past 5 years, were you a CIO/Deputy CIO; CISO/Deputy CISO within any of the countries above?',
    '3. Within the past 5 years, were you in an Officer or Cabinet-level officer or above position, or a Senate/House Member within any of the countries above?',
    'Are you located in US?',
  ];
  for (const q of NO) ok(d(q) === 'no', 'No: ' + q.slice(0, 80));
  ok(make({ referrer: 'Jane Smith' })('Did someone within Axis recommend this job to you?') === 'yes', '…a referrer in your profile makes the referral question Yes');
  ok(make({ work_experience: [{ title: 'Deputy CISO', company: 'X' }] })(NO[3]) === 'yes', '…a CISO title in your work history makes that one Yes');
  ok(d('Are you located in Ireland?') === 'yes' && d('Are you based in the EU?') === 'yes' && d('Are you located in Europe?') === 'yes', 'your own country / EU / Europe → Yes');
  ok(d('Are you located in the United Kingdom?') === 'no' && d('Are you based in Canada?') === 'no', 'another country → No');
  ok(make({ country: 'United States' })('Are you located in US?') === 'yes', '…US is Yes for a US profile');
  ok(/locatedInAnswer\(l\) \|\| packKnockoutNo\(l\)/.test(src), 'the Workday engine gets these through the knockout hook');
}

console.log(`  v17.72-75: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
