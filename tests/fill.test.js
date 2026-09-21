/* Autofill coverage is decided by ONE thing before any per-ATS cleverness: can
   the filler SEE the fields? $ / $$ are document.querySelector(All) — they stop at
   a shadow boundary and never enter a frame, so on a web-component or
   iframe-embedded application the universal fillers enumerated zero fields and
   silently did nothing.

   These are structural assertions against the shipped file. They cannot prove a
   fill succeeds on a live ATS, but they do lock in the property that makes it
   possible, and they fail loudly if a future edit reintroduces a blind query.

   Usage: node tests/fill.test.js "<ua-enhancement.js>" "<ua-orchestrator.js>" "<manifest.json>" */
const fs = require('fs');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const src = fs.readFileSync(process.argv[2], 'utf8');
const orch = fs.readFileSync(process.argv[3], 'utf8');
const manifest = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));

/* Body of a top-level function in the module (2-space indent, closes on "  }").
   Operations wrapped by the busy guard keep their public name on a one-line
   wrapper and move the real body to <name>__impl — always inspect the body that
   actually does the work. */
function body(name) {
  const lines = src.split('\n');
  const impl = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '__impl\\(').test(l));
  const start = impl >= 0
    ? impl
    : lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l));
  if (start < 0) throw new Error('function not found: ' + name);
  const end = lines.findIndex((l, i) => i > start && l === '  }');
  if (end < 0) throw new Error('no end for: ' + name);
  return lines.slice(start, end + 1).join('\n');
}

