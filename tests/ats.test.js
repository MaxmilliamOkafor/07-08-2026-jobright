/* Two things decide whether a queued job survives on a new ATS:
     1. detection — does the URL route to the right driver, or fall through to the
        generic path (which is how myjobs.adp.com links used to stall)?
     2. the dialog answer policy — a native  Remove "…_CV"?  confirm blocks the
        page's JS thread, and answering it the wrong way deletes the résumé.
   Both are pure logic lifted straight out of the shipped files, so both can be
   tested here without a browser.

   Usage: node tests/ats.test.js "<ua-enhancement.js>" "<ua-page-hooks.js>" */
const fs = require('fs');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const enhSrc = fs.readFileSync(process.argv[2], 'utf8');
const hooksSrc = fs.readFileSync(process.argv[3], 'utf8');

/* ── 1. ATS detection ─────────────────────────────────────────────────────── */
// Rebuild the ATS table and the isX() predicates from the shipped source so the
// test can never drift from what actually runs.
function grabBlock(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error('missing marker: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  if (b < 0) throw new Error('missing end marker: ' + endMarker);
  return src.slice(a, b + endMarker.length);
}
const atsTable = grabBlock(enhSrc, '  const ATS = [', '\n  ];');
const predicates = ['isSmartRecruiters', 'isOracleCloud', 'isTaleo', 'isAdpMyJobs', 'isAdpAny']
  .map((n) => {
    const lines = enhSrc.split('\n');
    const i = lines.findIndex((l) => l.includes('function ' + n + '('));
    if (i < 0) throw new Error('missing predicate: ' + n);
    let end = i;
    while (end < lines.length && !/^\s*\}\s*$/.test(lines[end]) && !lines[end].trimEnd().endsWith('}')) end++;
    return lines.slice(i, end + 1).join('\n');
  }).join('\n');

const ctx = {};
new Function('exports', 'location', `
  ${atsTable}
  ${predicates}
  function detectATS() { for (const a of ATS) if (a.p.test(location.href)) return a.n; return null; }
  Object.assign(exports, { ATS, detectATS, isSmartRecruiters, isOracleCloud, isTaleo, isAdpMyJobs, isAdpAny });
`)(ctx, { get href() { return CURRENT.href; }, get hostname() { return CURRENT.hostname; }, get pathname() { return CURRENT.pathname; } });

let CURRENT = {};
const at = (href) => { const u = new URL(href); CURRENT = { href, hostname: u.hostname, pathname: u.pathname }; };

console.log('ATS detection');
at('https://myjobs.adp.com/acmecareers/cx/job-listing/12345');
eq('myjobs.adp.com → ADP myjobs driver', [ctx.isAdpMyJobs(), ctx.detectATS()], [true, 'ADP myjobs']);
eq('myjobs.adp.com is not routed to Oracle/Taleo', [ctx.isOracleCloud(), ctx.isTaleo()], [false, false]);

at('https://eabc.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/9876/apply/email');
eq('oraclecloud → Oracle driver', [ctx.isOracleCloud(), ctx.detectATS()], [true, 'Oracle Recruiting']);
eq('oraclecloud is NOT treated as classic Taleo', ctx.isTaleo(), false);

at('https://careers.example.com/hcmUI/CandidateExperience/en/sites/CX/requisitions');
eq('white-labelled Oracle path detected off oraclecloud.com', ctx.isOracleCloud(), true);

at('https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=12345');
eq('taleo.net → Taleo', [ctx.isTaleo(), ctx.detectATS()], [true, 'Taleo']);
at('https://jobs.example.com/careersection/2/jobdetail.ftl');
eq('careersection path → Taleo off taleo.net', ctx.isTaleo(), true);

at('https://jobs.smartrecruiters.com/Acme/744000012345-engineer');
eq('smartrecruiters → SmartRecruiters', [ctx.isSmartRecruiters(), ctx.detectATS()], [true, 'SmartRecruiters']);

at('https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Dublin/Engineer_R-1');
eq('workday still detected', ctx.detectATS(), 'Workday');
at('https://boards.greenhouse.io/acme/jobs/4321');
eq('greenhouse still detected', ctx.detectATS(), 'Greenhouse');
at('https://jobs.lever.co/acme/abc-123');
eq('lever still detected', ctx.detectATS(), 'Lever');

at('https://performancemanager.successfactors.eu/sfcareer/jobreqcareer?jobId=1');
eq('successfactors detected', ctx.detectATS(), 'SuccessFactors');
at('https://career5.sapsf.eu/careers?company=acme');
eq('sapsf (SuccessFactors alias) detected', ctx.detectATS(), 'SuccessFactors');
at('https://acme.talentbrew.com/job/dublin-engineer-1');
eq('radancy/talentbrew detected', ctx.detectATS(), 'Radancy');
at('https://join.com/companies/acme/1234-engineer');
eq('join.com detected', ctx.detectATS(), 'Join');
at('https://acme.softgarden.io/job/123456');
eq('softgarden detected', ctx.detectATS(), 'Softgarden');
at('https://job-boards.greenhouse.io/acme/jobs/999');
eq('new greenhouse job-boards host detected', ctx.detectATS(), 'Greenhouse EU');

/* ── 2. native dialog answer policy ───────────────────────────────────────── */
// The exact regex the MAIN-world hook uses, pulled from the shipped file.
const m = hooksSrc.match(/const DESTRUCTIVE_RE\s*=\s*([\s\S]*?);\n/);
if (!m) throw new Error('DESTRUCTIVE_RE not found in ua-page-hooks.js');
const DESTRUCTIVE_RE = new Function('return ' + m[1].trim())();
// answer === what window.confirm will return while automating
const answer = (msg) => !DESTRUCTIVE_RE.test(String(msg).trim());

console.log('native confirm() answer policy');
eq('the exact prompt that froze the run is declined', answer('Remove "Maxmilliam_Okafor_CV"?'), false);
eq('remove attachment declined', answer('Remove this attachment?'), false);
eq('delete resume declined', answer('Delete your resume?'), false);
eq('discard changes declined', answer('Discard your changes?'), false);
eq('withdraw application declined', answer('Withdraw application?'), false);
eq('are-you-sure-delete declined', answer('Are you sure you want to delete this file?'), false);
eq('clear form declined', answer('Clear all answers?'), false);
eq('submit accepted', answer('Submit your application?'), true);
eq('continue accepted', answer('Are you sure you want to continue?'), true);
eq('leave-page style accepted', answer('Your application will be sent. Proceed?'), true);
eq('empty message accepted', answer(''), true);

/* ── 3. destructive-control guard ─────────────────────────────────────────── */
const dm = enhSrc.match(/const DESTRUCTIVE_NAME_RE\s*=\s*([\s\S]*?);\n/);
if (!dm) throw new Error('DESTRUCTIVE_NAME_RE not found in ua-enhancement.js');
const NAME_RE = new Function('return ' + dm[1].trim())();

console.log('destructive-control name guard');
for (const [name, want] of [
  ['Remove', true], ['Remove file', true], ['Delete resume', true], ['Discard', true],
  ['Remove Maxmilliam_Okafor_CV', true], ['Withdraw my application', true],
  ['Replace resume', true], ['Detach', true],
  ['Submit application', false], ['Next', false], ['Continue', false],
  ['Cancel', false],           // dialog Cancel must stay clickable
  ['Save and Continue', false], ['Upload resume', false], ['Apply', false],
]) eq(`"${name}" → ${want ? 'blocked' : 'allowed'}`, NAME_RE.test(name), want);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
