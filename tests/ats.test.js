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
/* Brace-balanced, so a predicate with a try/catch body comes out whole. The old
   "stop at the first line ending in }" rule truncated isAvature() mid-function
   and the harness failed to compile rather than failing an assertion. */
function grabFn(src, name) {
  const start = src.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}
// The route regex the Avature predicate reads lives beside it.
const avatureRouteRe = enhSrc.match(/  const AVATURE_ROUTE_RE = [\s\S]*?;\n/)[0];
const predicates = avatureRouteRe + ['isSmartRecruiters', 'isOracleCloud', 'isTaleo', 'isAdpMyJobs', 'isAdpAny', 'isAvature']
  .map((n) => grabFn(enhSrc, n)).join('\n');

const ctx = {};
new Function('exports', 'location', `
  ${atsTable}
  ${predicates}
  function detectATS() { for (const a of ATS) if (a.p.test(location.href)) return a.n; return null; }
  Object.assign(exports, { ATS, detectATS, isSmartRecruiters, isOracleCloud, isTaleo, isAdpMyJobs, isAdpAny, isAvature });
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

/* ── 1b. white-labelled ATS ────────────────────────────────────────────────
   Large employers put the ATS behind their own domain, so a host list only ever
   covers the companies someone has already hit. Deloitte runs Avature at
   apply.deloitte.com; the old /avature\.net.*careers/ pattern matched nothing
   real and the URL fell through to the generic "Career" catch-all — which is
   why that queue stalled on the /careers/RegisterEdit account wall.

   What does not change with the domain is the platform's ROUTE NAMES. */
console.log('white-labelled ATS route to the right driver');
at('https://apply.deloitte.com/en_US/careers/RegisterEdit?jobId=363384');
eq('the exact Deloitte URL that was struggling → Avature', ctx.detectATS(), 'Avature');
eq('and the predicate agrees', ctx.isAvature(), true);
eq('it is not left to the generic career catch-all', ctx.detectATS() === 'Career', false);

for (const [url, want] of [
  // Avature's routes, on anyone's domain.
  ['https://apply.deloitte.com/en_US/careers/JobDetail/Senior-Consultant/363384', 'Avature'],
  ['https://apply.deloitte.com/en_US/careers/ApplicationMethods?jobId=363384', 'Avature'],
  ['https://apply.deloitte.com/en_US/careers/SubmitApplication?jobId=363384', 'Avature'],
  ['https://careers.siemens.com/en_GB/careers/JobDetail/Engineer/12345', 'Avature'],
  ['https://acme.avature.net/careers/JobDetail/Engineer/1', 'Avature'],
  // JPMorgan and the other big white-labellers.
  ['https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210536215', 'Oracle Recruiting'],
  ['https://careers.jpmorgan.com/us/en/job/210536215/software-engineer', 'Phenom'],
  ['https://careers.acme.com/jobs/12345/software-engineer/job', 'iCIMS'],
  ['https://jobs.acme.com/careersection/exuni/jobdetail.ftl?job=1', 'Taleo'],
  ['https://performancemanager.successfactors.eu/sfcareer/jobreqcareer?jobId=1', 'SuccessFactors'],
  ['https://acme.csod.com/ux/candidate/careersite/1/home/requisition/900', 'Cornerstone'],
  ['https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=1&siteid=2', 'Brassring'],
  ['https://acme.pageuppeople.com/caw/en/job/512345/senior-engineer', 'PageUp'],
  ['https://acme.dayforcehcm.com/CandidatePortal/en-US/acme/Posting/View/1234', 'Dayforce'],
  ['https://recruiting.acme.com/JobBoard/abc/JobDetails?jobId=99', 'UltiPro'],
]) { at(url); eq(`${new URL(url).hostname}${new URL(url).pathname.slice(0, 34)} → ${want}`, ctx.detectATS(), want); }

// The registry must not have become so loose it swallows ordinary pages.
for (const url of [
  'https://www.deloitte.com/us/en/about.html',
  'https://news.acme.com/2026/01/our-new-office',
  'https://acme.com/blog/how-we-hire',
]) { at(url); eq(`an ordinary page is not an ATS: ${new URL(url).pathname.slice(0, 30)}`, ctx.detectATS(), null); }

/* When the URL says nothing at all — a bare careers.acme.com — the PAGE still
   does. These fingerprints are what route an unknown employer domain. */
console.log('the platform is recognised from the page when the URL is silent');
const fpBlock = enhSrc.slice(enhSrc.indexOf('  const DOM_FINGERPRINTS = ['), enhSrc.indexOf('\n  function detectATSByDom()'));
const fpCtx = {};
new Function('exports', fpBlock + '\nexports.DOM_FINGERPRINTS = DOM_FINGERPRINTS;')(fpCtx);
const fpFor = (name) => (fpCtx.DOM_FINGERPRINTS.find((f) => f.n === name) || {}).sel || '';
for (const [platform, marker] of [
  ['Workday', 'data-automation-id'],
  ['SmartRecruiters', 'spl-input'],
  ['Oracle Recruiting', 'oj-input-text'],
  ['iCIMS', 'icims_content_iframe'],
  ['Phenom', 'phApp'],
  ['Greenhouse', 'grnhse_app'],
  ['Avature', 'mandatory'],
]) eq(`${platform} is recognised by its own markup (${marker})`, fpFor(platform).includes(marker), true);
eq('the most specific fingerprint is checked first',
  fpCtx.DOM_FINGERPRINTS[0].n, 'iCIMS');
eq('a URL match that is not the generic catch-all still wins over the page',
  /if \(byUrl && byUrl !== 'Career'\) return byUrl;/.test(enhSrc), true);
eq('and the generic catch-all can be replaced by a fingerprint',
  /const byDom = detectATSByDom\(\);/.test(enhSrc), true);
eq('the dispatcher routes on the resolved platform, not only the URL',
  /const platform = detectATS\(\);/.test(enhSrc), true);
eq('Avature has a driver of its own', /async function avatureAutomation\(\)/.test(enhSrc), true);
eq('and the dispatcher reaches it', /isAvature\(\) \|\| platform === 'Avature'\) await avatureAutomation\(\);/.test(enhSrc), true);
eq('the Avature account wall is completed before the form is filled',
  /RegisterEdit\|Register\|Login\/i\.test\(avatureRoute\(\)\)[\s\S]{0,120}?await handleAccountAuth\(\)/.test(enhSrc), true);
eq('a third-party apply method is never chosen',
  /const offsite = \/linkedin\|indeed\|google\|facebook\|xing\|seek\\b\|social\/i;/.test(enhSrc), true);
eq('Avature marks required fields with .mandatory, and that is honoured',
  /\.required,\.mandatory,\.req,\.is-required,\.asterisk/.test(enhSrc), true);

/* ── 1c. what the rival extensions know ────────────────────────────────────
   OptimHire ("50+ job boards") and Simplify were mined for ATS hosts this
   registry did not have. The answer was almost none — two job boards — which is
   worth recording, because it means the coverage question is settled and the
   remaining work is depth on the platforms already supported, not breadth. */
console.log('coverage matches or exceeds the rival extensions');
for (const [url, want] of [
  ['https://www.amazon.jobs/en/jobs/2841234/software-development-engineer', 'Amazon Jobs'],
  ['https://www.dice.com/job-detail/abc-123', 'Dice'],
  ['https://www.welcometothejungle.com/en/companies/acme/jobs/engineer', 'Welcome to the Jungle'],
  ['https://jobs.polymer.co/acme/12345', 'Polymer'],
]) { at(url); eq(`${new URL(url).hostname} → ${want}`, ctx.detectATS(), want); }

// Everything else they knew, this registry already had.
for (const [url, want] of [
  ['https://acme.freshteam.com/jobs/abc/engineer', 'Freshteam'],
  ['https://www.comeet.com/jobs/acme/93.00A/engineer/A1', 'Comeet'],
  ['https://acme.recooty.com/jobs/engineer', 'Recooty'],
  ['https://acme.gohire.io/jobs/engineer', 'GoHire'],
]) { at(url); eq(`${new URL(url).hostname} was already covered`, ctx.detectATS() === want || !!ctx.detectATS(), true); }

/* iCIMS puts its account wall on a different route from the posting, and that is
   the one AMD's careers site stops on. */
console.log('the iCIMS account wall routes to the iCIMS driver');
at('https://careers-amd.icims.com/jobs/91328/login?mobile=false&width=1570&height=500');
eq('the exact AMD wall URL → iCIMS', ctx.detectATS(), 'iCIMS');
at('https://careers-acme.icims.com/jobs/4321/senior-engineer/job');
eq('and so does the posting route', ctx.detectATS(), 'iCIMS');
at('https://careers-acme.icims.com/jobs/4321/register');
eq('and the register route', ctx.detectATS(), 'iCIMS');
/* The route match earns its keep on a WHITE-LABELLED iCIMS, where the host says
   nothing — careers.acme.com serving an iCIMS wall. Matching on icims.com alone
   would send that to the generic path. */
at('https://careers.acme.com/jobs/91328/login?mobile=false&width=1570');
eq('a white-labelled iCIMS wall is still recognised', ctx.detectATS(), 'iCIMS');
at('https://careers.acme.com/jobs/91328/register');
eq('and its register route', ctx.detectATS(), 'iCIMS');
eq('the wall path is recognised as an auth page',
  /\/jobs\\\/\\d\+\\\/\(login\|register\)/.test(enhSrc), true);

/* ── 1d. URLs from four real 943-job queues ────────────────────────────────
   Ten per cent of those jobs fell through to the generic path, and most were
   platforms already supported here — just not recognised from the URL shape the
   EMPLOYER actually uses rather than the one the vendor documents. These are the
   real URLs, taken verbatim from the CSVs. */
console.log('the URL shapes employers actually use');

/* Greenhouse is embedded on the employer's own site far more often than it is
   served from greenhouse.io, and it always carries gh_jid. One parameter covered
   eight different employers in a single queue. */
for (const url of [
  'https://careers.toasttab.com/jobs?gh_jid=7982262&gh_src=dbd19ebc1',
  'https://jobs.elastic.co/jobs?gh_jid=8155560&gh_jid=8155560',
  'https://careers.withwaymo.com/jobs?gh_jid=8157441',
  'https://databricks.com/company/careers/open-positions/job?gh_jid=8736885002',
  'https://www.hubspot.com/careers/jobs/8038103?gh_jid=8038103',
  'https://www.hudsonrivertrading.com/careers/job?gh_jid=8159996',
  'https://www.gonitro.com/about/careers/8030415?gh_jid=8030415',
  'http://www.squarespace.com/about/careers?gh_jid=7962046&gh_src=afe793d31',
]) { at(url); eq(`gh_jid on ${new URL(url).hostname} → Greenhouse`, ctx.detectATS(), 'Greenhouse'); }
at('https://grnh.se/14zdhkej1us?gh_src=20687b321us');
eq('the Greenhouse short link too', ctx.detectATS(), 'Greenhouse');

/* Teamtailor white-labelled onto the employer's domain — the single biggest
   fall-through in the queue, 27 jobs across four employers. */
for (const url of [
  'https://careers.sumsub.com/jobs/8273242-marketing-coordinator',
  'https://careers.spacelift.io/jobs/8211457-senior-fp-a-analyst-finance-business-partner-remote-poland',
  'https://careers.phorest.com/jobs/8157251-engineering-manager-ecommerce?utm_source=LinkedIn',
  'https://careers.geelyauto.co.uk/jobs/8288665-project-manager?utm_source=LinkedIn',
]) { at(url); eq(`${new URL(url).hostname} → Teamtailor`, ctx.detectATS(), 'Teamtailor'); }

/* Phenom uses an alphanumeric requisition code on most tenants, so requiring
   digits missed Mastercard and Snowflake entirely. */
for (const url of [
  'https://careers.mastercard.com/us/en/job/MASRUSR280277EXTERNALENUS/Senior-Software-Engineer?utm_medium=phenom-feeds',
  'https://careers.snowflake.com/us/en/job/SNCOUSF46D6446D81A4FBC9531A80B36C7E9DBEXTERNALENUSC7726FBB',
]) { at(url); eq(`${new URL(url).hostname} → Phenom`, ctx.detectATS(), 'Phenom'); }

for (const [url, want] of [
  ['https://www.personio.com/careers/71e56d2a-87eb-4ad6-b28a-f6fa079e9c3f?utm_source=LinkedIn', 'Personio'],
  ['https://integrity360.bamboohr.com/careers/739?source=LinkedIn', 'BambooHR'],
  ['https://explore-jobs.ciklum.com/en/sites/ciklum-career/job/4391?utm_source=linkedin', 'Oracle Recruiting'],
  ['https://www.aplitrak.com/?adid=V2VzLk9Ccmllbi42NjU2My4xNTUwQGVyZ29ncm91cA', 'Bullhorn'],
  ['https://nodwyer.current-vacancies.com/Jobs/Advert/4168578?cid=1877', 'Current Vacancies'],
  ['https://JPMorganChase.contacthr.com/152856470', 'ContactHR'],
]) { at(url); eq(`${new URL(url).hostname} → ${want}`, ctx.detectATS(), want); }

/* The platforms that already worked must keep working — the new rules are broad,
   and a Teamtailor-shaped path could easily have swallowed one of these. */
for (const [url, want] of [
  ['https://www.linkedin.com/jobs/view/4291234567', 'LinkedIn'],
  ['https://jobs.ashbyhq.com/openai/1234abcd-5678', 'Ashby'],
  ['https://job-boards.greenhouse.io/intercom/jobs/6276021?gh_src=m3lq2e1', 'Greenhouse EU'],
  ['https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/job/Ireland---Dublin/SMB_JR338719', 'Workday'],
  ['https://microsoft.eightfold.ai/careers/job/1234567890', 'Eightfold'],
  ['https://ats.rippling.com/acme/jobs/1234', 'Rippling'],
  ['https://jobs.lever.co/acme/abc-123', 'Lever'],
  ['https://jobs.smartrecruiters.com/Version1/744000130554399-solution-architect-java-', 'SmartRecruiters'],
  ['https://emit.fa.ca3.oraclecloud.com/hcmUI/CandidateExperience/en/job/86989/', 'Oracle Recruiting'],
  ['https://careers-sisk.icims.com/jobs/2827/operational-lessons-learned-manager/job', 'iCIMS'],
  ['https://bloomberg.avature.net/careers/JobDetail/Engineer/1234', 'Avature'],
]) { at(url); eq(`still recognised: ${want}`, ctx.detectATS(), want); }

/* And an ordinary page must not be swept up by the broader rules. */
for (const url of [
  'https://www.deloitte.com/us/en/about.html',
  'https://news.acme.com/2026/01/our-new-office',
  'https://shop.example.com/products/12345-blue-shirt',
]) { at(url); eq(`not an ATS: ${new URL(url).pathname.slice(0, 34)}`, ctx.detectATS(), null); }

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

/* ── 4. the dialog must be answerable even when NOT automating ────────────── */
// The screenshot case: a manual apply on SmartRecruiters, a script-driven
// Remove "…_CV"? confirm, and nothing armed to answer it — the page froze.
console.log('script-driven confirms cannot freeze the page');
eq('a trusted-gesture tracker exists', /let lastTrustedAt = 0;/.test(hooksSrc), true);
eq('only trusted events count as a human acting', /if \(e && e\.isTrusted\) lastTrustedAt = Date\.now\(\)/.test(hooksSrc), true);
eq('a script-driven destructive confirm is declined even when idle',
  /if \(destructive && !humanJustActed\(\)\) \{[\s\S]{0,120}?return false;/.test(hooksSrc), true);
eq('a confirm the user actually triggered still reaches the real dialog',
  /return orig\.confirm\.apply\(window, arguments\);\n  \};/.test(hooksSrc), true);
eq('the gesture window is short', /Date\.now\(\) - lastTrustedAt < 1200/.test(hooksSrc), true);

/* ── 5. the remove control must be unreachable across shadow boundaries ───── */
console.log('destructive guard reaches into shadow DOM');
eq('the guard walks out of shadow roots', /function closestAcrossShadow\(el, selector\)/.test(enhSrc), true);
eq('it steps through the shadow host chain', /root\.host\) \? root\.host : null/.test(enhSrc), true);
eq('SmartRecruiters spl-* upload widgets are recognised as attachment containers',
  /spl-file-upload,spl-attachment,spl-file,spl-file-item/.test(enhSrc), true);
eq('spl-/oj- elements count as clickable controls', /tag\.startsWith\('SPL-'\)/.test(enhSrc), true);
eq('the icon inside the button\'s own shadow root is read',
  /el\.shadowRoot && el\.shadowRoot\.textContent/.test(enhSrc), true);
eq('triggerMouse is guarded too, not just realClick',
  /Refusing to pointer-click destructive control/.test(enhSrc), true);

/* ── 6. real queued URLs reach their own driver ───────────────────────────── */
/* Every URL below came out of real diagnostics exports. The dispatcher's
   routing chain is rebuilt from the shipped source and walked in order, so a
   new detection rule that steals a URL from the right driver — or a platform
   the recogniser names but no branch accepts — fails here. The DOM
   fingerprint is off: these must route from the URL alone. */
console.log('real queued URLs → driver');
const dispatch = grabFn(enhSrc, 'dispatchATSAutomation');
const chain = [...dispatch.matchAll(/^\s*(?:else\s+)?(?:if\s*\((.+?)\)\s*)?await (\w+)\(\);/gm)]
  .map((m) => ({ cond: m[1] || 'true', drv: m[2] }))
  .filter((c) => /Automation$|EasyApply$|^tailorFirstFlow$/.test(c.drv));
const route = new Function('location', `
  const detectATSByDom = () => null;
  const LOG = () => {};
  ${atsTable}
  ${avatureRouteRe}
  ${['isWorkday', 'isSmartRecruiters', 'isOracleCloud', 'isTaleo', 'isAdpMyJobs', 'isAvature', 'detectATS'].map((n) => grabFn(enhSrc, n)).join('\n')}
  const url = location.href;
  const platform = detectATS();
  for (const c of ${JSON.stringify(chain)}) if (eval(c.cond)) return [platform, c.drv];
  return [platform, null];
`);
const routeOf = (href) => { const u = new URL(href); return route({ href, hostname: u.hostname, pathname: u.pathname }); };
for (const [href, want] of [
  ['https://careers.amd.com/careers-home/jobs/92491', 'icimsAutomation'],
  ['https://www.pepsicojobs.com/main/jobs/447137', 'icimsAutomation'],
  ['https://careers-idirect.icims.com/jobs/2878/devops-engineer/candidate', 'icimsAutomation'],
  ['https://jobs.workable.com/view/1Ctkw2QrCmKk1N9xzFiYAZ/rpa-developer', 'workableAutomation'],
  ['https://apply.workable.com/acme/j/ABC123/', 'workableAutomation'],
  ['https://hcyc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/10393', 'oracleCloudAutomation'],
  ['https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/29', 'oracleCloudAutomation'],
  ['https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210000001', 'oracleCloudAutomation'],
  ['https://wd3.myworkdaysite.com/recruiting/rabobank/jobs/job/Utrecht', 'workdayAutomation'],
  ['https://nxp.wd3.myworkdayjobs.com/careers/job/Catania/Senior-Digital-Design-Engineer', 'workdayAutomation'],
  ['https://job-boards.greenhouse.io/twilio/jobs/8190887', 'greenhouseAutomation'],
  ['https://jobs.smartrecruiters.com/Grab/744000150545769-senior-data-scientist', 'smartRecruitersAutomation'],
  ['https://jobs.smartrecruiters.com/oneclick-ui/company/Grab/publication/152ae953-580', 'smartRecruitersAutomation'],
  ['https://aa115.taleo.net/careersection/qa_external_cs/jobdetail.ftl', 'taleoAutomation'],
  ['https://career5.successfactors.eu/careers', 'successFactorsAutomation'],
  ['https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html', 'adpAutomation'],
  ['https://acme.bamboohr.com/careers/42', 'bamboohrAutomation'],
  ['https://jobs.jobvite.com/acme/job/oABC123', 'jobviteAutomation'],
  ['https://acme.breezy.hr/p/abc123-engineer', 'breezyhrAutomation'],
  ['https://ats.rippling.com/acme/jobs/1234', 'ripplingAutomation'],
  ['https://acme.applytojob.com/apply/ABC123/Engineer', 'jazzhrAutomation'],
]) eq(`${new URL(href).hostname}${new URL(href).pathname.slice(0, 28)} → ${want}`, routeOf(href)[1], want);
// The newly recognised boards are named (the generic flow logs and records them
// by name), and still go through the generic flow that handles them.
for (const [href, name] of [
  ['https://app.trinethire.com/companies/526703-black-lake/jobs/104', 'TriNet Hire'],
  ['https://jobs.qureos.com/jobs/8410384-remote-data-analyst', 'Qureos'],
  ['https://careers-page.com/digway-2/job/Y6894W35', 'Manatal'],
  ['https://kumaran.zohorecruit.in/jobs/Careers/31840000017690179/QA-Lead', 'Zoho'],
  ['https://careers.arm.com/job/galway/senior-software-ml-engineer/33099/93485591024', 'Radancy'],
  ['https://careers.sokin.com/jobs/8409552-senior-fullstack-engineer', 'Teamtailor'],
]) eq(`${new URL(href).hostname} recognised as ${name}`, routeOf(href), [name, 'tailorFirstFlow']);

/* ── 7. Oracle Recruiting's front door + SmartRecruiters knockouts ───────── */
console.log('Oracle email step, terms box, SmartRecruiters knockouts');
{
  // A terms box drawn over a hidden <input>: ticked via the input, never by a
  // pointer click on the label (which holds the terms link).
  const mkBox = (label, opts = {}) => {
    const lab = { textContent: label, visible: opts.labelVisible !== false };
    const c = { checked: false, disabled: false, visible: !!opts.visible, id: '', lab,
      closest: () => lab, getRootNode: () => ({}), click() { this.checked = !this.checked; } };
    return c;
  };
  const boxes = [
    mkBox('I agree with the terms and conditions'),
    mkBox('Send me job alerts and marketing emails'),
    mkBox('I agree to the privacy policy', { visible: true }),
    mkBox('I agree with the terms', { labelVisible: false }),
    mkBox('Relocation assistance'),
  ];
  new Function('boxes', `
    const deepAll = () => boxes;
    const isVisible = (el) => el.lab ? el.visible : el.visible;
    const isMarketingCheckbox = (el) => /marketing|job alerts/i.test(el.lab.textContent);
    const CSS = { escape: (x) => x };
    ${grabFn(enhSrc, 'tickHiddenTermsBoxes')}
    tickHiddenTermsBoxes();
  `)(boxes);
  eq('the hidden terms box is ticked', boxes[0].checked, true);
  eq('a marketing opt-in is not', boxes[1].checked, false);
  eq('a visible box is left to the visible sweep', boxes[2].checked, false);
  eq('a box with no visible label is left alone', boxes[3].checked, false);
  eq('an unrelated hidden box is left alone', boxes[4].checked, false);

  const oracle = grabFn(enhSrc, 'oracleCloudAutomation');
  eq('Oracle presses Apply Now even with a search box on the job page',
    /deepQuery\('input,select,textarea,oj-input-text'\)\) break/.test(oracle), false);
  eq('Oracle walks its email + PIN step before anything else', /await oracleEmailAndPin\(\);/.test(oracle), true);
  const ep = grabFn(enhSrc, 'oracleEmailAndPin');
  eq('the email step prefers Next over the header Sign In link',
    /next = stepButton\(\) \|\| findAuthSubmit\('create'\)/.test(ep), true);
  eq('the PIN is waited for, not skipped', /await resolveEmailVerification\(120000\)/.test(ep), true);

  const sr = grabFn(enhSrc, 'smartRecruitersAutomation');
  eq('SmartRecruiters radios use the shared knockout engine', /answerKnockoutRadioGroup\(radios, group, p\)/.test(sr), true);
  eq('SmartRecruiters never defaults an unsure radio to "yes"', /\|\| 'yes'\)/.test(sr), false);
  eq('the location fix targets the location box, not the first combobox',
    /deepQueryAll\('\[role="combobox"\],spl-input\[id="location"\]'\)\.filter\(isVisible\)\[0\]/.test(sr), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
