/* v17.63 — the five jobs v17.62 left unfixed in the 9 Nov 22:24 log:
   Phenom "School or University*", OpenText State after Country, TeamTailor
   "Standorte" checkboxes, the iCIMS profile password, and Oracle's emailed PIN
   with no mailbox connected. DOM behaviour is checked in Chromium by
   tests/e2e/dom-1763.js.

   Usage: node tests/v1763.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const src = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
function fn(name) {
  const m = new RegExp('^  (async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('missing ' + name);
  let j = src.indexOf('{', m.index), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1); }
  throw new Error('unbalanced ' + name);
}
const rxOf = (name) => { const m = src.match(new RegExp('const ' + name + ' = (/.+/[a-z]*);')); if (!m) throw new Error('missing ' + name); return eval(m[1]); };

console.log('TeamTailor: a checkbox is never a location box');
{
  ok(/if \(el\.tagName === 'INPUT' && \/\^\(checkbox\|radio\)\$\/i\.test\(el\.type \|\| ''\)\) return false;/.test(fn('isLocationField')), 'isLocationField turns down checkboxes and radios');
  ok(/:not\(\[type=checkbox\]\):not\(\[type=radio\]\)/.test(fn('resolveLocationFields')), 'the location pass never lists them');
  ok(/\^\(checkbox\|radio\)\$\/i\.test\(el\.type \|\| ''\)\) return false;/.test(fn('nativeSet')), 'nativeSet never rewrites what a checkbox submits');
}

console.log('Phenom: search-and-pick boxes');
{
  const HINT = rxOf('PICK_LIST_HINT_RE'), OTHER = rxOf('PICK_OTHER_RE'), SUBJ = rxOf('PICK_LIST_SUBJECT_RE');
  ok(HINT.test('School or University*Please select "Other" from the list if no results are found'), 'Adobe\'s hint is recognised');
  ok(HINT.test('Select one from the list'), '"Select one from the list"');
  ok(!HINT.test('First name') && !HINT.test('Please select'), 'plain labels are not');
  ok(OTHER.test('Other') && OTHER.test('Other (not listed)') && OTHER.test('Not listed'), '"Other" entries are recognised');
  ok(!OTHER.test('Otherton University') && !OTHER.test('Imperial College London'), '…a school whose name starts "Other…" is not');
  ok(SUBJ.test('School or University') && SUBJ.test('Field of study') && !SUBJ.test('City'), 'school-type subjects');
  const g = fn('guaranteeRequiredFieldsPass');
  ok(/if \(isPickListField\(el\)\) \{\s*if \(await commitPickList\(el, pickListValue\(el, lbl, p\)\)\) fixed\+\+;\s*continue;/.test(g), 'the guarantor picks from the list instead of typing');
  const c = fn('commitPickList');
  ok(/wdBestIndex\(texts, wanted, 0\.8\)/.test(c), 'only a suggestion that IS your school is clicked');
  ok(/pickListSearch\(el, 'Other'\)/.test(c) && /\\bother\\b\/i\.test/.test(c), 'the list\'s "Other" only when the form asks for it');
  ok(/if \(n > 2\) return false;/.test(c), 'twice per box at most');
  ok(/nativeSet\(el, ''\)/.test(c) && /field\.unanswered/.test(c), 'no match: the box is left clear and the question named');
  ok(!/items\[0\]/.test(c), 'never the first suggestion because nothing matched');
  const v = fn('pickListValue');
  ok(/list\.find\(s => wdSimilarity\(typed, s\) >= 0\.85\)/.test(v) && /list\[i\]/.test(v), 'each school box gets its own school');
  ok(/isWorkday\(\)/.test(fn('isPickListField')), 'Workday keeps its own school code');
}

console.log('OpenText: a list that fills after another answer');
{
  const g = fn('guaranteeRequiredFieldsPass');
  ok(/await waitUntil\(\(\) => selectOptions\(el\)\.some\(o => o\.value && o\.index > 0 && \(o\.text \|\| ''\)\.trim\(\)\), 4000, 200\);/.test(g), 'waits up to 4s for State to get its choices');
  ok(/if \(!opt && opts\.length === 1\) opt = opts\[0\];/.test(g) && !/if \(!opt\) opt = opts\[0\];/.test(g), 'still never guesses the first of several');
}

console.log('iCIMS: the account password on the application');
{
  const g = fn('guaranteeRequiredFieldsPass');
  ok(/if \(el\.type === 'password'\) \{\s*if \(await fillProfilePassword\(el\)\) fixed\+\+;\s*continue;/.test(g), 'required password boxes are handled');
  const f = fn('fillProfilePassword');
  ok(/pastTheApplyStep\(\) \|\| hasApplicationForm\(\)/.test(f), 'only on the application itself');
  ok(/String\(el\.value \|\| ''\)\) return false;/.test(f), 'a box already holding something is left alone');
  ok(/await getAppPassword\(\)/.test(f) && !/['"][A-Za-z0-9!@#$%^&*]{8,}['"]/.test(f.replace(/'[^']*(password|ATS|change|blur)[^']*'/g, '')), 'your saved ATS password, none written in the code');
  ok(/markAccountCreated\(location\.hostname\)/.test(f), 'the account is recorded so the next job signs in');
}

console.log('Oracle: emailed code with no mailbox stops at once');
{
  const r = fn('resolveEmailVerification__impl');
  ok(/reading codes from Gmail is off — tick "Read codes from my signed-in Gmail"/.test(r) && /_authSkip = true;/.test(r), 'no mailbox: skipped now, with what to switch on');
  ok(/Gmail is not signed in in this browser — sign in to Gmail in Chrome/.test(r), 'Gmail signed out: skipped now, with the reason');
  ok(/if \(!_authDeadEnd\)/.test(r), 'an earlier reason is not overwritten');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
