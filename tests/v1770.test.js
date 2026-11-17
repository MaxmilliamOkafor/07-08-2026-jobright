/* v17.70 — lessons from the LazyApply Workday logs:
   • Workday's post-submit pages (/jobTasks/completed/application, and the
     careers home with ?Job_Application_ID=…) are proof of a submission.
   • "Duplicate language entries are not allowed": each language once.
   • "You can't add duplicate website URLs": each address once.
   • "Must end after start date": an end date before the start is left out.

   Usage: node tests/v1770.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const enh = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
function fnIn(src, name) {
  const m = new RegExp('^  (async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('missing ' + name);
  let j = src.indexOf('{', m.index), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1); }
  throw new Error('unbalanced ' + name);
}
const lineIn = (src, name) => { const m = src.match(new RegExp('  const ' + name + ' = [^\\n]*\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };

console.log('Workday submitted pages count as success');
{
  const wd = new Function(`${lineIn(enh, 'WD_SUBMITTED_URL_RE')}${fnIn(enh, 'wdSubmittedUrl')}\nreturn wdSubmittedUrl;`)();
  ok(wd('https://acme.wd5.myworkdayjobs.com/en-US/External/jobTasks/completed/application'), '/jobTasks/completed/application');
  ok(wd('https://acme.wd1.myworkdayjobs.com/en-US/Careers?Job_Application_ID=8f3a2c11d0e94b7a'), '?Job_Application_ID=<hex> on the careers home');
  ok(wd('https://wd3.myworkdaysite.com/recruiting/acme/Ext/jobTasks/completed/application'), 'myworkdaysite host');
  ok(!wd('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Dublin/Engineer_R123/apply'), 'the apply form is not');
  ok(!wd('https://evil.example.com/x?Job_Application_ID=abc123&u=myworkdayjobs.com'), 'another site is not');
  ok(/if \(wdSubmittedUrl\(location\.href\)\) return true;/.test(fnIn(enh, 'hardSuccessSignal')), 'hardSuccessSignal checks it first');
}

console.log('Workday engine: languages, websites, dates');
{
  const uniqueBy = new Function(fnIn(eng, 'uniqueBy') + '\nreturn uniqueBy;')();
  const langs = [{ language: 'English' }, { language: 'French' }, { language: 'english ' }, { language: '' }].filter((l) => l && l.language);
  const lu = uniqueBy(langs, (l) => l.language.trim().toLowerCase());
  ok(lu.length === 2 && lu[0].language === 'English' && lu[1].language === 'French', 'English twice → once, order kept');
  const key = (u) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[/#?]+$/, '');
  const su = uniqueBy(['https://github.com/me', 'http://www.github.com/me/', 'https://me.dev'], key);
  ok(su.length === 2 && su[1] === 'https://me.dev', 'the same address with/without www, https, trailing / → once');

  const work = fnIn(eng, 'fillWork');
  ok(/endBeforeStart = !!\(w\.start && w\.end && w\.end < w\.start\)/.test(work), 'fillWork compares end with start');
  ok(/if \(!w\.current && w\.end && !endBeforeStart\)/.test(work), 'an end before the start is not typed');
  ok('2021-03' < '2022-01' && !('2023-05' < '2021-03'), 'YYYY-MM strings compare in date order');
  ok(/const langList = uniqueBy\(/.test(eng) && /ensureBlockCount\(ctx, langs, "langF", langList\.length\)/.test(eng), 'language blocks sized to the de-duplicated list');
  ok(/const sites = uniqueBy\(/.test(eng), 'website blocks use the de-duplicated list');

  const ts = fs.readFileSync(path.resolve(__dirname, '../workday-engine/src/workday/steps.ts'), 'utf8');
  ok(/export function uniqueBy/.test(ts) && /endBeforeStart/.test(ts) && /const langList = uniqueBy/.test(ts), 'the TypeScript source has the same fixes');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
