/* A queued job may only be marked "done" when it was really submitted. Two
   pieces of pure logic decide that, and both are lifted from the shipped file:

     isSubmitLabel(text)  — is this button the thing that SENDS the application?
     SUCCESS_PATH_RE      — is this URL a confirmation page?

   Both had defects that produced the same visible symptom: the form fills to
   100%, the queue advances, nothing was submitted.

   Usage: node tests/submit.test.js "<ua-enhancement.js>" */
const fs = require('fs');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const src = fs.readFileSync(process.argv[2], 'utf8');

function grab(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error('missing: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  if (b < 0) throw new Error('missing end for: ' + startMarker);
  return src.slice(a, b + endMarker.length);
}

const ctx = {};
new Function('exports', [
  grab('  const SUBMIT_POSITIVE_RE =', "].join('|'), 'i');"),
  grab('  const SUBMIT_NEGATIVE_RE =', "].join('|'), 'i');"),
  grab('  function isSubmitLabel(text) {', '\n  }'),
  grab('  const SUCCESS_PATH_RE =', ';\n'),
  grab('  const SUCCESS_TEXT_RE =', ';\n'),
  'Object.assign(exports, { isSubmitLabel, SUCCESS_PATH_RE, SUCCESS_TEXT_RE });',
].join('\n'))(ctx);

const isSubmit = ctx.isSubmitLabel;

/* ── 1. submit labels across platforms ────────────────────────────────────── */
console.log('button labels that DO submit an application');
for (const label of [
  'Submit',
  'Submit Application',
  'Submit application',
  'Submit Your Application',
  'Submit my application',
  'SUBMIT APPLICATION',
  'Review and Submit',            // final page on several ATS
  'Accept & Submit',              // USAJOBS / GovernmentJobs style
  'I Agree and Submit',
  'Confirm and Submit',
  'Sign and Submit',
  'Finish and Submit',
  'Send',
  'Send Application',
  'Send my application',
  'Complete Application',
  'Complete my application',
  'Finish',
  'Finish Application',
  'Bewerbung absenden',           // de
  'Absenden',
  'Envoyer ma candidature',       // fr
  'Soumettre',
  'Enviar solicitud',             // es
  'Invia candidatura',            // it
  'Verzenden',                    // nl
]) eq(`"${label}"`, isSubmit(label), true);

console.log('button labels that must NOT be treated as submit');
for (const label of [
  'Apply',                        // opens the form — clicking it as submit started
  'Apply Now',                    // the confirmation grace timer on an unsent form
  'Apply for this job',
  'Easy Apply',
  'Next',
  'Continue',
  'Save and Continue',
  'Save as draft',
  'Save for later',
  'Save this job',
  'Back',
  'Previous',
  'Cancel',
  'Close',
  'Upload resume',
  'Attach CV',
  'Add another',
  'Edit',
  'Print application',
  'Download',
  'Sign in',
  'Create account',
  'Register',
  'Subscribe',
  'Submit feedback',              // a support widget, not the application
  'Submit a question',
  'Contact us',
  'Search jobs',
  'Create job alert',
  'Withdraw application',
  'Delete',
  'Postuler',                     // fr "apply" — opens, does not send
  'Jetzt bewerben',               // de "apply now"
]) eq(`"${label}"`, isSubmit(label), false);

/* ── 2. confirmation URLs ─────────────────────────────────────────────────── */
console.log('URL paths that ARE a confirmation page');
for (const path of [
  '/apply/thank-you', '/thankyou', '/careers/success', '/application/confirmation',
  '/jobs/1234/submitted', '/apply/application-complete', '/confirmation',
]) eq(path, ctx.SUCCESS_PATH_RE.test(path), true);

console.log('job URLs that must NOT read as a confirmation page');
for (const path of [
  // Every one of these used to declare the application submitted on arrival,
  // before anything had been filled in, because the test was a substring match.
  '/jobs/customer-success-manager',
  '/jobs/applied-scientist-ii',
  '/careers/complete-care-nurse',
  '/job/donegal-warehouse-operative',
  '/jobs/success-engineer-dublin',
  '/en/job/confirmation-analyst',
  '/jobs/senior-software-engineer',
  '/careers/apply/12345',
  '/jobs/received-goods-clerk',
  '/o/data-engineer',
]) eq(path, ctx.SUCCESS_PATH_RE.test(path), false);

/* ── 3. confirmation TEXT ─────────────────────────────────────────────────── */
console.log('page text that confirms a submission');
for (const text of [
  'Your application has been submitted',
  'Thank you for applying to Acme',
  'Application received',
  'We have received your application',
  "We've received your application",
  'Application submitted',
  'Application is under review',
]) eq(JSON.stringify(text), ctx.SUCCESS_TEXT_RE.test(text), true);

console.log('page text that must NOT confirm a submission');
for (const text of [
  'Please complete all required fields',   // a validation ERROR — used to pass
  '4/4 required fields filled',            // the autofill readout
  '100% complete',
  'Complete your profile to continue',
  'Submit your application when ready',
  'Application form',
  'Upload your resume to complete the application',
]) eq(JSON.stringify(text), ctx.SUCCESS_TEXT_RE.test(text), false);

/* ── 4. the evidence rules in the shipped source ──────────────────────────── */
console.log('submission evidence rules');
eq('confirmSubmitted requires a submit attempt for soft signals',
  /function confirmSubmitted\(\)[\s\S]{0,600}?if \(!submitAttempted\(\)\) return false;/.test(src), true);
eq('hard signals alone still count',
  /function confirmSubmitted\(\)[\s\S]{0,300}?if \(hardSuccessSignal\(\)\) return true;/.test(src), true);
eq('the submit attempt is persisted across navigations',
  /const SUBMIT_MARK_KEY = 'ua_submit_mark'/.test(src) && /st\.set\(SUBMIT_MARK_KEY, mark\)/.test(src), true);
eq('the mark is restored on load', /_submitMark = \(await st\.get\(SUBMIT_MARK_KEY\)\)/.test(src), true);
eq('each job starts with no submit evidence',
  (src.match(/clearSubmitAttempt\(\)/g) || []).length >= 2, true);
eq('the submit step is not skipped on a soft signal alone',
  /if \(!confirmSubmitted\(\)\) await multiPageLoop\(\);/.test(src), true);
eq('"Apply" is no longer an attribute-level submit selector',
  /'button\[aria-label\*="Apply" i\]'|'\[data-testid="apply-button"\]'/.test(
    (src.match(/const submitSels = \[[\s\S]*?\];/) || [''])[0]), false);
eq('failure reasons distinguish no-submit-found from no-confirmation',
  /Form filled but no Submit control was found/.test(src) && /Submit was clicked but no confirmation appeared/.test(src), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
