/* v17.68 — from the MaintainX (Autodesk) application on Ashby, 14 Nov:
   • "What is your current age?" left blank → your age group (Under 30).
   • "Where are you located?*" never filled ("located" was not a location word),
     and Dublin, Ireland must win over the four US Dublins.
   • "Are you currently interviewing … at Autodesk?" → No (your answer).

   Usage: node tests/v1768.test.js "<ext dir>" */
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
const line = (name) => { const m = src.match(new RegExp('  const ' + name + ' = [^\\n]*\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };

console.log('Age group');
{
  const lib = new Function(`const DEFAULTS = { ageUnder: 30 };
    ${line('AGE_Q_RE')}${fn('ageRangeOf')}${fn('ageOptionIndex')}
    return { AGE_Q_RE, ageOptionIndex };`)();
  const ashby = ['Under 30', '30-39', '40-49', '50-59', '60 or older', 'I prefer not to answer'];
  ok(lib.AGE_Q_RE.test('what is your current age?'), '"What is your current age?" is an age question');
  ok(lib.AGE_Q_RE.test('AGE: What is your age group?') && lib.AGE_Q_RE.test('Age range'), 'age group / range too');
  ok(!lib.AGE_Q_RE.test('language') && !lib.AGE_Q_RE.test('agency') && !lib.AGE_Q_RE.test('manage a team'), '"language", "agency", "manage" are not');
  ok(ashby[lib.ageOptionIndex(ashby, {})] === 'Under 30', 'Ashby list → "Under 30"');
  ok(['18-29', '30-44', '45+'][lib.ageOptionIndex(['18-29', '30-44', '45+'], {})] === '18-29', '"18-29" → picked');
  ok(lib.ageOptionIndex(['18-24', '25-29', '30-39', 'Prefer not to say'], {}) === -1, '"18-24" vs "25-29": not enough to know → left to the decline rule');
  ok(lib.ageOptionIndex(['Under 18', '18-24', '25-34'], {}) === -1, 'a 25-34 bucket crosses 30 → not picked');
  ok(['18-24', '25-29', '30-39'][lib.ageOptionIndex(['18-24', '25-29', '30-39'], { date_of_birth: '2000-03-01' })] === '25-29', 'a date of birth in the profile gives the exact bucket');
  ok(/if \(AGE_Q_RE\.test\(ql\)/.test(fn('pillChoice')), 'pillChoice asks the age rule before declining');
}

console.log('"Where are you located?"');
{
  ok(/where\.\*\(live\|based\|located\|reside\)/.test(fn('isLocationField')), 'isLocationField: "located" is a place question');
  ok(/where\.\*\(you\|do you\)\.\*\(live\|located\|reside\|based\)/.test(fn('guessValue')), 'guessValue answers it with your city');
  const pick = new Function('NOT_A_PLACE_RE', fn('pickPlaceSuggestion') + '\nreturn pickPlaceSuggestion;')(/university|college|street|road/i);
  const items = (a) => a.map((t) => ({ textContent: t }));
  const opts = ['Dublin, Ohio, United States', 'Dublin, California, United States', 'Dublin, Ireland', 'Dublin, Georgia, United States'];
  ok(pick(items(opts), 'Dublin, Dublin, Ireland').textContent === 'Dublin, Ireland', 'Dublin, Ireland wins even listed third');
  ok(pick(items(['Dublin, Leinster', 'Dublin, Ohio, United States']), 'Dublin, Ireland').textContent === 'Dublin, Leinster', 'a region name is not another country');
  ok(pick(items(['London, Ontario, Canada', 'London, England, United Kingdom']), 'London, United Kingdom').textContent === 'London, England, United Kingdom', 'London UK over London, Ontario');
}

console.log('"Are you currently interviewing … at Autodesk?" → No');
{
  const d = fn('determineYesNo');
  const rx = d.match(/if \((\/\\b\(currently[^\n]*?\/)\.test\(q\)\) return 'no';/);
  ok(!!rx, 'determineYesNo has the rule');
  const R = rx && eval(rx[1]);
  ok(R && R.test('are you currently interviewing or actively being considered for a role at autodesk?'), 'Autodesk\'s wording');
  ok(R && R.test('are you already in the interview process for another position with us?'), '"already in the interview process"');
  ok(R && !R.test('are you currently authorized to work in canada?') && !R.test('would you be interested in other roles?'), 'other questions untouched');
}

console.log(`  v17.68: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
