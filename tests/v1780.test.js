/* v17.80 — lessons from AIHawk's site notes (feder-cr/Jobs_Applier_AI_Agent, MIT):
   closed postings checked before a tab opens, each ATS's own confirmation and
   closed-posting signs, two id-only honeypots, the CV parser's decoy upload box,
   Paylocity's "fill out application with my resume", Workday's "Sign in with
   email" screen and its code sender.

   Usage: node tests/v1780.test.js "<extension dir>" */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = process.argv[2];
const src = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const orch = fs.readFileSync(path.join(EXT, 'ua-orchestrator.js'), 'utf8');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const constOf = (code, name) => new Function('return ' + code.match(new RegExp('const ' + name + ' = (\\/[^\\n]*\\/[a-z]*);'))[1])();
const body = (code, name) => {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l));
  if (start < 0) throw new Error('no ' + name);
  const end = lines.findIndex((l, i) => i > start && l === '  }');
  return lines.slice(start, end + 1).join('\n');
};

/* ── the worker's closed-posting check ── */
const sandbox = { console: { log() {}, warn() {} }, setTimeout, clearTimeout, URL, JSON, Promise, AbortController, Map, Set, Object, Array, String, Number };
sandbox.self = sandbox;
// Only the check itself is run: everything from its header to fillSlots.
const liveSrc = orch.slice(orch.indexOf('  const LIVE = {'), orch.indexOf('  self.__uaPostingCheck = postingCheck;'));
vm.createContext(sandbox);
vm.runInContext(liveSrc + '\nself.check = postingCheck; self.classify = liveClassify; self.plan = livePlan;', sandbox);
const { check, classify, plan } = sandbox;