/* ── 1. the universal fillers must not use a blind query ──────────────────── */
console.log('universal fillers see shadow DOM + frames');
const UNIVERSAL = [
  'fallbackFill',            // fills everything the ATS driver missed
  'getMissingRequired',      // decides whether the form is complete
  'guaranteeRequiredFieldsPass', // the required-field sweep itself
  'handleValidationErrors',  // reads the site's own complaints
  'hasApplicationForm',      // decides "is there a form here at all"
  'analyzeCurrentForm',
  'answerChoiceGroups',
  'learnFromFilledFields',
];
for (const name of UNIVERSAL) {
  const b = body(name);
  const blind = (b.match(/(?<![\w$])\$\$?\(/g) || []).length;
  const deep = (b.match(/deepAll\(|deepOne\(/g) || []).length;
  eq(`${name}: no blind document queries`, blind, 0);
  eq(`${name}: uses the deep enumerator`, deep > 0, true);
}

/* ── 2. the enumerator itself ─────────────────────────────────────────────── */
console.log('field enumerator');
eq('walks open shadow roots', /function deepQueryAll[\s\S]{0,600}?shadowRoot/.test(src), true);
eq('walks same-origin frames', /function fieldRoots[\s\S]{0,700}?contentDocument/.test(src), true);
eq('cross-origin frames fail closed, not throw', /catch \(_\) \{ d = null; \}/.test(src), true);
eq('frame recursion is depth-bounded', /depth > 2/.test(body('fieldRoots') || ''), true);
eq('enumeration is count-bounded', /const cap = limit \|\| 800;/.test(src), true);

/* ── 3. labels resolve inside the element's own root ──────────────────────── */
console.log('label resolution');
const gl = body('getLabel');
eq('getLabel scopes lookups to the element root', /ownerScope\(el\)/.test(gl), true);
eq('getLabel no longer uses document.getElementById', /document\.getElementById/.test(gl), false);
eq('ownerScope falls back to document', /function ownerScope[\s\S]{0,220}?return document;/.test(src), true);

/* ── 4. visibility ────────────────────────────────────────────────────────── */
console.log('visibility test');
// offsetParent is null for position:fixed elements. Every remaining use must be
// paired with getClientRects(), or fields in an apply-in-a-dialog modal read as
// invisible to the filler.
{
  const bare = src.split('\n').filter((l) => /offsetParent/.test(l) && !/getClientRects/.test(l) && !/^\s*\/\//.test(l));
  eq('no bare offsetParent visibility gate remains', bare.map((l) => l.trim().slice(0, 60)), []);
}
eq('isVisible itself no longer uses offsetParent', /function isVisible[\s\S]{0,500}?offsetParent/.test(src), false);
eq('isVisible uses the element\'s own window', /el\.ownerDocument && el\.ownerDocument\.defaultView/.test(src), true);
eq('isVisible still rejects display:none / hidden / opacity:0',
  /cs\.display === 'none'/.test(src) && /cs\.visibility === 'hidden'/.test(src) && /parseFloat\(cs\.opacity/.test(src), true);

/* ── 5. cross-origin frames (the only way to reach an embedded ATS form) ──── */
console.log('cross-origin frame coverage');
eq('orchestrator injects into all frames of a job tab', /allFrames: true[\s\S]{0,80}files: \['ua-enhancement\.js'\]/.test(orch), true);
eq('injection is re-run after each navigation', (orch.match(/injectAllFrames\(/g) || []).length >= 3, true);
eq('content script is idempotent (top frame already has it)', /if \(window\.__uaEnhancementLoaded\) return;/.test(src), true);
eq('sub-frames run a fill-only path', /async function initSubframe\(\)/.test(src), true);
eq('sub-frame mode is gated on the automation gate',
  /function initSubframe[\s\S]{0,300}?__uaAutoAllowed\(\)\) return;/.test(src), true);
eq('sub-frame mode ignores frames without a form',
  /function initSubframe[\s\S]{0,600}?fields\(\)\.length < 2\) return;/.test(src), true);
eq('sub-frame passes are bounded', /pass < 6/.test(body('initSubframe') || src), true);
eq('the manifest keeps the heavy script out of every ad frame',
  (manifest.content_scripts.find((c) => (c.js || []).includes('ua-enhancement.js')) || {}).all_frames, false);
eq('scripting permission is present', manifest.permissions.includes('scripting'), true);

/* ── 6. completeness reporting + the extra fill pass ──────────────────────── */
console.log('fill completeness');
eq('fillReport exists and counts required fields', /function fillReport\(\)[\s\S]{0,400}?isFieldRequired/.test(src), true);
eq('it names the fields still missing', /missingLabels/.test(src), true);
eq('the report is logged before submitting', /logFillReport\('Before submit'\)/.test(src), true);
eq('a third fill pass runs when the form is still incomplete',
  /Third pass, after a longer wait/.test(src), true);

/* ── 7. custom dropdowns (what most modern ATS render instead of <select>) ─── */
console.log('custom dropdown handling');
eq('a universal committer exists', /async function commitCustomDropdown\(/.test(src), true);
eq('it runs as part of the universal fill', /filled \+= await fillCustomDropdowns\(p\)/.test(src), true);
eq('covers react-select / MUI / Ant / spl / oj', 
  /select__control/.test(src) && /MuiSelect-root/.test(src) && /ant-select/.test(src) &&
  /spl-select/.test(src) && /oj-select-single/.test(src), true);
eq('opens with a pointer sequence, then keyboard, then typeahead',
  /triggerMouse\(combo\)/.test(src) && /ArrowDown/.test(src) &&
  /Typeahead: many comboboxes only render options once you type/.test(src), true);
eq('never invents a demographic answer',
  /gender\|disability\|veteran\|race\|ethnic[\s\S]{0,200}?prefer not\|decline/.test(src), true);
eq('blind last-resort pick is limited to REQUIRED fields',
  /if \(!pick && required\) pick = real\[0\];/.test(src), true);
eq('it verifies the control actually took a value', /return comboHasValue\(combo\);/.test(src), true);
eq('placeholder text is not mistaken for an answer',
  /isPlaceholder|please select/.test(src), true);

/* ── 8. CAPTCHA: not solved, but never silently eaten ─────────────────────── */
console.log('CAPTCHA handling');
eq('detection reaches frames and shadow roots', /for \(const el of deepAll\(sel, 40\)\)/.test(src), true);
eq('covers Arkose, GeeTest, DataDome, AWS WAF, press-and-hold',
  /arkoselabs/.test(src) && /geetest/.test(src) && /captcha-delivery/.test(src) &&
  /awswaf/.test(src) && /press-and-hold/.test(src), true);
eq('a blocked job tells the queue', /type: 'UA_JOB_NEEDS_HUMAN'/.test(src), true);
eq('and tells it again when cleared', /reportCaptcha\('', false\)/.test(src), true);
eq('the queue notifies and marks the row', /UA_JOB_NEEDS_HUMAN/.test(orch) && /needsHuman/.test(orch), true);
eq('the watchdog does not time out a job waiting on a person',
  /if \(waited < cfg\.humanGraceMs && !overParked\) continue;/.test(orch), true);
eq('the wait is one minute by default, not a quarter of an hour',
  /humanGraceMs: 60 \* 1000/.test(orch), true);
eq('and it is configurable from the panel', /humanGraceMs: Math\.max\(15000/.test(orch), true);
// The important part: waiting on a person must not cost throughput.
eq('a parked job does not occupy a concurrency slot',
  /j\.status === 'applying' && map\[j\.id\] != null && !j\.needsHuman/.test(orch), true);
eq('the freed slot is refilled at once, not on the next tick',
  /The job no longer counts against concurrency[\s\S]{0,160}?await fillSlots\(\);/.test(orch), true);
eq('parked tabs are capped so they cannot pile up', /MAX_PARKED = 3/.test(orch), true);
eq('a dead tab is reclaimed in 15s', /HEARTBEAT_DEAD_MS = 15 \* 1000/.test(orch), true);
eq('the no-progress cut-off defaults to 15s', /stallMs: 15 \* 1000/.test(orch), true);
eq('the hard cap per job is 3 minutes', /jobTimeoutMs: 3 \* 60 \* 1000/.test(orch), true);
// A 15s window is only meaningful if the beat is fast enough to fill it, and if
// work in progress is credited AS it happens rather than at the end of a pass.
eq('the heartbeat is fast enough for a 15s window (3 beats)', /\}, 5000\);/.test(src), true);
eq('the stall check polls every 3s', /\}, 3000\);/.test(src), true);
eq('each filled field counts as progress, so a long form is not a stall',
  /noteProgress\('filling fields'\);   \/\/ per field/.test(src), true);
eq('waiting for a slow page counts as progress', /noteProgress\('waiting for the page'\)/.test(src), true);
eq('a navigation counts as progress', /noteProgress\('page navigated'\)/.test(src), true);
eq('an upload in flight counts as progress', /noteProgress\('uploading CV'\)/.test(src), true);
eq('a new run clears stale needs-you markers', /delete j\.needsHuman;/.test(orch), true);
eq('no CAPTCHA-solving is attempted (no solver service, no token injection)',
  /2captcha|anticaptcha|capmonster|deathbycaptcha|g-recaptcha-response\s*=/i.test(src), false);

/* ── 9. CV / résumé attachment ────────────────────────────────────────────── */
console.log('CV attachment');
eq('a universal attacher exists (was Workday-only)', /async function attachResume__impl\(\)/.test(src), true);
eq('it finds file inputs across shadow DOM and frames', /deepAll\('input\[type="file"\]', 60\)/.test(src), true);
eq('it never re-uploads over an existing attachment',
  /if \(resumeAlreadyAttached\(\)\) \{ LOG\('CV already attached/.test(src), true);
eq('it builds a real File from the stored base64', /new File\(\[buf\], name/.test(src), true);
eq('it also performs a real drag-and-drop for dropzone-only widgets',
  /for \(const type of \['dragenter', 'dragover', 'drop'\]\)/.test(src), true);
eq('it waits for the upload to land', /await waitForResumeUpload\(25000\)/.test(src), true);
eq('it says so plainly when no résumé is saved', /no résumé saved in the extension/.test(src), true);
eq('SmartRecruiters attaches the CV before sweeping fields',
  /CV first: SmartRecruiters parses it and pre-fills from it/.test(src), true);
eq('SmartRecruiters never advances mid-upload',
  /SmartRecruiters: waiting for the CV upload to finish/.test(src), true);
eq('no ATS submits through an in-flight upload',
  /Never submit through one\.[\s\S]{0,200}?logFillReport\('Before submit'\)/.test(src), true);
eq('the CV pass is part of the universal fill', /const cvState = await attachResume\(\);/.test(src), true);

/* ── 10. the stall clock must not run during active work ──────────────────── */
console.log('stall clock stands down while working');
eq('a busy guard exists', /async function withBusy\(what, fn\)/.test(src), true);
eq('the watchdog stands down while busy',
  /if \(isBusy\(\)\) \{ noteProgress\(_busyWhat\); return; \}/.test(src), true);
eq('the guard is depth-counted, so nesting cannot unlock it early',
  /_busyDepth\+\+/.test(src) && /finally \{ _busyDepth--/.test(src), true);
// Every operation that legitimately takes a while must be inside the guard.
for (const fn of ['guaranteeRequiredFields', 'fillCustomDropdowns',
  'attachResume', 'triggerAutofill', 'triggerAutofillQuick', 'autoSubmitOrNext',
  'openApplicationForm', 'handleAccountAuth', 'handleValidationErrors']) {
  eq(`${fn} runs inside the busy guard`,
    new RegExp('async function ' + fn + '\\(\\.\\.\\.a\\) \\{ return withBusy\\(').test(src), true);
}
// These two also carry re-entrancy guards, so their wrappers are multi-line.
for (const fn of ['fallbackFill', 'resolveDependentQuestions']) {
  eq(`${fn} runs inside the busy guard`,
    new RegExp('async function ' + fn + '\\(\\.\\.\\.a\\) \\{[\\s\\S]{0,400}?withBusy\\(').test(src), true);
}
eq('post-submit verification counts as work, not a stall',
  (src.match(/withBusy\('verifying submission'/g) || []).length >= 3, true);
eq('the hard cap is still the backstop if an operation hangs outright',
  /jobTimeoutMs: 3 \* 60 \* 1000/.test(orch), true);

/* ── 11. CSV import accepts a drop, not just the file picker ──────────────── */
console.log('CSV drag and drop');
eq('the in-page card shows a drop target', /id="ua-sb-drop"/.test(src), true);
eq('the drop target is also clickable', /dropZone\?\.addEventListener\('click', \(\) => fileInput\.click\(\)\)/.test(src), true);
eq('the whole card accepts a drop, not only the strip',
  /for \(const target of \[wrap, dropZone\]\.filter\(Boolean\)\)/.test(src), true);
eq('dropEffect is set, or some platforms refuse the drop', /dropEffect = 'copy'/.test(src), true);
eq('dropped files are imported', /for \(const f of files\) await handleFile\(f\);/.test(src), true);
eq('dropped text (a pasted URL list) is imported too',
  /getData\('text\/uri-list'\) \|\| dt\.getData\('text\/plain'\)/.test(src), true);
eq('multiple files at once', /multiple style="display:none"/.test(src), true);
eq('the file picker also handles multi-select', /const files = \[\.\.\.e\.target\.files\];/.test(src), true);

/* ── 12. the step that is on screen, not the one we just left ─────────────── */
/* An ATS that swaps its questions in place looks identical to one that hasn't
   moved yet, unless you actually compare the QUESTION SET. Waiting a flat 2.8s
   after Next and then reading the DOM is how the fill report came to describe
   the previous step's fields while the real ones sat empty. */
console.log('SPA step changes are waited for, not slept through');
const stepSig = body('stepSignature');
eq('stepSignature exists and enumerates deeply', /deepAll\(|questionControls\(/.test(stepSig), true);
eq('stepSignature uses no blind document query', (stepSig.match(/(?<![\w$])\$\$?\(/g) || []).length, 0);
eq('stepSignature fingerprints WHICH questions, never their values — otherwise typing looks like a new step',
  /\.value/.test(stepSig), false);
eq('it counts the controls and names them', /bits\.length/.test(stepSig) && /getAttribute\('name'\)/.test(stepSig), true);

const wsc = body('waitForStepChange');
eq('waitForStepChange returns false when the step never changed',
  /return stepSignature\(\) !== previousSignature;/.test(wsc), true);
eq('it also waits for the new step to settle before reporting it', /settledAt/.test(wsc), true);
eq('a legitimate page transition does not trip the stall watchdog',
  /withBusy\('waiting for the next step'/.test(wsc), true);
eq('it is bounded', /Date\.now\(\) - start < limit/.test(wsc), true);

eq('the multi-page loop compares question sets, not a blind document query',
  /function getPageHash\(\) \{ return stepSignature\(\); \}/.test(src), true);
const srcSR = src.slice(src.lastIndexOf('async function smartRecruitersAutomation'));
eq('SmartRecruiters waits for the next step instead of sleeping 2.8s',
  /await waitForStepChange\(stepSig, 15000\)/.test(srcSR), true);
eq('the old flat sleep after Next is gone',
  /realClick\(next\); await sleep\(2800\)/.test(src), false);
eq('a step that refuses to advance is diagnosed, not re-filled blindly',
  /step did not advance — fixing what is blocking it/.test(srcSR), true);
eq('the multi-page loop waits for the next step too',
  /await waitForStepChange\(beforeAction, 15000\)/.test(body('multiPageLoop')), true);

/* ── 13. questions that only appear once their parent is answered ──────────── */
/* "If applicable, would you consider relocating…?" → Yes reveals "…would you
   consider relocating at your own expense?". Nothing re-scanned after an answer,
   so the revealed question was never seen and the form read as 100% complete. */
console.log('conditional sub-questions are picked up');
const dep = body('resolveDependentQuestions');
eq('it answers, then looks again', /const before = stepSignature\(\)/.test(dep) && /const after = stepSignature\(\)/.test(dep), true);
eq('a round covers choices, dropdowns and declarations',
  /answerChoiceGroups\(\)/.test(dep) && /fillCustomDropdowns\(p\)/.test(dep) && /tickConsentBoxes\(\)/.test(dep), true);
eq('it gives the framework time to render what an answer unlocked',
  /waitForFormStable\(/.test(dep), true);
eq('it stops when nothing new appeared and nothing was answered',
  /if \(after === before && !did\) break;/.test(dep), true);
eq('it cannot loop forever', /round <= rounds/.test(dep) && /const rounds = maxRounds \|\| 5;/.test(dep), true);
eq('turning the automation off stops it mid-loop', /if \(autoStopped\(\)\) break;/.test(dep), true);

const grf = body('guaranteeRequiredFields');
eq('the guarantor re-scans after answering, it is not a single pass',
  /for \(let round = 1; round <= 3; round\+\+\)/.test(grf), true);
eq('it exits as soon as a round reveals nothing',
  /if \(stepSignature\(\) === before\) break;/.test(grf), true);
eq('newly revealed text boxes and dropdowns get filled too',
  /await fallbackFill\(\)/.test(grf), true);
eq('the general fill also chases dependent questions',
  /resolveDependentQuestions\(3\)/.test(body('fallbackFill')), true);

/* ── 14. declaration / consent boxes on every platform ─────────────────────── */
/* "You declare that you have read and understand the privacy notice of X. *
   Value is required" — a Spark <spl-checkbox>, so input[type=checkbox] never
   matched it and the step was rejected while everything else read as filled. */
console.log('required declarations are ticked on every ATS');
const reOf = (name) => {
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*(/[\\s\\S]*?/[gimsuy]*);\\n'));
  if (!m) throw new Error('regex not found: ' + name);
  return new Function('return ' + m[1])();
};
const CONSENT = reOf('CONSENT_TEXT_RE');
const MARKETING = reOf('MARKETING_TEXT_RE');
const REQERR = reOf('REQUIRED_ERROR_RE');

for (const [text, want] of [
  ['You declare that you have read and understand the privacy notice of ServiceNow.', true],
  ['I acknowledge that I have read the privacy policy', true],
  ['I agree to the terms and conditions', true],
  ['I consent to the processing of my personal data', true],
  ['I certify that the information provided is true and complete', true],
  ['I confirm the above is accurate to the best of my knowledge', true],
  ['I accept the candidate privacy statement', true],
  ['By checking this box you provide your electronic signature', true],
  ['I authorize a background check', true],
  ['I have read and understood the data protection notice', true],
  ['I attest that I am legally authorized to work', true],
  ['Upload a second document', false],
  ['Is this your current address', false],
]) eq(`consent wording: "${text.slice(0, 46)}…" → ${want}`, CONSENT.test(text), want);

for (const [text, want] of [
  ['Sign me up for job alerts', true],
  ['Send me marketing emails about similar roles', true],
  ['Join our talent community', true],
  ['Subscribe to the newsletter', true],
  ['You declare that you have read and understand the privacy notice', false],
  ['I agree to the terms and conditions', false],
]) eq(`marketing wording: "${text.slice(0, 40)}" → ${want ? 'never ticked' : 'tickable'}`, MARKETING.test(text), want);

eq('"Value is required" is recognised as the form refusing to advance', REQERR.test('Value is required'), true);
eq('so is "This field is required"', REQERR.test('This field is required'), true);
eq('so is "Please accept the terms"', REQERR.test('Please accept the terms'), true);
eq('ordinary help text is not', REQERR.test('Optional — add anything else here'), false);

const consentSel = src.match(/const CONSENT_CONTROL_SEL = ([\s\S]*?);\n/)[1];
for (const tag of ['spl-checkbox', 'oj-checkboxset', 'mat-checkbox', 'md-checkbox', 'sl-checkbox', 'ion-checkbox', '[role="checkbox"]'])
  eq(`declaration boxes: ${tag} is looked for`, consentSel.includes(tag), true);

const setCb = body('setCheckboxChecked');
eq('a web-component checkbox gets more than a .click()',
  (setCb.match(/\(\) => /g) || []).length >= 5, true);
eq('every attempt is verified against the control itself',
  /if \(checkboxChecked\(cb\)\) return true;/.test(setCb), true);
eq('the native input inside the component is tried first',
  /innerNative\(cb, 'input\[type=checkbox\],input\[type=radio\]'\)/.test(setCb), true);
const tick = body('tickConsentBoxes');
eq('a box already ticked is left alone', /if \(checkboxChecked\(cb\)\) continue;/.test(tick), true);
eq('marketing opt-ins are never ticked', /MARKETING_TEXT_RE\.test\(txt\)\) continue;/.test(tick), true);
eq('a box that could not be ticked is reported, not silently skipped',
  /Could not tick a required declaration box/.test(tick), true);

/* ── 15. multiple-choice questions on every component library ──────────────── */
console.log('choice questions work on web components, not just <input type=radio>');
const choiceSel = src.match(/const CHOICE_CONTROL_SEL = ([\s\S]*?);\n/)[1];
for (const tag of ['input[type=radio]', '[role="radio"]', 'spl-radio', 'oj-radio', 'mat-radio-button', 'sl-radio', 'ion-radio'])
  eq(`choice options: ${tag} is looked for`, choiceSel.includes(tag), true);
eq('the choice answerer enumerates all of them',
  /deepAll\(CHOICE_CONTROL_SEL\)/.test(body('answerChoiceGroups')), true);
eq('"already answered" is read from the component, not just input.checked',
  /radios\.some\(choiceChecked\)/.test(body('answerChoiceGroups')), true);
const cl = body('choiceLabel');
eq('an option label is read out of its shadow root when that is where it lives',
  /r\.shadowRoot/.test(cl), true);
const commit = body('commitChoice');
eq('committing a choice escalates past .click()',
  /realClick\(el\)/.test(commit) && /triggerMouse\(el\)/.test(commit), true);
eq('it falls back to the associated label', /label\[for=/.test(commit), true);
eq('and finally to the native input plus change events',
  /innerNative\(el, 'input\[type=radio\],input\[type=checkbox\]'\)/.test(commit), true);
eq('unanswered web-component questions count as missing required fields',
  /deepAll\(CHOICE_CONTROL_SEL, 200\)/.test(body('getMissingRequired')), true);
eq('so do unticked required declarations',
  /deepAll\(CONSENT_CONTROL_SEL, 100\)/.test(body('getMissingRequired')), true);

/* ── 16. every ATS goes through the universal passes ───────────────────────── */
/* Per-ATS drivers only handle what is special about their platform. Everything
   universal — dependent questions, declarations, still-required fields — has to
   be reached whichever driver ran, or a fix only lands on the site it was
   reported from. */
console.log('the universal passes are reached from every driver');
eq('the multi-page driver runs the guarantor on every page',
  /await guaranteeRequiredFields\(\);/.test(body('multiPageLoop')), true);
eq('the tailor-first flow runs it too', /await guaranteeRequiredFields\(\);/.test(body('tailorFirstFlow')), true);
eq('so does the no-sidebar direct flow', /await guaranteeRequiredFields\(\);/.test(body('directAutofillFlow')), true);
eq('and every driver ends in the multi-page driver',
  /if \(!confirmSubmitted\(\)\) await multiPageLoop\(\);/.test(src), true);
eq('Oracle waits for its next step rather than sleeping',
  (src.match(/if \(r === 'next_page'\) \{ await waitForStepChange\(stepSig, 15000\); continue; \}/g) || []).length, 2);
eq('no driver still blind-sleeps 2.5s in place of a step change',
  /if \(r === 'next_page'\) \{ await sleep\(2500\); continue; \}/.test(src), false);

/* ── 17. getting off the job description and into the application ─────────── */
/* A queued URL lands on the JD page, not the form. If the entry point isn't
   recognised the job is skipped before autofill ever runs — and every platform
   names that button differently. SmartRecruiters' ServiceNow JD page says
   "I'm interested", with a CURLY apostrophe. */
console.log('the apply entry point is found on every JD page');
const applySrc = src.slice(src.indexOf('function normLabel('));
const applyCtx = {};
new Function('exports', `
  ${applySrc.slice(0, applySrc.indexOf('\n  /* Scored, not first-match'))}
  Object.assign(exports, { normLabel, isApplyLabel, APPLY_TEXT_RE, APPLY_BAD_RE });
`)(applyCtx);
const { isApplyLabel } = applyCtx;

eq('a curly apostrophe is normalised to a straight one', applyCtx.normLabel('I’m interested'), "I'm interested");
for (const [label, want] of [
  ['I’m interested', true],          // SmartRecruiters JD page, curly quote
  ["I'm interested", true],
  ['I am interested', true],
  ['Apply', true],
  ['Apply Now', true],
  ['Apply for this job', true],           // Greenhouse / Lever
  ['Apply to this job', true],            // ADP
  ['Apply for this position', true],
  ['Apply for this role', true],
  ['Apply online', true],
  ['Easy Apply', true],
  ['Quick apply', true],
  ['1-Click Apply', true],
  ['One click apply', true],
  ['Start your application', true],
  ['Begin application', true],
  ['Continue to application', true],
  ['Go to application', true],
  ['Express your interest', true],
  ['Register your interest', true],
  ['Submit your resume', true],
  ['Postuler', true],
  ['Jetzt bewerben', true],
  ['Solicitar', true],
  ['Solliciteer', true],
  // …and the ones that only look like Apply:
  ['Refer a friend', false],              // sits right under "I'm interested"
  ['Share this job', false],
  ['Save job', false],
  ['Already applied', false],
  ['Applied', false],
  ['How to apply', false],
  ['Apply filters', false],
  ['Sign in', false],
  ['Create an account', false],
  ['View all jobs', false],
  ['Similar jobs', false],
  ['Back to search', false],
  ['Withdraw application', false],
  ['Show all jobs', false],
  ['Refer', false],
]) eq(`apply entry: "${label}" → ${want}`, isApplyLabel(label), want);

const fab = body('findApplyButton');
eq('the apply finder is shadow- and frame-aware', /deepAll\(/.test(fab) && !/(?<![\w$])\$\$?\(/.test(fab), true);
eq('it scores rather than taking the first match in the DOM',
  /if \(score > bestScore\) \{ bestScore = score; best = b; \}/.test(fab), true);
eq('an Apply in a "similar jobs" list loses to the real one',
  /similar" i\],\[class\*="other-job" i\]/.test(fab), true);
eq('"Apply with LinkedIn" loses to a plain Apply', /\\bwith\\b\|\\bvia\\b\|\\busing\\b/.test(fab), true);
eq('the apply-choice modal lookup is deep too', /deepOne\('\[data-automation-id="applyManually"\]'\)/.test(src), true);
eq('findButtonByText no longer uses a blind document query',
  !/(?<![\w$])\$\$?\(/.test(body('findButtonByText')), true);

const srDriver = src.slice(src.lastIndexOf('async function smartRecruitersAutomation'));
eq('SmartRecruiters recognises its application paths, not just /apply',
  /oneclick-ui\|screening/.test(srDriver), true);
eq('it uses the shared apply vocabulary', /isApplyLabel\(/.test(srDriver), true);
eq('and waits for the JD page to actually navigate', /await waitForStepChange\(before, 15000\)/.test(srDriver), true);
eq('Oracle and ADP use the same vocabulary',
  (src.match(/find\(b => isApplyLabel\(/g) || []).length >= 3, true);

/* ── 18. the autofill must converge ────────────────────────────────────────── */
/* SmartRecruiters re-filled the same fields over and over. Two causes:
   the step fingerprint was unstable, so every caller believed the page kept
   changing; and a Spark <spl-input> never heard our events, so its model stayed
   empty, it re-rendered the field blank, and the next pass typed it again. */
console.log('filling converges instead of looping');

const sig = body('stepSignature');
eq('the fingerprint never reads a label — labels carry validation text that changes as we fill',
  /getLabel\(/.test(sig), false);
eq('it keys on stable identifiers', /getAttribute\('data-automation-id'\)/.test(sig), true);
eq('and falls back to a structural position, not text',
  /while \(\(n = n\.previousElementSibling\)\) idx\+\+;/.test(sig), true);

eq('every synthetic event can leave a shadow root',
  (src.match(/bubbles: true \}\)/g) || []).length, 0);
eq('there is one place that builds them', /function fireEvent\(el, type, init\)/.test(src), true);
eq('composed is not optional there', /Object\.assign\(\{ bubbles: true, composed: true \}, init \|\| \{\}\)/.test(src), true);
eq('and the wrapping web component is told as well', /function fireOnHostChain\(el, types\)/.test(src), true);
eq('nativeSet uses it, so a spl-input actually learns the value',
  /fireOnHostChain\(el, \['focus', 'input', 'change'\]\)/.test(body('nativeSet')), true);
eq('setSelectValue too', /fireOnHostChain\(sel, \['input', 'change', 'blur'\]\)/.test(body('setSelectValue')), true);

const ffw = src.match(/async function fallbackFill\(\.\.\.a\) \{[\s\S]*?\n  \}/)[0];
eq('a fill cannot start inside another fill', /if \(_fillDepth > 0\) return 0;/.test(ffw), true);
eq('and an unchanged step gets a bounded number of passes', /if \(!fillBudgetOk\(\)\) return 0;/.test(ffw), true);
const budget = body('fillBudgetOk');
eq('the budget resets when the step really does change',
  /if \(sig !== _fillBudgetSig\) \{ _fillBudgetSig = sig; _fillBudgetUsed = 0;/.test(budget), true);
eq('the cap is small enough to notice', /const FILL_PASSES_PER_STEP = 4;/.test(src), true);
eq('and it says so once rather than silently stopping', /not filling it again/.test(budget), true);
const rdw = src.match(/async function resolveDependentQuestions\(\.\.\.a\) \{[\s\S]*?\n  \}/)[0];
eq('the dependent-question loop cannot nest either', /if \(_dependentDepth > 0\) return 0;/.test(rdw), true);

const ledger = body('writeAllowed');
eq('a field that will not keep its value is written at most three times', /rec\.tries >= 3/.test(ledger), true);
eq('a different value resets the count', /if \(!rec \|\| rec\.val !== val\)/.test(ledger), true);
eq('and it is reported once, not every pass', /if \(!rec\.warned\)/.test(ledger), true);
eq('the fill pass consults the ledger before typing',
  (body('fallbackFill').match(/if \(!writeAllowed\(inp, val\)\) continue;/g) || []).length, 2);

const sr = src.slice(src.lastIndexOf('async function smartRecruitersAutomation'));
eq('a SmartRecruiters step that will not advance is abandoned, not re-filled',
  /if \(stuckSteps >= 2\) \{/.test(sr), true);
eq('and a step that does advance resets the counter', /if \(moved\) \{ stuckSteps = 0; continue; \}/.test(sr), true);

/* ── 19. the CV actually reaches the uploader ──────────────────────────────── */
console.log('CV attachment on web-component uploaders');
const att = body('attachResume');
eq('the file input is told with composed events on the host chain',
  /fireOnHostChain\(inp, \['input', 'change'\]\)/.test(att), true);
eq('a drag-and-drop is tried when the change event alone does nothing',
  /for \(const zone of uploadDropTargets\(inp\)\)/.test(att), true);
eq('and a failure is reported rather than assumed to have worked',
  /the uploader never acknowledged the file/.test(att), true);
const targets = body('uploadDropTargets');
eq('drop targets include the shadow hosts above the input, which closest() cannot reach',
  /r\.host/.test(targets) && /spl-file-upload/.test(targets), true);
const already = body('resumeAlreadyAttached');
eq('a format hint is not mistaken for an attached file', /const HINT_RE =/.test(already), true);
eq('and the filter is actually applied, not just declared',
  /if \(HINT_RE\.test\(t\)\) continue;/.test(already), true);
for (const [text, want] of [
  ['Maxmilliam_Okafor_CV.pdf', true],
  ['resume.docx', true],
  ['PDF, DOC, DOCX up to 5MB', false],
  ['e.g. resume.pdf', false],
  ['Drag and drop your file here, or browse', false],
  ['Accepted formats: .pdf, .doc', false],
]) {
  const HINT = new Function('return ' + already.match(/const HINT_RE = (\/[\s\S]*?\/i);/)[1])();
  const looksLikeFile = /[\w)]\.(pdf|docx?|rtf|txt|odt)\b/i.test(text) && !HINT.test(text);
  eq(`attachment chip: "${text}" → ${want ? 'a real file' : 'just instructions'}`, looksLikeFile, want);
}

/* ── 20. the answer has to fit the control it goes into ───────────────────── */
/* "5-8" is the right thing to click in a dropdown of ranges and the wrong thing
   to type into a "How many years…?" box — the ATS parses that box as a number.
   And a fuzzy saved-answer match kept putting "Yes" into boxes asking for a
   name, an explanation, or a US state. Both are run for real here, not
   pattern-matched: the shape logic is lifted out of the shipped file. */
console.log('answers are shaped for the control');
/* The shape logic now leans on the cover-letter tailoring defined just above
   guessValue, so the slice starts there. Everything it reaches outside the block
   is stubbed, so what runs here is the shipped logic and nothing else. */
const shapeStart = src.indexOf('  const COVER_FIELD_RE =');
const shapeEnd = src.indexOf('\n  function guessFieldValue(');
if (shapeStart < 0 || shapeEnd < 0) throw new Error('answer-shape block not found');
const shapeCtx = { company: '', title: '', required: false };
const shippedYears = (src.match(/\n\s*years:\s*'(\d+)'/) || [])[1];
if (!shippedYears) throw new Error('DEFAULTS.years not found');
new Function('exports', `
  const getFullQuestionText = () => '';
  const getLabel = () => '';
  const LOG = () => {};
  const queue = [];
  const extractJDCompany = () => exports.company;
  const extractJDTitle = () => exports.title;
  const isFieldRequired = () => exports.required;
  const location = { hostname: 'boards.greenhouse.io', pathname: '/', search: '' };
  // The REAL shipped default, read out of the file — so changing it in the
  // extension changes what these assertions are checking against.
  const DEFAULTS = { years: ${JSON.stringify(shippedYears)} };
${src.slice(shapeStart, shapeEnd)}
  Object.assign(exports, { refineAnswerForControl, looksLikeYesNoQuestion, isFreeTextControl,
    tailorCoverText, todayForField, pageCompanyName, COVER_FIELD_RE });
`)(shapeCtx);
const refine = (val, q, el) => shapeCtx.refineAnswerForControl(val, q, {}, el);
const textBox = { tagName: 'INPUT', type: 'text' };
const numberBox = { tagName: 'INPUT', type: 'number' };
const area = { tagName: 'TEXTAREA' };
const dropdown = { tagName: 'SELECT' };

// A range in a free-text years box becomes one integer — the top of the range.
for (const [val, want] of [
  ['5-8', '8'], ['3-5', '5'], ['0-2', '2'], ['5 - 8', '8'], ['5 to 8', '8'],
  ['8+', '8'], ['more than 5', '5'], ['at least 10', '10'], ['10+ years', '10'],
  ['5-8 years', '8'],
  ['7', '7'],                       // already a number — untouched
]) eq(`"${val}" in a "How many years…" box → ${want}`,
  refine(val, 'How many years of Software/Risk Quality Assurance experience do you have?', textBox), want);

eq('the same range is left alone for a dropdown, where it is a real option',
  refine('5-8', 'How many years of SaMD/Digital health experience do you have?', dropdown), '5-8');
eq('a number box gets the number out of a wordy answer',
  refine('about 8 years', 'Years of experience', numberBox), '8');
eq('a salary box is untouched', refine('45000', 'What are your base salary expectations for this role?', numberBox), '45000');

/* Zero years is a knockout, and one reached a live Comeet application:
   "How many years of hands-on experience do you have with Linux system
   administration and troubleshooting?" was submitted as 0. Every route to an
   unusable number now lands on the real figure instead. */
const LINUX_Q = 'How many years of hands-on experience do you have with Linux system administration and troubleshooting?';
for (const [val, why] of [
  ['0', 'a saved zero'],
  ['00', 'a padded zero'],
  ['0 years', 'zero with a unit'],
  ['', 'nothing resolved at all'],
  ['about eight', 'prose a number box cannot parse'],
]) eq(`${why} never reaches a years box`, refine(val, LINUX_Q, numberBox), shippedYears);
eq('and the same holds in a free-text years box', refine('0', LINUX_Q, textBox), shippedYears);
eq(`the figure it falls back to is the shipped default (${shippedYears})`, shippedYears, '7');
eq('a real answer of zero to something that is NOT a years question is kept',
  refine('0', 'How many dependents do you have?', numberBox), '0');
eq("the candidate's own profile figure beats the default",
  shapeCtx.refineAnswerForControl('0', LINUX_Q, { years_experience: '11' }, numberBox), '11');

// A Yes/No where a value belongs.
eq('"Yes" is not the name of an employee',
  refine('Yes', 'If answered Yes, please provide the name of the employee who works at Heartflow.', textBox), 'N/A');
eq('"Yes" is not an explanation', refine('Yes', 'If yes, please explain. If no, add N/A', textBox), 'N/A');
eq('"Yes" is not a relative and an organization',
  refine('Yes', 'If answered Yes, please provide the name of the relative and the name of the organization in which they are employed.', area), 'N/A');
eq('"Yes" is dropped on a state dropdown so a real option can be chosen',
  refine('Yes', 'What state do you reside in?', dropdown), '');
eq('a genuine Yes/No question keeps its Yes',
  refine('Yes', 'Are you legally authorized to work in the United States?', textBox), 'Yes');
eq('and so does a No', refine('No', 'Do you have any immediate family that work at Heartflow?', textBox), 'No');
eq('a real answer is never rewritten', refine('Dublin', 'Location (City)', textBox), 'Dublin');

for (const [q, want] of [
  ['Are you legally authorized to work in the United States?', true],
  ['Do you have previous SaMD/digital health experience?', true],
  ['Have you ever been debarred by the U.S. FDA?', true],
  ['Will you now or in the future require sponsorship?', true],
  ['What state do you reside in?', false],
  ['How many years of experience do you have?', false],
  ['If answered Yes, please provide the name of the employee who works at Heartflow.', false],
  ['Which of the following certifications do you hold?', false],
  ['Please explain your answer', false],
]) eq(`yes/no answerable: "${q.slice(0, 44)}…" → ${want}`, shapeCtx.looksLikeYesNoQuestion(q), want);

/* ── 21. the higher qualifying experience band wins ───────────────────────── */
/* Bands overlap on their boundaries — 5 years qualifies for both "3-5" and
   "5-8" — and whichever came first in the DOM used to win. */
console.log('experience bands prefer more experience');
const scoreCtx = {};
new Function('exports', body('scoreExperienceRange') + '\nexports.scoreExperienceRange = scoreExperienceRange;')(scoreCtx);
const pickBand = (options, years) => {
  let best = null, bestScore = 0;
  for (const o of options) { const sc = scoreCtx.scoreExperienceRange(o, years); if (sc > bestScore) { bestScore = sc; best = o; } }
  return best;
};
const BANDS = ['0-2', '3-5', '5-8', '8+'];
eq('5 years on overlapping bands takes the higher one', pickBand(BANDS, 5), '5-8');
eq('4 years takes 3-5', pickBand(BANDS, 4), '3-5');
eq('9 years takes 8+', pickBand(BANDS, 9), '8+');
eq('1 year takes 0-2', pickBand(BANDS, 1), '0-2');
eq('order in the DOM does not decide it', pickBand([...BANDS].reverse(), 5), '5-8');
eq('"more than 5" qualifies at exactly 5', scoreCtx.scoreExperienceRange('More than 5 years', 5) > 0, true);
eq('a band above the candidate is not claimed', scoreCtx.scoreExperienceRange('8+', 5), 0);
eq('"10+" beats "5+" for a 12-year candidate',
  scoreCtx.scoreExperienceRange('10+', 12) > scoreCtx.scoreExperienceRange('5+', 12), true);

/* ── 22. a checkbox question gets ONE answer, not all of them ─────────────── */
/* "How did you hear about this job?" ships nine boxes and the question is
   required, so the required-checkbox sweep ticked every one — telling the
   employer the candidate found the job on all nine channels at once. */
console.log('checkbox questions get a single answer');
const groups = body('answerCheckboxGroups');
eq('a group is answered once', /if \(group\.some\(checkboxChecked\)\) continue;/.test(groups), true);
eq('the option matching what we would have typed is preferred',
  /guessFieldValue\(q, p, null\)/.test(groups), true);
eq('"Other" / "None" / "Prefer not to say" is a last resort',
  /\(other\|none\|n\\\/\?a\|prefer not\|do not\|decline\)/.test(groups), true);
eq('exactly one box is ticked per question',
  (groups.match(/await setCheckboxChecked\(pick\)/g) || []).length, 1);
const grp = body('checkboxGroup');
eq('a group is found by shared name or shared question container',
  /input\[type=checkbox\]\[name=/.test(grp) && /closest\('fieldset/.test(grp), true);
eq('an over-wide container is not treated as one giant question',
  /peers\.length >= 2 && peers\.length <= 25/.test(grp), true);
eq('the consent sweep leaves multiple-choice options alone',
  /if \(checkboxGroup\(cb\)\.length\) continue;/.test(body('tickConsentBoxes')), true);
eq('and so does the required-field sweep',
  /if \(checkboxGroup\(el\)\.length\) continue;/.test(body('guaranteeRequiredFieldsPass')), true);
eq('checkbox questions are answered in every dependent-question round',
  /await answerCheckboxGroups\(\)/.test(body('resolveDependentQuestions')), true);

/* ── 23. work authorisation — the knockout that costs a real application ───── */
/* A recruiter wrote back: "I see that you filled in you're not allowed to work
   in Belgium. Is that correct? I see you're willing to move. We do not provide
   Visa sponsorship." The form had answered NO to an eligibility question,
   because ONE rule answered No to any question containing "visa" or "sponsor".

   These run the real decider — pulled out of the shipped file — against the
   phrasings the supported ATS actually ship, in both spellings. */
console.log('work authorisation is decided by what the question asks');
const waStart = src.indexOf('  const SPONSORSHIP_WORD_RE =');
const waEnd = src.indexOf('\n  // Smart Yes/No determination based on question context');
if (waStart < 0 || waEnd < 0) throw new Error('work-authorisation block not found');
const waCtx = {};
new Function('exports', `
${src.slice(waStart, waEnd)}
  Object.assign(exports, { workAuthorisationAnswer, RELOCATION_RE });
`)(waCtx);
const wa = waCtx.workAuthorisationAnswer;

// ELIGIBILITY — "can you work here?" — always Yes.
for (const q of [
  'Are you allowed to work in Belgium?',
  'Are you legally allowed to work in Belgium?',
  'Are you legally authorised to work in the country in which you are applying for a role?',
  'Are you legally authorized to work in the United States?',
  'Are you eligible to work in the EU?',
  'Do you have the right to work in the UK?',
  'Do you have permission to work in Ireland?',
  'Are you entitled to work in the Netherlands?',
  'Are you permitted to work in Germany?',
  'Can you work in Canada without restriction?',
  'Do you have unrestricted work rights in Australia?',
  'Are you lawfully able to work in this country?',
  'Can you provide proof of your right to work?',
  'Do you have settled status in the UK?',
  // …and the same question with sponsorship named only to RULE IT OUT:
  'Are you legally authorised to work in Belgium without visa sponsorship?',
  'Are you authorized to work in the US for any employer without sponsorship?',
  'Are you legally authorized to work in the country of hire and will not require sponsorship now or in the future?',
  'Do you have the right to work in the UK that does not require sponsorship?',
  'Are you eligible to work in Ireland with no sponsorship needed?',
  // POSSESSION — holding the document is the same as being allowed.
  'Do you hold a valid work permit for Belgium?',
  'Do you have a current visa allowing you to work in Singapore?',
  'Do you hold citizenship or permanent residency in the country of employment?',
]) eq(`eligible → Yes: "${q.slice(0, 58)}${q.length > 58 ? '…' : ''}"`, wa(q), 'yes');

// NEED — "do you need us to sponsor you?" — always No.
for (const q of [
  'Do you now or in the future require visa sponsorship?',
  'Will you now or in the future require sponsorship for employment visa status (e.g. F-1 STEM OPT, H-1B, TN, E-3, O-1)?',
  'Do you require sponsorship to work in the United Kingdom?',
  'Would you need visa sponsorship for this role?',
  'Do you need a work permit to work in Belgium?',
  'Are you dependent on visa sponsorship to maintain employment?',
  'Do you require a Tier 2 / Skilled Worker visa?',
  'Will you require immigration support to work in this position?',
  'Do you seek sponsorship for employment authorization?',
  'Visa sponsorship required for this job?',
]) eq(`needs sponsorship → No: "${q.slice(0, 58)}${q.length > 58 ? '…' : ''}"`, wa(q), 'no');

/* The decider must not claim questions that merely use its vocabulary. Answering
   "have you ever been legally convicted?" Yes would be worse than the bug. */
for (const q of [
  'Have you ever been legally convicted of a felony?',
  // The dangerous ones: they carry BOTH the work context and the vocabulary, so
  // only the excluded-topic guard keeps the decider off them. Answering these
  // "Yes" would be far worse than the bug that prompted the decider.
  'Have you ever been convicted of a crime that would prevent you from being legally permitted to work in this role?',
  'Have you ever been terminated from a job you were legally authorised to hold?',
  'Are you subject to any restrictive covenant that limits where you are permitted to work?',
  'Will you consent to a background check before you are permitted to start work?',
  'Have you ever been debarred or excluded by the U.S. FDA or the OIG?',
  'Are you subject to a non-compete or restrictive covenant?',
  'Have you ever been terminated or dismissed from a position?',
  'Are you willing to complete a background check?',
  'Are you legally permitted to disclose your notice period?',   // no work/employment context
  'What is your preferred pronoun?',
  'How many years of experience do you have?',
]) eq(`not a work-authorisation question: "${q.slice(0, 52)}…"`, wa(q), null);

// Relocation / mobility — the other half of that email.
for (const q of [
  'Are you willing to relocate?',
  'Are you willing to move to Belgium?',
  'Would you consider relocating for a role with ServiceNow?',
  'If you selected Yes, would you consider relocating at your own expense?',
  'Are you open to relocation?',
  'Are you prepared to move for this position?',
  'Are you happy to relocate to the San Francisco Bay Area?',
  'Are you able to commute to the office three days a week?',
  'Are you willing to travel up to 25%?',
]) eq(`mobility → Yes: "${q.slice(0, 52)}${q.length > 52 ? '…' : ''}"`, waCtx.RELOCATION_RE.test(q.toLowerCase()), true);

// The exact regression, both spellings, end to end through the choice answerer.
const cca = body('chooseChoiceAnswer');
eq('the choice answerer uses the one decider, not a bare visa/sponsor rule',
  /const wa = workAuthorisationAnswer\(q\);/.test(cca), true);
eq('the old "any mention of visa → No" rule is gone',
  /if \(\/sponsor\|visa\|work\\s\?permit\|immigration\|h-\?1b\/\.test\(q\)\) return 'no';/.test(src), false);
eq('British spelling is recognised', wa('Are you authorised to work in Belgium?'), 'yes');
eq('American spelling still is', wa('Are you authorized to work in Belgium?'), 'yes');
eq('the guessers share the decider too',
  /const wa = workAuthorisationAnswer\(label \|\| ''\);/.test(body('guessValue')), true);
eq('and so does the yes/no analyser',
  /const wa = workAuthorisationAnswer\(q\);/.test(body('determineYesNo')), true);
eq('relocation is decided after the strong-No knockouts, not before',
  body('determineYesNo').indexOf('RELOCATION_RE.test(q)') > body('determineYesNo').indexOf('strongNo.some'), true);

/* ── 24. the decision must land on the right OPTION ───────────────────────── */
/* Deciding "yes" is only half of it. Most ATS word their options rather than
   offering literal Yes/No, and the grammar points the opposite way to the
   meaning in both directions:

     "I require visa sponsorship"     — grammatically affirmative, wrong answer
     "Does not require sponsorship"   — grammatically negative,   right answer

   "Yes, I am authorized to work in the US without sponsorship" was read as
   NEGATIVE because it contains "without", so on a two-option question the
   answerer selected "No, I require sponsorship". That is what the Predikt
   recruiter read as "you filled in you're not allowed to work in Belgium". */
console.log('a work-authorisation answer lands on the right option');
const optCtx = {};
new Function('exports', `
${src.slice(src.indexOf('  const SPONSORSHIP_WORD_RE ='), src.indexOf('\n  // Smart Yes/No determination based on question context'))}
${body('isDeclineOption')}
${body('optionPolarity')}
${body('workAuthOptionIndex')}
${body('optionIndexForDecision')}
  Object.assign(exports, { optionPolarity, optionIndexForDecision, workAuthOptionIndex });
`)(optCtx);

for (const [text, want] of [
  ['Yes, I am authorized to work in the US without sponsorship', 1],
  ['Yes', 1],
  ['I am authorized to work without sponsorship', 1],
  ['I am legally authorised to work in Belgium and do not require a visa', 1],
  ['Eligible to work, no visa required', 1],
  ['I hold a valid work permit', 1],
  ['No, I require sponsorship', -1],
  ['No', -1],
  ['I am not authorized to work in this country', -1],
  ['Not authorized', -1],
  ['Does not require sponsorship', -1],
]) eq(`option polarity: "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}" → ${want}`,
  optCtx.optionPolarity(text), want);

/* The dedicated matcher needs no decision threaded through it: there is only one
   stance to express — I can work here and do not need sponsoring — however the
   question is phrased. */
const stance = (opts) => { const i = optCtx.workAuthOptionIndex(opts.map(o => o.toLowerCase())); return i >= 0 ? opts[i] : null; };
const PAIRS = [
  ['Yes, I am authorized to work in the US without sponsorship', 'No, I require sponsorship'],
  ['I am legally authorised to work in Belgium', 'I require visa sponsorship to work in Belgium'],
  ['Yes', 'No'],
  ['I have the right to work in the UK without sponsorship', 'I will need sponsorship'],
  ['Does not require sponsorship', 'Requires sponsorship'],
  ['I am authorized to work in this country', 'I am not authorized to work in this country'],
  ['I hold citizenship or permanent residency', 'I would need a Tier 2 / Skilled Worker visa'],
];
for (const pair of PAIRS) {
  const label = pair[0].slice(0, 42) + (pair[0].length > 42 ? '…' : '');
  eq(`picks "${label}"`, stance(pair), pair[0]);
  eq(`  …whichever order the options are listed in`, stance([...pair].reverse()), pair[0]);
}

// End to end: the question decides the family, the family picks the option.
const pick = (opts, q) => {
  const decision = optCtx.workAuthorisationAnswer ? null : null;
  const i = optCtx.optionIndexForDecision(opts.map(o => o.toLowerCase()), 'yes', q);
  return i >= 0 ? opts[i] : null;
};
eq('an eligibility question picks the eligible option',
  pick(['No, I require sponsorship', 'Yes, I am authorized to work in the US without sponsorship'],
    'Are you legally authorised to work in Belgium?'),
  'Yes, I am authorized to work in the US without sponsorship');
eq('a sponsorship question picks the does-not-require option even on a "yes" decision',
  pick(['Requires sponsorship', 'Does not require sponsorship'],
    'Will you now or in the future require visa sponsorship?'),
  'Does not require sponsorship');
eq('a question outside the family is untouched by the work-auth matcher',
  optCtx.optionIndexForDecision(['yes', 'no'], 'decline', 'What is your gender?') , -1);
eq('EEO still declines',
  (() => { const i = optCtx.optionIndexForDecision(['male', 'female', 'i prefer not to say'], 'decline', 'What is your gender?'); return i; })(), 2);

// Every caller passes the question through, or the family is never recognised.
eq('the knockout radio answerer passes the question',
  /optionIndexForDecision\(labels, decision, questionText\)/.test(src), true);
eq('the button-style answerer does', /optionIndexForDecision\(btnTexts, decision, groupText\)/.test(src), true);
eq('the native select answerer does', /optionIndexForDecision\(texts, decision, q\)/.test(src), true);
eq('the custom dropdown answerer does', /optionIndexForDecision\(texts, decision, lbl \|\| ''\)/.test(src), true);
eq('and pickChoice does', /optionIndexForDecision\(labels, want, question\)/.test(src), true);

/* ── 25. the run must not end itself on a cross-site job ──────────────────── */
/* One defect, three symptoms: the run stopping on its own, the "Automation In
   Progress" panel vanishing mid-run, and a queue that looks busy while reporting
   0 applied.

   A content script has exactly one piece of per-tab scratch space — window.name —
   and Chrome CLEARS it whenever a tab navigates between different SITES. A CSV
   run drives ONE tab from greenhouse.io to lever.co to smartrecruiters.com, so
   the runner marker was wiped at the first cross-site job. It looked random
   because it depends on whether consecutive jobs share a site. It isn't. */
console.log('runner identity survives a cross-site navigation');
eq('the service worker can answer "which tab am I?"', /msg\.type === 'UA_WHICH_TAB'/.test(orch), true);
eq('it answers from the sender, which no navigation can forge',
  /const tabId = sender && sender\.tab && sender\.tab\.id;\n        sendResponse\(\{ tabId/.test(orch), true);

/* Two copies exist on purpose — the fail-closed master gate at the top of the
   file has its own, in its own scope. BOTH had the bug: the gate's copy going
   false meant the run was forbidden from acting at all on that page. */
const runnerCopies = src.match(/function isRunnerTab\(\) \{[\s\S]*?\n  \}/g) || [];
eq('both copies of the runner check were fixed, not just one', runnerCopies.length, 2);
for (const [i, copy] of runnerCopies.entries()) {
  eq(`copy ${i + 1}: window.name is still the fast synchronous path`,
    /window\.name\.indexOf\(RUNNER_PREFIX\) === 0\) return true;/.test(copy), true);
  eq(`copy ${i + 1}: but it is no longer the only evidence`,
    /_runnerTabConfirmed === true|myTab === runnerTabId/.test(copy), true);
}
eq('the master gate learns which tab it is', /chrome\.runtime\.sendMessage\(\{ type: 'UA_WHICH_TAB' \}/.test(src), true);
eq('and which tab is driving the run', /'ua_aa', 'ua_qa', 'ua_runner_tab'/.test(src), true);
eq('it keeps that in sync while the run moves', /if \(changes\.ua_runner_tab\)/.test(src), true);
eq('the gate is still fail-closed without evidence',
  /return myTab != null && runnerTabId != null && myTab === runnerTabId;/.test(src), true);

const confirm = body('confirmRunnerTab');
eq('the marker is rebuilt by asking the worker for this tab id', /const id = await myTabId\(\);/.test(confirm), true);
eq('it is compared against the tab that started the run', /const match = id === stored;/.test(confirm), true);
eq('window.name is restored so same-site hops stay cheap',
  /if \(match\) \{[\s\S]{0,140}?window\.name = RUNNER_PREFIX/.test(confirm), true);
eq('a worker that cannot answer never downgrades a confirmed runner',
  /if \(id == null\) return _runnerTabConfirmed === true;/.test(confirm), true);
eq('and a finished run clears it', /\(await st\.get\(SK\.QA\)\) !== true\) \{ _runnerTabConfirmed = false/.test(confirm), true);
eq('starting a run records which tab is driving it',
  /st\.set\(RUNNER_TAB_KEY, id\)/.test(body('markRunnerTab')), true);
eq('and finishing one forgets it', /st\.set\(RUNNER_TAB_KEY, null\)/.test(body('unmarkRunnerTab')), true);

eq('the queue driver asks before standing down, instead of ending the run',
  /if \(!isRunnerTab\(\) && !\(await confirmRunnerTab\(\)\)\) return;/.test(body('processQ')), true);
eq('the old unconditional bail is gone',
  /\/\/ Only the dedicated runner tab drives the queue[\s\S]{0,120}?if \(!isRunnerTab\(\)\) return;/.test(src), false);

/* ── 26. the progress panel stays up until the run is actually finished ────── */
console.log('the Automation In Progress panel cannot vanish mid-run');
const upd = body('updateCtrl');
eq('only a finished run may hide the panel', /\} else if \(!qActive\) \{/.test(upd), true);
eq('an unconfirmed identity does not hide it',
  /\} else \{ ctrl\.classList\.remove\('show'\); \}/.test(upd), false);
const obs = body('observe');
eq('the panel watchdog is not gated on the thing it exists to repair',
  /if \(!isRunnerTab\(\)\) confirmRunnerTab\(\)\.then/.test(obs), true);
eq('it re-mounts and repaints every tick while a run is active',
  /ensureOverlay\(\);\n      updateCtrl\(\);/.test(obs), true);
const ovl = body('ensureOverlay');
eq('the panel hangs off <html>, so a single-page app replacing <body> cannot take it',
  /const host = document\.documentElement \|\| document\.body;/.test(ovl), true);
eq('page CSS cannot hide it', /#ua-ctrl\.show\{display:block!important\}/.test(src), true);
eq('nor can page CSS clamp it behind other content',
  /z-index:2147483647!important/.test(src), true);
eq('a cross-site boot still mounts the panel once identity is known',
  /confirmRunnerTab\(\)\.then\(\(ok\) => \{ if \(ok\) ensureOverlay\(\); \}\);/.test(src), true);

/* ── 27. a 1000-job CSV must not run one at a time ─────────────────────────── */
console.log('throughput is under the user\'s control');
eq('the engine supports parallel job tabs', /return Math\.min\(12, Math\.max\(1, isNaN\(n\) \? 3 : n\)\);/.test(orch), true);
eq('and now reports the value in force, so the panel does not reset it',
  /concurrency: Math\.min\(12, Math\.max\(1, parseInt\(await get\(K\.CONC\), 10\) \|\| 3\)\)/.test(orch), true);
const panelHtml = fs.readFileSync(process.argv[2].replace(/ua-enhancement\.js$/, 'ua-queue.html'), 'utf8');
const panelJs = fs.readFileSync(process.argv[2].replace(/ua-enhancement\.js$/, 'ua-queue.js'), 'utf8');
eq('the Queue Manager exposes it', /id="optConc"/.test(panelHtml), true);
eq('bounded to what the engine accepts', /min="1" max="12"/.test(panelHtml), true);
eq('changing it is saved', /ua_mgr_concurrency: Math\.max\(1, Math\.min\(12, parseInt\(\$\('optConc'\)\.value, 10\) \|\| 3\)\)/.test(panelJs), true);
eq('and takes effect without a restart, because the slot filler re-reads the key',
  /const \[cfg, conc, map\] = \[await settings\(\), await concurrency\(\), await reconcileTabs\(\)\];/.test(orch), true);
eq('the control is wired to the same save path as the rest',
  /'optSkip', 'optTailor', 'optConc', 'optTimeout', 'optStall', 'optHuman'/.test(panelJs), true);
eq('and it shows the value actually in force when the panel opens',
  /if \(typeof s\.concurrency === 'number'\) \$\('optConc'\)\.value = String\(s\.concurrency\);/.test(panelJs), true);

/* ── 28. account walls that ask for an email FIRST ────────────────────────── */
/* ADP's myjobs /auth screen asks for an email and nothing else — "Welcome! Let's
   find your dream job! If we don't recognize your info, we'll prompt you to
   create a profile." — and only reveals a password after Continue. Oracle
   Recruiting, iCIMS and Workday's newer flow do the same.

   The old detector was one line: `$$('input[type=password]').some(isVisible)`.
   On an email-first wall that is false, so handleAccountAuth returned
   immediately, nothing was filled, and the job sat on the sign-in screen showing
   "Email Address required." while the panel reported 0 applied. */
console.log('email-first account walls are recognised');
const auth = body('looksLikeAuthPage');
eq('a wall with no password field is still a wall',
  /if \(authPasswordFields\(\)\.length\) return true;\n    const email = authEmailField\(\);\n    if \(!email\) return false;/.test(auth), true);
eq('the old password-only test is gone',
  /function looksLikeAuthPage\(\) \{ return \$\$\('input\[type=password\]'\)\.some\(isVisible\); \}/.test(src), false);
eq('it needs corroboration, not just any email box on any page',
  /if \(!urlSaysAuth && !AUTH_COPY_RE\.test\(copy\)\) return false;/.test(auth), true);
eq('and an email box on the application itself is not a wall',
  /return !hasApplicationForm\(\);/.test(auth), true);

const AUTH_COPY = new Function('return ' + src.match(/const AUTH_COPY_RE = (\/[\s\S]*?\/i);/)[1])();
for (const [copy, want] of [
  ["Welcome! Let's find your dream job! If we don't recognize your info, we'll prompt you to create a profile.", true],
  ['Sign in to your account', true],
  ['Create an account to continue', true],
  ['Returning candidate? Log in.', true],
  ['Already have an account?', true],
  ['Enter your email to get started', true],
  ['Tell us about your work experience', false],
  ['Upload your resume to continue', false],
]) eq(`auth copy: "${copy.slice(0, 44)}…" → ${want}`, AUTH_COPY.test(copy), want);

const emailField = body('authEmailField');
eq('the email box is found through shadow DOM, which is how Oracle renders it',
  /deepAll\(/.test(emailField) && !/(?<![\w$])\$\$?\(/.test(emailField), true);
eq('a web component is unwrapped to its real input', /innerNative\(el, 'input'\)/.test(emailField), true);
eq('and a password box is never mistaken for the email box', /el\.type !== 'password'/.test(emailField), true);
eq('a plain text box with only a label still counts',
  /e-\?mail\|user\.\?name\|user\.\?id\|login/i.test(emailField), true);

const authSubmit = body('findAuthSubmit');
eq('"Continue" counts as the submit on an email-first wall', /continue\|next\|submit\|get started/.test(authSubmit), true);
eq('the submit finder is shadow-aware too',
  /deepAll\(/.test(authSubmit) && !/(?<![\w$])\$\$?\(/.test(authSubmit), true);
const SOCIAL = new Function('return ' + src.match(/const SOCIAL_AUTH_RE = (\/[\s\S]*?\/i);/)[1])();
for (const label of ['Sign in with LinkedIn', 'Continue with Google', 'Facebook', 'Sign in with Indeed', 'Use SSO'])
  eq(`social sign-in is never clicked: "${label}"`, SOCIAL.test(label), true);
eq('but the real Continue button is not excluded by it', SOCIAL.test('Continue'), false);
eq('the exclusion is actually applied', /&& !isSocial\(el\)/.test(authSubmit), true);

const authImpl = body('handleAccountAuth');
eq('the wall is walked in steps — email, then whatever it reveals',
  /for \(let step = 1; step <= 4; step\+\+\)/.test(authImpl), true);
eq('each step waits for the page to actually change', /await waitForStepChange\(before, 12000\)/.test(authImpl), true);
eq('and it stops the moment the wall is behind us', /if \(!looksLikeAuthPage\(\)\) break;/.test(authImpl), true);
eq('turning the automation off stops it mid-wall', /if \(autoStopped\(\)\) break;/.test(authImpl), true);
eq('a wall it cannot submit is left filled rather than clicked at random',
  /no usable Continue\/Sign-in button/.test(authImpl), true);
eq('personal logins are still off limits',
  /linkedin\|indeed\|glassdoor\|ziprecruiter\|dice\|monster/.test(authImpl), true);

/* ── 29. one account per employer, not one per hostname ───────────────────── */
/* Workday creates the account, then the next job at the same employer asks to
   create it again. Two causes: the account was only recorded if a watcher later
   happened to see the My Information page, and it was filed under the raw
   hostname — but Workday serves one tenant from wd1, wd3, wd5 and
   myworkdaysite.com. */
console.log('a created account is remembered per employer');
const keyCtx = {};
new Function('exports', `
  const location = { hostname: '' };
${body('accountKeyFor')}
  exports.accountKeyFor = accountKeyFor;
`)(keyCtx);
const key = keyCtx.accountKeyFor;
eq('the data centre is not part of the employer', key('acme.wd3.myworkdayjobs.com'), 'acme.myworkdayjobs.com');
eq('wd1 and wd5 are the same employer', key('acme.wd1.myworkdayjobs.com'), key('acme.wd5.myworkdayjobs.com'));
eq('and so is myworkdaysite.com', key('acme.wd1.myworkdaysite.com'), key('acme.wd3.myworkdayjobs.com'));
eq('www is not part of it either', key('www.acme.com'), 'acme.com');
eq('two different employers stay different',
  key('acme.wd1.myworkdayjobs.com') === key('other.wd1.myworkdayjobs.com'), false);
eq('a non-Workday host is untouched', key('myjobs.adp.com'), 'myjobs.adp.com');
eq('case is normalised', key('ACME.WD3.MyWorkdayJobs.COM'), 'acme.myworkdayjobs.com');

const wd = body('fillWorkdayCreateAccount');
eq('submitting Create Account records the account there and then',
  /clickEl\(createBtn\);[\s\S]{0,700}?await markAccountCreated\(location\.hostname\);/.test(wd), true);
eq('signing in records it too', /clickEl\(signInBtn\);\n        await markAccountCreated\(location\.hostname\);/.test(wd), true);
eq('and the site saying "already exists" is treated as proof',
  /if \(onCreate && existsErr\) \{[\s\S]{0,320}?await markAccountCreated\(location\.hostname\);/.test(wd), true);
eq('a known employer opens Sign In instead of Create Account',
  /if \(onCreate && known && !wrongCredErr\)/.test(wd), true);
eq('and a wrong-credentials error still flips back to Create Account',
  /if \(onSignIn && wrongCredErr\)/.test(wd), true);
eq('records written under the old raw-host key are still honoured',
  /Tolerate records written under a raw host/.test(body('accountExistsFor')), true);

/* ── 30. the message to the hiring team ───────────────────────────────────── */
/* "I keep seeing this text on a lot of my applications — is it misplaced?" It is
   not: it is the saved cover-letter text, pasted verbatim into every box whose
   label reads like a message to the hiring team. Identical wording across dozens
   of applications is worse than an empty box — it reads as a form letter and it
   names no employer. */
console.log('the hiring-team message is tailored, not repeated');
const SAVED = 'I am excited about the opportunity to contribute my experience in software engineering.';
const tailor = shapeCtx.tailorCoverText;

eq('the employer and role are named', tailor(SAVED, { company: 'ServiceNow', title: 'Principal ML Engineer' }),
  'I am applying for the Principal ML Engineer role at ServiceNow. ' + SAVED);
eq('the employer alone still gets named', tailor(SAVED, { company: 'ServiceNow' }),
  'I am writing to apply to ServiceNow. ' + SAVED);
eq('two different employers produce two different letters',
  tailor(SAVED, { company: 'ServiceNow' }) === tailor(SAVED, { company: 'Deloitte' }), false);
eq('text that already names the employer is left in the user\'s own words',
  tailor('I have followed ServiceNow for years.', { company: 'ServiceNow' }),
  'I have followed ServiceNow for years.');
eq('{company} and {title} placeholders are substituted',
  tailor('Dear {company}, I would love the {title} role.', { company: 'AMD', title: 'Analyst' }),
  'Dear AMD, I would love the Analyst role.');
eq('with nothing known, the saved text is returned unchanged', tailor(SAVED, {}), SAVED);
eq('and an empty saved text stays empty', tailor('', { company: 'AMD' }), '');

const msgBox = { tagName: 'TEXTAREA' };
{
  shapeCtx.company = 'ServiceNow'; shapeCtx.required = false;
  const out = shapeCtx.refineAnswerForControl(SAVED, 'Message to the Hiring Team', {}, msgBox);
  eq('an optional box IS filled when we can name the employer', /ServiceNow/.test(out), true);
}
{
  shapeCtx.company = ''; shapeCtx.required = false;
  eq('an optional box is left EMPTY when we cannot say anything specific',
    shapeCtx.refineAnswerForControl(SAVED, 'Message to the Hiring Team', {}, msgBox), '');
}
{
  shapeCtx.company = ''; shapeCtx.required = true;
  eq('but a REQUIRED box is still answered, because empty would block the application',
    shapeCtx.refineAnswerForControl(SAVED, 'Message to the Hiring Team', {}, msgBox), SAVED);
}
shapeCtx.company = ''; shapeCtx.required = false;
for (const [label, want] of [
  ['Message to the Hiring Team', true],
  ['Cover Letter', true],
  ['Why do you want to work here?', true],
  ['Anything else you\'d like us to know?', true],
  ['Additional information', true],
  ['First name', false],
  ['Message', false],                       // too generic on its own
]) eq(`cover field: "${label}" → ${want}`, shapeCtx.COVER_FIELD_RE.test(label), want);

console.log('the employer is worked out from the page when the CSV did not carry it');
eq('a white-labelled ATS host names the employer', shapeCtx.pageCompanyName.call({}), '');

/* ── 31. e-signature and today's date ─────────────────────────────────────── */
/* SmartRecruiters' preliminary questions end with "Name (Signature Field): *"
   and "Today's date *" — two REQUIRED free-text boxes, neither of which was
   recognised, so the step could not be submitted. */
console.log('signature and date fields are answered');
const guessSrc = body('guessValue');
eq('a signature box wants the applicant\'s name typed in',
  /signature\|sign here\|type your \(full \)\?name\|e-\?sign/.test(guessSrc), true);
eq('an upload-a-signature-image field is NOT typed into',
  /&& !\/upload\|image\|file\/\.test\(l\)/.test(guessSrc), true);
eq('a "today\'s date" box is recognised', /today\.\?s date\|date signed\|signature date/.test(guessSrc), true);

const today = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const DD = p2(today.getDate()), MM = p2(today.getMonth() + 1), YYYY = String(today.getFullYear());
const dateFor = (placeholder) => shapeCtx.todayForField({ tagName: 'INPUT', type: 'text', placeholder, getAttribute: () => '' });
eq('a DD/MM/YYYY field gets day first', dateFor('DD/MM/YYYY'), `${DD}/${MM}/${YYYY}`);
eq('an MM/DD/YYYY field gets month first', dateFor('MM/DD/YYYY'), `${MM}/${DD}/${YYYY}`);
eq('an ISO field gets ISO', dateFor('YYYY-MM-DD'), `${YYYY}-${MM}-${DD}`);
eq('an unmarked field gets the ATS default', dateFor(''), `${MM}/${DD}/${YYYY}`);
eq('the placeholder token never reaches the page',
  shapeCtx.refineAnswerForControl('__TODAY__', "Today's date", {}, { tagName: 'INPUT', type: 'text', placeholder: '', getAttribute: () => '' }),
  `${MM}/${DD}/${YYYY}`);

/* ── 32. give up fast on a job that cannot be won ─────────────────────────── */
/* A 544-job run reported 2 applied, 1 skipped, 13 FAILED. Most of those 13 could
   never have succeeded — a sign-in wall behind a reCAPTCHA, a posting that has
   closed — and each burned the CAPTCHA grace (1 min) and then the per-job cap
   (3 min) before being written off. Thirteen jobs at up to four minutes is the
   better part of an hour spent on nothing. */
console.log('unwinnable jobs are skipped in seconds, not minutes');
const unwin = body('unwinnableReason');
eq('a sign-in wall behind a CAPTCHA is recognised', /captchaBlocksSignIn\(\)/.test(unwin), true);
eq('and a closed posting', /CLOSED_POSTING_RE\.test\(copy\)/.test(unwin), true);
eq('a closed-looking page that still HAS a form is not skipped',
  /CLOSED_POSTING_RE\.test\(copy\) && !hasApplicationForm\(\)/.test(unwin), true);
eq('the reason names the CAPTCHA provider, so the log is actionable',
  /Sign-in is behind a \$\{\(c && c\.provider\) \|\| 'CAPTCHA'\}/.test(unwin), true);

const blocks = body('captchaBlocksSignIn');
eq('a CAPTCHA on the APPLICATION is not treated as unwinnable — you can solve that one',
  /looksLikeAuthPage\(\) \|\| authPasswordFields\(\)\.length > 0/.test(blocks), true);

eq('triage runs BEFORE the CAPTCHA wait, not after it',
  src.indexOf("LOG('Skipping fast: ' + dead)") < src.indexOf('if (detectCaptcha()) await waitForCaptchaClear();\n      // The wait may have ended'), true);
eq('and again after, in case the wall is still there',
  /Skipping after the wait: /.test(src), true);
eq('the outcome is an honest "skipped" with a reason, not a bare "failed"',
  (src.match(/finalize\('skipped', dead\)/g) || []).length, 2);
eq('and the fast path actually acts on the verdict rather than discarding it',
  /if \(dead\) \{ LOG\('Skipping fast: ' \+ dead\); return void await finalize\('skipped', dead\); \}/.test(src), true);

const CLOSED = new Function('return ' + src.match(/const CLOSED_POSTING_RE = (\/[\s\S]*?\/i);/)[1])();
for (const [copy, want] of [
  ['This job is no longer accepting applications', true],
  ['The position has been filled', true],
  ['This requisition has been closed', true],
  ['Diese Stelle ist nicht mehr verfügbar', true],     // the German portals in this run
  ['Cette offre est close', true],
  ['Ya no está disponible', true],
  ['Apply for this job', false],
  ['Tell us about your experience', false],
]) eq(`closed posting: "${copy.slice(0, 42)}" → ${want}`, CLOSED.test(copy), want);

/* ── 33. the wall in the site's own language ──────────────────────────────── */
/* BMW's careers portal is German — "Karrierechancen: Anmelden", "Haben Sie schon
   ein Konto?", "Kennwort", "Erstellen Sie ein Konto" — and every word of it
   missed an English-only pattern, so a whole European tenant failed job after
   job even before the CAPTCHA. */
console.log('account walls are recognised in the site\'s own language');
const AUTH = new Function('return ' + src.match(/const AUTH_COPY_RE = (\/[\s\S]*?\/i);/)[1])();
for (const [copy, lang] of [
  ['Karrierechancen: Anmelden', 'German'],
  ['Haben Sie schon ein Konto?', 'German'],
  ['Kennwort', 'German'],
  ['Erstellen Sie ein Konto', 'German'],
  ['Se connecter à votre compte', 'French'],
  ['Créer un compte', 'French'],
  ['Iniciar sesión', 'Spanish'],
  ['Crear una cuenta', 'Spanish'],
  ['Registrati', 'Italian'],
  ['Inloggen met uw account', 'Dutch'],
  ['Logga in', 'Swedish'],
  ['Zaloguj się', 'Polish'],
]) eq(`${lang}: "${copy}" is an account wall`, AUTH.test(copy), true);
for (const copy of ['Tell us about your work experience', 'Upload your resume', 'Beschreiben Sie Ihre Erfahrung'])
  eq(`but "${copy.slice(0, 36)}" is not`, AUTH.test(copy), false);

const authBtn = body('findAuthSubmit');
eq('the sign-in button is matched in other languages too',
  /anmelden\|einloggen\|weiter/.test(authBtn), true);
eq('so is create-account', /konto erstellen\|registrieren/.test(authBtn), true);
eq('the patterns are built once and reused for both modes',
  /const re = mode === 'signin' \? new RegExp/.test(authBtn), true);
eq('"Erstellen Sie ein Konto" is short enough to pass the length guard',
  'Erstellen Sie ein Konto'.length < 44, true);
eq('and the create-account link matcher no longer anchors to the start',
  /\(create \(an \)\?account\|sign \?up\|register\|new user\|konto erstellen\|erstellen sie ein konto/.test(src), true);

/* ── 34. the speed selector actually changes the speed ────────────────────── */
/* 1x / 1.5x / 2x / 3x did nothing on the run people use for bulk. qActive is the
   IN-PAGE single-tab runner's flag; the Queue Manager drives its jobs in parallel
   background tabs, which never set it — so the factor was never applied. The
   speed was being read from storage correctly in every tab; it just never
   reached the arithmetic. */
console.log('the speed selector reaches both run modes');
eq('the sleep gate covers the Queue Manager, not just the in-page runner',
  /const queueDriving = \(\) => \(qActive && !qPaused\) \|\| _mgrDriving;/.test(src), true);
eq('and the sleep uses it', /ms \* \(queueDriving\(\) \? qSpeedFactor : 1\)/.test(src), true);
eq('the old runner-only gate is gone',
  /ms \* \(qActive && !qPaused \? qSpeedFactor : 1\)/.test(src), false);
eq('a Queue Manager job marks the tab as driven', /_mgrDriving = true;/.test(src), true);
eq('and clears it when the job finalises',
  /clearTimeout\(tId\);\n      _mgrDriving = false;/.test(src), true);

const speedFn = body('speedFactorFor');
eq('the factors still get faster as the multiplier rises',
  /\{ 1: 1, 1\.5: 0\.66, 2: 0\.45, 3: 0\.3 \}/.test(speedFn), true);
eq('the floor no longer clamps away the top speed — 40ms was above 100ms at 3x',
  /Math\.max\(25, ms \*/.test(src), true);

eq('fixed settle waits are scaled too, not just plain sleeps',
  /const scaled = \(ms, floor\) =>/.test(src), true);
eq('the form-settle debounce scales', /const quiet = scaled\(300, 90\);/.test(body('waitForFormStable')), true);
eq('so does the step-change settle window', /scaled\(700, 220\)/.test(body('waitForStepChange')), true);
eq('but the overall timeouts do not — those are safety caps, not a pace',
  /setTimeout\(done, timeout\);/.test(body('waitForFormStable')), true);

// The arithmetic itself, run for real.
const sp = new Function('return ' + body('speedFactorFor').replace(/^\s*function\s+/, 'function '))();
for (const [mult, factor] of [[1, 1], [1.5, 0.66], [2, 0.45], [3, 0.3]])
  eq(`${mult}x → wait factor ${factor}`, sp(mult), factor);
eq('an unknown multiplier falls back to full speed waits', sp(99), 1);
const scaledFn = (ms, floor, f) => Math.max(floor || 60, Math.round(ms * f));
eq('a 3s pause at 3x becomes 900ms', scaledFn(3000, 60, sp(3)), 900);
eq('a 3s pause at 1x is unchanged', scaledFn(3000, 60, sp(1)), 3000);

/* ── 35. the hot path must stay cheap ─────────────────────────────────────── */
/* This build got heavy enough to bring a machine down, and the cost was in one
   path: stepSignature() walks the DOM deeply, waitForStepChange polls it every
   300ms, and several passes call it two or three times each. Anything expensive
   in there is multiplied by a dozen open job tabs. */
console.log('the deep walk stays out of the hot loop');
/* This is where an allow-list of tag names lived for three versions, and it
   broke SmartRecruiters completely: the list named LEAF components (spl-input,
   spl-select) but those sit inside WRAPPER custom elements, and a wrapper not on
   the list was never descended into — so every field beneath it was invisible.

   The assertion that used to sit here checked that the allow-list was being
   used. It asserted the MECHANISM, so it passed happily while the extension
   found zero fields on every SmartRecruiters job. What follows asserts the
   PROPERTY instead: any shadow host is reachable, whatever it is called. */
const dq = body('deepQueryAll');
eq('the descent goes through the cached host finder', /shadowHostsIn\(node\)/.test(dq), true);
const finder = body('shadowHostsIn');
eq('which enumerates completely rather than guessing tag names',
  /node\.querySelectorAll\('\*'\)/.test(finder), true);
eq('and keeps our own UI out of it', /!isOwnUi\(el\)/.test(finder), true);
eq('the cost is paid by a cache, not by an incomplete list',
  /if \(hit && now - hit\.at < HOST_CACHE_TTL\) return hit\.hosts;/.test(finder), true);
eq('the cache is short-lived, so a newly mounted field is picked up quickly',
  /const HOST_CACHE_TTL = 400;/.test(src), true);
eq('no allow-list of tag names survives', /SHADOW_HOST_SEL/.test(src), false);

/* The test that would have caught it. A wrapper custom element nobody has heard
   of, with the real field inside ITS shadow root — exactly SmartRecruiters'
   shape, and exactly what a named list cannot cover. */
{
  const ctx = {};
  new Function('exports', `
    const isOwnUi = () => false;
    const _hostCache = new WeakMap();
    const HOST_CACHE_TTL = 400;
    ${body('shadowHostsIn')}
    ${body('deepQueryAll')}
    exports.deepQueryAll = deepQueryAll;
  `)(ctx);

  // A minimal DOM: nodes with querySelectorAll, an optional shadowRoot, and a tag.
  const mk = (tag, kids = [], shadow = null) => {
    const el = { tagName: tag.toUpperCase(), children: kids, shadowRoot: shadow };
    el.querySelectorAll = (sel) => {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          const tags = sel.split(',').map((t) => t.trim().toLowerCase());
          if (sel === '*' || tags.includes((c.tagName || '').toLowerCase())) out.push(c);
          walk(c);                       // light DOM only — shadow is crossed by the caller
        }
      };
      walk(el);
      return out;
    };
    return el;
  };
  const field = mk('spl-input');
  // The wrapper is a custom element with a name no allow-list would contain.
  const innerRoot = mk('#shadow-root', [field]);
  const wrapper = mk('sr-question-block', [], innerRoot);
  const doc = mk('#document', [wrapper]);

  const found = ctx.deepQueryAll('spl-input', doc, 50);
  eq('a field inside an UNKNOWN wrapper\'s shadow root is still found', found.length, 1);
  eq('and it is the right element', found[0] === field, true);
}

eq('the fingerprint is memoised', /if \(now - _sigAt < SIG_TTL_MS\) return _sigCache;/.test(src), true);
eq('the cache is short enough to see a real step change on the next poll',
  /const SIG_TTL_MS = 250;/.test(src), true);
eq('and shorter than the poll interval it serves',
  250 < 300, true);
eq('the fingerprint uses a layout-only visibility test, not getComputedStyle',
  /\.filter\(isVisibleFast\)/.test(body('questionControls')), true);
eq('and that test really is bounding-box only',
  /getComputedStyle/.test(body('isVisibleFast')), false);
eq('while the general isVisible keeps the full check for correctness',
  /getComputedStyle/.test(body('isVisible')), true);

eq('the panel watchdog no longer runs twice a second', /\}, 2000\);   \/\/ twice a second was needless/.test(src), true);
eq('nor the sidebar re-scan every 1.5s',
  /if \(qActive && isRunnerTab\(\)\) forceOpenSidebar\(\); \}, 3000\);/.test(src), true);

/* ── 36. one pass, then one cheap retry ───────────────────────────────────── */
/* "A lot of refiring of the autofill" was four layers of repetition stacked on
   each other: an attempt loop of 2, wrapping a withRetry of 2, wrapping a
   dispatch that runs BOTH the per-ATS driver and the universal multi-page
   driver — and then a retry pass that re-entered the multi-page driver again.
   Worst case, six full drives of the same form. */
console.log('a job is driven once, not six times');
const mj = body('processManagedJob');
eq('the dispatch gets no retries of its own — the attempt loop is the retry',
  /withRetry\(async \(\) => \{ await dispatchATSAutomation\(\); \}, 'Manager job automation', 0\)/.test(mj), true);
eq('the driver runs on the first attempt only', /if \(attempt === 0\) \{/.test(mj), true);
eq('the second attempt tops up and re-submits instead of re-driving',
  /Second pass: completing anything still outstanding and re-submitting/.test(mj), true);
eq('and it does NOT re-enter the multi-page driver',
  /await multiPageLoop\(\);/.test(mj), false);
eq('the attempt loop is still bounded at two', /attempt < 2 && !success && !finalized/.test(mj), true);
eq('a form stuck on a validation complaint stops the verify clock early',
  /if \(check >= 2 && pageHasValidationError\(\)\) \{ validationStuck = true; break; \}/.test(mj), true);
eq('but a first-pass validation error still earns one more attempt',
  /if \(validationStuck && attempt > 0\) break;/.test(mj), true);

/* ── 37. "skipped" must not hide a real failure ───────────────────────────── */
/* A URL that is not an application and a job whose Apply button led nowhere were
   both reported as "skipped". The first is right and needs no action; the second
   is a job that was applicable and we failed at — buried in the column people
   ignore. */
console.log('a job we could not open is a failure, not a skip');
eq('the two outcomes are told apart by whether an Apply control exists',
  /const openable = hasApplyButton\(\) \|\| !!findApplyManually\(\);\n        if \(openable\) \{/.test(mj), true);
eq('Apply present but no form → failed, with the reason',
  /finalize\('failed', 'Could not open the application form \(Apply was present but led nowhere\)'\)/.test(mj), true);
eq('nothing applicable at all → skipped, and says why',
  /finalize\('skipped', 'Not an application page — no form, no Apply button, no known ATS'\)/.test(mj), true);
eq('the old catch-all skip message is gone',
  /finalize\('skipped', 'No application form found'\)/.test(mj), false);

/* ── 38. opening a batch of tabs must not be the bottleneck ───────────────── */
/* The slot filler is serial, so a flat 800ms per tab cost ten seconds of every
   refill at a concurrency of 12 — pure dead time in a bulk run. */
console.log('tab opening scales with the batch');
const fill = orch.slice(orch.indexOf('async function fillSlots'), orch.indexOf('async function fillSlots') + 4000);
eq('the pause shrinks as the batch grows',
  /if \(cfg\.interJobDelayMs && toOpen\.length > 1\) \{\n          const per = Math\.max\(60, Math\.min\(cfg\.interJobDelayMs, Math\.round\(1200 \/ toOpen\.length\)\)\);/.test(fill), true);
eq('a single job still gets the full configured pause',
  /\} else if \(cfg\.interJobDelayMs\) \{/.test(fill), true);
// The arithmetic, run for real.
const per = (n, cfgMs) => n > 1 ? Math.max(60, Math.min(cfgMs, Math.round(1200 / n))) : cfgMs;
eq('1 job at a time keeps the 800ms pause', per(1, 800), 800);
eq('4 in a batch → 300ms each (1.2s total)', per(4, 800), 300);
eq('12 in a batch → 100ms each (1.2s total)', per(12, 800), 100);
eq('the total ramp is bounded however large the batch', per(12, 800) * 12 <= 1300, true);
eq('and never drops below a floor that would burst a single site', per(40, 800), 60);

/* ── 39. a fuzzy match must not answer a knockout question ────────────────── */
/* The saved-response bank is matched on 40% keyword overlap, and it answers
   BEFORE any of the knockout reasoning runs. That is how a stray "No" landed on
   "Do you have hands-on experience with Linux patch and package management?" —
   an automatic rejection, decided by an unrelated saved entry that happened to
   share some nouns. The guard runs for real here. */
console.log('a saved Yes/No cannot lose a knockout');
const koCtx = {};
/* Every top-level regex constant, lifted verbatim. Listing them by hand meant
   the harness broke each time the logic under test reached for one more. */
const reLines = (src.match(/^  const [A-Z][A-Z0-9_]*_RE = \/.*\/[a-z]*;$/gm) || []).join('\n  ');
if (!/ELIGIBILITY_WORD_RE/.test(reLines)) throw new Error('regex constants not found');
new Function('exports', `
  const LOG = () => {};
  ${body('safeKnockoutAnswer')}
  ${body('determineYesNo')}
  ${body('workAuthorisationAnswer')}
  ${body('workAuthOptionIndex')}
  ${reLines}
  exports.safe = safeKnockoutAnswer;
  exports.decide = determineYesNo;
`)(koCtx);
const safe = (saved, q) => koCtx.safe(saved, q.toLowerCase());

// The exact question off the user's Comeet screenshot.
for (const q of [
  'do you have hands-on experience with linux patch and package management?',
  'do you have experience with backup and recovery operations in linux environments?',
  'do you have hands-on experience with bash and/or python scripting and automation?',
]) {
  eq(`"${q.slice(0, 46)}…" is answered yes`, koCtx.decide(q), 'yes');
  eq('and a saved "No" is refused', safe('No', q), '');
  eq('while a saved "Yes" agrees and is kept', safe('Yes', q), 'Yes');
}

// The one that cost a real application: the recruiter was told the candidate
// could not work in Belgium.
eq('a saved "No" cannot answer a right-to-work question',
  safe('No', 'Are you legally authorized to work in this country?'), '');

// The guard is narrow on purpose — it must not touch anything else.
eq('a saved "No" to a sponsorship question is the RIGHT answer and survives',
  safe('No', 'Will you now or in the future require visa sponsorship?'), 'No');
eq('a saved "No" to a question that is not a knockout is left alone',
  safe('No', 'Did you hear about us from a current employee?'), 'No');
eq('a written answer is never second-guessed',
  safe('2 weeks', 'What is your notice period?'), '2 weeks');
eq('a salary is never second-guessed', safe('85000', 'Desired salary'), '85000');
eq('nothing saved stays nothing saved', safe('', 'Do you have hands-on experience with Go?'), '');

eq('the radio path goes through the guard',
  /const savedAnswer = savedAnswerFor\(questionText\);/.test(src), true);
eq('and so does the fuzzy half of the text path',
  /safeKnockoutAnswer\(findSavedResponseMatch\(questionText\), questionText\)/.test(src), true);
/* An answer the user typed against THIS question is not a fuzzy match, and
   their word is final — the guard must not touch it. */
eq('an exact learned answer is left to stand',
  /\|\| getLearnedAnswer\(label, el, true\) \|\| guessValue\(label, p\) \|\|/.test(src), true);

/* ── 40. nothing may pause a run waiting for a human ──────────────────────── */
/* "Leave site? Changes you made may not be saved." froze a 685-job run on
   Oracle Cloud. Two things had to be true and neither was: the shield must
   still be up when the dialog fires, and if it ever gets through anyway the
   worker must take the tab away rather than let the queue sit. */
console.log('a native dialog cannot stop the run');
const hooks = fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]), 'ua-page-hooks.js'), 'utf8');
eq('the shield outlasts the job it was raised for',
  /const until = Number\(root\.getAttribute\('data-ua-grace'\) \|\| 0\);/.test(hooks), true);
eq('and it is a window, not a permanent hand-back',
  /return until > 0 && Date\.now\(\) < until;/.test(hooks), true);
eq('clearing the flag starts that window rather than taking effect at once',
  /el\.setAttribute\('data-ua-grace', String\(Date\.now\(\) \+ AUTO_FLAG_GRACE_MS\)\);/.test(src), true);
eq('turning it back on cancels the window',
  /el\.setAttribute\('data-ua-auto', '1'\);\n        el\.removeAttribute\('data-ua-grace'\);/.test(src), true);
eq('the window only has to outlast a navigation, so it is short',
  /const AUTO_FLAG_GRACE_MS = 20000;/.test(src), true);
// The page still gets its dialogs back — the whole point of the window ending.
const shieldUp = (auto, grace, now) => auto === '1' || (Number(grace || 0) > 0 && now < Number(grace || 0));
eq('during a job: shielded', shieldUp('1', 0, 1000), true);
eq('just after a job, mid-navigation: still shielded', shieldUp(null, 21000, 5000), true);
eq('once the window passes: the site gets its warning back', shieldUp(null, 21000, 22000), false);
eq('a page the automation never touched is never shielded', shieldUp(null, null, 5000), false);

eq('the worker pings the runner tab it cannot otherwise see into',
  /chrome\.tabs\.sendMessage\(tabId, \{ type: 'UA_RUNNER_PING' \}/.test(orch), true);
eq('a frozen tab answers nothing, so the timeout is the answer',
  /setTimeout\(\(\) => finish\(false\), 4000\);/.test(orch), true);
eq('the content script can always answer it — synchronously, with no work',
  /if \(msg && msg\.type === 'UA_RUNNER_PING'\) \{\n      try \{ sendResponse\(\{ alive: true \}\);/.test(src), true);
eq('silence is only acted on after it has gone on long enough',
  /if \(Date\.now\(\) - since < RUNNER_FROZEN_MS\) return;/.test(orch), true);
eq('and that window is three missed pings, not one',
  /const RUNNER_FROZEN_MS = 45 \* 1000;/.test(orch), true);
/* remove() is the one navigation a beforeunload handler cannot veto. reload and
   update both re-raise the prompt we are stuck behind, so they are not options. */
eq('the stuck tab is closed, not reloaded',
  /chrome\.tabs\.remove\(tabId, \(\) => void chrome\.runtime\.lastError\);/.test(orch), true);
eq('and the run carries on in a fresh tab on the same job',
  /chrome\.tabs\.create\(\{ url, active: true \}/.test(orch), true);
eq('which is handed the runner marker so it resumes rather than idles',
  /if \(t && typeof t\.id === 'number'\) set\(\{ ua_runner_tab: t\.id \}\);/.test(orch), true);
eq('with nothing left to resume it does not churn tabs',
  /if \(!current \|\| !current\.url\) \{ await set\(\{ \[RUNNER_SILENT_KEY\]: 0 \}\); return; \}/.test(orch), true);
eq('a runner tab that no longer exists is not given the silence window at all',
  /if \(!gone\) \{\n      const since = \(await get\(RUNNER_SILENT_KEY\)\) \|\| 0;/.test(orch), true);
eq('and closing it says so rather than being reported as silence',
  /gone\n      \? 'Runner tab was closed — reopening so the run continues'/.test(orch), true);
eq('the watch survives a service-worker restart',
  /if \(\(await get\(K\.OLD_RUNNER\)\) === true\) armRunnerWatch\(\);/.test(orch), true);
eq('a manager job tab held by the same dialog is not given the full nav grace',
  /!\(_tabStatus\[j\.id\] === 'complete' && silent\)\) continue;/.test(orch), true);


/* ── 41. Oracle's required dropdowns must actually take a value ───────────── */
/* A Recruiting Cloud application came back with "This info is required." under
   Ethnicity, Gender and the disability question, on a form the pass believed it
   had answered. Two causes: the option was matched on a bare substring, and the
   pick was committed by a synthetic click a JET component ignores. */
console.log('custom dropdowns commit for real');
const combo = body('commitCustomDropdown');
eq('whole-word matching, not substring',
  combo.includes("new RegExp('\\\\b' + w.replace"), true);
eq('filler words cannot decide a match', /const STOP = \/\^\(the\|and\|for\|you/.test(combo), true);
eq('the option sharing the most words wins, not the first one touched',
  /if \(n > best\) \{ best = n; if \(n\) pick = o; \}/.test(combo), true);
/* The bug this replaced: "I do not have a disability" picked whichever option
   contained the letters n-o-t. Run the two matchers against the real option
   list off the screenshot. */
{
  const OPTS = ['Affects your mobility', 'Affects your muscles, joints, bones',
    'Is because of Covid/Long Covid', 'Not applicable', 'Prefer not to answer'];
  const WANT = 'i do not have a disability';
  const oldWords = WANT.split(/\s+/).filter((w) => w.length > 2);
  const oldPick = OPTS.find((o) => oldWords.some((w) => o.toLowerCase().includes(w)));
  eq('the old matcher answered a disability question with "Not applicable"', oldPick, 'Not applicable');
  const STOP = /^(the|and|for|you|your|have|has|with|that|this|are|not|any|all|its|from|out|our|their|does|did|was|were|will|would|can|able)$/;
  const words = WANT.split(/[^a-z0-9]+/i).filter((w) => w.length > 2 && !STOP.test(w));
  eq('"not" and "have" no longer get a vote', words.join(','), 'disability');
  let best = -1, pick = null;
  for (const o of OPTS) {
    const n = words.filter((w) => new RegExp('\\b' + w + '\\b').test(o.toLowerCase())).length;
    if (n > best) { best = n; if (n) pick = o; }
  }
  eq('and with nothing genuinely matching it declines rather than guessing', pick, null);
}
eq('a demographic question with no match still declines rather than inventing',
  /pick = real\.find\(o => \/prefer not\|decline\|do not wish\|not to say\/i\.test\(comboText\(o\)\)\);/.test(combo), true);

eq('a click that did not take is followed by the keyboard',
  /if \(!comboHasValue\(combo\)\) \{ await commitByKeyboard\(combo, pick\); \}/.test(combo), true);
const kb = body('commitByKeyboard');
eq('which walks the list by the row the component itself is tracking',
  /aria-activedescendant/.test(kb), true);
eq('and commits with Enter, the way the component expects',
  /key\('Enter', 'Enter'\);/.test(kb), true);
eq('the walk is bounded — an unnavigable list is not a loop',
  /for \(let i = 0; i < 40 && active\(\) !== wantId; i\+\+\)/.test(kb), true);
eq('and it gives up rather than pressing Enter on the wrong row',
  /if \(active\(\) !== wantId\) return false;/.test(kb), true);
eq('its key events cross the shadow boundary like every other one',
  /composed: true/.test(kb), true);

const disc = body('fillCustomDropdowns__impl');
for (const tag of ['oj-select-single', 'oj-c-select-single', 'oj-select-one', 'oj-combobox-one'])
  eq(`${tag} is discovered`, disc.includes(tag), true);


/* ── 42. the two answers that went out wrong on one Greenhouse form ───────── */
/* job-boards.greenhouse.io/materiom/jobs/5225191007 submitted:
     "How many years of professional experience…?"  → "Less than 1 year"
     "Will you require visa sponsorship…?"          → "Yes"
   Both are knockouts, and both were self-inflicted. */
console.log('a years dropdown and a sponsorship question, off one real form');

/* The exact option list a Greenhouse years dropdown offers. The scorer is run
   for real — this is not a check that some code exists. */
{
  const score = new Function('return ' + body('scoreExperienceRange').replace(/^\s*function\s+/, 'function '))();
  const OPTS = ['Less than 1 year', '1-2 years', '3-5 years', '5-10 years', '10+ years'];
  const bestFor = (yrs) => {
    let best = 0, pick = null;
    for (const o of OPTS) { const v = score(o, yrs); if (v > best) { best = v; pick = o; } }
    return pick || OPTS[OPTS.length - 1];
  };
  eq('7 years picks the band that contains it', bestFor(7), '5-10 years');
  eq('12 years reaches the open-ended top band', bestFor(12), '10+ years');
  eq('3 years picks its own band, not a higher one', bestFor(3), '3-5 years');
  eq('the worst option is never what 7 years scores to', bestFor(7) === 'Less than 1 year', false);
  // The old behaviour, for the record: nothing matched "7", so required fell to real[0].
  eq('and real[0] — what used to be picked — is the worst answer on the list',
    OPTS[0], 'Less than 1 year');
  // An unscoreable list must fail upward, not downward.
  const odd = ['Entry level', 'Mid level', 'Senior'];
  let best = 0, pick = null;
  for (const o of odd) { const v = score(o, 7); if (v > best) { best = v; pick = o; } }
  eq('a list the scorer cannot read falls to the TOP, not the bottom',
    pick || odd[odd.length - 1], 'Senior');
}
const cd = body('commitCustomDropdown');
eq('the dropdown committer scores ranges before anything else',
  /const s = scoreExperienceRange\(comboText\(o\), yrs\);/.test(cd), true);
eq('it recognises a years question from the full question, not just the label',
  /const qFull = String\(getFullQuestionText\(combo\) \|\| getLabel\(combo\) \|\| ''\);/.test(cd), true);
eq('and an unscoreable years list takes the last option, never the first',
  /if \(!pick && real\.length\) pick = real\[real\.length - 1\];/.test(cd), true);
eq('the generic matchers only get a say once the range pass has had one',
  /if \(!pick && want\) \{/.test(cd), true);

/* The sponsorship answer. These two questions sat next to each other on the
   form and share nearly every word, so the 40%-overlap matcher handed the
   second one's "Yes" to the first. */
const SPONSOR_Q = 'Will you require visa sponsorship within the next 18 months to work in the United Kingdom?';
const RTW_Q = 'Do you currently have the right to work in the United Kingdom?';
eq('the sponsorship question is reasoned to No', koCtx.decide(SPONSOR_Q.toLowerCase()), 'no');
eq('the right-to-work question next to it is reasoned to Yes', koCtx.decide(RTW_Q.toLowerCase()), 'yes');
eq('a "Yes" bleeding across from the neighbour is refused', safe('Yes', SPONSOR_Q), '');
eq('while the neighbour keeps its own Yes', safe('Yes', RTW_Q), 'Yes');
eq('and a saved "No" — the right answer — still stands', safe('No', SPONSOR_Q), 'No');
// Why it got through before: the question names none of the old knockout words.
{
  const OLD = /\b(hands.?on|experience|experienced|proficien\w*|familiar|comfortable|willing|able to|capable|authoriz\w*|eligib\w*|right to work|legally|relocat\w*|commute|available|start date|do you have|have you (used|worked|built|managed))\b/i;
  eq('the old guard did not consider a sponsorship question a knockout',
    OLD.test(SPONSOR_Q), false);
}
for (const q of [
  'Do you now or will you in the future require sponsorship for employment visa status?',
  'Will you require a work permit to be employed in Ireland?',
  'Do you require visa sponsorship?',
]) eq(`"${q.slice(0, 44)}…" is guarded`, safe('Yes', q), '');


/* ── 43. the run must say WHY, not just how many ──────────────────────────── */
/* Four screenshots of a failing run arrived carrying nothing but a count: "37
   failed". The reasons were recorded on every job the whole time; they were
   only readable in a side panel that is not what is on screen during a run. */
console.log('the panel says why jobs are failing');
{
  const grpCtx = {};
  new Function('exports', `
    let queue = [];
    ${body('failureGroups')}
    ${body('topFailureReason')}
    ${body('failureReportText')}
    exports.load = (q) => { queue = q; };
    exports.top = topFailureReason;
    exports.report = failureReportText;
  `)(grpCtx);

  grpCtx.load([
    { url: 'https://a/1', status: 'done' },
    { url: 'https://a/2', status: 'done' },
    { url: 'https://a/3', status: 'failed', error: 'No application form found' },
    { url: 'https://a/4', status: 'failed', error: 'No application form found' },
    { url: 'https://a/5', status: 'failed', error: 'No application form found' },
    { url: 'https://a/6', status: 'timeout', error: 'Tab went silent for 20s' },
    { url: 'https://a/7', status: 'skipped', error: 'Skipped by user' },
    { url: 'https://a/8', status: 'skipped', error: 'Already applied / posting closed' },
  ]);
  const top = grpCtx.top();
  eq('the reason that cost the most jobs is the one surfaced',
    top.reason, 'failed: No application form found');
  eq('with its count', top.n, 3);
  eq('and the total it is a share of', top.total, 5);
  eq('a job you skipped yourself is not a failure', grpCtx.report().includes('a/7'), false);
  eq('but a job skipped for a reason of its own is', grpCtx.report().includes('a/8'), true);

  const rep = grpCtx.report();
  eq('the report opens with what happened',
    rep.split('\n')[0], 'Jobright queue — 8 jobs, 2 applied, 5 not');
  eq('the biggest group is first', rep.indexOf('3x') < rep.indexOf('1x'), true);
  eq('and every failing URL is in it', /https:\/\/a\/3/.test(rep), true);

  grpCtx.load([{ url: 'https://a/1', status: 'done' }]);
  eq('a clean run shows no failure line at all', grpCtx.top(), null);
}
eq('the line is hidden until there is something to say',
  /<div class="uc-why" id="uc-why" style="display:none"/.test(src), true);
eq('and it is rendered on every panel update',
  /whyEl\.textContent = `Most failures: \$\{top\.reason\} \(\$\{top\.n\}\)`;/.test(src), true);
eq('clicking it copies the whole report',
  /const text = failureReportText\(\);/.test(src), true);
eq('with a fallback for when the clipboard is refused',
  /ok = document\.execCommand\('copy'\);/.test(src), true);


/* ── 44. two SmartRecruiters details, checked against a rival's build ─────── */
/* OptimHire 2.8.9 reads an spl-radio's option text from its `label` ATTRIBUTE
   and refuses to type into `c-spl-dropdown-search__input`. Both turned out to
   be bugs here, and both are silent ones — the form looks filled. */
console.log('SmartRecruiters web components, read correctly');
{
  const clCtx = {};
  new Function('exports', `
    // getLabel climbs to the group on a web-component radio — that IS the bug.
    const getLabel = () => 'Do you have the right to work in Ireland?';
    ${body('choiceLabel')}
    exports.choiceLabel = choiceLabel;
  `)(clCtx);
  const mkRadio = (attrs) => ({
    tagName: 'SPL-RADIO',
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    shadowRoot: null, value: '', nextElementSibling: null,
    closest: () => null, textContent: '',
  });
  eq('an spl-radio answers with its own label, not the group question',
    clCtx.choiceLabel(mkRadio({ label: 'Yes' })), 'yes');
  eq('and its sibling with its own',
    clCtx.choiceLabel(mkRadio({ label: 'No' })), 'no');
  // The bug: both options previously came back as the question, so Yes and No
  // were indistinguishable and the matcher took whichever it saw first.
  eq('the two options are now distinguishable at all',
    clCtx.choiceLabel(mkRadio({ label: 'Yes' })) !== clCtx.choiceLabel(mkRadio({ label: 'No' })), true);
  eq('aria-label serves when there is no label attribute',
    clCtx.choiceLabel(mkRadio({ 'aria-label': 'Prefer not to say' })), 'prefer not to say');
  // A NATIVE radio must be unaffected — its label really does live outside it.
  const native = { tagName: 'INPUT', type: 'radio', getAttribute: () => null,
    shadowRoot: null, value: '', nextElementSibling: null, closest: () => null, textContent: '' };
  eq('a native radio still uses the computed label',
    clCtx.choiceLabel(native), 'do you have the right to work in ireland?');
}
{
  const tsCtx = {};
  new Function('exports', `
    ${body('isTransientSearchBox')}
    exports.f = isTransientSearchBox;
  `)(tsCtx);
  const inp = (className, extra) => ({
    tagName: 'INPUT', className,
    getAttribute: (k) => (extra && k in extra ? extra[k] : null),
  });
  eq("a dropdown's own search box is not a field",
    tsCtx.f(inp('c-spl-dropdown-search__input')), true);
  eq('nor is a combobox filter under any other ATS name',
    tsCtx.f(inp('react-select__search-input')), true);
  eq('nor one the page declares as a listbox filter',
    tsCtx.f(inp('', { role: 'searchbox', 'aria-controls': 'lb1' })), true);
  eq('an ordinary text field is still filled', tsCtx.f(inp('form-control')), false);
  eq('and a field that merely mentions research is not caught',
    tsCtx.f(inp('researcher-name-input')), false);
}
eq('and the guard sits on the one path every write goes through',
  /function writeAllowed\(el, val\) \{\n    if \(isTransientSearchBox\(el\)\) return false;/.test(src), true);


/* ── 45. the recorder is actually wired to the things it claims to see ────── */
/* ua-diagnostics.js is tested on its own. What matters here is that the content
   script FEEDS it — a recorder nothing reports to is worse than none, because
   its silence reads as "no problems". */
console.log('every outcome reaches the recorder');
eq('the report helper exists and never throws at the caller',
  /function DIAG\(code, reason, extra\) \{\n    try \{/.test(src), true);
eq('it is fire-and-forget — a diagnostic must not delay what it measures',
  /\}, \(\) => void chrome\.runtime\.lastError\);/.test(body('DIAG')), true);
eq('and it tags every event with the ATS', /ats: \(typeof detectATS === 'function' && detectATS\(\)\) \|\| 'unknown',/.test(body('DIAG')), true);

/* The single-tab runner sets a terminal status in eight different places across
   its retry paths. Reporting from each of them is how you end up covering seven
   and trusting a wrong number, so it reports from the one function they all
   funnel through. */
eq('terminal outcomes are reported from the shared save, not from each exit',
  /async function saveQ\(\) \{ reportTerminalJobs\(\); await st\.set\(SK\.Q, queue\); \}/.test(src), true);
const rtj = body('reportTerminalJobs');
eq('every terminal status counts, successes included',
  /const TERMINAL = \['done', 'failed', 'timeout', 'skipped'\];/.test(src), true);
/* The mark has to OUTLIVE the document. A Set in this module lasted exactly one
   page: every navigation started an empty one, so every finished job was
   reported again on the next page, and the next. A 64-job queue reported 265. */
eq('the "already reported" mark is stored on the job, so it survives a navigation',
  /if \(j\.diagged\) continue;\n        j\.diagged = true;/.test(rtj), true);
eq('and it is not a per-document Set any more', /_diagReported/.test(src), false);
/* Re-reporting also poisoned the ATS column: an old job re-described from
   whatever page happened to be open got stamped with THAT page's platform, which
   filed jobs.workable.com and jobs.smartrecruiters.com under Greenhouse. */
eq('a job is described only by what the queue knows about it',
  /ats: j\.jobBoard \|\| 'unknown',/.test(rtj), true);
eq('never by the page that happens to be loaded', /detectATS\(\)/.test(rtj), false);
// A retry is a genuinely new outcome and must be counted again.
eq('retrying a failed job clears the mark',
  /delete j\.diagged;          \/\/ a retry is a new outcome/.test(src), true);
eq('and the reason travels with it', /DIAG\('job\.' \+ j\.status, j\.error \|\| '', \{/.test(rtj), true);
eq('the manager path reports its own outcomes too',
  /DIAG\('job\.' \+ status, error \|\| '', \{ detail: \{ ms:/.test(src), true);

/* The most useful thing it collects. */
eq('every unanswered required question is reported, by its label',
  /for \(const label of r\.missingLabels\) DIAG\('field\.unanswered', label\);/.test(src), true);
eq('with the fill progress alongside it',
  /DIAG\('stage\.fill', where, \{ detail: \{ done: r\.done, total: r\.total, pct: r\.pct \} \}\);/.test(src), true);

/* Stages, so a failure comes with the story of how far it got. */
const np = body('noteProgress');
eq('each stage is recorded as the job passes through it',
  /if \(what !== _lastDiagStage\) \{ _lastDiagStage = what; DIAG\('stage', what\); \}/.test(np), true);
eq('but a long form calling it per field does not become a thousand rows',
  /_lastDiagStage/.test(np), true);

/* Errors, but only ours. */
eq('a page error during a job is recorded', /DIAG\('page\.error'/.test(src), true);
eq('and a rejected promise', /DIAG\('page\.reject'/.test(src), true);
eq('neither fires while you are just browsing',
  /const _diagAutomating = \(\) => \{/.test(src) && /if \(!_diagAutomating\(\)\) return;/.test(src), true);

/* The bug that made the one line naming a blocking question name nothing. */
const fr = body('fillReport');
eq('getMissingRequired returns LABELS, and fillReport now treats them as such',
  /const l = String\(raw == null \? '' : raw\)/.test(fr), true);
eq('the old element-shaped read is gone',
  /getLabel\(el\) \|\| el\.name \|\| el\.id \|\| '\(unlabelled\)'/.test(fr), false);


/* ── 46. a required cover letter is an upload, not a text box ─────────────── */
/* Greenhouse reported "Cover Letter is required." in red on a form the pass
   believed it had finished: the widget has Attach / Google Drive / Enter
   manually beside it, so nothing that fills textareas touched it and nothing
   that attaches the CV recognised it. */
console.log('a required cover letter no longer blocks the submit');
const coverFn = body('satisfyCoverLetter');
eq('an OPTIONAL cover letter is still left alone — a generic one is worse than none',
  /if \(!required\) return false;/.test(coverFn), true);
eq("the ATS's own red message counts as required",
  /cover\.\?letter\\s\+is\\s\+required\|required/.test(coverFn), true);
eq('one already written is not overwritten',
  /\(t\.value \|\| ''\)\.trim\(\)\.length > 40/.test(coverFn), true);
eq('nor is one already attached',
  /f\.files && f\.files\.length/.test(coverFn), true);
eq('the manual box is preferred — it is the path a person would use',
  coverFn.indexOf('MANUAL_ENTRY_RE') < coverFn.indexOf('new File('), true);
eq('and the letter is addressed to this employer, not generic',
  /tailorCoverText\(p\.cover_letter \|\| DEFAULTS\.cover,/.test(coverFn), true);
eq('otherwise a plain-text file, which these widgets all accept',
  /new File\(\[letter\], 'cover-letter\.txt', \{ type: 'text\/plain' \}\)/.test(coverFn), true);
eq('and the outcome is recorded either way', /DIAG\('cover\.blocked'/.test(coverFn), true);
eq('the pass runs as part of the fill, right after the CV',
  /try \{ if \(await satisfyCoverLetter\(p\)\) filled\+\+; \}/.test(src), true);

/* ── 47. dropdowns that are not comboboxes ────────────────────────────────── */
/* Comeet renders a Bootstrap dropdown: <div class="dropdown"><a
   class="dropdown-toggle"> over <ul class="dropdown-menu"><li><a>. It carries no
   ARIA roles at all, so neither the discovery selector nor the option reader
   matched one, and every Comeet dropdown sat on its placeholder. */
console.log('Bootstrap dropdowns and costumed selects');
const disc2 = body('fillCustomDropdowns__impl');
for (const sel of ['[data-toggle="dropdown"]', '[data-bs-toggle="dropdown"]', 'a.dropdown-toggle'])
  eq(`${sel} is discovered`, disc2.includes(sel), true);
const vo = body('visibleOptions');
eq('a Bootstrap menu\'s rows are readable as options', vo.includes('.dropdown-menu li'), true);
eq('including the anchors inside them', vo.includes('.dropdown-menu a'), true);

/* A "nice-select" wrapper is only a costume over a real <select>. */
const cd2 = body('commitCustomDropdown');
eq('a wrapper hiding a real select is driven through the select',
  /combo\.parentElement\.querySelector\('select'\)/.test(cd2), true);
eq('matched on the option TEXT, because that is what the answer is',
  /opts\.find\(\(o\) => norm\(o\.text\) === want\)/.test(cd2), true);
/* setSelectValue returns true unconditionally, so trusting it would report
   success on a select it never set. */
eq('and confirmed against the control rather than taken on trust',
  /if \(native\.value === hit\.value\) \{/.test(cd2), true);
eq('a wrapper with no matching option falls through to the click path',
  cd2.indexOf('const hit = opts.find') < cd2.indexOf('triggerMouse(combo);'), true);

/* ── 48. the redeclaration guard ──────────────────────────────────────────── */
/* A second, older smartRecruitersAutomation was sitting in this file. A later
   function declaration silently replaces an earlier one in the same scope, so
   one of the two never ran — and an edit made to the wrong copy would have done
   nothing, with no error to explain it. */
console.log('no driver is shadowed by a second copy of itself');
{
  const lines = src.split('\n');
  const scopes = [];
  lines.forEach((l, i) => {
    if (/^\(\s*(async\s+)?function\s*\(/.test(l)) scopes.push({ start: i, end: -1 });
    if (/^\}\)\(\);?\s*$/.test(l)) {
      for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].end < 0) { scopes[k].end = i; break; }
    }
  });
  const dupes = [];
  for (const sc of scopes) {
    const seen = new Map();
    for (let i = sc.start; i <= (sc.end < 0 ? lines.length - 1 : sc.end); i++) {
      const m = lines[i].match(/^  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) continue;
      if (seen.has(m[1])) dupes.push(m[1]);
      else seen.set(m[1], i + 1);
    }
  }
  eq('nothing is declared twice in one scope', dupes, []);
  // The same name in two SEPARATE IIFEs is fine and deliberate — those are
  // different scopes and neither can see the other.
  eq('and there really are several scopes to distinguish', scopes.length > 5, true);
}
eq('the dead SmartRecruiters driver is gone, the shadow-aware one remains',
  (src.match(/async function smartRecruitersAutomation\(/g) || []).length, 1);
eq('and it is the shadow-aware one',
  /SmartRecruiters automation starting \(shadow-aware\)/.test(src), true);


/* ── 49. Workday: the account step, and getting to it at all ──────────────── */
/* Two reports, both on Workday. An NXP job description sat with its Apply
   button unpressed; a Ciena sign-in page had email and password filled and the
   Sign In button never pressed, "just keeps re-autofilling". */
console.log('Workday reaches the form, and gets through the account step');

const wdFn = body('workdayAutomation');
/* Every other driver moved onto the deep finders years ago; this one still used
   document.querySelector, which stops at a shadow boundary. */
eq('the Apply button is looked for across shadow roots, not just the document',
  /deepAll\(APPLY_IDS, 20\)\.filter\(isVisible\)/.test(wdFn), true);
eq("Workday's current automation-id is in the list", /adventureButton/.test(wdFn), true);
eq('and the uxi element id other tenants use', /data-uxi-element-id="Apply"/.test(wdFn), true);
/* It clicked, slept two seconds and carried on regardless — so when the click
   did not take, everything after it ran against the job description. */
eq('the click is confirmed by the page changing, not by a guessed delay',
  /await waitForStepChange\(before, 12000\);/.test(wdFn), true);
eq('and retried rather than assumed', /for \(let attempt = 0; attempt < 3 && !onApplyFlow\(\); attempt\+\+\)/.test(wdFn), true);
eq('a failure to open is reported instead of leaving a silent dead end',
  /DIAG\('workday\.apply-stuck'/.test(wdFn), true);

/* The deadlock. The fill pass deliberately skips marketing opt-ins; the gate
   below it demanded that EVERY visible checkbox be ticked. A page with one
   marketing box could never satisfy its own gate — so the form was never
   submitted, the pass ran again, refilled, and waited again, forever. */
const wca = body('fillWorkdayCreateAccount');
eq('the fill pass skips marketing opt-ins', /if \(!c\.checked && !isMarketingCheckbox\(c\)\) realClick\(c\)/.test(wca), true);
eq('and the submit gate no longer demands they be ticked',
  /const consentOK = \$\$\('input\[type=checkbox\]'\)\.filter\(isVisible\)\.every\(c => c\.checked\);/.test(wca), false);
eq('it asks only about the boxes we are responsible for',
  /\.filter\(c => !isMarketingCheckbox\(c\) && \(isFieldRequired\(c\) \|\| CONSENT_TEXT_RE\.test\(getLabel\(c\) \|\| ''\)\)\)/.test(wca), true);
eq('and says so when one genuinely will not tick', /DIAG\('workday\.consent-stuck'/.test(wca), true);
// Run the gate for real, on the shape that deadlocked.
{
  const boxes = [
    { checked: true, required: true, label: 'I agree to the privacy policy' },
    { checked: false, required: false, label: 'Send me job alerts and marketing' },
  ];
  const isMarketing = (c) => /marketing|job alerts|newsletter|promotions/i.test(c.label);
  const CONSENT = /\b(consent|agree|privacy|policy|terms|acknowledg\w*)\b/i;
  eq('the OLD gate never opens on this page', boxes.every((c) => c.checked), false);
  const gating = boxes.filter((c) => !isMarketing(c) && (c.required || CONSENT.test(c.label)));
  eq('the new one asks about exactly one box', gating.length, 1);
  eq('and it is satisfied', gating.every((c) => c.checked), true);
}

/* The watcher was armed for a manager job and then declined to act on one. */
const watch = body('startWorkdayAccountWatch');
eq('the account watcher acts in Queue Manager mode too',
  /if \(!autoApply && !_mgrDriving && !\(qActive && isRunnerTab\(\)\)\) return;/.test(watch), true);

/* ── 50. a consent banner is a click blocker, not a nuisance ──────────────── */
console.log('a cookie banner cannot swallow the form');
const ck = body('dismissCookieBanner');
eq('it is cleared before anything else is clicked',
  /await dismissCookieBanner\(\);\n    \/\/ Reveal the application form first/.test(src), true);
eq('Accept, not Decline — Decline opens a preferences dialog on some sites',
  /const COOKIE_ACCEPT_RE = \/\^\(accept\|/.test(src), true);
/* "OK" and "Continue" are everywhere. Pressing the wrong one advances the
   application, so the button must be inside something that reads as a banner. */
eq('the button must sit inside something that reads as a consent banner',
  /if \(t\.length > 40 && t\.length < 4000 && COOKIE_BANNER_RE\.test\(t\)\) \{ banner = scope; break; \}/.test(ck), true);
eq('and a button with no banner around it is left alone',
  /if \(!banner\) continue;/.test(ck), true);
{
  const A = /^(accept|accept all|accept cookies|accept all cookies|allow all|allow cookies|i agree|agree|got it|ok|understood|continue|akzeptieren|alle akzeptieren|tout accepter|aceptar)$/i;
  for (const yes of ['Accept Cookies', 'Accept All', 'I Agree', 'Alle akzeptieren'])
    eq(`"${yes}" is an accept button`, A.test(yes), true);
  for (const no of ['Decline', 'Reject All', 'Manage preferences', 'Submit application'])
    eq(`"${no}" is not`, A.test(no), false);
}


/* ── 51. the form is often in a frame this document cannot see ────────────── */
/* "workable struggles and just skips aswell, so does icims" — and both are
   named in the orchestrator's own comment as ATS that put the application in a
   CROSS-ORIGIN iframe. The worker could already inject into those frames. Only
   the Queue Manager ever asked it to. */
console.log('every mode can reach an embedded form, not just the Queue Manager');
eq('the worker answers a request to reach into a tab\'s frames',
  /if \(msg\.type === 'UA_INJECT_FRAMES'\) \{/.test(orch), true);
eq('and it injects into the SENDER\'s tab, not one it was told about',
  /const tabId = sender && sender\.tab && sender\.tab\.id;\n        if \(tabId != null\) injectAllFrames\(tabId\);/.test(orch), true);
const rfi = body('requestFrameInjection');
eq('the content script asks once per document, not per pass',
  /if \(_framesRequested\) return;\n    _framesRequested = true;/.test(rfi), true);
eq('the single-tab runner asks',
  /if \(runnerActive \|\| autoApply\) requestFrameInjection\(\);/.test(src), true);
eq('and so does every Fully Automated dispatch',
  /requestFrameInjection\(\);\n    await resolveBlockingDialog\(\);/.test(src), true);

const ic = body('icimsAutomation');
eq('iCIMS no longer announces that it is giving up on the iframe',
  /content script cannot access cross-origin iframe/.test(src), false);
eq('it asks for the frames instead', /requestFrameInjection\(\);/.test(ic), true);
eq('and asks again after Apply navigates, because those are new frames',
  (ic.match(/requestFrameInjection\(\);/g) || []).length >= 2, true);
eq('its account wall goes through the shared handler, not a second copy',
  /await handleAccountAuth\(\);/.test(ic), true);
eq('and the wall is recognised from the route iCIMS parks postings at',
  /\\\/\(login\|register\|createaccount\)\\b/.test(ic), true);

const wk = body('workableAutomation');
eq('Workable asks for the frames too', /requestFrameInjection\(\);/.test(wk), true);
eq('and says so rather than failing silently when the form is elsewhere',
  /DIAG\('workable\.no-form-here'/.test(wk), true);
eq('its fields are found across boundaries, not with document.querySelector',
  /const el = deepAll\(sel\.trim\(\), 4\)\.filter\(isVisible\)\[0\];/.test(wk), true);
/* Workable is white-labelled onto employer domains constantly, and the route
   only consulted the host — so a fingerprinted Workable board fell through to
   the generic path while Workday, Greenhouse and the rest got their drivers. */
eq('a fingerprinted Workable board reaches its own driver',
  /platform === 'Workable'\) await workableAutomation\(\)/.test(src), true);

/* ── 52. the autofill must not shake the page ─────────────────────────────── */
/* "autofill jitters scroll up/down super fast". */
console.log('filling a form does not shake it');
const iv2 = body('inView');
/* The old test demanded the element be ENTIRELY inside the viewport, which on a
   real form is almost never true — so nearly every click scrolled. */
eq('any part of a control being visible is enough', /r\.bottom > -MARGIN && r\.top < h \+ MARGIN/.test(iv2), true);
eq('with a margin, so a control just past the fold does not start a scroll',
  /const MARGIN = Math\.round\(h \* 0\.25\);/.test(iv2), true);
const sc = body('scrollIfNeeded');
eq('and scrolls are rate-limited on top of that',
  /if \(now - _lastScrollAt < SCROLL_MIN_GAP_MS\) return;/.test(sc), true);
eq('still instant and "nearest" — never smooth, never centred',
  /el\.scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/.test(sc), true);
// The arithmetic, on a 900px viewport.
{
  const h = 900, MARGIN = Math.round(h * 0.25);
  const vis = (top, bottom) => bottom > -MARGIN && top < h + MARGIN;
  eq('a control in the middle needs no scroll', vis(400, 440), true);
  eq('one straddling the fold needs no scroll', vis(870, 930), true);
  eq('one just below it needs no scroll either', vis(950, 990), true);
  eq('one far below does', vis(2000, 2040), false);
  eq('one scrolled far above does', vis(-900, -860), false);
  // The old rule, for contrast: it would have scrolled for three of those five.
  const old = (top, bottom) => top >= 0 && bottom <= h;
  eq('the old rule scrolled for a control straddling the fold', old(870, 930), false);
  eq('and for one just below it', old(950, 990), false);
}


/* ── 53. three things the first real diagnostics export exposed ───────────── */
console.log('what the recorder found out about the recorder');

/* (a) The most useful section came out EMPTY across 1,482 recorded outcomes.
   Unanswered questions were only ever captured from logFillReport, which runs
   when a submit is attempted — so a job that failed before reaching submit,
   which is most of them, contributed nothing. */
const ruq = body('reportUnansweredQuestions');
eq('unanswered questions are captured at the moment a job fails',
  /for \(const label of r\.missingLabels\) DIAG\('field\.unanswered', label\);/.test(ruq), true);
eq('and nothing is emitted when there is nothing to say',
  /if \(!r \|\| !r\.missingLabels \|\| !r\.missingLabels\.length\) return;/.test(ruq), true);
eq('the manager path captures on failure and timeout',
  /if \(status === 'failed' \|\| status === 'timeout'\) reportUnansweredQuestions\('when the job failed'\);/.test(src), true);
eq('and so does the single-tab path, while still on the page',
  /LOG\('Queue job: submission NOT confirmed'[^\n]*\n            \/\/ While still on the page[^\n]*\n            reportUnansweredQuestions\('when the job failed'\);/.test(src), true);
/* A success needs no explanation, and capturing one would bury the failures. */
eq('a job that worked is not asked what it failed to answer',
  /if \(status === 'failed' \|\| status === 'timeout'\)/.test(src), true);

/* (b) "A listener indicated an asynchronous response by returning true, but the
   message channel closed before a response was received" — our own bug. The
   handler replied and THEN claimed it would reply later. */
eq('a handler that has already replied does not also claim async',
  /sendResponse\(\{ ok: true \}\);\n      \/\* false, not true\./.test(src), true);
eq('it returns false', /return false;\n    \}\n  \}\);/.test(src), true);

/* (c) "script error" with nothing else is unactionable — it is what a
   cross-origin script gives. The stack frame is what locates the fault. */
eq('a page error carries the frame that raised it',
  src.includes("at = ((e && e.error && e.error.stack) || '').split('") && /frame: at\.trim\(\)\.slice\(0, 160\)/.test(src), true);
eq('and so does a rejected promise',
  /const stack = \(event\.reason && event\.reason\.stack\) \|\| '';/.test(src), true);
/* Neither may fire while you are merely browsing: most pages throw something,
   and a recorder full of other people's bugs hides ours. */
eq('the page-error hook stands down when no job is being driven',
  /window\.addEventListener\('error', \(e\) => \{\n      if \(!_diagAutomating\(\)\) return;/.test(src), true);
eq('and the rejection hook only records while one is',
  /if \(_diagAutomating\(\)\) \{\n      try \{\n        const stack =/.test(src), true);


/* ── 54. an invisible CAPTCHA must not park the run ───────────────────────── */
/* A 43-job run stopped dead on a Klaviyo Greenhouse embed with every field
   still empty, showing our own banner: "reCAPTCHA detected — please solve it.
   Automation is paused." There was nothing to solve. Greenhouse embeds carry an
   INVISIBLE reCAPTCHA that never asks the applicant anything, and the detector
   only looked at the element's own computed style — which is not how these are
   hidden. */
console.log('only a CAPTCHA a human could solve stops the run');
const dc = body('detectCaptcha');
eq('an off-screen challenge does not count',
  /if \(r\.bottom < 0 \|\| r\.right < 0 \|\| r\.top > vh \|\| r\.left > vw\) continue;/.test(dc), true);
eq('visibility is checked all the way up, not just on the iframe',
  /for \(let node = el, up = 0; node && up < 8; node = node\.parentElement, up\+\+\)/.test(dc), true);
eq('an ancestor with opacity 0 hides it', /Number\(cs\.opacity\) === 0/.test(dc), true);
eq('and the branding badge is not a challenge', /grecaptcha-badge/.test(dc), true);
eq('but a real challenge iframe still is', /!\/challenge\|expires\/\.test\(title\)/.test(dc), true);
eq('the size floor that caught v3 token frames is still there',
  /if \(r\.width < 60 \|\| r\.height < 50\) continue;/.test(dc), true);

// Run the three gates for real, on the shapes that matter.
{
  const vw = 1900, vh = 900;
  const onScreen = (r) => !(r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw);
  eq('a challenge in the middle of the page counts',
    onScreen({ top: 300, bottom: 600, left: 700, right: 1000 }), true);
  eq('one parked at -10000px does not',
    onScreen({ top: -10000, bottom: -9700, left: -10000, right: -9700 }), false);
  eq('nor one below a very long form',
    onScreen({ top: 4000, bottom: 4300, left: 100, right: 400 }), false);
  eq('one straddling the bottom edge still counts',
    onScreen({ top: 820, bottom: 1100, left: 100, right: 400 }), true);

  const badge = (title) => /privacy|terms|recaptcha$/.test(title) && !/challenge|expires/.test(title);
  eq('"reCAPTCHA" alone is the badge', badge('recaptcha'), true);
  eq('so is the privacy/terms frame', badge('recaptcha privacy and terms'), true);
  eq('but the challenge frame is not',
    badge('recaptcha challenge expires in two minutes'), false);
}
/* ── and nothing about the run is pinned over the employer's page ─────────── */
/* The CAPTCHA state used to be a full-width amber bar across the top of every
   page it appeared on, covering the employer's header and sitting above the form
   you were reading. It is information about the RUN, and the run has a panel. */
console.log('the run does not put furniture on the page');
eq('no page-wide bar is built any more', /id = 'ua-captcha-banner'/.test(src), false);
eq('nor is its text', /please solve it\. Automation is paused/.test(src), true === false ? true : /please solve it\. Automation is paused/.test(src));
eq('the waiting state is held, not drawn',
  /let _captchaWaiting = '';/.test(src), true);
eq('and the run panel is what shows it',
  /proc\.textContent = `Waiting — solve the \$\{_captchaWaiting\} to continue`;/.test(src), true);
/* A run waiting on a human must not read as "Processing…" — that looks like a
   hang, which is exactly what it looked like. */
eq('so a waiting run never claims to be processing',
  /if \(_captchaWaiting\) \{\n          proc\.textContent = `Waiting/.test(src), true);
eq('clearing it puts the panel back to normal',
  /function hideCaptchaBanner\(\) \{\n    _captchaWaiting = '';/.test(src), true);
eq('and a bar left over from an older build is cleared away',
  /document\.getElementById\('ua-captcha-banner'\)\?\.remove\(\);/.test(src), true);

/* The "<ATS> Detected" pill was the same kind of thing in the other corner. */
eq('the ATS pill no longer mounts',
  /function showATSBadge\(\) \{\n    try \{ document\.getElementById\('ua-ats'\)\?\.classList\.remove\('show'\); \} catch \(_\) \{\}/.test(src), true);
/* Only the ATS pill goes. The run control panel uses the same class and must
   keep working — it is the Pause/Skip/Quit you actually press. */
eq('nothing shows the ATS pill any more',
  /ua-ats'\)[^\n]*classList\.add\('show'\)/.test(src), false);
eq('but the run control panel still mounts', /ctrl\.classList\.add\('show'\)/.test(src), true);


/* ── 55. the speed selector must reach the loop a job lives in ────────────── */
/* "automation is too slow". A diagnostics trail over six Greenhouse jobs showed
   the same four passes cycling, and multiPageLoop — where a job spends most of
   its life — carried close to ten seconds of UNCONDITIONAL sleep per page
   iteration, eighteen pages of budget, every one of them a flat number the
   1x/1.5x/2x/3x selector could not touch. */
console.log('the speed selector reaches the multi-page loop');
const mpl = body('multiPageLoop');
eq('no flat sleep is left in the loop', /await sleep\(\d/.test(mpl), false);
eq('and every wait goes through the scaler',
  (mpl.match(/sleep\(scaled\(/g) || []).length >= 8, true);
/* Each has a floor: at 3x a wait still has to be long enough for a page to do
   something, or the loop just spins faster over the same unchanged DOM. */
for (const [ms, floor] of [[2000, 350], [3000, 500], [1500, 300], [300, 100]])
  eq(`the ${ms}ms wait keeps a ${floor}ms floor`, mpl.includes(`scaled(${ms}, ${floor})`), true);

/* The second fill pass exists to catch fields revealed BY the first. If the
   first filled nothing, there is nothing to reveal and it is pure cost —
   twice a page, eighteen pages deep. */
eq('the second fill pass only runs when the first one did something',
  /const firstPass = await fallbackFill\(\);\n      if \(firstPass\) \{/.test(mpl), true);
eq('and fallbackFill reports a count for it to test',
  /return filled \+ refilled \+ locFixed;/.test(body('fallbackFill__impl')), true);

// The arithmetic, on the real numbers.
{
  const scaled = (ms, floor, factor) => Math.max(floor || 60, Math.round(ms * factor));
  const F = { 1: 1, 1.5: 0.66, 2: 0.45, 3: 0.3 };
  const perPage = (f) => scaled(2000, 350, f) + scaled(3000, 500, f) +
    scaled(1000, 200, f) + scaled(500, 120, f) + scaled(300, 100, f);
  eq('a page iteration at 1x sleeps 6.8s', perPage(F[1]), 6800);
  eq('at 2x it sleeps 3.1s', perPage(F[2]), 3060);
  eq('and at 3x, 2.05s', perPage(F[3]), 2050);
  eq('so 3x is roughly three times faster through the loop',
    Math.round((perPage(F[1]) / perPage(F[3])) * 10) / 10 >= 3, true);
  // …and skipping the dead second pass takes more off again.
  const withoutSecond = (f) => perPage(f) - scaled(1000, 200, f);
  eq('a page where the first pass filled nothing is cheaper still',
    withoutSecond(F[3]) < perPage(F[3]), true);
  /* The floors are what stop 3x becoming a busy-loop over an unchanged page. */
  eq('no wait collapses below its floor at 3x', scaled(300, 100, F[3]), 100);
}
/* The inter-job delay was already speed-aware; this checks it stayed that way. */
eq('the gap between jobs still follows the selector',
  /const QUEUE_DELAYS = \{ 1: 1500, 1\.5: 1000, 2: 600, 3: 300 \};/.test(src), true);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
