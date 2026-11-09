/* v17.61 — fixes for the failures in the 9 Nov debug log.
   Lifts the shipped functions out of ua-enhancement.js / ua-wd-engine.js and
   runs them, plus source checks on where they are used.

   Usage: node tests/failures-1109.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const src = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n); } };

// The text of `function name(...) { ... }` in s, braces balanced.
function fn(s, name) {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let j = s.indexOf('{', i), depth = 0;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return s.slice(i, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
const constLine = (s, name) => { const m = s.match(new RegExp('(?:const|var) ' + name + ' = [^\\n]+')); if (!m) throw new Error('missing ' + name); return m[0]; };

/* ── 1. removed postings ── */
console.log('a posting that was taken down is skipped at once, with that reason');
{
  const JOB_GONE_RE = eval('(' + constLine(src, 'JOB_GONE_RE').replace(/^const JOB_GONE_RE = /, '').replace(/;$/, '') + ')');
  const JOB_GONE_RX = eval('(' + constLine(eng, 'JOB_GONE_RX').replace(/^var JOB_GONE_RX = /, '').replace(/;$/, '') + ')');
  const gone = [
    "The page you are looking for doesn't exist.",          // relx.wd3, 9 Nov
    'Die Seite, die Sie suchen, ist nicht vorhanden.',      // ista.wd3 (de-DE), 9 Nov
    'The page you’re looking for does not exist',
    "La page que vous recherchez n'existe pas.",
    'La página que busca no existe.',
    'De pagina die u zoekt, bestaat niet.',
  ];
  for (const t of gone) {
    ok(JOB_GONE_RE.test(t), 'content script knows: ' + t);
    ok(JOB_GONE_RX.test(t), 'Workday engine knows: ' + t);
  }
  const live = [
    'Senior MLOps Engineer\nLondon Wall\nApply\nJob description… We are looking for an engineer who does not exist yet in our team',
    'Search for Jobs\nIntroduce Yourself\nMy Information\nFirst Name',
    'Page 2 of 5 — My Experience',
  ];
  for (const t of live) ok(!JOB_GONE_RE.test(t) && !JOB_GONE_RX.test(t), 'a live page is not "gone": ' + t.slice(0, 40));

  ok(/function pageJobGone\(\)[\s\S]{0,200}JOB_GONE_RE\.test[\s\S]{0,120}!hasApplicationForm\(\)/.test(src), 'never "gone" while an application form is on the page');
  ok(/FAILURE_TEXT_RE\.test\([\s\S]{0,90}\) \|\| pageJobGone\(\)/.test(fn(src, 'pageHasFailure')), 'the failure check includes a removed posting');
  ok(fn(src, 'unwinnableReason').includes('if (pageJobGone()) return JOB_GONE_REASON;'), 'triage skips a removed posting before any wait');
  ok(/r\.page === 'jobGone' \|\| pageJobGone\(\)[\s\S]{0,140}return 'closed';/.test(fn(src, 'workdayEngineOutcome')), 'engine result on a removed posting ends the job, not the built-in flow');
  ok((src.match(/failureSkipReason\(\)/g) || []).length >= 3, 'both skip paths give the specific reason');
  const dp = fn(eng, 'detectPage');
  ok(/JOB_GONE_RX\.test\(body\) && !anyAid\("progressActive"\) && !qa\('\[data-automation-id\^="formField-"\]'\)\.some\(isVisible\)\) return "jobGone"/.test(dp), 'the engine recognises the page');
  ok(dp.indexOf('"jobGone"') < dp.indexOf('"applyMethod"'), '…before it would try Apply Manually');
  ok(/case "jobGone":\s*throw new Error\("The job no longer exists — the posting was taken down"\)/.test(eng), 'the engine stops with the reason');
}

/* ── 2. the cover-letter opener only goes on a letter ── */
console.log('a name, link, email or phone is never given the cover-letter opener');
{
  const looksLikeLetterText = eval('(' + fn(src, 'looksLikeLetterText') + ')');
  const input = (type) => ({ tagName: 'INPUT', type });
  const letter = 'I am excited to apply for this role. My background and experience align closely with the requirements, and I am confident I can deliver.';
  ok(!looksLikeLetterText('Maxmilliam', input('text')), 'first name');
  ok(!looksLikeLetterText('Okafor', input('text')), 'last name');
  ok(!looksLikeLetterText('https://www.linkedin.com/in/maxokafor/', input('text')), 'LinkedIn URL');
  ok(!looksLikeLetterText('max.test@example.com', input('text')), 'email in a text box');
  ok(!looksLikeLetterText('+44 7700 900123', input('text')), 'phone in a text box');
  ok(!looksLikeLetterText(letter, input('tel')), 'anything in a tel box');
  ok(!looksLikeLetterText(letter, input('email')), 'anything in an email box');
  ok(!looksLikeLetterText('London, United Kingdom', input('text')), 'a one-line value');
  ok(looksLikeLetterText(letter, { tagName: 'TEXTAREA' }), 'a real letter in a textarea is still tailored');
  ok(looksLikeLetterText(letter, input('text')), 'a real letter in a text box is still tailored');
  ok(/COVER_FIELD_RE\.test\(q\) && \(isFreeTextControl\(el\) \|\| \(el && el\.tagName === 'TEXTAREA'\)\) && looksLikeLetterText\(v, el\)/.test(fn(src, 'refineAnswerForControl')),
    'the tailoring step checks it');
}

/* ── 3. unlabelled field named by its own error ── */
console.log('a box with no label is named by its error message (Gem)');
{
  const labelFromErrorText = eval('(' + fn(src, 'labelFromErrorText') + ')');
  const cases = [
    ['Please enter a first name.', 'first name'],
    ['Please enter a last name.', 'last name'],
    ['Please enter a valid phone number.', 'phone number'],
    ['Please enter a location.', 'location'],
    ['Please enter your email address', 'email address'],
    ['Enter a valid email', 'email'],
    ['Please select an option.', ''],
    ['Please enter a valid answer.', ''],
    ['Please enter your salary expectations', ''],
    ['This field is required.', ''],
    ['', ''],
  ];
  for (const [m, want] of cases) ok(labelFromErrorText(m) === want, JSON.stringify(m) + ' → ' + JSON.stringify(want) + ' (got ' + JSON.stringify(labelFromErrorText(m)) + ')');
  ok(fn(src, 'fixFieldError').includes("const label = item.label || getLabel(el) || labelFromErrorText(message) || '';"),
    'the field-error fixer uses it only when the box has no label');
}

/* ── 4. an honest reason when Fully Automated stands down ── */
console.log('Fully Automated standing down for another tool says so');
{
  ok(/if \(autoStopped\(\)\) standDown = \(window\.__uaAutoReason/.test(src) && src.includes("'Left alone — ' + standDown"),
    'the reason names why it left the page alone');
  ok(src.includes("'Fully Automated pass ended without a confirmed submit'"), 'other passes keep the old reason');
}

console.log(`  failures-1109: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
