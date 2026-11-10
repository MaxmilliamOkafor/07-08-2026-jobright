/* v17.62 — fixes from the two 9 Nov debug logs (13:01 and 22:24).
   Shipped functions are lifted out of the source and run; the DOM-dependent
   ones are checked in Chromium by tests/e2e/dom-1762.js.

   Usage: node tests/v1762.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const src = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n); } };
function fn(s, name) {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let j = s.indexOf('{', i), depth = 0;
  for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
const rxOf = (name) => { const m = src.match(new RegExp('const ' + name + ' = (/.+/[a-z]*);')); if (!m) throw new Error('missing ' + name); return eval(m[1]); };

console.log('a question is the field\'s own text, never the section\'s');
{
  const g = fn(src, 'getFullQuestionText');
  ok(/if \(holdsOtherFields\(p, el\)\) continue;/.test(g), 'a container holding other fields is passed over');
  ok(/visibleTextOf\(p\)/.test(g) && !/p\.textContent/.test(g), 'script/style text is never part of a question');
  ok(/script,style,noscript,template/.test(fn(src, 'visibleTextOf')), 'visibleTextOf drops script, style, noscript, template');
  const h = fn(src, 'holdsOtherFields');
  ok(/t === 'radio' \|\| t === 'checkbox'\) return false/.test(h), 'choice groups keep their container as the question');
  ok(/if \(others > 1\) return true;/.test(h) && /return plain > 0;/.test(h), 'two other boxes, or one plain text box, means a section');
}

console.log('label rules');
{
  const open = eval('(' + fn(src, 'looksLikeOpenQuestion') + ')');
  ok(open('What are you most proud of building? This could be personal or professional'), 'the Ashby essay is an open question');
  ok(open('Describe a project you led'), '"Describe…" is an open question');
  ok(!open('Apartment, suite, unit, building, floor, etc.'), 'an address-line-2 label is not');
  ok(!open('Address Line 2'), '"Address Line 2" is not');
  const gv = fn(src, 'guessValue');
  ok(/\\b\(apt\|suite\|unit\|apartment\|floor\|building\)\\b\/\.test\(l\)\) && !looksLikeOpenQuestion\(label\)\) return p\.address_line_2/.test(gv), 'address line 2 needs whole words and is never a question');
  ok(!/\|apt\|suite\|unit\|apartment\|floor\|building\/\.test\(l\)\) return/.test(gv), 'the bare-substring rule is gone');
  // the rules themselves, as shipped
  const rule = (re) => { const m = gv.match(re); if (!m) throw new Error('rule missing ' + re); return m[0]; };
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const townRx = eval(rule(/\/\^town\$\|[^\n]*?\/(?=\.test\(l\)\) return p\.city)/));
  ok(townRx.test(norm('Town *')) && townRx.test(norm('Town or City')) && !townRx.test(norm('Downtown office preference')), 'Town → your city');
  ok(/\\bcounty\\b\/\.test\(l\) && !\/country\/\.test\(l\)\) return p\.county \|\| p\.state/.test(gv), 'County → your county, else state');
  const zipRx = eval(rule(/\/zip\|postal\|post \?code\|\\beircode\\b\//));
  ok(zipRx.test(norm('Postcode *')) && zipRx.test(norm('Post Code')) && zipRx.test(norm('Eircode')) && zipRx.test(norm('ZIP')), 'Postcode / Post Code / Eircode → your postal code');
  const joinRx = eval(rule(/\/earliest \(possible \)\?\(date\|time\|day\)[^\n]*?\/(?=\.test\(l\)\) return p\.notice_period)/));
  ok(joinRx.test(norm('Earliest date you could join e.g. Immediately, 1 month , 3 months')), 'Workable\'s "Earliest date you could join" → your notice period');
  ok(joinRx.test(norm('When can you start?')) && joinRx.test(norm('How soon could you join us?')), '…and its common wordings');
  ok(!joinRx.test(norm('Start date of your last role')), '…but not an employment-history date');
}

console.log('dead ends say what they are');
{
  const LOGIN = rxOf('LOGIN_REFUSED_RE'), TAKEN = rxOf('EMAIL_TAKEN_RE'), TC = rxOf('TALENT_COMMUNITY_RE');
  ok(LOGIN.test('The email or password you entered is incorrect.'), 'CV-Library\'s refusal');
  ok(LOGIN.test('Invalid credentials') && LOGIN.test('Incorrect password') && LOGIN.test('Username or password is invalid'), 'common refusals');
  ok(!LOGIN.test('Enter your email and password to continue') && !LOGIN.test('Forgotten your password?'), 'a plain login page is not a refusal');
  ok(TAKEN.test('This email address is already taken.'), 'Welcome to the Jungle\'s "already taken"');
  ok(TAKEN.test('An account with this email already exists') && TAKEN.test('Email already registered'), 'common wordings');
  ok(!TAKEN.test('Enter your email address'), 'a plain sign-up page is not "taken"');
  ok(TC.test('Join Our Talent Community') && TC.test('Join the Talent Network'), 'talent-community headings');
  ok(!TC.test('Senior Engineer — join our team'), 'a job title is not one');
  const pd = fn(src, 'pageDeadEnd');
  ok(/if \(pw && !isWorkday\(\)\)/.test(pd), 'login checks only with a password box on screen, and never on Workday (it has its own)');
  ok(/u200b/.test(fn(src, 'talentCommunityPage')), 'zero-width characters in the heading are ignored (BCG)');
  ok((src.match(/const de = pageDeadEnd\(\); if \(de\) \{ _authDeadEnd = de; _authSkip = true;/g) || []).length === 2, 'both run loops stop on a dead end, as skipped with the reason');
  ok(/!_authDeadEnd && !confirmSubmitted\(\)\) \{ const de = pageDeadEnd\(\)/.test(src), 'never after a confirmed submit');
  const sf = fn(src, 'submitFailureReason');
  ok(/remainingErrorSummary\(\) \|\| formSummaryError\(\)/.test(sf), 'Ashby\'s "Missing entry for required field" reaches the reason');
  ok(/!submitAttempted\(\) && !hasApplicationForm\(\)\) return 'No application form was found on the page/.test(sf), 'a page with no form is not reported as "Form filled"');
  const m = 'Your form needs corrections\nMissing entry for required field: What causes the highest emissions?\nFull name'.match(/missing entry for required field:?\s*([^\n]{2,140})/i);
  ok(m && m[1] === 'What causes the highest emissions?', 'the missing question is named');
}

console.log('a search button is never the application\'s Submit');
{
  const NOT = rxOf('NOT_APPLICATION_SUBMIT_RE');
  for (const t of ['Search Jobs', 'Search', 'Stellen suchen', 'Rechercher', 'Create Alert', 'Subscribe', 'Sign In', 'Log in'])
    ok(NOT.test(t), '"' + t + '" is left alone');
  for (const t of ['Submit', 'Submit Application', 'Send application', 'Bewerbung absenden', 'Postuler'])
    ok(!NOT.test(t), '"' + t + '" is still pressed');
  ok(/if \(submitEnabled\(btn\) && notAnApplicationSubmit\(btn\)\) \{[^\n]*continue; \}\n\s*if \(submitEnabled\(btn\)\) \{ LOG\('Clicking submit:', sel\)/.test(src), 'the selector path checks before pressing');
  ok(/role="search"/.test(fn(src, 'notAnApplicationSubmit')), 'a button inside a search form is never pressed');
}

console.log('the per-job time limit survives page reloads');
{
  let now = 1000000, frozen = 0;
  const jobTimeLeft = new Function('qTimeout', 'frozenSince', 'Date', fn(src, 'jobTimeLeft') + '\nreturn jobTimeLeft;')(180000, () => frozen, { now: () => now });
  ok(jobTimeLeft(now) === 180000, 'a fresh job gets the whole limit');
  ok(jobTimeLeft(now - 100000) === 80000, 'a job 100s old gets the 80s left, not a fresh 180s');
  ok(jobTimeLeft(now - 8498000) === 1000, 'a job long past its limit fires at once');
  frozen = 60000;
  ok(jobTimeLeft(now - 100000) === 140000, 'time the tab was frozen is given back');
  ok((src.match(/setTimeout\(onJobTimeout, jobTimeLeft\(jobStart\)\)/g) || []).length === 1 && /tId = setTimeout\(onTimeout, jobTimeLeft\(jobStart\)\)/.test(src), 'both run paths arm the time left');
  ok(!/setTimeout\(onJobTimeout, qTimeout\)/.test(src) && !/setTimeout\(onTimeout, qTimeout\)/.test(src), 'no path arms a fresh full limit any more');
}

console.log('an Apply button that only opens a menu (EY / SuccessFactors)');
{
  ok(/if \(location\.href === hrefBefore && !hasApplicationForm\(\) && !findApplyManually\(\)\) \{\s*const target = applyLinkBehind\(btn\);/.test(src), 'followed only when the click changed nothing');
  const a = fn(src, 'applyLinkBehind');
  ok(/if \(!isMenu\) return '';/.test(a), 'only for a control that is a menu toggle');
  ok(/u\.hostname !== location\.hostname\) return ''/.test(a), 'same site only');
  ok(/linkedin\|indeed\|facebook\|google/.test(a), 'never an "apply with LinkedIn" option');
}

console.log('SmartRecruiters: the town is searched the way a person would');
{
  const q = new Function('DEFAULTS', 'locationQuery', fn(src, 'srLocationQueries') + '\nreturn srLocationQueries;')({ country: 'United Kingdom' }, () => 'fallback');
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(q({ city: 'Dublin', state: 'Dublin', country: 'Ireland' }), ['Dublin', 'Dublin, Ireland']), '"Dublin, Dublin" is never searched: ' + JSON.stringify(q({ city: 'Dublin', state: 'Dublin', country: 'Ireland' })));
  ok(eq(q({ city: 'Manchester', state: 'England', country: 'United Kingdom' }), ['Manchester, England', 'Manchester', 'Manchester, United Kingdom']), 'city+region first when they differ');
  ok(eq(q({}), ['fallback']), 'no city: whatever location the profile has');
  ok(/for \(const cand of queries\)/.test(fn(src, 'srLocation')), 'each wording is tried until one has suggestions');
  ok(/return !!opt;/.test(fn(src, 'srWaitLocationOption')), 'the "enter manually" row alone does not end the wait');
}

console.log('Workday: a current role on a site with no "I currently work here" box');
{
  const thisMonth = eval('(' + fn(eng, 'thisMonth') + ')');
  ok(/^\d{4}-\d{2}$/.test(thisMonth()), 'thisMonth() is YYYY-MM: ' + thisMonth());
  const mc = fn(eng, 'markCurrentRole');
  ok(/if \(!box\) \{[\s\S]{0,700}!readValue\(end0\)[\s\S]{0,200}setDate\(end0, thisMonth\(\)\)/.test(mc), 'most recent role with no end date gets To = this month');
  ok(/\} else if \(w\.current && !cur\) \{[\s\S]{0,300}setDate\(end, thisMonth\(\)\)/.test(fn(eng, 'fillWork')), 'a role marked current gets To = this month');
  ok(/if \(!w\.current && w\.end\) \{/.test(fn(eng, 'fillWork')), 'a past role still gets its own end date');
}

console.log('a dropdown nothing matches is left for you, never given the first option');
{
  ok(!/if \(!opt\) opt = opts\[0\];/.test(src), 'required-field pass: no first-option fallback');
  ok(/if \(!opt && opts\.length === 1\) opt = opts\[0\];/.test(src), '…a single-choice list is still taken');
  ok(!/setSelectValue\(sel, opts\[0\]\.value\); filled\+\+;\n      \}\n    \}/.test(src) || /if \(opts\.length === 1\) \{ setSelectValue\(sel, opts\[0\]\.value\); filled\+\+; \}/.test(src), 'fallback fill: only a single-choice list');
  ok(/if \(!pick && required && real\.length === 1\) pick = real\[0\];/.test(src) && !/if \(!pick && required\) pick = real\[0\];/.test(src), 'custom dropdowns: only a single-choice list');
  ok(!/\|\| opts\[0\];\n      pick\.click\(\);/.test(src), 'chat questions: no first-choice click');
  ok(/kind: 'no-matching-option'/.test(src), 'the unanswered dropdown is recorded for the Debugger');
  const Q = rxOf('PRIOR_TIE_Q_RE'), O = rxOf('NO_PRIOR_TIE_OPTION_RE');
  ok(Q.test('What is your current status with Open Text?*'), 'OpenText\'s status question is recognised');
  ok(Q.test('Have you ever worked for Acme?') && Q.test('Are you a current or former employee of Acme?'), '…and its common wordings');
  ok(!Q.test('What is your current salary?') && !Q.test('Country'), 'other questions are not');
  ok(O.test('I have never worked for OpenText') && O.test('Not a current or former employee') && O.test('External candidate') && O.test('No'), 'the truthful "no tie" options');
  ok(!O.test('I am a contractor at OpenText (Through Third Party)') && !O.test('I am a current employee') && !O.test('Former employee'), 'never an option that claims a tie');
  const lw = fn(src, 'labelWords');
  ok(/select,textarea,script,style,noscript,template/.test(lw), 'a label\'s words leave out the dropdown it wraps');
  ok((fn(src, 'getLabel').match(/labelWords\(lbl\)/g) || []).length === 2, 'getLabel uses it for label[for] and the container label');
  ok(/script,style,noscript,template,select/.test(fn(src, 'visibleTextOf')), 'question text leaves out a dropdown\'s option list');
}

console.log('your known answer is not on the list → the list\'s own "Other"');
{
  const OTHER = rxOf('OTHER_OPTION_RE');
  const mk = (known) => new Function('guessFieldValue', 'OTHER_OPTION_RE', fn(src, 'otherOptionFor') + '\nreturn otherOptionFor;')(() => known, OTHER);
  const opts = ['Poland', 'Ukraine', 'Ireland', 'Germany', 'Other'].map((t) => ({ text: t, value: t }));
  ok((mk('United Kingdom')(opts, 'country where you reside', {}, null) || {}).text === 'Other', 'a country that is not listed → Other (was "Poland", the first option)');
  ok(mk('')(opts, 'x', {}, null) === null, 'no known answer → nothing is picked');
  ok(mk('Yes')(opts, 'x', {}, null) === null, 'a yes/no is not a reason to pick Other');
  ok(mk('United Kingdom')(opts.slice(0, 4), 'x', {}, null) === null, 'no "Other" on the list → nothing is picked');
  ok(OTHER.test('Other (please specify)') && OTHER.test('None of the above') && !OTHER.test('Other European Union country') && !OTHER.test('Another employer'), 'only an explicit Other');
  const gv = fn(src, 'guessValue');
  const hearRx = eval(gv.match(/\/hear\.\?about\.\*position\|referral\.\?source\|[^\n]*?\/(?=\.test\(l\)\) return p\.how_heard)/)[0]);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  ok(hearRx.test(norm('Where did you hear about this job? *')) && hearRx.test(norm('How did you hear about us?')) && hearRx.test(norm('How did you find out about this role?')), '"Where did you hear about this job?" is answered by rule, not by luck');
}

console.log(`  v17.62: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