console.log('which request answers for which site');
eq('Workday: the JSON the page reads', plan('https://acme.wd1.myworkdayjobs.com/en-US/External/job/London/Engineer_R100/apply'),
  ['workday', 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/London/Engineer_R100']);
eq('…without a locale too', plan('https://acme.wd5.myworkdayjobs.com/Careers/job/NY/Eng_R1')[1], 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/NY/Eng_R1');
eq('BambooHR: the job\'s own JSON', plan('https://nylon.bamboohr.com/careers/27'), ['bamboohr', 'https://nylon.bamboohr.com/careers/27/detail']);
eq('Lever / Greenhouse / Ashby / Workable / Paylocity: the posting itself',
  ['https://jobs.lever.co/a/1/apply', 'https://job-boards.greenhouse.io/a/jobs/1', 'https://jobs.ashbyhq.com/a/1', 'https://apply.workable.com/a/j/1', 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/1'].map((u) => plan(u)[0]),
  ['lever', 'greenhouse', 'ashby', 'workable', 'paylocity']);
eq('any other site: no request at all', [plan('https://careers-acme.icims.com/jobs/1'), plan('https://example.com/jobs/1'), plan('mailto:x@y.z')], [null, null, null]);

console.log('\nwhat each answer says (only a clear sign is "closed")');
eq('Lever 404 → closed; 200 → open; 500 → unclear', [classify('lever', 404, 'https://jobs.lever.co/a/1'), classify('lever', 200, ''), classify('lever', 500, '')], ['closed', 'open', 'unclear']);
eq('Ashby 404 with the board page "Jobs" → closed; another 404 → unclear',
  [classify('ashby', 404, '', '<title>Jobs</title>'), classify('ashby', 404, '', '<title>Not Found</title>')], ['closed', 'unclear']);
eq('Greenhouse redirect to ?error=true → closed', classify('greenhouse', 200, 'https://job-boards.greenhouse.io/acme?error=true', ''), 'closed');
eq('…a page still holding its template placeholder → unclear (the API is asked)', classify('greenhouse', 200, 'https://job-boards.greenhouse.io/acme/jobs/1', '{{page_title}}'), 'unclear');
eq('Workable /oops → closed', classify('workable', 200, 'https://apply.workable.com/oops', ''), 'closed');
eq('BambooHR 404, or back on the job list → closed; JSON with the job → open',
  [classify('bamboohr', 404, '', ''), classify('bamboohr', 200, 'https://nylon.bamboohr.com/careers', ''), classify('bamboohr', 200, 'https://nylon.bamboohr.com/careers/27/detail', '{"result":{"jobOpening":{}}}')], ['closed', 'closed', 'open']);
eq('Paylocity JobNotFound → closed', classify('paylocity', 200, 'https://recruiting.paylocity.com/Recruiting/Jobs/JobNotFound', ''), 'closed');
eq('Workday 403 S22 → closed; 200 with jobPostingInfo → open; another 403 → unclear',
  [classify('workday', 403, '', '{"errorCode":"S22"}'), classify('workday', 200, '', '{"jobPostingInfo":{}}'), classify('workday', 403, '', '{"errorCode":"S99"}')], ['closed', 'open', 'unclear']);

(async () => {
  console.log('\nthe check end to end, against a fake network');
  const fake = (routes) => async (url) => { const r = routes[url]; if (!r) throw new Error('no route ' + url); if (r === 'hang') return new Promise(() => {}); return { status: r.status, url: r.url || url, text: async () => r.text || '' }; };
  let r = await check('https://jobs.lever.co/acme/1/apply', fake({ 'https://jobs.lever.co/acme/1/apply': { status: 404 } }));
  eq('a closed Lever posting → closed, with the reason', [r.state, r.why], ['closed', 'Lever answers 404 for it']);
  r = await check('https://job-boards.greenhouse.io/acme/jobs/42', fake({
    'https://job-boards.greenhouse.io/acme/jobs/42': { status: 200, text: '{{page_title}}' },
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs/42': { status: 404 } }));
  eq('Greenhouse unclear on the page → its public API answers 404 → closed', [r.state, /API/.test(r.why)], ['closed', true]);
  r = await check('https://jobs.lever.co/acme/2', fake({}));
  eq('a request that fails → unclear (the job is opened as before)', r.state, 'unclear');
  let asked = false;
  r = await check('https://example.com/jobs/1', async () => { asked = true; return { status: 404, url: '', text: async () => '' }; });
  eq('an unknown site is never asked', [r.state, asked], ['unclear', false]);
  const t0 = Date.now();
  r = await check('https://jobs.lever.co/acme/3', fake({ 'https://jobs.lever.co/acme/3': 'hang' }));
  eq('a site that never answers → unclear within ~8s', [r.state, Date.now() - t0 < 9500], ['unclear', true]);
  eq('no cookies are sent with the check', /credentials: 'omit'/.test(liveSrc), true);

  console.log('\nthe Queue Manager skips a closed posting before opening a tab for it');
  const fill = orch.slice(orch.indexOf('async function fillSlots'), orch.indexOf('async function maybeFinish'));
  eq('the batch is checked at once, before any tab opens, unless switched off',
    /if \(toOpen\.length && cfg\.livenessCheck !== false\) \{\n        const verdicts = await Promise\.all\(toOpen\.map/.test(fill) && fill.indexOf('postingCheck(') < fill.indexOf('openRunTab('), true);
  eq('…a closed one is marked skipped with the reason, and its slot goes to the next job',
    /j\.status = 'skipped';\n              j\.error = 'Posting closed — '/.test(fill) && /_refill = true;/.test(fill), true);
  eq('the single-tab runner asks the worker before it goes to the next job',
    /const v = await askPostingCheck\(n\.url\);\n          if \(v && v\.state === 'closed'/.test(src) && /msg\.type !== 'UA_POSTING_CHECK'/.test(orch), true);

  console.log('\nconfirmation pages');
  const OK = constOf(src, 'SUCCESS_TEXT_RE');
  for (const t of ['Your application was successfully submitted. We\'ll contact you if there are next steps!',   // Ashby
    'Application Submitted', 'Fertig! Danke für deine Bewerbung!', 'Gracias por la solicitud', 'Hemos recibido tu solicitud',
    'Merci pour votre candidature', 'Bedankt voor je sollicitatie', 'Your application has been submitted successfully. Good luck!'])
    eq(`"${t.slice(0, 48)}" is a confirmation`, OK.test(t), true);
  for (const t of ['Please complete all required fields', 'Your application is incomplete', 'Success!'])   // Lever's "Success!" is the CV upload
    eq(`"${t}" is not`, OK.test(t), false);
  const PATH = constOf(src, 'SUCCESS_PATH_RE');
  eq('Recruitee\'s …/applied and Breezy\'s …/apply/submitted are confirmation addresses', ['/o/data-engineer/c/applied', '/p/123/apply/submitted'].every((p) => PATH.test(p)), true);
  const LEVER = constOf(src, 'LEVER_APP_ID_RE');
  eq('Lever sending you to the company\'s site with LeverAppId=… is a received application',
    LEVER.test('https://www.acme.com/careers/thanks?LeverAppId=8f3a9c2e-1b2d-4e5f-9a8b-7c6d5e4f3a2b') && !LEVER.test('https://jobs.lever.co/acme/1/apply'), true);
  eq('…and counts without a matching sentence on that page', /if \(LEVER_APP_ID_RE\.test\(location\.href\)\) return true;/.test(body(src, 'hardSuccessSignal')), true);

  console.log('\nclosed postings, once the page is open');
  const GONE_URL = constOf(src, 'JOB_GONE_URL_RE'), GONE_TXT = constOf(src, 'JOB_GONE_TEXT2_RE');
  eq('Greenhouse ?error=true, Workable /oops, Paylocity JobNotFound', ['https://job-boards.greenhouse.io/acme?error=true', 'https://apply.workable.com/oops', 'https://recruiting.paylocity.com/Recruiting/Jobs/JobNotFound'].every((u) => GONE_URL.test(u)), true);
  eq('…but not an open posting', ['https://job-boards.greenhouse.io/acme/jobs/1', 'https://apply.workable.com/acme/j/1'].some((u) => GONE_URL.test(u)), false);
  eq('Lever\'s "Sorry, we couldn\'t find anything here"', GONE_TXT.test("Sorry, we couldn't find anything here"), true);

  console.log('\nhoneypots known by id');
  const TRAP = constOf(src, 'TRAP_FIELD_RE');
  eq('Workday\'s beecatcher and BambooHR\'s nickname_hpcsaf are never filled', [TRAP.test('website beecatcher'), TRAP.test('nickname_hpcsaf')], [true, true]);
  eq('…a real website or nickname field is', [TRAP.test('website websiteUrl'), TRAP.test('nickname preferredName')], [false, false]);

  console.log('\nthe CV goes into the CV field, not the parser\'s box');
  const PARSER = constOf(src, 'RESUME_PARSER_RE');
  eq('"Autofill from resume", "Autofill application", "Import resume from" are parser boxes',
    ['Autofill from resume Upload your resume here to autofill key application fields.', 'Autofill application', 'Import resume from'].every((t) => PARSER.test(t)), true);
  eq('"Resume/CV", "Attach resume" and "Upload your CV" are not', ['Resume/CV', 'Attach resume', 'Upload your CV'].some((t) => PARSER.test(t)), false);
  eq('with a real CV field present the parser box is left out (and alone it still counts)',
    /if \(found\.length > 1\) \{\n      const real = found\.filter\(\(el\) => !isResumeParserInput\(el\)\);\n      if \(real\.length\) return real;/.test(body(src, 'resumeFileInputs')), true);
  const OPT = constOf(src, 'RESUME_PARSE_OPTION_RE');
  eq('Paylocity\'s "Fill out application with my resume" is unticked before filling',
    OPT.test('useAttachedResumeToFillOutApplication') && OPT.test('Fill out application with my resume') && /untickResumeParseOption\(\);/.test(body(src, 'fallbackFill__impl')), true);

  console.log('\nWorkday');
  eq('the "Sign in with email" screen is the account step', /\|\| !!wdEmailSignInButton\(\)/.test(body(src, 'workdayOnAccountWall')), true);
  eq('…its email form is opened (never Google or LinkedIn), at most every 2.5s, not while the engine drives',
    /\[data-automation-id="SignInWithEmailButton"\]/.test(src) && /Date\.now\(\) - _wdEmailSignInAt > 2500/.test(body(src, 'wdOpenEmailSignIn')) && /__uaWdEngine\.busy\(\)\) return true;/.test(body(src, 'wdOpenEmailSignIn')), true);
  eq('…from the account step and from the account watcher',
    /if \(!pwFields\.length && wdOpenEmailSignIn\(\)\) return 'working';/.test(body(src, 'fillWorkdayCreateAccount')) && /if \(!pwFields\.length\) \{ wdOpenEmailSignIn\(\); return; \}/.test(src), true);
  eq('verification codes are looked for from myworkday.com, Workday\'s own sender', /if \(isWorkday\(\)\) hosts\.push\('myworkday\.com'\);/.test(src), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
