/* v17.65 — fixes from the 11 Nov 14:46 log (80 jobs):
   • SuccessFactors job pages (Capgemini): the site's job-search and job-alert
     boxes were taken for the application form, so "Apply now" was never pressed.
   • A verification-code wall with Gmail reading off: the "allow?" prompt waited
     120s in a background tab nobody could see, and the job ran to its time limit
     instead of stopping with the reason.
   The background-tab clock and loopback channel are in tests/keepalive.test.js.

   Usage: node tests/v1765.test.js "<ext dir>" */
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

console.log('SuccessFactors: job search and job alerts are not the application');
{
  const L = rxOf('JOB_SEARCH_LABEL_RE'), A = rxOf('JOB_SEARCH_ATTR_RE');
  for (const t of ['Search by Keyword', 'Search by Location', 'Select how often (in days) to receive an alert:', 'Keywords', 'Job alerts'])
    ok(L.test(t), 'search/alert label: ' + t);
  for (const t of ['First Name', 'Email', 'Legal Last Name *', 'What is your notice period?', 'Where are you based?', 'How did you hear about us?', 'Phone Number:*', 'Have you been employed by Capgemini Group before?'])
    ok(!L.test(t), 'application label is kept: ' + t);
  for (const t of ['keywordsearch-q', 'locationsearch-q', 'q', 'jobAlertFrequency', 'alert_freq'])
    ok(A.test(t), 'search/alert name or id: ' + t);
  for (const t of ['firstName', 'email', 'question_123', 'job_application[answers][0]', 'request_search_consent'])
    ok(!A.test(t), 'application name or id is kept: ' + t);
  ok(/filter\(\(el\) => isVisible\(el\) && !isJobSearchWidget\(el\)\)/.test(fn('hasApplicationForm')), 'hasApplicationForm leaves those boxes out');
  ok(/\[role=search\]/.test(fn('isJobSearchWidget')), 'anything inside role=search is a search box');
}

console.log('Verification-code wall with no mailbox: skip now, with the reason');
{
  const impl = fn('resolveEmailVerification__impl');
  ok(/if \(!offered && document\.visibilityState === 'visible'\)/.test(impl), 'the Gmail question is asked only in a tab you can see');
  ok(/reading codes from Gmail is off[^`]*`; _authSkip = true;/.test(impl), 'otherwise the job is skipped with the reason');
  ok(/function jobDeadEnded\(\) \{ return !!\(_authDeadEnd && _authSkip\); \}/.test(src), 'jobDeadEnded() helper');
  ok(/resolveEmailVerification\(90000\);\s*\/\/[^\n]*\n\s*if \(jobDeadEnded\(\)\) \{ LOG\('Multi-page: stopping/.test(fn('multiPageLoop')), 'the page loop stops at once');
  ok(/await handleAccountAuth\(\);\s*if \(jobDeadEnded\(\)\) \{ LOG\('Not filling: '/.test(fn('dispatchATSAutomation')), 'no filling after a sign-in dead end');
  ok(/resolveEmailVerification\(120000\);\s*if \(jobDeadEnded\(\)\) return;/.test(fn('oracleEmailAndPin')), 'Oracle\'s PIN loop stops too');
}

console.log('v17.66 — Workday start date: two weeks from the day you apply');
{
  const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');
  const m = /function startDateInTwoWeeks\(now = new Date\(\)\) \{[\s\S]*?\n  \}/.exec(eng);
  ok(!!m, 'engine has startDateInTwoWeeks');
  const f = m && new Function(m[0] + '\nreturn startDateInTwoWeeks;')();
  ok(f && f(new Date(2026, 10, 12)) === '2026-11-26', '12 Nov 2026 → 2026-11-26');
  ok(f && f(new Date(2026, 11, 25)) === '2027-01-08', 'across the year end: 25 Dec 2026 → 2027-01-08');
  ok(/\[Q\.startDate, \(_l, c, _o, kind\) => kind === "date" \? startDateInTwoWeeks\(\)/.test(eng), 'a Workday start-date box gets that date');
  ok(/myworkdayjobs[^\n]*location\.hostname\)\) return todayForField\(el, 14\)/.test(fn('availableDateFor')), 'the built-in flow uses 14 days on Workday too');
  ok(/"date":\s*\n?\s*return setDate\(container, answer\)|case "date":\s*return setDate\(container, answer\);/.test(eng), 'date answers go through the Workday date setter');
}

console.log('v17.66 — a placeholder email another tool typed is replaced with yours');
{
  const isPh = new Function(fn('isPlaceholderEmail') + '\nreturn isPlaceholderEmail;')();
  for (const v of ['default@lazyapply.com', 'DEFAULT@LAZYAPPLY.COM', 'anyone@lazyapply.com', 'john@example.com', 'your.email@gmail.com'])
    ok(isPh(v), 'placeholder: ' + v);
  for (const v of ['maxokafordev@gmail.com', 'max.okafor@outlook.com', 'm@lazyapplyfan.io', 'defaulter@gmail.com', ''])
    ok(!isPh(v), 'real (or empty) kept: ' + JSON.stringify(v));
  ok(/\(!\(emailField\.value \|\| ''\)\.trim\(\) \|\| isPlaceholderEmail\(emailField\.value\)\)/.test(fn('handleAccountAuth__impl')), 'create-account: a placeholder in the email box is overwritten');
  ok(/isPlaceholderEmail\(e\)\) e = ''/.test(fn('getAppEmail')), 'a placeholder is never used as your account email');
  ok(/await replacePlaceholderEmails\(\);/.test(fn('fallbackFill__impl')), 'the fill pass swaps placeholder emails for yours');
}

console.log('v17.67 — a yes/no question about a location is not a place search (Stripe)');
{
  const q = new Function(fn('isYesNoLocationQuestion') + '\nreturn isYesNoLocationQuestion;')();
  for (const t of ['Are you authorized to work in the location(s) you selected in your previous response?*',
    'Will you require Stripe to sponsor you for a work permit now or in the future for the location(s) you selected in your previous response?',
    'If this role offers the option to work from a remote location, do you plan to work remotely?',
    'Are you currently living in London or willing to move to London?', 'Do you live within commuting distance of our Dublin office?'])
    ok(q(t), 'question, not a place: ' + t.slice(0, 70));
  for (const t of ['Location (City)*', 'City', 'Current location', 'Where are you based?', 'Which city do you live in?',
    'Please select the country where you currently reside.', 'Preferred work location for this position:*'])
    ok(!q(t), 'still a place: ' + t);
  ok(/if \(isYesNoLocationQuestion\(/.test(fn('isLocationField')), 'isLocationField turns those questions down');
}

console.log(`  v17.65/66/67: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
