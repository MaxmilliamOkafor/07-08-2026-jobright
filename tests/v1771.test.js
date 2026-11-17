/* v17.71
   • "Do you currently reside in the United States?" → Yes, and the same for
     every European country, the UK and Canada.
   • Workday My Experience: an entry Workday's CV parser pre-filled with another
     job (a second "Meta", From 01/2023 To 12/2022 → "Must end after start
     date") is re-filled from the profile; work fields overwrite what the parser
     typed; a date already right is not retyped.

   Usage: node tests/v1771.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const ua = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const wd = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
function fn(src, name) {
  const m = new RegExp('^  (async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('missing ' + name);
  let j = src.indexOf('{', m.index), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1); }
  throw new Error('unbalanced ' + name);
}
const line = (src, name) => { const m = src.match(new RegExp('  const ' + name + ' = [^\\n]*\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };

console.log('Reside in …');
{
  const lib = new Function(`let _policyProfile = {};
    ${line(ua, 'EMBARGO_RE')}${line(ua, 'RESIDE_IN_RE')}${line(ua, 'RESIDE_YES_PLACE_RE')}${fn(ua, 'packKnockoutNo')}
    return { packKnockoutNo };`)();
  const yes = (q) => lib.packKnockoutNo(q.toLowerCase()) === 'yes';
  ok(yes('Do you currently reside in the United States?'), 'United States → Yes');
  ok(yes('Do you currently reside in the US?'), 'US → Yes');
  ok(yes('Are you currently living in the United Kingdom?'), 'UK → Yes');
  ok(yes('Are you based in Canada?'), 'Canada → Yes');
  ok(yes('Do you live in Germany?') && yes('Are you located in Switzerland?') && yes('Do you reside in Ukraine?'), 'European countries → Yes');
  ok(yes('Are you currently based in the EU?'), 'the EU → Yes');
  ok(!yes('Do you currently reside in Australia?'), 'Australia → left to the other rules');
  ok(!yes('Are you willing to relocate to the United States?'), 'relocation is not a residence question');
  ok(!yes('Will you require visa sponsorship to work in the US?'), 'sponsorship is not a residence question');
  ok(lib.packKnockoutNo('are you a citizen or resident of cuba, iran or syria?') === 'no', 'export-control question still No');
}

console.log('Workday experience');
{
  const lib = new Function(`${fn(wd, 'same')}${fn(wd, 'sameDate')}
    let page = {};
    const field = (k) => (k in page ? k : null), containerOf = (x) => x, readValue = (c) => page[c] ?? '';
    const dateContainer = (b, which) => which + 'Date', dateValue = (c) => page[c] ?? '', isVisible = () => true;
    ${fn(wd, 'workMatches')}
    return { same, sameDate, workMatches, set: (p) => { page = p; } };`)();
  ok(lib.sameDate('2022-08', '2022-08') && lib.sameDate('2022-8', '2022-08') && lib.sameDate('2022-08-01', '2022-08'), 'same month in any spelling');
  ok(!lib.sameDate('2023-01', '2022-08') && !lib.sameDate('', '2022-08'), 'a different or empty date is not');
  const solim = { title: 'Software Engineer', company: 'SolimHealth', start: '2022-08', end: '2022-12', current: false };
  lib.set({ jobTitleF: 'Senior Software Engineer', companyF: 'Meta', startDate: '2023-01', endDate: '2022-12' });
  ok(!lib.workMatches({}, solim), 'entry 2 pre-filled with Meta / 01-2023 → re-filled');
  lib.set({ jobTitleF: 'Software Engineer', companyF: 'SolimHealth', startDate: '2023-01', endDate: '2022-12' });
  ok(!lib.workMatches({}, solim), 'right company but start after end → re-filled');
  lib.set({ jobTitleF: 'software engineer', companyF: 'SolimHealth', startDate: '2022-8', endDate: '2022-12' });
  ok(lib.workMatches({}, solim), 'matching entry is left alone');
  lib.set({ jobTitleF: 'Senior Software Engineer', companyF: 'Meta', startDate: '2023-01', endDate: '' });
  ok(lib.workMatches({}, { title: 'Senior Software Engineer', company: 'Meta', start: '2023-01', current: true }), 'current role: no end date needed');
  const fw = fn(wd, 'fillWork');
  ok(/fill\(ctx, "jobTitleF", w\.title, block, true\)/.test(fw) && /fill\(ctx, "companyF", w\.company, block, true\)/.test(fw), 'title and company overwrite the CV parser');
  ok(/!sameDate\(dateValue\(start\), w\.start\) && !await setDate\(start/.test(fw), 'a start date already right is not retyped');
  ok(/workMatches\(bs\[i\], items\[i\]\)/.test(fn(wd, 'verifyBlocks')), 'the check after filling compares each entry with your profile');
  ok(/if \(hooks\.keepExisting\?\.\(\) && keep && !\(force && !touched\.has\(c\)\)\) return true;/.test(fn(wd, 'fill')), 'keep-existing never keeps a parser value in a work entry');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
