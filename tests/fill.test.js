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
const path = require('path');

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
// Checks that finish after the synchronous run; the exit waits for them.
const asyncChecks = [];
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
eq('the heartbeat is fast enough for a 15s window (3 beats)', /beatIv = setInterval\(beat, 5000\);/.test(src), true);
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
  /Never submit through one\.[\s\S]{0,120}?await waitForResumeUpload\(25000\); \}[\s\S]{0,900}?logFillReport\('Before submit'\)/.test(src), true);
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
    // (v17.39: a "Workday is SpeedyApply's" return may come first.)
    new RegExp('async function ' + fn + '\\(\\.\\.\\.a\\) \\{ (if \\(saOwnsWorkday\\(\\)\\) return [^;]+; )?return withBusy\\(').test(src), true);
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

/* ── 10b. the per-job cap extends for a job that is still working ─────────── */
console.log('per-job cap extends while working');
{
  const m = src.match(/const JOB_EXTEND_MS[\s\S]*?function jobTimeoutExtension\(startedAt\) \{[\s\S]*?\n  \}/);
  eq('jobTimeoutExtension exists', !!m, true);
  const mk = (busy, idle, qTimeout) => new Function('isBusy', 'stalledFor', 'qTimeout',
    m[0] + '\nreturn jobTimeoutExtension;')(() => busy, () => idle, qTimeout);
  const now = Date.now();
  eq('busy at 150s → 45s more', mk(true, 0, 150000)(now - 150000), 45000);
  eq('progressed 10s ago → 45s more', mk(false, 10000, 150000)(now - 150000), 45000);
  eq('idle 40s, not busy → expire', mk(false, 40000, 150000)(now - 150000), 0);
  // The ceiling is whatever the extension ships (5 min since your 12.4 build).
  const CEIL = Number((m[0].match(/JOB_HARD_CEIL_MS = (\d+) \* 60 \* 1000/) || [])[1]) * 60000;
  eq('busy at the ceiling → expire', mk(true, 0, 150000)(now - CEIL), 0);
  const near = mk(true, 0, 150000)(now - (CEIL - 10000));
  eq('near the ceiling → only the time left', near > 0 && near <= 10000, true);
  eq('both run modes use it',
    (src.match(/jobTimeoutExtension\(/g) || []).length >= 3, true);
  eq('the timeout reason names the last activity',
    /Timed out after \$\{took\}s \(last activity:/.test(src), true);
  eq('the heartbeat reports busy to the worker', /idleMs: stalledFor\(\), busy: isBusy\(\)/.test(src), true);
  eq('the worker spares a working job up to the ceiling',
    /j\.working && j\.beatAt && Date\.now\(\) - j\.beatAt < 15000/.test(orch), true);
}

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
  /step did not advance — ' \+ \(toast \? 'the form says: "' \+ toast \+ '"' : 'fixing what is blocking it'\)/.test(srcSR), true);
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
eq(`the figure it falls back to is the shipped default (${shippedYears})`, shippedYears, (src.match(/\n\s*years:\s*'(\d+)'/) || [])[1]);
eq('a real answer of zero to something that is NOT a years question is kept',
  refine('0', 'How many dependents do you have?', numberBox), '0');
// v17.23: only the figure YOU set in the profile editor ("years") overrides 7.
eq("the candidate's own profile figure beats the default",
  shapeCtx.refineAnswerForControl('0', LINUX_Q, { years: '11' }, numberBox), '11');
eq('years merged in from other stored data do not',
  shapeCtx.refineAnswerForControl('0', LINUX_Q, { years_experience: '2' }, numberBox), shippedYears);

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
  /pressWorkdayButton\(createBtn\);[\s\S]{0,700}?await markAccountCreated\(location\.hostname\);/.test(wd), true);
eq('signing in records it too', /pressWorkdayButton\(signInBtn\);\n        await markAccountCreated\(location\.hostname\);/.test(wd), true);
eq('and the site saying "already exists" is treated as proof',
  /if \(onCreate && existsErr\) \{[\s\S]{0,320}?await markAccountCreated\(location\.hostname\);/.test(wd), true);
eq('a known employer opens Sign In instead of Create Account',
  /if \(onCreate && known && !wrongCredErr\)/.test(wd), true);
eq('and a wrong-credentials error still flips back to Create Account (when no account is confirmed)',
  /if \(onSignIn && wrongCredErr && !auth\.exists\)/.test(wd), true);
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
  const DEFAULTS = { years: '7' };
  const _policyProfile = {};
  ${body('yearsAnswer')}
  ${body('knockoutPolicy')}
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
eq('an exact learned answer YOU gave is left to stand',
  /const exactOk = exact && \(isManualAnswer\(label, el\) \? exact : safeKnockoutAnswer\(exact, questionText\)\);/.test(src), true);
eq('and it is consulted before the built-in guesses', /const raw = fromSaved \|\| exactOk \|\| guessValue\(label, p\) \|\|/.test(src), true);

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
eq('and the run carries on in a fresh BACKGROUND tab, in the same window, on the same job',
  /const t = await openRunTab\(url, \{ active: false, windowId: old \? old\.windowId : undefined \}\);/.test(orch), true);
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
  /const qFull = comboQuestion\(combo\);/.test(cd) && /return String\(getFullQuestionText\(el\) \|\| getLabel\(el\)|for \(const t of \[getFullQuestionText\(el\), getLabel\(el\), getFullQuestionText\(combo\), getLabel\(combo\)\]\)/.test(src), true);
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
    ${body('reasonGroup')}
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
  /for \(const label of r\.missingLabels\) DIAG\('field\.unanswered', label, \{ kind: describeControl\(_missingEls\.get\(label\)\) \}\);/.test(src), true);
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
eq('otherwise a PDF named after you (plain text only where PDF is not accepted)',
  /new File\(\[textToPdf\(letter\)\], `\$\{who\}_Cover_Letter\.pdf`/.test(coverFn) && /new File\(\[letter\], `\$\{who\}_Cover_Letter\.txt`/.test(coverFn), true);
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
eq('the click is confirmed by the page changing (or the apply choice / sign-in showing), not by a guessed delay',
  /waitUntil\(\(\) => pastApply\(\) \|\| stepSignature\(\) !== before, 12000, 150\)/.test(wdFn), true);
eq('and retried rather than assumed', /for \(let attempt = 0; attempt < 3 && !pastApply\(\); attempt\+\+\)/.test(wdFn), true);
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
  /for \(const label of r\.missingLabels\) DIAG\('field\.unanswered', label, \{ kind: describeControl\(_missingEls\.get\(label\)\) \}\);/.test(ruq), true);
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
  (mpl.match(/scaled\(/g) || []).length >= 8, true);

/* ── and 1x got faster too, by not guessing ────────────────────────────────
   Scaling only helped 1.5x and above; at 1x the loop still paid the full
   constant every time. Those constants were guesses at the SLOWEST case, and a
   page that had settled in 200ms still waited two seconds.

   The fix is not smaller guesses. Each wait now returns the moment its
   condition is met, with the old number kept as a cap. */
eq('the loop waits for the DOM to settle rather than for a timer',
  (mpl.match(/await waitForFormStable\(scaled\(/g) || []).length >= 5, true);
eq('and the caps are the same numbers as before, now a backstop',
  mpl.includes('waitForFormStable(scaled(2000, 350))') &&
  mpl.includes('waitForFormStable(scaled(3000, 500))'), true);
/* After a submit the question is not "has the DOM gone quiet" but "is it
   confirmed", so that one asks directly. */
eq('the post-submit wait polls for the confirmation itself',
  /if \(await waitUntil\(confirmSubmitted, scaled\(3000, 600\), 200\)\)/.test(mpl), true);
const wu = body('waitUntil');
eq('waitUntil returns the instant the condition holds',
  /try \{ if \(cond\(\)\) return true; \} catch \(_\) \{\}/.test(wu), true);
eq('and gives up at the cap rather than hanging',
  /if \(Date\.now\(\) >= deadline\) return false;/.test(wu), true);
eq('it never sleeps past its own deadline',
  /Math\.min\(step, Math\.max\(30, deadline - Date\.now\(\)\)\)/.test(wu), true);
eq('a condition that throws does not break the wait', /catch \(_\) \{\}/.test(wu), true);

/* waitForFormStable resolves after a short quiet period, so the real cost at 1x
   is that quiet period — not the cap. */
{
  const settle = (f) => Math.max(90, Math.round(300 * f));
  eq('a settled page costs ~300ms at 1x, not 2000ms', settle(1), 300);
  eq('and 90ms at 3x', settle(0.3), 90);
  /* Four of the waits became settles; the two small fixed ones are left as
     they are, being real breathing room rather than guesses at a page load. */
  const quietIteration = (f) =>
    settle(f) * 4 + Math.max(120, Math.round(500 * f)) + Math.max(100, Math.round(300 * f));
  eq('a quiet page iteration at 1x: 2000ms, down from 6800ms', quietIteration(1), 2000);
  eq('which is a 3.4x improvement at 1x alone',
    Math.round((6800 / quietIteration(1)) * 10) / 10, 3.4);
  eq('at 3x it is 610ms', quietIteration(0.3), 610);
  /* The caps have not moved, so a page that genuinely needs the time still
     gets it — this is a floor being removed, not a ceiling being lowered. */
  eq('and a slow page can still take the full 2s+3s+1s if it needs to',
    2000 + 3000 + 1000, 6000);
}
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


/* ── 56. moving to the next job cannot be vetoed by the page ──────────────── */
/* "Leave site? Changes you made may not be saved." kept appearing after every
   application, needing a click before the run would continue. The MAIN-world
   shield disarms beforeunload handlers, but that is a race by construction: it
   wraps only listeners registered after it installs, and anything that
   re-patches addEventListener afterwards undoes it. That race was being lost. */
console.log('the next job opens without asking the page');
const gnj = body('goToNextJob');
eq('the runner asks the worker to move it, rather than setting location',
  /chrome\.runtime\.sendMessage\(\{ type: 'UA_NAV_NEXT', url \}/.test(gnj), true);
eq('and the queue calls that instead of assigning location.href',
  /setTimeout\(\(\) => \{ goToNextJob\(n\.url\); \}, delay\);/.test(src), true);
eq('no bare location.href hop is left in the queue runner',
  /setTimeout\(\(\) => \{ location\.href = n\.url; \}, delay\)/.test(src), false);
/* A worker that is asleep, or a page outside the extension, must not strand the
   run — the old road is still there when the reply does not come. */
eq('a silent worker falls back rather than stranding the run',
  /const t = setTimeout\(fallback, 1500\);/.test(gnj), true);
eq('and the fallback runs at most once', /if \(!done\) \{ done = true;/.test(gnj), true);

eq('the worker closes the old tab, which beforeunload cannot veto',
  /chrome\.tabs\.remove\(tabId, \(\) => void chrome\.runtime\.lastError\);/.test(orch), true);
eq('the next job opens in the SAME tab, navigated in place',
  /chrome\.tabs\.update\(tabId, \{ url \}, \(\) => void chrome\.runtime\.lastError\);/.test(orch), true);
eq('a swap happens only if the in-place move never started',
  /if \(started\) return;\n\s*chrome\.tabs\.create\(\{ url, active: !!was\.active,/.test(orch), true);
/* "It keeps switching tabs — it's messing up my use of my PC." Nothing the
   automation does on its own may bring a tab or window to the front. */
eq('no automated path opens an active tab', /tabs\.create\(\{[^}]*active: true/.test(orch), false);
eq('no automated path activates a tab', /tabs\.update\([^)]*active: true/.test(orch), false);
eq('no automated path focuses a window', /windows\.update\(/.test(orch) || /windows\.update\(|tabs\.update\([^)]*active/.test(src), false);
/* The marker has to move BEFORE the old tab goes, or a watchdog tick in between
   sees an active run with no runner tab and starts rescuing it. */
{
  const nav = orch.slice(orch.indexOf("msg.type === 'UA_NAV_NEXT'"), orch.indexOf("msg.type === 'UA_INJECT_FRAMES'"));
  eq('on a swap, the runner marker moves to the new tab before the old one closes',
    nav.indexOf('ua_runner_tab: t.id') < nav.indexOf('chrome.tabs.remove(tabId'), true);
  eq('and only an http(s) url is ever opened', nav.includes("test(url)") && nav.includes('https?:'), true);
  eq('a tab we cannot identify is refused outright', /tabId == null/.test(nav), true);
}

/* Belt and braces: the shield now notices when it has been replaced. */
const hooks2 = fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]), 'ua-page-hooks.js'), 'utf8');
eq('the hook marks itself so it can tell if it is still installed',
  /mine\.__uaHook = true;/.test(hooks2), true);
eq('and puts itself back when something else has taken over',
  /if \(!EventTarget\.prototype\.addEventListener\.__uaHook \|\|/.test(hooks2), true);
eq('checked cheaply, on an interval, not on every call',
  /\}, 2000\);/.test(hooks2), true);


/* ── 57. Greenhouse "Location (City)" ─────────────────────────────────────── */
/* The only unanswered question in an entire diagnostics export. Three defects,
   and the first one meant the field was never even attempted. */
console.log('a required location field gets answered');
{
  const lqCtx = {};
  new Function('exports', `
    const DEFAULTS = { country: 'Ireland' };
    ${body('locationQuery')}
    exports.q = locationQuery;
  `)(lqCtx);
  const q = lqCtx.q;
  /* (1) It returned 0 before touching the field whenever the profile had no
     city. */
  eq('a full profile gives city, region and country', q({ city: 'Dublin', state: 'Leinster', country: 'Ireland' }, false), 'Dublin, Leinster, Ireland');
  eq('a "city" field gets just the city part', q({ city: 'Dublin', state: 'Leinster', country: 'Ireland' }, true), 'Dublin, Leinster');
  eq('no city: the profile\'s own location is used', q({ location: 'Cork, Ireland' }, true), 'Cork, Ireland');
  eq('no location either: the address', q({ address: 'Galway' }, true), 'Galway');
  eq('nothing at all: the country — never a blank that blocks the submit', q({}, true), 'Ireland');
  eq('the profile\'s country beats the default', q({ country: 'Belgium' }, true), 'Belgium');
  /* It must never make a city up. */
  eq('a city is never invented', /Dublin|London/.test(q({ country: 'Ireland' }, true)), false);
}
const rlf = body('resolveLocationFields');
eq('the field is always attempted, not skipped for want of a city',
  /if \(!locationQuery\(p, false\)\) return 0;/.test(rlf) && !/if \(!cityVal\) return 0;/.test(rlf), true);
eq('and it is found across shadow roots, not with document.querySelectorAll',
  /deepAll\('input:not/.test(rlf), true);
eq('a location that would not commit is reported, with what was tried',
  /DIAG\('location\.uncommitted'/.test(rlf), true);

/* (2) The dropdown finder took the first visible [class*=dropdown] or
   [class*=menu] anywhere on the page — the Country selector or the site nav. */
const fad = body('findAutocompleteDropdown');
eq('the listbox the input names in aria-controls wins',
  /for \(const attr of \['aria-controls', 'aria-owns', 'list'\]\)/.test(fad), true);
eq('its own field is searched before the whole page',
  fad.indexOf("input.closest('.form-group") < fad.indexOf('const dd = $(sel);'), true);
eq('and a page-wide match must have appeared near the input',
  /if \(Math\.abs\(r\.top - r0\.bottom\) > 400\) continue;/.test(fad), true);

/* (3) Typing leaves text in the box whether or not a suggestion was chosen, so
   a non-empty input proved nothing. */
{
  const laCtx = {};
  new Function('exports', `${body('locationAccepted')}\nexports.f = locationAccepted;`)(laCtx);
  const mk = (value, around) => ({
    value,
    closest: () => ({ textContent: around }),
    parentElement: null,
  });
  eq('a value with nothing complaining is accepted', laCtx.f(mk('Dublin, Ireland', 'Location (City)*')), true);
  eq('an empty box is not', laCtx.f(mk('', 'Location (City)*')), false);
  eq('typed text beside "is required" is NOT accepted — nothing was chosen',
    laCtx.f(mk('Dublin', 'Location (City)* Location (City) is required')), false);
  eq('nor beside "please select a location"',
    laCtx.f(mk('Dub', 'Location Please select a location')), false);
}
const ca = body('commitAutocomplete');
eq('a query that finds nothing is retried with its first part',
  /const attempts = \[\.\.\.new Set\(\[value, parts\[0\]\]\.filter\(Boolean\)\)\];/.test(ca), true);
eq('and success means the widget accepted it, not that text was typed',
  /if \(await commitAutocompleteOnce\(el, q\) && locationAccepted\(el\)\) return true;/.test(ca), true);
eq('each attempt starts from an empty box, not appended to the last',
  /try \{ nativeSet\(el, ''\); \} catch \(_\) \{\}/.test(body('commitAutocompleteOnce')), true);
/* ArrowDown+Enter after a click that worked moves the highlight on and commits
   the NEXT suggestion. */
eq('the keyboard reinforcement only fires when the click did not take',
  /if \(!findPacItems\(\)\.length && locationAccepted\(el\)\) \{/.test(body('commitAutocompleteOnce')), true);


/* ── 58. the iCIMS login loop ─────────────────────────────────────────────── */
/* From a real export. The login SUCCEEDED — the run reached
   /candidate?from=login and filled sixteen fields — and then went round again:
   an Apply link back to the job page, "entering the account email" into the
   application form, a CV uploaded twice across iCIMS's reload, until the 150s
   cap. On a second board the whole fill ran against the login page itself. */
console.log('iCIMS gets through its login and stays through');
{
  const re = new RegExp((src.match(/const IN_APPLICATION_URL_RE = \/(.*)\/i;/) || [])[1], 'i');
  const past = (url) => { const u = new URL(url); return re.test(u.pathname + u.search); };
  // The exact URLs from the export.
  eq('iCIMS\'s post-login application page is inside the application',
    past('https://careers-idirect.icims.com/jobs/2878/devops-engineer/candidate?from=login&csrf=9AEFF7D91043FC5E&hashed=-626008887'), true);
  eq('including the magic-link variant it lands on first',
    past('https://careers-idirect.icims.com/jobs/2878/devops-engineer/candidate?from=login&eem=3gsKV&code=489f&eu_resident=1&accept_gdpr=1'), true);
  eq('and the page it reloads to after a CV upload',
    past('https://careers-idirect.icims.com/jobs/2878/devops-engineer/candidate?from=login&csrf=9AEF&uploadResume=1&uploadResume=1'), true);
  eq('the job description is NOT — Apply must still work there',
    past('https://careers-idirect.icims.com/jobs/2878/devops-engineer/job?mobile=false&width=1904'), false);
  eq('nor is the login wall itself — it still has to be signed in',
    past('https://careers-sig.icims.com/jobs/10903/login?iis=jobright'), false);
  // Nothing outside that shape may change behaviour.
  for (const u of ['https://job-boards.greenhouse.io/acme/jobs/123',
    'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Dublin/X_R1/apply',
    'https://jobs.lever.co/acme/abc/apply', 'https://jobs.smartrecruiters.com/Acme/123-x'])
    eq(`${u.split('/')[2]} is unaffected`, past(u), false);
}
eq('an application page is never mistaken for a sign-in wall',
  /function looksLikeAuthPage\(\) \{\n    \/\/ The URL is the ATS telling us sign-in is done\. It outranks any field\.\n    if \(pastTheApplyStep\(\)\) return false;/.test(src), true);
eq('the generic opener does not click Apply from inside the application',
  /if \(pastTheApplyStep\(\)\) return true;\n    while \(clicks < limit\) \{/.test(src), true);
/* My own guard from the previous iCIMS change listed /apply, /login and
   /register and missed /candidate — which is how the run went back to /job. */
eq('and neither does the iCIMS driver, which is where the loop started',
  /if \(applyBtn && !pastTheApplyStep\(\) && /.test(body('icimsAutomation')), true);

/* The reload around a CV upload. */
{
  const cvCtx = {};
  const store = {};
  new Function('exports', `
    let location = { search: '', pathname: '/jobs/2878/x/candidate' };
    const sessionStorage = { getItem: (k) => exports.store[k] || null, setItem: (k, v) => { exports.store[k] = v; } };
    let document = { body: { innerText: '' } };
    ${(src.match(/  const CV_NOTE_MS = [^\n]+/) || [''])[0]}
    ${body('cvUploadedHereRecently')}
    ${body('noteCvUploadedHere')}
    ${body('cvRequiredErrorShowing')}
    exports.recent = cvUploadedHereRecently;
    exports.note = noteCvUploadedHere;
    exports.required = cvRequiredErrorShowing;
    exports.at = (search, text) => { location.search = search; document.body.innerText = text || ''; };
  `)(Object.assign(cvCtx, { store }));
  cvCtx.at('?from=login&csrf=9AEF');
  eq('a page that has seen no upload is free to upload', cvCtx.recent(), false);
  cvCtx.at('?from=login&csrf=9AEF&uploadResume=1');
  eq('iCIMS\'s own uploadResume=1 means it has one already', cvCtx.recent(), true);
  cvCtx.at('?from=login&csrf=9AEF');
  cvCtx.note();
  eq('and so does this tab having uploaded here a moment ago', cvCtx.recent(), true);
  cvCtx.at('?x', 'Resume is required');
  eq('but a visible "Resume is required" means the file really is gone', cvCtx.required(), true);
  cvCtx.at('?x', 'Please upload your CV');
  eq('in any of its wordings', cvCtx.required(), true);
  cvCtx.at('?x', 'Upload your resume (optional). Accepted: pdf, docx.');
  eq('while an upload HINT is not a complaint', cvCtx.required(), false);
}
const ar = body('attachResume__impl');
eq('a CV the ATS just reloaded around is not uploaded again',
  /if \(cvUploadedHereRecently\(\) && !cvRequiredErrorShowing\(\)\) \{/.test(ar), true);
eq('the note is written the moment the file goes in, not on confirmation',
  ar.indexOf('noteCvUploadedHere();') > ar.indexOf("fireOnHostChain(inp, ['input', 'change']);") &&
  ar.indexOf('noteCvUploadedHere();') < ar.indexOf('await sleep(500);'), true);

/* The login page filled as if it were the application. */
const mpl2 = body('multiPageLoop');
eq('a page that is still a sign-in wall is not filled as an application',
  mpl2.indexOf('if (looksLikeAuthPage()) {') < mpl2.indexOf('await triggerAutofill();') &&
  mpl2.indexOf('if (looksLikeAuthPage()) {') > mpl2.indexOf('await handleAccountAuth();'), true);
eq('it waits for the sign-in to land instead',
  /await waitForStepChange\(getPageHash\(\), scaled\(8000, 2500\)\);\n        continue;/.test(mpl2), true);
eq('and gives up after a few passes rather than going round until the cap',
  /const MAX_AUTH_WALL_PASSES = 3;/.test(mpl2) && /DIAG\('auth\.stuck'/.test(mpl2), true);
eq('a page that is past the wall resets the count', /authWallPasses = 0;\n\n      \/\/ Try Jobright autofill again/.test(mpl2), true);


/* ── 59. the full audit ───────────────────────────────────────────────────── */
/* A systematic pass, one bug class at a time — the classes this codebase has
   actually had — with every hit triaged. Each class is locked here so it cannot
   come back quietly. */
console.log('audit: page-derived text never reaches the DOM as markup');
{
  /* Saved responses are LEARNED from page question text, so a keyword is
     page-controlled; it was rendered raw into the drawer on whatever site it was
     opened on next. */
  const resp = src.slice(src.indexOf('respList.innerHTML = filtered.map('), src.indexOf('respList.innerHTML = filtered.map(') + 1500);
  eq('saved-response keywords are escaped', resp.includes("${escHtml((r.keywords || []).join(', '))}"), true);
  eq('and so is the response text', resp.includes("${escHtml((r.response || '').slice(0, 120))}"), true);
  /* The LinkedIn recruiter follow-up (which auto-messaged people on linkedin.com)
     was removed in v17.15 — nothing of it may come back. */
  eq('the LinkedIn follow-up module is gone', /UA-LinkedIn|Recruiter Follow-up|ua-li-followup/.test(src), false);
  eq('applications no longer queue LinkedIn follow-ups', /enqueueFollowUp|stashInsidersFromJobright|ua_followup_queue/.test(src), false);
  eq('and the worker clears what it left in storage', /dropRemovedLinkedInFollowUp/.test(orch) && /'ua_followup_queue'/.test(orch), true);
}
{
  /* The Queue Manager is an extension page: an injection there runs with the
     extension's own privileges. It must never use innerHTML at all. */
  const qsrc = fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]), 'ua-queue.js'), 'utf8');
  eq('the privileged Queue Manager page has no innerHTML at all', /\.innerHTML\s*=/.test(qsrc), false);
  eq('and only ever links to http(s)', /if \(isSafeUrl\(j\.url\)\) \{ a\.href = j\.url;/.test(qsrc), true);
}

console.log('audit: the speed selector reaches every wait');
{
  /* 86 flat waits, 173 seconds of them, the selector could not touch —
     including 17s in the generic flow every unrecognised job goes through. */
  const lines = src.split('\n');
  const flat = [];
  let fn = '';
  lines.forEach((l, i) => {
    const m = l.match(/^  (?:async )?function ([\w$]+)/); if (m) fn = m[1];
    if (/await sleep\(\d{4,}\)/.test(l) && fn !== 'resolveEmailVerification__impl') flat.push(`${fn}:${i + 1}`);
  });
  eq('no flat wait of a second or more is left outside the mailbox poll', flat, []);
  /* The mailbox poll is deliberately NOT scaled — halving it doubles Gmail API
     calls for nothing a user would see. */
  eq('the mailbox poll keeps its own pace', /await sleep\(4000\);\s+\/\/ the mail has not landed yet/.test(src), true);
  // Every converted wait keeps at least half its time, at any speed.
  const conv = [...src.matchAll(/await sleep\(scaled\((\d{4,}), (\d+)\)\)/g)];
  // v17.22 replaced four of them on Workday with waits on the page itself, and
  // v17.36 a dozen more at the start of each ATS flow (form-stable / button-ready).
  eq('there are many converted waits', conv.length >= 55, true);
  eq('and every one keeps at least half its original time',
    conv.every(([, ms, floor]) => Number(floor) >= Math.floor(Number(ms) / 2) - 0), true);
  const scaledFn = (ms, floor, f) => Math.max(floor || 60, Math.round(ms * f));
  eq('a 3s wait is 3s at 1x', scaledFn(3000, 1500, 1), 3000);
  eq('and 1.5s at 3x — never cut below half, since some wait on a server', scaledFn(3000, 1500, 0.3), 1500);
}

console.log('audit: storage cannot fail silently, and cannot forget an application');
{
  const stBlock = src.slice(src.indexOf('  const st = {'), src.indexOf('  const st = {') + 900);
  eq('a failed write is read, not ignored', /const err = chrome\.runtime\.lastError;/.test(stBlock), true);
  eq('and reported in the log and the diagnostics', /LOG\(`Could not save \$\{k\}/.test(stBlock) && /DIAG\('storage\.error'/.test(stBlock), true);
  eq('the caller still gets its reply either way', /\n      r\(\);\n    \}\)\),/.test(stBlock), true);
  const mf = manifest;
  eq('the extension is not held to the 10MB default quota', mf.permissions.includes('unlimitedStorage'), true);

  /* The history "Skip already applied" reads was capped at 500 of ANY status,
     so on a 685-job queue real applications fell off the end within a run. */
  eq('the history holds far more than one run', /const APP_HISTORY_CAP = 5000;/.test(src), true);
  eq('the old 500 cap is gone', /_appHistory\.length > 500/.test(src), false);
  // Run the eviction for real.
  const evict = (hist, cap) => {
    if (hist.length <= cap) return hist;
    const keep = []; let excess = hist.length - cap;
    for (let i = hist.length - 1; i >= 0; i--) {
      const e = hist[i];
      if (excess > 0 && e && e.status !== 'applied') { excess--; continue; }
      keep.unshift(e);
    }
    return keep.slice(0, cap);
  };
  // newest first: 3 applied, then 4 failed, then 2 old applied
  const h = [{ u: 'a3', status: 'applied' }, { u: 'a2', status: 'applied' }, { u: 'a1', status: 'applied' },
    { u: 'f4', status: 'failed' }, { u: 'f3', status: 'failed' }, { u: 'f2', status: 'skipped' }, { u: 'f1', status: 'failed' },
    { u: 'old2', status: 'applied' }, { u: 'old1', status: 'applied' }];
  const kept = evict(h, 6).map((e) => e.u);
  eq('overflow drops failures and skips before any application', kept, ['a3', 'a2', 'a1', 'f4', 'old2', 'old1']);
  eq('so an old application is still remembered', kept.includes('old1'), true);
  eq('the real code evicts the same way',
    /if \(excess > 0 && e && e\.status !== 'applied'\) \{ excess--; continue; \}/.test(src), true);
}

console.log('audit: every message the worker answers, it answers exactly once');
{
  /* Replying and THEN returning true tells Chrome a second reply is coming;
     the caller sees "the message channel closed". UA_WHICH_TAB did exactly that,
     split across two lines so a one-line check missed it. */
  const wt = orch.slice(orch.indexOf("msg.type === 'UA_WHICH_TAB'"), orch.indexOf("msg.type === 'UA_WHICH_TAB'") + 500);
  eq('UA_WHICH_TAB replies synchronously and returns false', /sendResponse\(\{ tabId:[^\n]*\n[\s\S]*?return false;/.test(wt), true);
  /* An async handler that throws must still reply, or the caller hangs. */
  const asyncBranches = (orch.match(/\}\)\(\)\.catch\(\(\) => \{ try \{ sendResponse\(\{ ok: false \}\); \} catch \(_\) \{\} \}\);/g) || []).length;
  eq('every async handler in the worker replies even when it throws', asyncBranches >= 4, true);
  eq('none is left without one', /\}\)\(\);\s*\n\s*return true;/.test(orch), false);
}

console.log('audit: a missing mailbox client ID says so');
{
  const mb = fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]), 'ua-mailbox.js'), 'utf8');
  eq('connecting without a client ID is reported as that, not as a Google refusal',
    /return sendResponse\(\{ ok: false, reason: 'no-client-id' \}\);/.test(mb), true);
  eq('but a Chrome-managed sign-in, if one exists, is still allowed through',
    /const managed = await chromeToken\(false\)\.catch\(\(\) => null\);/.test(mb), true);
  eq('every async mailbox handler replies even when it throws',
    (mb.match(/\}\)\(\)\.catch\(\(\) => \{ try \{ sendResponse\(\{ ok: false \}\); \} catch \(_\) \{\} \}\);/g) || []).length >= 4, true);
}


/* ── 60. knockout answers, against real phrasing ──────────────────────────── */
/* A wrong Yes/No here is not a wrong field; it is an automatic rejection. This
   runs the real decider against 54 phrasings — the ordinary ones and the
   inverted ones where rules like these usually break. Three were wrong until
   the audit:
     "Do you have any RESTRICTIONS on your right to work in the UK?"  → was Yes
     "Do you hold a visa that would REQUIRE our sponsorship?"          → was Yes
     "Have you applied to this company in the last 6 months?"          → was Yes */
console.log('knockout answers are the ones that do not get you rejected');
{
  const koCtx2 = {};
  new Function('exports', `
    ${reLines}
    const DEFAULTS = { years: '7' };
    const _policyProfile = {};
    ${body('yearsAnswer')}
    ${body('knockoutPolicy')}
    ${body('workAuthorisationAnswer')}
    ${body('workAuthOptionIndex')}
    ${body('determineYesNo')}
    exports.d = determineYesNo;
  `)(koCtx2);
  const CASES = [
    // right to work — Yes
    ['Are you legally authorized to work in the United States?', 'yes'],
    ['Are you legally authorised to work in the UK?', 'yes'],
    ['Do you have the right to work in Ireland?', 'yes'],
    ['Do you currently have the right to work in the United Kingdom?', 'yes'],
    ['Are you able to work in the Netherlands without sponsorship?', 'yes'],
    ['Can you work in Belgium without requiring a visa?', 'yes'],
    ['Are you eligible to work in the EU?', 'yes'],
    ['Do you hold a valid work permit for Switzerland?', 'yes'],
    ['Are you a citizen or permanent resident of Canada?', 'yes'],
    ['Please confirm you do not require visa sponsorship', 'yes'],
    ['I am authorized to work in the US without sponsorship', 'yes'],
    ['Will you be able to work without restrictions?', 'yes'],
    ['Are you legally able to work in Ireland without any visa restrictions?', 'yes'],
    ['Do you have unrestricted right to work in Australia?', 'yes'],
    ['Are you authorized to work for any employer in the US?', 'yes'],
    ['Can you legally work in Canada?', 'yes'],
    // sponsorship / restriction — No
    ['Will you now or in the future require sponsorship for employment visa status (e.g. H-1B)?', 'no'],
    ['Will you require visa sponsorship within the next 18 months to work in the United Kingdom?', 'no'],
    ['Do you require a work permit to work in Germany?', 'no'],
    ['Would you need visa support to take up this role?', 'no'],
    ['Are you currently on a visa that requires sponsorship to change employers?', 'no'],
    ['Do you need the company to sponsor your visa now or in the future?', 'no'],
    ['Do you have any restrictions on your right to work in the UK?', 'no'],
    ['Would your employment be subject to obtaining a work permit?', 'no'],
    ['Is visa sponsorship required for you to work in Poland?', 'no'],
    ['Do you currently hold a visa that would require our sponsorship?', 'no'],
    ['Will you be requiring immigration support to work for us?', 'no'],
    ['Will you ever require sponsorship to maintain your work authorization?', 'no'],
    ['Do you need a visa to work in Spain?', 'no'],
    // availability / fit — Yes
    ['Are you willing to relocate to London?', 'yes'],
    ['Are you comfortable working from our Dublin office 3 days a week?', 'yes'],
    ['Are you currently residing in Romania?', 'yes'],
    ['Are you at least 18 years of age?', 'yes'],
    ['Do you have 5+ years of experience with Kubernetes?', 'yes'],
    ['Do you have hands-on experience with Linux patch and package management?', 'yes'],
    ['Do you consent to a background check?', 'yes'],
    ['Can you start within 4 weeks?', 'yes'],
    ['Are you open to travel up to 25%?', 'yes'],
    ['Is your notice period less than 3 months?', 'yes'],
    ['Do you have a valid driving licence?', 'yes'],
    ['Are you willing to undergo a drug test?', 'yes'],
    ['Would you be able to work in the office five days a week?', 'yes'],
    ['Are you prepared to relocate at your own expense?', 'yes'],
    // history / conduct — No
    ['Have you ever been convicted of a felony?', 'no'],
    ['Have you previously worked for Stripe?', 'no'],
    ['Are you a current employee of Deloitte?', 'no'],
    ['Do you have any relatives working at this company?', 'no'],
    ['Are you subject to a non-compete agreement?', 'no'],
    ['Have you ever been terminated from employment?', 'no'],
    ['Do you have any criminal convictions?', 'no'],
    ['Have you applied to this company in the last 6 months?', 'no'],
    ['Do you have any pending criminal charges?', 'no'],
    ['Are you bound by any restrictive covenants from a previous employer?', 'no'],
    ['Have you been dismissed from any position?', 'no'],
  ];
  const wrong = CASES.filter(([q, want]) => koCtx2.d(q.toLowerCase()) !== want)
    .map(([q, want]) => `${q} → ${koCtx2.d(q.toLowerCase())} (want ${want})`);
  eq(`all ${CASES.length} knockout phrasings get the answer that does not reject you`, wrong, []);
  eq('the battery really is 54 questions', CASES.length, 54);
}

/* ── 61. v17.4: what a real browser run showed ────────────────────────────────
   Every case here came out of driving the shipped extension in Chromium against
   a local application form (see README v17.4). Behavioural wherever the logic
   can run outside a page. */
console.log('v17.4 — the answer bank, native radios, the form\'s own error messages, calm scrolling');
{
  // 1. The saved-response matcher, run for real against the REAL seed bank.
  const seedSrc = src.match(/const SEED = (\[[\s\S]*?\n  \]);/)[1];
  const SEED = new Function('return ' + seedSrc)().map((e) => ({ ...e, seeded: true }));
  const mk = (bank) => {
    const x = {};
    new Function('exports', 'bank', `
      let _savedResponses = bank;
      ${src.match(/  const SEED_PROFILE_OWNED_RE = [^\n]*\n/)[0]}
      ${body('findSavedResponseMatch')}
      exports.m = findSavedResponseMatch;
    `)(x, bank);
    return x.m;
  };
  const match = mk(SEED);
  eq('"Location (City)" is not answered by the seeded "current location"', match('Location (City) *'), '');
  eq('the sponsorship question gets the sponsorship entry, not "visa status"',
    match('Will you now or in the future require sponsorship for employment visa status?'), 'No');
  eq('a seeded salary never stands in for the profile', match('What are your salary expectations?'), '');
  eq('a seeded notice period never stands in for the profile', match('What is your notice period?'), '');
  eq('one word of a two-word entry is not a match', match('Where is your office location?'), '');
  eq('a full seeded match still answers', match('Are you at least 18 years of age?'), 'Yes');
  eq('a seed matching 2 of its 3 words is not used (the decider answers instead)', match('Have you previously worked for Acme?'), '');
  const withMine = mk([...SEED, { keywords: ['previously', 'worked', 'acme'], response: 'Yes', manual: true }]);
  eq('your own entry still matches', withMine('Have you previously worked for Acme?'), 'Yes');

  // 2. A sentence cannot be squeezed onto a yes/no knockout.
  eq('a saved sentence on a sponsorship knockout is dropped',
    safe('Authorized to work without sponsorship', 'Will you now or in the future require sponsorship for employment visa status?'), '');
  eq('a sentence on an ordinary question is kept', safe('Immediately', 'When can you start?'), 'Immediately');

  // 3. Prior employment phrasings.
  eq('"Have you ever worked for Acme before?" → no', koCtx.decide('have you ever worked for acme before?'), 'no');
  eq('"previously been employed by Acme" → no', koCtx.decide('have you previously been employed by acme?'), 'no');
  eq('"worked for a startup before" is experience → yes', koCtx.decide('have you ever worked for a startup before?'), 'yes');

  // 4. A native radio's OWN label, not the group's legend.
  const cl = {};
  new Function('exports', `
    const getLabel = () => 'have you previously worked for acme? *';
    ${body('choiceLabel')}
    exports.c = choiceLabel;
  `)(cl);
  const radio = (txt) => ({ tagName: 'INPUT', type: 'radio', getAttribute: () => null,
    labels: [{ cloneNode: () => ({ querySelectorAll: () => [], textContent: ' ' + txt + ' ' }) }] });
  eq('each option reads its own label', [cl.c(radio('Yes')), cl.c(radio('No'))], ['yes', 'no']);

  // 5. Learning only from what YOU entered.
  eq('fields the automation filled are not learned', /\.filter\(el => isVisible\(el\) && hasFieldValue\(el\) && userTouched\(el\)\)/.test(src), true);
  eq('the focusout learner requires a real touch', /\/\/ The automation's own focus\(\) moves raise TRUSTED focusout events\.\n\s*if \(!userTouched\(el\)\) return;/.test(src), true);
  eq('input/change are not proof of a human', /for \(const ev of \['keydown', 'pointerdown', 'mousedown', 'paste', 'drop'\]\)/.test(src), true);

  // 6. Phone formats, always from the profile number.
  const ph = {};
  new Function('exports', `
    const DEFAULTS = { phoneCountryCode: '+353' };
    ${src.match(/  const DIAL_CODES = [^\n]*\n/)[0]}
    ${body('phoneVariants')}
    exports.v = phoneVariants;
  `)(ph);
  const P = { phone: '+44 7700 900123' };
  eq('international wording → +447700900123 first', ph.v('', P, 'Enter a phone number in international format, e.g. +14155550123')[0], '+447700900123');
  eq('the number\'s own +44 is kept, not the +353 default', ph.v('', P, '').every((x) => !/353/.test(x)), true);
  eq('retries never compound (built from the profile, not the box)', ph.v('353447700900123', P, '')[0], '+447700900123');
  eq('an Irish national number gets +353', ph.v('', { phone: '087 123 4567' }, 'international format')[0], '+353871234567');
  eq('"digits only" → a national number', ph.v('', P, 'Digits only please')[0], '07700900123');

  // 7. Classifying the form's own messages.
  const cf = {};
  new Function('exports', `
    const getLabel = () => '', getQuestionForInput = () => '', textOfIds = () => '';
    ${body('fieldName')}
    ${body('classifyFieldError')}
    exports.c = classifyFieldError;
  `)(cf);
  const inp = (type, label) => ({ type, labels: [{ cloneNode: () => ({ querySelectorAll: () => [], textContent: label }) }], getAttribute: () => '' });
  for (const [type, label, msg, kind, want] of [
    ['tel', 'Phone', 'Please enter a valid phone number', '', 'phone'],
    ['text', 'LinkedIn', 'Please enter a valid URL', '', 'url'],
    ['email', 'Email', 'Please include an \'@\' in the email address.', 'type', 'email'],
    ['text', 'Why us?', 'Your answer must be at least 100 characters', '', 'tooShort'],
    ['text', 'Summary', 'Maximum 50 characters', '', 'tooLong'],
    ['text', 'Years', 'Must be between 0 and 5', '', 'range'],
    ['text', 'Salary', 'Please enter a whole number', '', 'number'],
    ['text', 'Location', 'Please select a location from the list', '', 'list'],
    ['text', 'First name', 'This field is required', '', 'required'],
    ['text', 'Postcode', 'Invalid format', '', 'pattern'],
  ]) eq(`"${msg}" → ${want}`, cf.c(inp(type, label), msg, kind), want);

  // 8. The error pass runs before Submit, and a failed job says what the form said.
  eq('errors are read and fixed before Submit is pressed', /for \(let pass = 0; pass < 2 && readFieldErrors\(\)\.length; pass\+\+\) \{/.test(src), true);
  eq('the browser\'s own validity is read', /if \(el\.willValidate && el\.validity && !el\.validity\.valid\) \{/.test(src), true);
  eq('a stale message is not "fixed" twice', /if \(!e\.live && stamp && stamp\.round === _lastSubmitAt && stamp\.value === errFieldValue\(e\.el\)\) continue;/.test(src), true);
  eq('a stuck job names the field and the message', /return 'Validation errors could not be resolved' \+ \(e \? ' — ' \+ e : ''\);/.test(src), true);

  // 9. Calm scrolling, run for real against a fake page.
  const calm = src.match(/  try \{\n    const automatingNow = [\s\S]*?\n  \} catch \(_\) \{\}\n/)[0];
  const calls = [];
  const attrs = { 'data-ua-auto': '1' };
  const Element = function () {}; Element.prototype.scrollIntoView = function (a) { calls.push(['siv', a]); };
  const HTMLElement = function () {}; HTMLElement.prototype.focus = function (o) { calls.push(['focus', o]); };
  const win = { innerHeight: 800, scrollTo(a) { calls.push(['to', a]); } };
  win.scroll = win.scrollTo; win.scrollBy = win.scrollTo;
  const doc = { documentElement: { clientHeight: 800, getAttribute: (k) => attrs[k] || null } };
  new Function('Element', 'HTMLElement', 'window', 'document', calm)(Element, HTMLElement, win, doc);
  const el = (top) => { const e = new Element(); e.getBoundingClientRect = () => ({ top, bottom: top + 30, width: 100, height: 30 }); return e; };
  el(100).scrollIntoView({ behavior: 'smooth', block: 'center' });
  eq('an on-screen field is not scrolled to', calls.length, 0);
  el(3000).scrollIntoView({ behavior: 'smooth', block: 'start' });
  eq('an off-screen one jumps once, instantly, to the nearest edge', calls.pop(), ['siv', { block: 'nearest', inline: 'nearest', behavior: 'instant' }]);
  el(5000).scrollIntoView({ behavior: 'smooth' });
  eq('and a second jump inside 700ms is dropped', calls.length, 0);
  new HTMLElement().focus();
  eq('focus never scrolls during a run', calls.pop(), ['focus', { preventScroll: true }]);
  attrs['data-ua-auto'] = null;
  el(9000).scrollIntoView({ behavior: 'smooth', block: 'center' });
  eq('outside a run, scrolling is untouched', calls.pop(), ['siv', { behavior: 'smooth', block: 'center' }]);
}

/* ── 62. v17.5: dropdown options by meaning, not just by text ────────────────
   Required dropdowns worded as ranges were left EMPTY and blocked the submit
   (seen in a real browser run). The matcher runs for real on real option lists. */
console.log('v17.5 — ranges, notice periods, education levels, misplaced values');
{
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  const bo = {};
  new Function('exports', `${gc('PLACEHOLDER_OPT_RE')}${gc('normMoney')}${body('toDays')}
    ${src.match(/\n  const EDU_RANKS = \[[\s\S]*?\n  \];\n/)[0]}${gc('eduRank')}${body('bestOptionIndex')}
    exports.b = bestOptionIndex;`)(bo);
  const pick = (texts, t, l) => { const i = bo.b(texts, t, l); return i < 0 ? null : texts[i]; };
  const Y = ['Select...', '0-2 years', '3-5 years', '6-10 years', '10+ years'];
  eq('7 years → "6-10 years" (never the first option)', pick(Y, '7', 'Years of experience'), '6-10 years');
  eq('12 years → "10+ years"', pick(Y, '12', 'Years'), '10+ years');
  const S = ['Select...', 'Under €50,000', '€50,000 - €70,000', '€70,000 - €90,000', '€90,000+'];
  eq('85000 → "€70,000 - €90,000"', pick(S, '85000', 'Expected salary'), '€70,000 - €90,000');
  eq('95000 → "€90,000+"', pick(S, '95000', 'Salary'), '€90,000+');
  eq('k-notation bands', pick(['$50k-$80k', '$80k-$120k'], '85000', 'Salary'), '$80k-$120k');
  const N = ['Select...', 'Immediately available', '1 week', '2 weeks', '1 month', '2 months', '3 months or more'];
  eq('"1 month" → "1 month"', pick(N, '1 month', 'Notice period'), '1 month');
  eq('"4 weeks" → "1 month"', pick(N, '4 weeks', 'Notice period'), '1 month');
  eq('"30 days" → "1 month" (not "Immediately" via the "0 days" inside it)', pick(N, '30 days', 'Notice period'), '1 month');
  eq('"6 months" → "3 months or more"', pick(N, '6 months', 'Notice'), '3 months or more');
  const E = ['Select...', 'High school', "Bachelor's degree", "Master's degree", 'PhD'];
  eq('"Master of Science" → "Master\'s degree"', pick(E, 'Master of Science', 'Highest level of education'), "Master's degree");
  eq('never above the profile: MSc with no Master\'s option → Bachelor', pick(['High school', 'Associate', 'Bachelor'], 'MSc', 'Degree'), 'Bachelor');
  eq('a placeholder is never picked', pick(['Select...', 'Yes', 'No'], 'select', 'Q'), null);
  eq('Yes/No still exact', pick(['Yes', 'No'], 'No', 'Sponsorship'), 'No');

  eq('the native dropdown pass uses it', /let bi = val \? bestOptionIndex\(texts, val, lbl\) : -1;/.test(src), true);
  eq('and falls back to the profile field the question is about', /if \(bi < 0 && !isEEO\) bi = bestOptionIndex\(texts, profileTargetFor\(lbl, p\), lbl\);/.test(src), true);
  eq('custom dropdowns use it', /let bi = want \? bestOptionIndex\(texts, want, qFull\) : -1;/.test(src), true);
  eq('the error fixer uses it', /let bi = want \? bestOptionIndex\(texts, want, label\) : -1;/.test(src), true);

  // Profile-first guesses that used to be shadowed by defaults.
  eq('years of experience reads the profile', /if \(\/years\.\*\(exp\|work\)\|exp\.\*years\|total\.\*experience\/\.test\(l\)\) return yearsAnswer\(p\);/.test(src), true);
  eq('notice period reads the profile before "availability"', /return p\.notice_period \|\| p\.notice \|\| DEFAULTS\.notice;\n[\s\S]{0,200}?if \(\/availab/.test(src), true);

  // Misplaced values.
  eq('misplaced values are corrected after every fill', /try \{ refilled \+= sanitizeMisplacedValues\(p\); \} catch \(_\) \{\}/.test(src), true);
  eq('never in a box you typed in', /\(el\.value \|\| ''\)\.trim\(\) && !userTouched\(el\)\)/.test(body('sanitizeMisplacedValues')), true);
}

/* ── 63. v17.7: ideas from NextRaise ─────────────────────────────────────── */
console.log('v17.7 — honeypots, seeded phone boxes, select2, Lever location, control diagnostics, covered Submit, Workday wall');
{
  const nr = {};
  new Function('exports', `
    const DEFAULTS = { phoneCountryCode: '+353' };
    ${src.match(/  const TRAP_FIELD_RE = [^\n]*\n/)[0]}
    ${src.match(/  const DIAL_CODES = [^\n]*\n/)[0]}
    ${body('isTrapField')}
    ${body('isPhoneBox')}
    ${body('dialCodeOnly')}
    ${body('phoneVariants')}
    ${body('phoneForSeededBox')}
    Object.assign(exports, { isTrapField, dialCodeOnly, phoneForSeededBox });
  `)(nr);
  const inp = (attrs, extra) => Object.assign({ tagName: 'INPUT', type: attrs.type || 'text', name: attrs.name || '', id: attrs.id || '',
    placeholder: attrs.placeholder || '', value: attrs.value || '', required: !!attrs.required,
    labels: attrs.label ? [{ textContent: attrs.label }] : [],
    getAttribute: (k) => (k in attrs ? attrs[k] : null) }, extra || {});
  // 1. Honeypots
  eq('name="honeypot" is a trap', nr.isTrapField(inp({ name: 'honeypot' })), true);
  eq('"Leave this field blank" is a trap', nr.isTrapField(inp({ name: 'x', label: 'Leave this field blank' })), true);
  eq('"…blank if you are human" is a trap', nr.isTrapField(inp({ name: 'website', label: 'Website (leave this field blank if you are human)' })), true);
  eq('the hidden no-tab-stop shape is a trap', nr.isTrapField(inp({ name: 'company_url', tabindex: '-1', 'aria-hidden': 'true', autocomplete: 'off' })), true);
  eq('an ordinary Website box is not', nr.isTrapField(inp({ name: 'website', label: 'Website' })), false);
  eq('an ordinary required box with tabindex=-1 is not', nr.isTrapField(inp({ name: 'city', tabindex: '-1', required: true })), false);
  eq('the main setter refuses traps', /if \(el\.tagName !== 'SELECT' && val !== '' && isTrapField\(el\)\) \{/.test(src), true);
  eq('the essay module\'s own setter refuses them too', /Never a bot-trap field \(same rule as the main setter's isTrapField\)\./.test(src), true);
  // 2. Seeded phone boxes
  eq('"+353" alone in a phone box is a seed', nr.dialCodeOnly(inp({ type: 'tel', value: '+353' })), true);
  eq('"+1" alone is a seed', nr.dialCodeOnly(inp({ type: 'tel', value: '+1' })), true);
  eq('a real number is not', nr.dialCodeOnly(inp({ type: 'tel', value: '+353 87 123 4567' })), false);
  eq('"353" in a non-phone box is not', nr.dialCodeOnly(inp({ type: 'text', name: 'zip', value: '353' })), false);
  eq('an Irish national number goes in with the seeded code', nr.phoneForSeededBox(inp({ type: 'tel', value: '+353' }), '087 123 4567'), '+353871234567');
  eq('a number with its own code keeps it', nr.phoneForSeededBox(inp({ type: 'tel', value: '+353' }), '+44 7700 900123'), '+447700900123');
  eq('a seeded box counts as unanswered', /return !!el\.value\?\.trim\(\) && !dialCodeOnly\(el\);/.test(src), true);
  eq('and the fill pass picks it up', /\(!el\.value\?\.trim\(\) \|\| dialCodeOnly\(el\)\) && !isTrapField\(el\)/.test(src), true);
  // 3. select2
  eq('hidden select2 selects are answered', /deepAll\('select'\)\.filter\(el => \(isVisible\(el\) \|\| isSelect2Native\(el\)\) && !hasFieldValue\(el\)\)/.test(src), true);
  eq('and read by the error reader', /isVisible\(el\) \|\| isSelect2Native\(el\) \|\|/.test(src), true);
  // 4. Lever location
  eq('the Lever driver picks the location from Lever\'s list', /try \{ await leverLocation\(p\); \}/.test(body('leverAutomation')), true);
  eq('so does the general location pass', /if \(await leverLocation\(p\)\) return 1;/.test(src), true);
  eq('success means the hidden selectedLocation is set', /input\[type="hidden"\]\[name="selectedLocation"\]/.test(body('leverLocation')), true);
  eq('and the general pass never retypes Lever\'s box', /!el\.matches\('input\.location-input\[name="location"\]'\)/.test(src), true);
  // 5. Control diagnostics
  eq('unanswered questions carry the control\'s structure', /DIAG\('field\.unanswered', label, \{ kind: describeControl\(_missingEls\.get\(label\)\) \}\)/.test(src), true);
  eq('unfixable errors too', /\+ ' \[' \+ describeControl\(e\.el\) \+ '\]'/.test(src), true);
  eq('never its text or value', /value|textContent|innerText/.test(body('describeControl').replace(/\/\*[\s\S]*?\*\//g, '').replace(/el\.options\.length/g, '')), false);
  // 6. Covered Submit
  eq('every Submit path clears what covers the button first (shared submit ×2, Amazon)', (src.match(/await clearOverSubmit\(/g) || []).length, 3);
  eq('a banner that appeared late is swept right before Submit', /try \{ await dismissCookieBanner\(\); \} catch \(_\) \{\}\n\s*try \{ scrollIfNeeded\(btn\); \} catch \(_\) \{\}/.test(body('clearOverSubmit')), true);
  // 7. Workday wall
  eq('no Workday filling while a password box is on screen',
    /while \(\(workdayOnAccountWall\(\) \|\| wdResetActive\(\)\) && Date\.now\(\) < until && !autoStopped\(\) && !_authDeadEnd\)/.test(body('workdayAutomation')), true);
  eq('a tenant still on the wall is reported, not filled', /DIAG\('workday\.auth\.stuck'/.test(body('workdayAutomation')), true);
  eq('the account watcher stops on the broader "applying" test — but never with a password box on screen', /if \(!pwFields\.length && \([\s\S]{0,260}\|\| workdayApplicationReady\(\)\)\) \{/.test(src), true);
}

/* ── 64. v17.9: Amazon, Workday (SpeedyApply 2.28), SmartRecruiters, OptimHire 9.0 ── */
console.log('v17.9 — Amazon Jobs, Workday newer layouts, SmartRecruiters markers, no fill fights');
{
  // No fill fights, run for real.
  const nf = {};
  new Function('exports', `
    const LOG = () => {}, getLabel = () => 'Phone';
    ${src.match(/  const FIGHT_MAX = \d+;\n/)[0]}
    const _ourWrites = new WeakMap();
    ${body('mayWrite')}
    ${body('noteWrite')}
    Object.assign(exports, { mayWrite, noteWrite });
  `)(nf);
  const box = { value: '', getAttribute: () => null };
  eq('a first write is allowed', nf.mayWrite(box, '+447700900123'), true);
  nf.noteWrite(box, '+447700900123'); box.value = '+447700900123';
  eq('our value still in place is not typed again', nf.mayWrite(box, '+447700900123'), 'same');
  box.value = '+44 7700 900123';
  eq('the site\'s own reformat of our value is left alone', nf.mayWrite(box, '+447700900123'), false);
  const rej = { value: '', getAttribute: () => null };
  for (let i = 0; i < 3; i++) { nf.noteWrite(rej, 'x'); }
  eq('a value the site keeps clearing is given up after three tries', nf.mayWrite(rej, 'x'), false);
  eq('a different value is still allowed', nf.mayWrite(rej, 'y'), true);
  eq('the main setter applies it', /const ok = mayWrite\(el, String\(val\)\);\n\s*if \(ok === 'same'\) return true;\n\s*if \(!ok\) return false;/.test(src), true);
  eq('and the picker-aware phone value', /val = phoneForPickerBox\(el, val == null \? '' : String\(val\)\);/.test(src), true);

  // The sanitizer never acts on a box it cannot name.
  const san = body('sanitizeMisplacedValues');
  eq('a nameless box is not "misplaced"', /if \(!lbl\.trim\(\)\) continue;/.test(san), true);
  eq('a box that declares itself an email box keeps its email', /!\/e-\?mail\|username\/\.test\(declares\)/.test(san), true);
  eq('labels inside a component\'s shadow root are read', /if \(root && root\.host\) \{/.test(body('fieldName')), true);

  // Workday newer layouts.
  const wd = body('workdayMultiPageFlow');
  eq('the page on screen is the one detected', /deepAll\(`\[data-automation-id="\$\{pt\}"\]`, 4\)\.some\(isVisible\)/.test(wd), true);
  eq('My Information also fills the newer layouts', /await workdayFillModernInfo\(p\);/.test(wd), true);
  eq('My Experience also fills numbered history', /await workdayFillModernHistory\(p\);/.test(wd), true);
  eq('Self Identify is filled', /await workdayFillSelfIdentify\(p\);/.test(wd), true);
  for (const id of ['infoFirstName', 'infoCellPhone', 'public-site-address-address-1', 'public-site-address-postal-code', 'workHistoryCompanyName0', 'txt-workHistory-startDate-0', 'educationHistoryName0', 'disabilityStatus-CheckboxGroup', 'datePickerSelectedToday', 'ethnicityDropdown'])
    eq(`Workday field "${id}" is handled`, src.includes(id), true);
  eq('Workday\'s own error messages feed the error reader', /'\[data-automation-id="inputError"\],\[data-automation-id="errorMessage"\],'/.test(src), true);
  eq('the hidden create-account terms box is ticked', /input\[data-automation-id="createAccountCheckbox"\]/.test(src), true);

  // SmartRecruiters current form.
  const sr = body('smartRecruitersAutomation');
  for (const id of ['#first-name-input', '#last-name-input', '#email-input', '#confirm-email-input', '#linkedin-input'])
    eq(`SmartRecruiters field ${id} is filled`, sr.includes(`srSet('${id}'`), true);
  eq('its location is picked from the autocomplete\'s own list', /await srLocation\(p\);/.test(sr), true);
  eq('its phone widget gets the country and the local number', /await srPhone\(p\);/.test(sr), true);
  eq('its data-test Next/Submit come first', /const dtSubmit = deepAll\("\[data-test='footer-submit'\]"/.test(sr), true);
  eq('a refused step reports the error toast', /const toast = srErrorToast\(\);/.test(sr), true);
  eq('its success page counts as success', /oc-success-page-content/.test(body('hardSuccessSignal')), true);

  // Amazon Jobs.
  eq('amazon.jobs has its own driver', /else if \(isAmazonJobs\(\) \|\| platform === 'Amazon Jobs'\) await amazonJobsAutomation\(\);/.test(src), true);
  eq('"Apply now" is followed in THIS tab', /location\.assign\(new URL\(href, location\.href\)\.href\)/.test(body('amazonJobsAutomation')), true);
  eq('Amazon\'s signed-in application pages are not mistaken for a wall', /\/applicant\\\/\(jobs\\\/\\d\+\\\/apply\|application\)\/i\.test\(location\.pathname\)/.test(body('pastTheApplyStep')), true);
  eq('Amazon\'s sign-in codes are searched for in Amazon\'s mail', /hosts\.push\('amazon\.jobs', 'amazon\.com'\)/.test(src), true);
}

/* ── 65. v17.10: LazyApply's ideas — answer a question once, logins per site ── */
console.log('v17.10 — site logins and the question bank');
{
  const sl = {};
  const run = (store, host) => new Function('store', 'host', `
    const location = { hostname: host };
    const st = { get: async (k) => store[k] };
    ${body('accountKeyFor')}
    ${body('siteLogin')}
    return siteLogin();
  `)(store, host);
  (async () => {
    const store = { ua_ats_logins: { 'nxp.myworkdayjobs.com': { email: 'me@x.com', password: 'p1' }, 'amazon.jobs': { email: 'a@x.com', password: 'p2' } } };
    eq('a login saved for a Workday tenant is used on any of its shards', (await run(store, 'nxp.wd3.myworkdayjobs.com') || {}).password, 'p1');
    eq('a parent-domain login covers its sign-in host', (await run(store, 'passport.amazon.jobs') || {}).password, 'p2');
    eq('other sites keep the shared account', await run(store, 'ciena.wd5.myworkdayjobs.com'), null);
  })();
  eq('the account steps use a site login first', /const site = await siteLogin\(\);\n\s*if \(site\) return site\.password;/.test(src) && /const site = await siteLogin\(\);\n\s*if \(site\) return site\.email;/.test(src), true);
}

/* ── 66. v17.11: what the 141-job run hit ─────────────────────────────────── */
console.log('v17.11 — Workday existing accounts, embedded Greenhouse, Microsoft sign-in');
{
  const wd = body('fillWorkdayCreateAccount');
  eq('Workday tries every saved password: site login, shared, Jobright\'s', /ua_app_password[\s\S]*WORKDAY_SIGNUP_INFORMATION/.test(body('workdayPasswordCandidates')), true);
  eq('a refused sign-in on an existing account tries the next password, not Create', /if \(onSignIn && wrongCredErr && auth\.exists && auth\.triedSignIn\) \{/.test(wd), true);
  eq('only an account the site has NOT confirmed is sent back to Create', /if \(onSignIn && wrongCredErr && !auth\.exists\) \{/.test(wd), true);
  eq('when every password is refused it stops and says what to do', /DIAG\('workday\.password-mismatch'/.test(body('wdPasswordDeadEnd')) && /return wdPasswordDeadEnd\(/.test(wd), true);
  eq('errors come from Workday\'s own messages, not the page text', /const errText = workdayAuthErrorText\(\);/.test(wd) && !/const pageText = \(document\.body\.innerText/.test(wd), true);
  eq('an embedded Greenhouse form is opened in this tab', /if \(!\$\('#application_form,#application-form,#application,\.application-form,\.application--form'\) && await openEmbeddedGreenhouseForm\(\)\) return;/.test(body('greenhouseAutomation')), true);
  { const og = body('openEmbeddedGreenhouseForm');
    eq('only a real https greenhouse.io address is followed', og.includes("!/^https:$/.test(u.protocol)") && og.includes('greenhouse\\.io$/i.test(u.hostname)'), true); }
  eq('Microsoft\'s account sign-in is reported at once, not timed out', /DIAG\('microsoft\.signin'/.test(body('eightfoldAutomation')), true);
}

/* ── 67. v17.14: the Anthropic Greenhouse screenshot, Workday Sign In, Microsoft ── */
console.log('v17.14: react-select answers, knockouts, dates, popups, Workday overlay');
{
  // A react-select's search text is not its value.
  eq('a react-select counts as answered only when it renders a chosen value',
    /if \(rs\) return reactSelectHasValue\(rs\);/.test(body('comboHasValue')), true);
  eq('hasFieldValue agrees', /if \(isSelectSearchBox\(el\)\) return reactSelectHasValue\(reactSelectControl\(el\)\);/.test(body('hasFieldValue')), true);
  eq('the text filler never types an answer into a dropdown search box', /!isSelectSearchBox\(el\)\);/.test(body('fallbackFill')), true);
  eq('the required-field guarantor picks the option instead of typing',
    /if \(isSelectSearchBox\(el\)\) \{[\s\S]{0,400}?commitCustomDropdown\(ctrl,/.test(src), true);
  eq('the error fixer does the same for a flagged react-select', /const rsCtrl = kind !== 'list' && isSelectSearchBox\(el\)/.test(body('fixFieldError')), true);
  eq('a dropdown question is read from its own label, never its "Select..." placeholder',
    /label\[for="/.test(body('comboQuestion')) && /PLACEHOLDER/.test(body('comboQuestion')), true);
  eq('a binary dropdown is decided before any fuzzy matching',
    body('commitCustomDropdown').indexOf('determineYesNo(') < body('commitCustomDropdown').indexOf('bestOptionIndex('), true);

  // A bare Yes / No answers the question as asked.
  const oi = (opts, q) => optCtx.optionIndexForDecision(opts, 'yes', q);
  eq('"Do you require visa sponsorship?" with Yes/No → No', oi(['yes', 'no'], 'Do you require visa sponsorship?'), 1);
  eq('…in either order', oi(['no', 'yes'], 'Do you require visa sponsorship?'), 0);
  eq('"Will you now or in the future require employment visa sponsorship…" → No',
    oi(['yes', 'no'], "Will you now or will you in the future require employment visa sponsorship to work in the country in which the job you're applying for is located?"), 1);
  eq('"Are you authorised to work in the UK?" with Yes/No → Yes', oi(['yes', 'no'], 'Are you legally authorised to work in the UK?'), 0);
  eq('worded options still go through the stance matcher',
    oi(['requires sponsorship', 'does not require sponsorship'], 'Will you now or in the future require visa sponsorship?'), 1);

  eq('"Have you ever interviewed at Anthropic before?" → no', koCtx.decide('have you ever interviewed at anthropic before?'), 'no');
  eq('"Have you previously interviewed with us?" → no', koCtx.decide('have you previously interviewed with us?'), 'no');

  // A start date that has passed is moved forward; words and future dates are kept.
  const fd = {};
  new Function('exports', `${body('toDays')}\n${body('freshStartDate')}\nexports.f = freshStartDate;`)(fd);
  const iso = (d) => d.toISOString().slice(0, 10);
  const plus = (n) => { const t = new Date(); t.setHours(0, 0, 0, 0); return new Date(t.getTime() + n * 86400000); };
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  eq('a past ISO start date becomes today + the notice period', fd.f('2025-12-02', { notice_period: '1 month' }), local(plus(30)));
  eq('two weeks when there is no notice period', fd.f('2025-12-02', {}), local(plus(14)));
  eq('a future date is kept', fd.f(local(plus(60)), {}), local(plus(60)));
  eq('words are kept', fd.f('Immediately', {}), 'Immediately');
  eq('a past day-first date keeps its format', /^\d{2}\/\d{2}\/\d{4}$/.test(fd.f('02/12/2025', {})) && fd.f('02/12/2025', {}) !== '02/12/2025', true);
  void iso;

  const DL = new Function(`${src.match(/^  const DEADLINE_Q_RE = .*$/m)[0]}\nreturn DEADLINE_Q_RE;`)();
  eq('"Do you have any deadlines or timeline considerations…" is a deadlines question', DL.test('do you have any deadlines or timeline considerations we should be aware of?'), true);
  eq('"…work under tight deadlines?" is not', DL.test('can you work under tight deadlines?'), false);
  eq('"…experience working to deadlines?" is not', DL.test('do you have experience working to deadlines?'), false);
  eq('a deadlines question is answered in words', /if \(DEADLINE_Q_RE\.test\(l\)\) return DEFAULTS\.noDeadlines;/.test(src), true);
  eq('a date in a deadlines box, or a past start date, is corrected after every fill',
    /isDateText\(v\) && DEADLINE_Q_RE\.test\(lbl\)/.test(body('sanitizeMisplacedValues')) && /a date in the past/.test(body('sanitizeMisplacedValues')), true);
  eq('"Why <company>?" is answered, not "N/A"', /\^\\s\*why\\s\+/.test(src) && /return whyAnswer\(\);/.test(src), true);

  // Pages, popups, waits.
  eq('the paywall remover never climbs into the page itself', /if \(i > 0 && isPage\(cur\)\) break;/.test(body('findKillTarget')), true);
  eq('Jobright\'s credits box is closed off jobright.ai too, inside its helper hosts only',
    /querySelectorAll\('plasmo-csui,#jobright-helper-plugin'\)/.test(src) && /closed Jobright\\'s "0 remaining Autofill credits" box/.test(src), true);
  eq('waiting for Jobright\'s sidebar counts as work, not a stall', /function waitForSidebar\(ms\) \{ return withBusy\(/.test(src), true);
  eq('no sidebar → no 20s hunt for its Autofill button', /directAutofillFlow\(\{ noJobright: true \}\)/.test(src), true);
  eq('the new-boards Greenhouse form is recognised', /#application-form/.test(body('greenhouseAutomation')), true);

  // Workday's click overlay.
  const wd = body('fillWorkdayCreateAccount');
  eq('Workday buttons are pressed through their click_filter overlay', /\[data-automation-id="click_filter"\]/.test(body('workdayClickTarget')), true);
  eq('Sign In and Create Account both use it', /pressWorkdayButton\(signInBtn\)/.test(wd) && /pressWorkdayButton\(createBtn\)/.test(wd) && !/clickEl\((signInBtn|createBtn)\)/.test(wd), true);
  eq('a button hidden under its overlay still counts as the form', /workdayControlShown\(signInBtn\)/.test(wd), true);

  // Microsoft's lone "Yes" acknowledgements.
  eq('a box labelled only "Yes" is read with the statement above it', /getFullQuestionText\(cb\)/.test(body('tickConsentBoxes')), true);
  eq('a styled checkbox (invisible input, visible label) is considered', /filter\(choiceShown\)/.test(body('tickConsentBoxes')), true);
  eq('Eightfold never types into a checkbox', /:not\(\[type=checkbox\]\):not\(\[type=radio\]\)/.test(body('eightfoldAutomation')), true);
}

/* ── 68. v17.18: the Workday engine (ported from the standalone autopilot) ── */
console.log('v17.18: Workday engine — any language, every formField container');
{
  // The engine's pure helpers, lifted out of the file and run for real.
  const start = src.indexOf('  const WD_FF = ');
  const end = src.indexOf('  /* ── The pages ─');
  eq('the engine block is present', start > 0 && end > start, true);
  const wd = {};
  new Function('exports', 'determineYesNo', 'DEFAULTS', `
    ${src.slice(start, end)}
    Object.assign(exports, { wdNorm, wdSimilarity, wdBestIndex, wdParseYM, wdYesNo, WD_STEP_PATTERNS, WD_DECLINE_RX, WD_Q });
  `)(wd, koCtx.decide, { years: '7' });
  const step = (t) => (wd.WD_STEP_PATTERNS.find(([rx]) => rx.test(t)) || [])[1] || '';

  // Localised options match the profile's English value.
  eq('"Vereinigtes Königreich" is the United Kingdom', wd.wdSimilarity('United Kingdom', 'Vereinigtes Königreich') >= 0.9, true);
  eq('"Vereinigtes Königreich (+44)" is a phone-code match', wd.wdSimilarity('United Kingdom', 'Vereinigtes Königreich (+44)') >= 0.6, true);
  eq('"Mobil" is Mobile', wd.wdSimilarity('Mobile', 'Mobil'), 1);
  eq('"Nein" is No and "Ja" is Yes', wd.wdNorm('Nein') + '/' + wd.wdNorm('Ja'), 'no/yes');
  eq('USA is the United States', wd.wdSimilarity('United States', 'USA') >= 0.9, true);
  eq('the best option is picked, not the first', wd.wdBestIndex(['Canada', 'Vereinigtes Königreich', 'Vereinigte Staaten von Amerika'], 'United Kingdom'), 1);
  eq('nothing close → no pick', wd.wdBestIndex(['Canada', 'Mexico'], 'United Kingdom'), -1);

  // Knockouts in German reach the right answer instead of the English default "yes".
  eq('German sponsorship → no', wd.wdYesNo('Benötigen Sie jetzt oder künftig ein Visum oder Sponsoring für eine Arbeitserlaubnis?'), 'no');
  eq('German right to work → yes', wd.wdYesNo('Sind Sie berechtigt, im Vereinigten Königreich zu arbeiten?'), 'yes');
  eq('German conviction → no', wd.wdYesNo('Wurden Sie jemals wegen einer Straftat verurteilt?'), 'no');
  eq('French sponsorship → no', wd.wdYesNo('Avez-vous besoin d\'un parrainage pour un permis de travail ?'), 'no');
  eq('Spanish right to work → yes', wd.wdYesNo('¿Está autorizado para trabajar en España?'), 'yes');
  eq('an unreadable German question gets no guess', wd.wdYesNo('Mögen Sie Katzen?'), '');
  eq('English still goes through the full English decider', wd.wdYesNo('Will you now or in the future require sponsorship for employment visa status?'), 'no');
  eq('a demographic question is declined', wd.wdYesNo('Geschlecht'), 'decline');
  eq('German "decline" options are recognised', ['Ich möchte keine Angabe machen', 'Keine Angabe', 'Ich möchte das nicht angeben', 'Ich möchte nicht antworten'].every((t) => wd.WD_DECLINE_RX.test(t)), true);

  // Steps named in any language.
  eq('"Meine Informationen" is My Information', step('Meine Informationen'), 'myInformation');
  eq('"Meine Erfahrung" is My Experience', step('Meine Erfahrung'), 'myExperience');
  eq('"Bewerbungsfragen" is the questions', step('Bewerbungsfragen'), 'questions');
  eq('"Freiwillige Angaben" is the disclosures', step('Freiwillige Angaben'), 'voluntary');
  eq('"Selbstidentifizierung" is Self Identify', step('Selbstidentifizierung'), 'selfIdentify');
  eq('"Überprüfen" is the review', step('Überprüfen'), 'review');
  eq('"Mes informations" is My Information', step('Mes informations'), 'myInformation');

  // Profile dates in any common shape.
  eq('"2019-03" → March 2019', JSON.stringify(wd.wdParseYM('2019-03')), '{"y":"2019","m":"03"}');
  eq('"03/2019" → March 2019', JSON.stringify(wd.wdParseYM('03/2019')), '{"y":"2019","m":"03"}');
  eq('"Mar 2019" → March 2019', JSON.stringify(wd.wdParseYM('Mar 2019')), '{"y":"2019","m":"3"}');
  eq('"2019" → the year', JSON.stringify(wd.wdParseYM('2019')), '{"y":"2019"}');

  // Wiring.
  eq('every Workday page gets the engine pass', /await wdEnginePass\(p\);\n      await fallbackFill\(\);/.test(body('workdayMultiPageFlow')), true);
  eq('a page without a page-type marker is read off the progress bar', /\[wdStepKind\(\)\]/.test(body('workdayMultiPageFlow')), true);
  eq('the "Upload your resume" page is handled', /wdHandleResumeUploadPage\(\)/.test(body('workdayAutomation')) && /wdHandleResumeUploadPage\(\)/.test(body('workdayMultiPageFlow')), true);
  eq('waiting for the application counts as work', /withBusy\('waiting for the Workday application'/.test(body('workdayAutomation')), true);
  eq('a stuck page follows Workday\'s error banner', /await wdFixFromErrorBanner\(p\);/.test(body('workdayMultiPageFlow')), true);
  eq('parser ghosts are deleted down to the profile\'s count, never below', /while \(n > 0 && bs\.length > n\)/.test(body('wdEnsureBlocks')), true);
  eq('dates are typed a digit at a time', /new KeyboardEvent\('keydown', \{ key: ch/.test(body('wdSetSegment')), true);
  eq('a school not in the list falls back to its "Other"', /'Sonstige'/.test(body('wdMyExperience')), true);
}

/* ── 69. v17.19: a Jobright link must not pull the tab back to Jobright ── */
console.log('v17.19: Jobright links, extra tabs, the runner staying on the job');
{
  const m = {};
  new Function('exports', `${body('urlsRoughlyMatch')}\nexports.f = urlsRoughlyMatch;`)(m);
  eq('a site\'s home page does not match every job on it', m.f('https://jobright.ai/', 'https://jobright.ai/jobs/info/68f0a1'), false);
  eq('two home pages still match', m.f('https://acme.com/', 'https://acme.com'), true);
  eq('apply → thank-you still matches', m.f('https://boards.greenhouse.io/acme/jobs/1/thanks', 'https://boards.greenhouse.io/acme/jobs/1/apply'), true);
  const cj = body('onCurrentJobPage');
  eq('a Jobright link\'s job is wherever it led', /jobright\\\.ai\$\/i\.test\(new URL\(c\.url\)\.hostname\) && !isJobright\(\)/.test(cj), true);
  eq('the site a job landed on is remembered', /c\.landedHost && c\.landedHost === location\.hostname/.test(cj) && /c\.landedHost = location\.hostname/.test(src), true);
  eq('a page still drawing gets a moment before it is judged', /if \(!onCurrentJobPage\(c\)\) await waitUntil\(\(\) => onCurrentJobPage\(c\), 6000, 300\);/.test(src), true);
  eq('a Jobright job page goes to the employer\'s link in the same tab', /const target = jobrightApplyTarget\(\);[\s\S]{0,300}location\.assign\(target\)/.test(body('openApplicationForm')), true);
  eq('the link is read from Jobright\'s page data first', /__NEXT_DATA__/.test(body('jobrightApplyTarget')) && /applyLink/.test(body('jobrightApplyTarget')), true);
  eq('a replaced parser entry does not keep the other role\'s description', /if \(!r\.description && otherRole\)/.test(body('wdMyExperience')), true);
  eq('"Role Description" is not answered with the job title', /dut\(y\|ies\)\|summary/.test(src), true);
}

/* ── 70. v17.20: SuccessFactors career site, start to finish ── */
console.log('v17.20: SuccessFactors — phone code, citizenship, CV dialog, Terms of Use, Apply');
{
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  const m = {};
  new Function('exports', `${gc('PLACEHOLDER_OPT_RE')}${body('dialCodeFromPhone')}${body('sfPickDialCode')}
    const DEFAULTS = { country: 'Ireland', phoneCountryCode: '+353' };
    const $$ = (s, sel) => sel.options;
    exports.dial = dialCodeFromPhone; exports.pick = sfPickDialCode;`)(m);
  eq('"+44 7700 900123" was written with +44', m.dial('+44 7700 900123'), '+44');
  eq('"0044-7700…" too', m.dial('0044-7700 900123'), '+44');
  eq('"(+353) 87…" too', m.dial('(+353) 87 426 1508'), '+353');
  eq('a run of digits is not split by guesswork', m.dial('+447700900123'), '');
  eq('a national number has no code', m.dial('087 426 1508'), '');
  const opt = (text, value) => ({ text, value: value == null ? text : value });
  const cc = { options: [opt('No Selection', ''), opt('Isle of Man (+44)', 'IM'), opt('Ireland (+353)', 'IE'), opt('United Kingdom (+44)', 'GB'), opt('United States (+1)', 'US'), opt('Antigua (+1268)', 'AG')] };
  eq('the phone\'s code picks the option', m.pick(cc, { phone: '+353 87 426 1508' }).value, 'IE');
  eq('+1 is not +1268', m.pick(cc, { phone: '+1 415 555 0100' }).value, 'US');
  eq('+44 is the UK, not the Isle of Man listed before it', m.pick(cc, { phone: '+44 7700 900123' }).value, 'GB');
  eq('…unless the profile lives on the Isle of Man', m.pick(cc, { phone: '+44 7624 000000', country: 'Isle of Man' }).value, 'IM');
  eq('no phone code: the profile\'s country', m.pick(cc, { phone: '087 426 1508', country: 'United Kingdom' }).value, 'GB');
  eq('no phone code: the profile\'s dial code', m.pick(cc, { phone: '087 426 1508', phoneCountryCode: '+353' }).value, 'IE');
  eq('"No Selection" is never the answer', m.pick({ options: [opt('No Selection', '')] }, { phone: '' }), null);

  const gv = body('guessValue');
  eq('"Country/Region Code" is not a region', /!\/statement\|country \(region \)\?code\//.test(gv), true);
  eq('"Country/Region Code" is the dial code, from the phone first', /country\.\?\(region\.\?\)\?code[^\n]*dialCodeFromPhone\(p\.phone\)/.test(gv), true);
  const cit = gv.indexOf('(citizenship|nationality)\\s*(1|one|primary)'), wa = gv.indexOf('const wa = workAuthorisationAnswer');
  eq('"Citizenship 1:" is a country, asked before the right-to-work decider', cit > 0 && cit < wa, true);
  eq('a second citizenship only comes from the profile', /p\.second_nationality \|\| p\.nationality2 \|\| ''/.test(gv), true);
  const rx = /^\s*(citizenship|nationality)\s*(1|one|primary)?\s*$/;
  eq('"citizenship 1" matches', rx.test('citizenship 1 '), true);
  eq('a citizenship QUESTION does not', rx.test('do you hold eu citizenship '), false);

  const sf = body('successFactorsAutomation');
  eq('the CV goes through the "Upload a Resume" dialog', /await sfUploadResume\(\)/.test(sf) && /realClick\(go\)/.test(body('sfUploadResume')), true);
  eq('the Terms of Use are opened and accepted', /await sfAcceptTerms\(\)/.test(sf) && /realClick\(accept\)/.test(body('sfAcceptTerms')), true);
  eq('the dial-code select is set before the generic pass', sf.indexOf('sfPickDialCode') < sf.indexOf('guessFieldValue(lbl'), true);
  const fs = body('findSubmitControl');
  eq('SuccessFactors\' "Apply" is its submit — only there, and only in a real form', /isSuccessFactorsHost\(\)/.test(fs) && /length >= 8/.test(fs), true);
  eq('"Apply" stays excluded everywhere else', /'\^\\\\s\*apply\\\\b'/.test(src), true);
  eq('a successfactors.eu job reaches the handler', /successfactors\\\.\(com\|eu\)\|sapsf[^\n]*await successFactorsAutomation\(\)/.test(src), true);
}


/* ── 71. v17.21: Oracle — postcode SW1W 0RH, address lines, pills, lists ── */
console.log('v17.21: Oracle Recruiting Cloud — address, self-identification pills, typed-only lists');
{
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  const m = {};
  new Function('exports', `${gc('NO_RESULTS_RE')}exports.nr = NO_RESULTS_RE;`)(m);
  for (const t of ['No results were found.', 'No results found', 'No matches found', 'No results', 'No matching items']) eq(`"${t}" is not an option`, m.nr.test(t), true);
  for (const t of ['No', 'None of the above', 'Not listed', 'No, I do not']) eq(`"${t}" is a real option`, m.nr.test(t), false);

  // The address plan — your postcode, the country it belongs to, the street on Line 1.
  const store = {};
  const a = {};
  new Function('exports', 'store', `const st = { get: async (k) => store[k] };
    const DEFAULTS = { country: 'Ireland' };
    ${gc('ORACLE_POSTCODE_DEFAULT')}${gc('UK_POSTCODE_RE')}${gc('COUNTRY_NAME_RE')}${body('oracleAddressPlan')}
    exports.plan = oracleAddressPlan;`)(a, store);
  (async () => {
    const pl = await a.plan({ address: 'United Kingdom', address_line_2: '37 Newnham Rd', country: 'Ireland', city: 'Dublin' });
    eq('the postcode is SW1W 0RH', pl.postcode, 'SW1W 0RH');
    eq('…so the country is the United Kingdom (the postcode list follows it)', pl.country, 'United Kingdom');
    eq('…and the town London', pl.city, 'London');
    eq('a country name is never the street', pl.line1, '');
    eq('a country name is recognised as one', pl.looksCountry('United Kingdom') && pl.looksCountry('Ireland') && !pl.looksCountry('37 Newnham Rd'), true);
    const p2 = await a.plan({ address: '37 Newnham Rd', country: 'United Kingdom' });
    eq('the profile street goes on Line 1', p2.line1, '37 Newnham Rd');
    store.ua_oracle_address = { postcode: 'D02 P820', country: 'Ireland', city: 'Dublin' };
    const p3 = await a.plan({ address: '1 Grand Canal Square' });
    eq('ua_oracle_address overrides it', [p3.postcode, p3.country, p3.city, p3.uk].join('|'), 'D02 P820|Ireland|Dublin|false');
  })();

  // Pill questions: consent → consent; demographics → your exact answer or decline.
  const pc = {};
  new Function('exports', `${body('isDeclineOption')}${gc('DEMOGRAPHIC_Q_RE')}
    const optionPolarity = (t) => /^yes\\b/i.test(t) ? 1 : /^no\\b/i.test(t) ? -1 : 0;
    const determineYesNo = () => 'yes';
    const optionIndexForDecision = (texts, d) => texts.findIndex((t) => t.toLowerCase() === d);
    const guessFieldValue = () => '';
    const bestOptionIndex = () => -1;
    ${body('pillChoice')}
    exports.pick = (q, opts, p) => { const i = pillChoice(q, opts, p || {}); return i < 0 ? null : opts[i]; };`)(pc);
  eq('consent → "I consent"', pc.pick('I consent to the processing of my diversity information.', ['I consent', 'I do not consent']), 'I consent');
  eq('consent spotted from the options alone', pc.pick('Diversity data', ['I do not agree', 'I agree']), 'I agree');
  eq('gender → decline', pc.pick('What is your gender?', ['Male', 'Female', 'Non-binary', 'Prefer not to say']), 'Prefer not to say');
  eq('gender → your profile\'s answer when it is an option word for word', pc.pick('What is your gender?', ['Male', 'Female', 'Prefer not to say'], { gender: 'Male' }), 'Male');
  eq('gender identity is not answered with your gender', pc.pick('Is the gender you identify with the same as your sex registered at birth?', ['Yes', 'No', 'Prefer not to say'], { gender: 'Male' }), 'Prefer not to say');
  eq('sexual orientation → "I prefer not to say"', pc.pick('Which of the following best describes your sexual orientation?', ['Heterosexual/Straight', 'Gay or Lesbian', 'I prefer not to say']), 'I prefer not to say');
  eq('pronouns → "Prefer Not To Say"', pc.pick('What are your pronouns?', ['He/Him', 'She/Her', 'Prefer Not To Say']), 'Prefer Not To Say');
  eq('disability → decline (the profile wording is not an option)', pc.pick('Do you consider yourself to have a disability?', ['Yes', 'No', 'Prefer not to say'], { disability: 'I do not have a disability' }), 'Prefer not to say');
  eq('"language" is not an age question', /\bage\b/.test('language') , false);
  eq('a plain yes/no pill question is decided, not declined', pc.pick('Are you willing to travel?', ['Yes', 'No']), 'Yes');

  // Location filler leaves Address Line 2 alone.
  const lf = {};
  new Function('exports', `let L = ''; const getLabel = () => L; ${body('isLocationField')}
    exports.loc = (label) => { L = label; return isLocationField({ tagName: 'INPUT', className: '', getAttribute: () => null }); };`)(lf);
  eq('"Address Line 2" is not a place search', lf.loc('Address Line 2'), false);
  eq('"Apartment / Suite" neither', lf.loc('Apartment, suite, etc.'), false);
  eq('"Town or City" still is', lf.loc('Town or City'), true);
  eq('a plain street "Address" box is not a place search (it got "Dublin, Ireland")', lf.loc('Address'), false);
  eq('"ZIP" is never one (it got "Dublin, Dublin, IE")', lf.loc('ZIP *'), false);
  eq('"Postcode / Eircode" neither', lf.loc('Postcode'), false);
  eq('"Location" still is', lf.loc('Location (City)'), true);

  const gv = body('guessValue');
  eq('"Address Line 2" is asked before the general address rule', gv.indexOf('address\\s*(line\\s*)?2\\b') > 0 && gv.indexOf('address\\s*(line\\s*)?2\\b') < gv.indexOf("if (/address|street/.test(l)) return p.address"), true);
  const cd = body('commitCustomDropdown');
  eq('"No results" rows are not options', /filter\(o => !NO_RESULTS_RE\.test\(comboText\(o\)\)\)/.test(cd), true);
  eq('typeahead falls back to the first word, then the full list', /\[want\.slice\(0, 24\), words\[0\], ''/.test(cd), true);
  eq('our own search text is cleared when nothing was picked', /if \(typed\) \{ try \{ nativeSet\(typeBox, ''\)/.test(cd), true);
  eq('typed text that found nothing is not an answer', /if \(comboShowsNoResults\(el\)\) return false;/.test(body('comboHasValue')), true);
  eq('the Oracle driver runs the pass before and after the generic fillers', (body('oracleCloudAutomation').match(/await oracleCxPass\(\)/g) || []).length, 2);
  eq('…and the multi-page loop runs it after a rejected submit', /if \(isOracleCloud\(\)\) await oracleCxPass\(\);/.test(body('multiPageLoop')), true);
  eq('the country is set before the postcode', body('oracleAddressPass').indexOf('plan.country') < body('oracleAddressPass').indexOf('plan.postcode'), true);
  eq('fields you edited are left alone', /!userTouched\(f\.el\)/.test(body('oracleAddressPass')) && /!userTouched\(x\.el\)/.test(body('oracleRepairLovs')), true);
}


/* ── 72. v17.22: Workday at SpeedyApply speed, and you can edit while it fills ── */
console.log('v17.22: Workday speed; editing while it fills');
{
  const wa = body('workdayAutomation');
  eq('Jobright autofill only when something required is still empty — and never beside the engine', /if \(!engineHere && getMissingRequired\(\)\.length\) \{[\s\S]{0,200}await triggerAutofill\(\);/.test(wa), true);
  eq('the tailor-first detour only when you opted into tailoring, and not on Workday with the engine', /if \(queueUseTailor && !engineHere\) await tailorFirstFlow\(\);/.test(wa), true);
  const mp = body('workdayMultiPageFlow');
  eq('no flat 2.5s after Next — on as soon as the step changes', /await waitForStepChange\(sig, scaled\(6000, 2500\)\)/.test(mp) && !/next_page'\) \{ await sleep\(scaled\(2500, 1250\)\)/.test(mp), true);
  eq('no flat 1.5s per page', !/await sleep\(scaled\(1500, 750\)\);\n\n      \/\/ Detect current page type/.test(mp), true);
  eq('the engine never overwrites a field you typed in', /if \(userTouched\(i\)\) return true;/.test(body('wdWriteText')), true);
  eq('Next / Submit wait while you are editing', /if \(await waitWhileUserEditing\(\)\)/.test(body('autoSubmitOrNext__impl')), true);
  eq('…bounded, and reported as progress', /noteProgress\('waiting — you are editing'\)/.test(body('waitWhileUserEditing')) && /maxMs \|\| 90000/.test(body('waitWhileUserEditing')), true);
  eq('your typing is noted (trusted keys/pointer only)', /_userFieldAt = Date\.now\(\); _userField = f;/.test(src) && /if \(!e\.isTrusted\) return;/.test(src), true);

  // The focus guard, run for real: our focus() calls leave your cursor alone while you type.
  const calls = [];
  const proto = { focus(...a) { calls.push(this.name); } };
  const fakeDoc = { activeElement: null };
  const g = {};
  const guard = src.match(/  try \{\n    const _focus = HTMLElement\.prototype\.focus;[\s\S]*?\n  \} catch \(_\) \{\}\n/)[0];
  new Function('exports', 'HTMLElement', 'document', `let _userField = null, _userFieldAt = 0;
    function userIsEditing(ms) { return Date.now() - _userFieldAt < (ms || 4000); }
    ${guard}
    exports.type = (el) => { _userField = el; _userFieldAt = Date.now(); };
    exports.idle = () => { _userFieldAt = 0; };`)(g, { prototype: proto }, fakeDoc);
  const A = Object.assign(Object.create(proto), { name: 'A', getRootNode: () => fakeDoc });
  const B = Object.assign(Object.create(proto), { name: 'B', getRootNode: () => fakeDoc });
  B.focus();
  eq('nobody typing: focus works', calls.join(), 'B');
  g.type(A); fakeDoc.activeElement = A; calls.length = 0;
  B.focus();
  eq('you typing in A: our focus on B is skipped', calls.join(), '');
  A.focus();
  eq('…focus on your own field still works', calls.join(), 'A');
  g.idle(); calls.length = 0; B.focus();
  eq('once you stop, focus works again', calls.join(), 'B');
}


/* ── 73. v17.23: your fixed knockout answers (years → 7, AWS certification → Yes) ── */
console.log('v17.23: knockout answers — years 7, AWS certified Yes, everywhere');
{
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  const k = {};
  new Function('exports', `const DEFAULTS = { years: ${JSON.stringify((src.match(/\n\s*years:\s*'(\d+)'/) || [])[1])} };
    ${gc('YEARS_Q_RE')}${gc('PROSE_Q_RE')}${body('yearsAnswer')}${gc('AWS_CERT_Q_RE')}${gc('ASKS_LIST_RE')}${gc('YES_NO_FORM_RE')}${body('knockoutPolicy')}
    exports.pol = knockoutPolicy; exports.yrs = yearsAnswer;`)(k);
  const P = (q, p) => k.pol(q, p || {});
  // The default is whatever DEFAULTS.years ships (7 on Oct 28; 9 in your 12.4 build).
  const Y = (src.match(/\n\s*years:\s*'(\d+)'/) || [])[1];
  eq(`the default is ${Y} years`, k.yrs({}), Y);
  eq('years from other stored data never lower it', k.yrs({ years_experience: '3', yearsExperience: '2' }), Y);
  eq('a number you set in the profile editor is used', k.yrs({ years: '9' }), '9');
  for (const q of ['How many years of experience do you have?', 'Years of relevant experience', 'How many years of experience do you have with Python?',
    'Total years of professional experience', 'Number of years of experience in data engineering']) eq(`"${q}" → ${Y}`, P(q), Y);
  eq('"Do you have 5+ years of experience…?" → yes', P('Do you have 5+ years of experience with AWS?'), 'yes');
  eq('"…at least 7 years…" → yes', P('Do you have at least 7 years of professional experience?'), 'yes');
  eq('"…10+ years…" → no (7 is fewer)', P('Do you have 10+ years of experience?'), 'no');
  eq(`"…more than 7 years…" → ${+Y > 7 ? 'yes' : 'no'}`, P('Do you have more than 7 years of experience?'), +Y > 7 ? 'yes' : 'no');
  eq('your own 12 years answers "10+" yes', P('Do you have 10+ years of experience?', { years: '12' }), 'yes');
  eq('"Describe your years of experience…" is prose, no fixed answer', P('Please describe your experience over the years'), '');
  for (const q of ['Do you hold an AWS Certified Solutions Architect certification?', 'Do you hold an AWS Certified Data Engineer – Associate certification?',
    'Are you AWS certified? (AWS Certified Cloud Practitioner or higher)', 'Do you have an active Amazon Web Services certification?',
    'Do you currently hold any AWS certifications?']) eq(`"${q}" → yes`, P(q), 'yes');
  eq('"Which AWS certifications do you hold?" asks for a list, not yes', P('Which AWS certifications do you hold?'), '');
  eq('"AWS Certification ID" is not a yes/no', P('AWS Certification ID'), '');
  eq('an unrelated question has no fixed answer', P('Are you willing to relocate?'), '');

  const gfv = body('guessFieldValue');
  eq('every filler that guesses goes through the rule first (your manual answer still wins)', /knockoutPolicy\(questionText \|\| label, p\)/.test(gfv) && /!isManualAnswer\(label, el\)/.test(gfv), true);
  eq('the yes/no decider follows it', /knockoutPolicy\(q, _policyProfile\); if \(pol === 'yes' \|\| pol === 'no'\) return pol;/.test(body('determineYesNo')), true);
  eq('a saved or learned answer that disagrees is ignored', /your fixed answer to this question is/.test(body('safeKnockoutAnswer')), true);
  eq('your Workday engine asks the rule first', /knockoutPolicy\(label, _policyProfile\)/.test(src.match(/window\.__uaWdAnswer = [\s\S]*?\n  \};/)[0]), true);
  eq('before every submit the page is corrected', /await enforceKnockoutPolicy\(\);\n    logFillReport\('Before submit'\);/.test(body('autoSubmitOrNext__impl')), true);
  eq('…never over what you typed', /userTouched\(el\)/.test(body('enforceKnockoutPolicy')) && /radios\.some\(userTouched\)/.test(body('enforceKnockoutPolicy')), true);
  eq('no filler reads years from merged data any more', /years_experience|yearsExperience/.test(src), false);
  eq('getProfile keeps only YOUR years', /const ownYears = p\.years;[\s\S]{0,200}p\.years = ownYears;/.test(body('getProfile')), true);
}


/* ── 74. v17.24: your Workday engine (optimhire-updates) inside this extension ── */
console.log('v17.24: your Workday engine — queue jobs, assist, CV roles');
{
  const ext = path.dirname(process.argv[2]);
  const root = path.dirname(ext);
  const entry = fs.readFileSync(path.join(root, 'workday-engine/src/ua/entry.ts'), 'utf8');
  const built = fs.readFileSync(path.join(ext, 'ua-wd-engine.js'), 'utf8');
  eq('the engine is built into the extension', /your Workday engine, built from workday-engine/.test(built) && built.length > 50000, true);
  eq('the CV reader is built (pdf.js), loaded only on demand', fs.existsSync(path.join(ext, 'ua-wd-cvtext.js')) &&
    !manifest.content_scripts.some((c) => (c.js || []).includes('ua-wd-cvtext.js')), true);
  const cs = manifest.content_scripts.find((c) => (c.js || []).includes('ua-wd-engine.js'));
  eq('it runs on Workday hosts only, top frame', !!cs && cs.matches.every((m) => /workday/.test(m)) && cs.all_frames === false, true);
  eq('the service worker loads the CV reader into the asking tab', /msg\.type === 'UA_WD_CV_LOAD'[\s\S]{0,300}files: \['ua-wd-cvtext\.js'\]/.test(orch), true);
  eq('the build reads the engine source unchanged from workday-engine/src/workday', fs.existsSync(path.join(root, 'workday-engine/src/workday/engine.ts')), true);
  eq('only the engine\'s own wd: messages are answered in the page', /msg\.type\.startsWith\("wd:"\)\) return answerWd\(msg\)/.test(entry), true);
  eq('your shared ATS password signs in to every Workday site', /"ua_app_password"/.test(entry) && /WORKDAY_SIGNUP_INFORMATION/.test(entry), true);
  eq('your CV is the one saved in the extension', /"ua_resumes", "ua_active_resume", "ua_resume_data"/.test(entry), true);
  eq('assist stops the moment Fully Automated goes off', /assistSwitch = d\.ua_aa === true && d\.ua_wd_assist !== false && d\.ua_wd_engine_off !== true/.test(entry) && /if \(!assistSwitch && isActive\(\) && !readMode\(\)\) void stopRun\(\)/.test(entry), true);
  eq('assist never overwrites what is in a field and never presses Next', /advance: \(\) => false, keepExisting: \(\) => true/.test(entry), true);
  eq('sensitive questions: yours in assist, decided in a queue run', /mode\.queue && SENSITIVE_RX\.test\(label\)/.test(entry), true);
  eq('where the engine would ask an AI, this extension\'s deciders answer', /case "wd:llm":\n\s+return llmStandIn/.test(entry) && /llmAnswers: true/.test(entry), true);

  const wa = body('workdayAutomation');
  eq('a queue job goes to the engine first', /const eng = await workdayEngineRun\(\);/.test(wa), true);
  eq('outside a run, Fully Automated means assist (when SpeedyApply does not own Workday)', /!_uaJobKey && !saOwnsWorkday\(\) && window\.__uaWdEngine[\s\S]{0,120}allowAssist\(\)\) \{[\s\S]{0,300}return 'assist';/.test(wa), true);
  eq('stopped mid-application, the built-in flow carries on from that step', /if \(eng === 'midway'\) \{\s+await fallbackFill\(\);\s+await workdayMultiPageFlow\(\);/.test(wa), true);
  eq('assist owns the page: no page walk after it', /if \(_wdAssistActive\) return;\n\s+if \(saOwnsWorkday\(\)\) return;[^\n]*\n\s+if \(!confirmSubmitted\(\)\) await multiPageLoop\(\);/.test(body('dispatchATSAutomation')) && /_wdAssistActive = true;\n\s+return 'assist';/.test(body('workdayAutomation')), true);
  eq('each queue job is told apart (results survive a reload, never leak to the next job)', (src.match(/_uaJobKey = String\(c\.id \|\| c\.url \|\| ''\);/g) || []).length, 2);
  eq('the engine is waited on as work, bounded', /withBusy\('Workday engine'/.test(body('workdayEngineWait')) && /[58] \* 60 \* 1000/.test(body('workdayEngineWait')) && /workdayEngineWait\(eng, id\)/.test(body('workdayEngineRun')), true);
  eq('"ua_wd_engine_off" gives Workday back to the built-in flow', /st\.get\('ua_wd_engine_off'\)\) === true\) return false/.test(body('workdayEngineRun')), true);
}


/* ── 75. v17.25: Workday sign-in — account made before, lockouts, resets; honest counts ── */
console.log('v17.25: Workday sign-in scenarios; a sign-in is never "applied"');
{
  const wd = body('fillWorkdayCreateAccount');
  // Counts.
  eq('a sign-in / create-account press is never recorded as a submit', /if \(onAuthWallOnly\(\)\) \{ LOG\('Pressed a sign-in/.test(body('markSubmitAttempt')), true);
  eq('nothing counts as applied while the sign-in form is on screen', /if \(onAuthWallOnly\(\)\) return false;/.test(body('confirmSubmitted')), true);
  eq('…an application form that asks for a password (SuccessFactors) still counts', /&& !hasApplicationForm\(\)/.test(body('onAuthWallOnly')), true);
  eq('Workday\'s Sign In is never pressed as the application Submit', /if \(isWorkday\(\) && workdayOnAccountWall\(\)\) \{ LOG\('Workday sign-in/.test(body('autoSubmitOrNext__impl')), true);
  eq('a job that cannot sign in fails at once, with the reason (runner and Queue Manager)',
    (src.match(/if \(_authDeadEnd\) break;/g) || []).length === 2 && /if \(_authDeadEnd\) return _authDeadEnd;/.test(body('submitFailureReason')), true);
  eq('…not "needs a human" (which held the job on Processing…)', /reportNeedsHuman\('Workday sign-in'\)/.test(src), false);
  eq('each job starts without the last one\'s dead end', (src.match(/_authDeadEnd = '';/g) || []).length >= 2, true);
  // Passwords.
  const cands = body('workdayPasswordCandidates');
  eq('passwords in order: site login, the one that worked here before, shared, Jobright\'s',
    cands.indexOf('siteLogin') < cands.indexOf('WD_SITE_PW_KEY') && cands.indexOf('WD_SITE_PW_KEY') < cands.indexOf("'ua_app_password'") && cands.indexOf("'ua_app_password'") < cands.indexOf('WORKDAY_SIGNUP_INFORMATION'), true);
  eq('the one that worked is remembered for the site', /if \(auth\.lastPw\) await wdSiteRecord\(WD_SITE_PW_KEY, auth\.lastPw\);/.test(body('wdAuthSucceeded')) && /await wdAuthSucceeded\(\);/.test(body('workdayAutomation')), true);
  eq('which password each press used is noted', (wd.match(/auth\.lastPw = pw;/g) || []).length, 2);
  // Lockouts.
  eq('refusals are counted per site and capped below Workday\'s lockout', /const refused = await wdNoteRefused\(\);/.test(wd) && /refused < WD_MAX_FAILS/.test(wd) && /const WD_MAX_FAILS = 4;/.test(src), true);
  eq('a locked account gets no more attempts', /if \(WD_LOCKED_RE\.test\(errText\) && !\/might be locked\/i\.test\(errText\)\) return wdPasswordDeadEnd\('the account is locked'/.test(wd), true);
  const L = new RegExp(src.match(/const WD_LOCKED_RE = \/(.*)\/i;/)[1], 'i');
  eq('"Your account has been locked" is locked', L.test('Your account has been locked. Use Forgot your password? to unlock it.'), true);
  eq('"too many failed attempts" is locked', L.test('Too many failed attempts. Try again later.'), true);
  eq('Workday\'s "…or your account might be locked" is a wrong password, not a lock (handled above it)', /!\/might be locked\/i/.test(wd), true);
  eq('a site where nothing worked fails fast next time, until your passwords change',
    /unk && unk\.cand === wdCandHash\(candidates\)/.test(wd) && /wdSiteRecord\(WD_UNKNOWN_KEY, \{ at: Date\.now\(\), cand: wdCandHash\(candidates\) \}\)/.test(body('wdPasswordDeadEnd')), true);
  eq('only a hash of WHICH passwords is stored, never the passwords', /never the passwords/.test(body('wdCandHash')), true);
  // Reset.
  const de = body('wdPasswordDeadEnd');
  eq('a reset is only tried when your Gmail API connection can read the link', /if \(mb\.enabled && mb\.connected && forgot\)/.test(de), true);
  const rs = body('wdResetStep');
  eq('the reset link is only followed back to this same Workday site', /u\.protocol === 'https:' && u\.hostname === location\.hostname/.test(rs), true);
  eq('the new password is your shared ATS password, remembered for the site', /const newPw = await getAppPassword\(\);/.test(rs) && /await wdSiteRecord\(WD_SITE_PW_KEY, newPw\);/.test(rs), true);
  eq('a reset email that never comes fails the job after 3 minutes, with the reason', /Date\.now\(\) - r\.at > 3 \* 60 \* 1000/.test(rs), true);
  eq('the reset counts as the account step (no filling meanwhile)', /while \(\(workdayOnAccountWall\(\) \|\| wdResetActive\(\)\)/.test(body('workdayAutomation')), true);
  // Engine order.
  const wa = body('workdayAutomation');
  eq('the sign-in stays ours; your engine applies after it', wa.indexOf('await wdAuthSucceeded();') < wa.indexOf('const eng = await workdayEngineRun();'), true);
  const entry = fs.readFileSync(path.join(path.dirname(path.dirname(process.argv[2])), 'workday-engine/src/ua/entry.ts'), 'utf8');
  eq('…and if a session expires mid-application, the engine signs in with the same per-site password', /"ua_ats_logins", "ua_wd_site_pw"/.test(entry), true);
  eq('an engine run that ends without reporting is recorded as stopped (no 8-minute wait)', /outcome: "stopped", page: lastPage \|\| detectPage\(\)/.test(entry), true);
}


/* ── 76. v17.26: Workday "Start Your Application" — only ever "Apply Manually" ── */
console.log('v17.26: Apply Manually, never Autofill with Resume / Use My Last Application');
{
  const bad = new RegExp(src.match(/const APPLY_BAD_RE = \/(.*)\/i;/)[1], 'i');
  for (const t of ['Autofill with Resume', 'Use My Last Application', 'Autofill Application']) eq(`"${t}" is never an Apply button`, bad.test(t.toLowerCase()), true);
  eq('"Apply Manually" still is not excluded', bad.test('apply manually'), false);
  eq('the [data-automation-id*=apply] selector cannot take useMyLastApplication', /!WD_NEVER_PRESS_AID_RE\.test\(el\.getAttribute\('data-automation-id'\) \|\| ''\)/.test(body('findApplyButton')), true);
  const dc = body('isDestructiveControl');
  eq('the click layer refuses both, by id and by label (every click path)', /autofillWithResume\|useMyLastApplication/.test(dc) && /autofill with \(my \)\?\(resume\|cv\)\|use my last application/.test(dc), true);
  const eng = fs.readFileSync(path.join(path.dirname(path.dirname(process.argv[2])), 'workday-engine/src/workday/engine.ts'), 'utf8');
  eq('your Workday engine presses Apply Manually only', /\/\/ \[ua\] Always "Apply Manually"/.test(eng) && /const btn = byAid\("applyManually"\);/.test(eng) && !/byAid\("autofillWithResume"\)/.test(eng), true);
  eq('the built engine has it', /Apply method: Apply Manually/.test(fs.readFileSync(path.join(path.dirname(process.argv[2]), 'ua-wd-engine.js'), 'utf8')) &&
    !/Autofill with Resume \(tailored CV\)/.test(fs.readFileSync(path.join(path.dirname(process.argv[2]), 'ua-wd-engine.js'), 'utf8')), true);
}


/* ── 77. v17.27: the run Debugger ── */
console.log('v17.27: Debugger — every job recorded, failures grouped by cause');
{
  const ext = path.dirname(process.argv[2]);
  const rd = (n) => fs.readFileSync(path.join(ext, n), 'utf8');
  const sw = rd('ua-debugger.js'), page = rd('ua-debug.js'), html = rd('ua-debug.html'), bg = rd('static/background/index.js'), qhtml = rd('ua-queue.html'), qjs = rd('ua-queue.js');
  const grab = (txt) => txt.match(/function reasonGroup[\s\S]*?\n  \}\n/)[0];
  eq('the run panel and the Debugger group causes with the same rule', grab(src).replace(/\s+/g, ' '), grab(sw).replace(/\s+/g, ' '));
  const g = new Function(grab(sw) + ';return reasonGroup;')();
  eq('specifics come out: "— First Name: required"', g('Validation errors could not be resolved — First Name: required'), 'Validation errors could not be resolved');
  eq('numbers fold: "Timed out after 150s"', g('Timed out after 150s'), 'Timed out after Ns');
  eq('emails and sites fold, first sentence only', g('Workday account already exists for a@b.com on x.wd12.myworkdayjobs.com with a password the extension doesn\'t have (all 2 refused). Add it under 🔐 Site logins.'), 'Workday account already exists for <email> on <site> with a password the extension doesn\'t have');
  eq('…so two such failures are one cause', g('Validation errors could not be resolved — Phone: invalid'), g('Validation errors could not be resolved — Email: required'));
  eq('the run panel\'s "Most failures" uses causes, not exact text', /const key = `\$\{j\.status\}: \$\{reasonGroup\(j\.error\)\}`;/.test(body('failureGroups')), true);
  // Recording.
  eq('every [UA] log line goes into the job\'s record', /if \(JR\.id\) \{ try \{ jrLine\('', a\.map\(_dbgFmt\)\.join\(' '\)\); \}/.test(src), true);
  eq('stages and diagnostics too', /if \(JR\.id\) jrLine\(code === 'stage' \? 'stage' : 'diag'/.test(body('DIAG')), true);
  eq('page errors too', /jrLine\('error', `\$\{\(e && e\.message\) \|\| 'script error'\}/.test(src), true);
  eq('your Workday engine\'s steps too', /__uaJrLine\?\.\("engine", msg\)/.test(fs.readFileSync(path.join(path.dirname(ext), 'workday-engine/src/ua/entry.ts'), 'utf8')), true);
  eq('each job is started in the record (runner and Queue Manager)', (src.match(/jrBegin\(c, 'queue'\);/g) || []).length, 2);
  eq('…and Fully Automated passes outside a run', /jrBegin\(\{ id: 'auto:'/.test(src), true);
  eq('ended: Queue Manager finalize and the runner\'s terminal jobs', /jrFinish\(status, error \|\| ''\);/.test(src) && /jrFinish\(j\.status, j\.error \|\| ''\)/.test(body('reportTerminalJobs')), true);
  eq('single-page steps are recorded as pages', /JR\.urlWatch = setInterval/.test(body('jrBegin')), true);
  const snap = body('jrSnapshot');
  eq('the end-of-job snapshot has fields, errors, empty required, alerts, buttons and the Submit pick', ['snap.fields.push', 'readFieldErrors()', 'getMissingRequired()', 'snap.alerts', 'snap.buttons', 'findSubmitControl()'].every((k) => snap.includes(k)), true);
  eq('passwords and ID numbers are masked in it', /type === 'password' \|\| SECRET\.test\(label\)/.test(snap) && /password\|passcode\|\\bssn\\b/.test(snap), true);
  eq('a screenshot is asked for when a job did not succeed', /shot: status !== 'done'/.test(snap), true);
  // Service worker.
  eq('the recorder loads in the service worker', /importScripts\("\/ua-debugger\.js"\)/.test(bg), true);
  eq('outcomes come from the queue itself (every path that ends a job)', /changes\.ua_q/.test(sw) && /TERMINAL\.includes\(j\.status\)/.test(sw), true);
  eq('bounded: jobs, lines per job, screenshots', /JOB_CAP = 600/.test(sw) && /LINE_CAP = 3000/.test(sw) && /SHOT_CAP = 40/.test(sw), true);
  eq('only the tab on screen is captured', /if \(!tab \|\| !tab\.active/.test(sw), true);
  eq('opens in front when you ask, even during a run', /__uaAllowFront: true/.test(sw), true);
  // Page + ways in.
  eq('the Debugger page loads its script (no inline script)', /<script src="ua-debug\.js"><\/script>/.test(html) && !/<script>[^<]/.test(html), true);
  eq('it shows causes, jobs, timeline, page snapshot, screenshot, pages', ['renderCauses', 'renderJobs', 'renderTimeline', 'renderPage', "'shot'", "'pages'"].every((k) => page.includes(k)), true);
  eq('copy and export for sending on', /jobReport/.test(page) && /Download everything/.test(html) && /Copy summary/.test(html), true);
  eq('a Debug button in the run panel', /id="uc-dbg"/.test(src) && /openDebugger\(/.test(src), true);
  eq('…in the Queue Manager', /id="btnDebugger"/.test(qhtml) && /btnDebugger/.test(qjs), true);
  eq('…and in the right-click menu', /ua-open-debugger/.test(orch), true);
}


/* ── 78. v17.28: alongside other extensions; one-click debug download ── */
console.log('v17.28: run panel sealed in its own shadow root; coexisting with OptimHire; download everything');
{
  const ext = path.dirname(process.argv[2]);
  const rd = (n) => fs.readFileSync(path.join(ext, n), 'utf8');
  const sw = rd('ua-debugger.js');
  // Sealed panel.
  const eo = body('ensureOverlay');
  eq('the run panel is a custom element with a CLOSED shadow root', /document\.createElement\('ua-run-panel'\)/.test(eo) && /attachShadow\(\{ mode: 'closed' \}\)/.test(eo), true);
  eq('its styles are inside it, not in the page', /style\.textContent = UC_PANEL_CSS/.test(eo) && !/#ua-ctrl-card\{width:300px/.test(body('injectCSS')), true);
  eq('the page cannot restyle the host either (all:initial !important)', /all:initial!important;position:fixed!important/.test(eo), true);
  eq('every lookup of its parts goes through the shadow root', !/document\.getElementById\('(uc-[\w-]+|ua-ctrl)'\)/.test(src) && /function ucEl\(id\)/.test(src), true);
  eq('…and an element with the same id in the page is never taken for ours', /_ucShadow\.getElementById\(id\)\) \|\| null/.test(body('ucEl')), true);
  eq('this extension\'s own scans skip it', /#ua-ctrl,ua-run-panel,/.test(src), true);
  // Generic hide rules only where we are applying.
  const css = body('injectCSS');
  eq('generic "paywall / review popup" hide rules only on a tab this extension is applying in',
    /html\[data-ua-auto="1"\] \[class\*="paywall"\]/.test(css) && /html\[data-ua-auto="1"\] \[class\*="review-popup"\]/.test(css) && !/\n\[class\*="paywall"\]/.test(css), true);
  // Not filling a page another extension is filling.
  eq('Fully Automated stands down where your OptimHire build is working', /otherAutofillDriving\(\) \|\| \(await waitUntil\(otherAutofillDriving, 2500, 250\)\)/.test(src) && /standing down here/.test(src), true);
  eq('…recognised by its own elements', ['#oh-csv-overlay-host', '#oh-autofill-banner', '#wd-autopilot-overlay', '#oh-wd-submit-countdown', '#optimhire-resume-score-record'].every((k) => src.includes(k)), true);
  // One-click download.
  eq('a "Download debug log" button in the Jobright sidebar card', /id="ua-sb-dl"/.test(src) && /querySelector\('#ua-sb-dl'\)\?\.addEventListener\('click', \(e\) => downloadDebugBundle/.test(src), true);
  eq('…in the run panel', /id="uc-dl"/.test(src), true);
  eq('…on the Debugger page and in the Queue Manager', /UA_DBG_BUNDLE/.test(rd('ua-debug.js')) && /Download everything/.test(rd('ua-debug.html')) && /btnDebugDl/.test(rd('ua-queue.html')) && /UA_DBG_BUNDLE/.test(rd('ua-queue.js')), true);
  eq('the page adds its own in-memory log to the file', /log: _dbgBuf\.slice\(-2000\)/.test(body('downloadDebugBundle')), true);
  const secret = new RegExp(sw.match(/const SECRET_KEY_RE = \/(.*)\/i;/)[1], 'i');
  for (const k of ['ua_app_password', 'WORKDAY_SIGNUP_INFORMATION', 'ua_ats_logins', 'ua_wd_site_pw', 'ua_resume_data', 'ua_resumes', 'ua_mail_token', 'ua_mail_client_id']) eq(`"${k}" never goes in the file`, secret.test(k), true);
  for (const k of ['ua_q', 'ua_mgr_log', 'ua_diag_events', 'ua_wd_engine_log', 'ua_profile']) eq(`"${k}" does`, secret.test(k), false);
  eq('the file has the summary by cause, every job record with its screenshot, and the diagnostics report',
    /causes: Object\.entries\(causes\)/.test(sw) && /record: all\[REC\(e\.id\)\] \|\| null, screenshot: all\[SHOT\(e\.id\)\]/.test(sw) && /self\.__uaDiagReport/.test(sw), true);
}



/* ── 79. v17.29: Greenhouse — CV slot, city pick, phone country; real job start ── */
console.log('v17.29: CV never into Cover Letter; a city, not a university; phone country from the phone; true job start');
{
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  const m = {};
  new Function('exports', `${gc('COVER_UPLOAD_RE')}${gc('CV_WORD_RE')}${gc('NOT_A_PLACE_RE')}${gc('DIAL_ISO')}${gc('DIAL_NAME')}${gc('JOB_T0_KEY')}
    ${body('dialCodeFromPhone')}${body('isCoverLetterSlot')}${body('pickPlaceSuggestion')}${body('phoneCountryTarget')}${body('phoneCountryOptionMatches')}${body('jobStartFor')}
    const DEFAULTS = { country: 'Ireland', phoneCountryCode: '+353' };
    const getLabel = (el) => el.label || '';
    const store = {}; const sessionStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
    Object.assign(exports, { isCoverLetterSlot, pickPlaceSuggestion, phoneCountryTarget, phoneCountryOptionMatches, jobStartFor, store });`)(m);
  // CV vs cover letter.
  const box = (text, parent) => ({ innerText: text, parentElement: parent || null });
  const inp = (o, parent) => Object.assign({ tagName: 'INPUT', name: '', id: '', getAttribute: (k) => (o.attrs || {})[k] || null, parentElement: parent }, o);
  eq('Greenhouse id="cover_letter" is the cover letter', m.isCoverLetterSlot(inp({ id: 'cover_letter', label: 'Cover Letter Attach' }, null)), true);
  eq('id="resume" is not', m.isCoverLetterSlot(inp({ id: 'resume', label: 'Resume/CV Attach' }, null)), false);
  eq('an unlabelled input under a "Cover Letter Attach Dropbox" block is the cover letter',
    m.isCoverLetterSlot(inp({}, box('Cover Letter* Attach Dropbox Google Drive Enter manually', box('Resume/CV* Attach … Cover Letter* Attach …')))), true);
  eq('…under a "Resume/CV" block it is the CV', m.isCoverLetterSlot(inp({}, box('Resume/CV* Attach Dropbox'))), false);
  eq('a slot for "CV and cover letter" still takes the CV', m.isCoverLetterSlot(inp({ label: 'Upload your CV and cover letter' }, null)), false);
  eq('resumeFileInputs drops cover-letter slots before anything else', /if \(isCoverLetterSlot\(el\)\) return false;/.test(body('resumeFileInputs')), true);
  eq('a cover-letter file on show is not taken as "CV already attached"', /if \(isCoverLetterSlot\(c\)\) continue;/.test(body('resumeAlreadyAttached')), true);
  // City, not a university.
  const it = (t) => ({ textContent: t });
  const galway = [it('National University of Ireland, Galway, Ireland'), it('Galway, Ireland'), it('Galway Airport, Carnmore')];
  eq('"Galway" picks the town, not the university listed first', m.pickPlaceSuggestion(galway, 'Galway').textContent, 'Galway, Ireland');
  eq('"Dublin, Ireland" picks Dublin in Ireland over Dublin, CA', m.pickPlaceSuggestion([it('Dublin, CA, USA'), it('Dublin, Ireland')], 'Dublin, Ireland').textContent, 'Dublin, Ireland');
  eq('"London" picks London, not a London street', m.pickPlaceSuggestion([it('London Road, Brighton'), it('London, UK')], 'London').textContent, 'London, UK');
  eq('Parkville is a place (no "park" false alarm)', m.pickPlaceSuggestion([it('Parkville VIC, Australia')], 'Parkville').textContent, 'Parkville VIC, Australia');
  eq('both pickers use it', (body('commitAutocompleteOnce').match(/pickPlaceSuggestion\(/g) || []).length, 2);
  eq('a typed-but-unpicked city under "is required" is picked again (at most twice)',
    /if \(!complains && \(\(locationAccepted\(inp\) && !typedOnly\) \|\| \(_locRetries\.get\(inp\) \|\| 0\) >= 2\)\) continue;/.test(body('resolveLocationFields')), true);
  // Phone country follows the phone.
  eq('a +44 phone → United Kingdom, not the Ireland default', JSON.stringify(m.phoneCountryTarget({ phone: '+44 7700 900123', country: 'Ireland', phoneCountryCode: '+353' })), JSON.stringify({ code: '44', iso: 'gb', country: 'United Kingdom' }));
  eq('a +353 phone → the profile country', m.phoneCountryTarget({ phone: '+353 87 426 1508', country: 'Ireland', phoneCountryCode: '+353' }).iso, 'ie');
  eq('no code in the phone → the profile\'s dial code', m.phoneCountryTarget({ phone: '087 426 1508', phoneCountryCode: '+44', country: 'United Kingdom' }).country, 'United Kingdom');
  const o = (text, attrs) => ({ textContent: text, getAttribute: (k) => (attrs || {})[k] || null });
  const uk = { code: '44', iso: 'gb', country: 'United Kingdom' };
  eq('intl-tel entry with data-dial-code', m.phoneCountryOptionMatches(o('United Kingdom +44', { 'data-dial-code': '44', 'data-country-code': 'gb' }), uk), true);
  eq('Guernsey +44 is not the UK', m.phoneCountryOptionMatches(o('Guernsey +44', { 'data-dial-code': '44', 'data-country-code': 'gg' }), uk), false);
  eq('"Ireland +353" is not +44', m.phoneCountryOptionMatches(o('Ireland +353'), uk), false);
  eq('a location suggestion is never a phone country', m.phoneCountryOptionMatches(o('National University of Ireland, Galway, Ireland'), { code: '353', iso: 'ie', country: 'Ireland' }), false);
  eq('a bare country-name entry matches only when it is exactly the country', m.phoneCountryOptionMatches(o('🇮🇪 Ireland'), { code: '353', iso: 'ie', country: 'Ireland' }), true);
  const fx = body('fixPhoneCountryCode');
  eq('the fixer no longer hard-codes Ireland', !/ireland|353|🇮🇪/i.test(fx), true);
  eq('it only opens a selector found beside a phone box', /for \(const tel of phones\)/.test(fx) && /\$\$\(SELECTOR_SEL, scope\)/.test(fx), true);
  eq('…and picks only from the list that click opened', /!listsBefore\.has\(l\)/.test(fx), true);
  eq('a number the widget emptied is put back', /if \(before && !\(tel\.value \|\| ''\)\.trim\(\)\) \{ nativeSet\(tel, before\)/.test(fx), true);
  // Real job start.
  const now = Date.now();
  eq('a fresh start time is believed', m.jobStartFor({ id: 'a', startedAt: now - 5000 }), now - 5000);
  eq('a start time 17 minutes old is not (the "Timed out after 1054s" bug)', Math.abs(m.jobStartFor({ id: 'b', startedAt: now - 17 * 60000 }) - now) < 1000, true);
  m.store.ua_job_t0 = JSON.stringify({ id: 'c', t: now - 200000 });
  eq('after a reload, this tab\'s own first sighting of the job counts', m.jobStartFor({ id: 'c', startedAt: now - 250000 }), now - 250000);
  eq('both timers use it', /const jobStart = jobStartFor\(c\);/.test(body('processManagedJob')) && /const jobStart = jobStartFor\(c\);/.test(body('processQ')), true);
  eq('no timer reads the stored start directly any more', !/jobTimeoutExtension\(c\.startedAt\)/.test(src), true);
}



/* ── 80. v17.30: Jobright's own profile under ours; no preferred-name trap ── */
console.log('v17.30: names and phone from Jobright\'s profile; "I have a preferred name" left unticked; one flow per tab');
{
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  const m = {};
  new Function('exports', `${body('profileFromJobright')}${body('mergeProfiles')}${gc('WD_PREFERRED_NAME_RE')}
    Object.assign(exports, { profileFromJobright, mergeProfiles, WD_PREFERRED_NAME_RE });`)(m);
  const snap = JSON.stringify({   // Jobright stores it through @plasmohq/storage: a JSON string
    personalInfo: { firstName: 'Maxmilliam', lastName: 'Okafor', preferredFirstName: '', email: 'max@example.com', phone_number: '+1 512 555 0100', linkedin_link: 'https://linkedin.com/in/max' },
    phoneCountryCode: 'United States (+1)', location: { country: 'United States', state: 'Texas', city: 'Austin', postCode: '73301' }, addressLine: '1 Main St',
    workExperience: [{ job_title: 'IT Lead', organization: 'Acme', location: 'Austin', dates: { start_date: '2020-01', is_current: true }, job_descriptions: ['Led ERP'] }],
    education: [{ organization: 'UT Austin', accreditation: 'BSc', dates: { completion_date: '2015-06' } }],
  });
  const jr = m.profileFromJobright(snap);
  eq('first / last name from Jobright', `${jr.first_name} ${jr.last_name}`, 'Maxmilliam Okafor');
  eq('phone and its dial code', `${jr.phone} | ${jr.phoneCountryCode}`, '+1 512 555 0100 | +1');
  eq('city, state, country, postcode, address, LinkedIn', [jr.city, jr.state, jr.country, jr.postal_code, jr.address, jr.linkedin].join('|'), 'Austin|Texas|United States|73301|1 Main St|https://linkedin.com/in/max');
  eq('work history in the keys the fillers and the engine read', `${jr.work_experience[0].title}@${jr.work_experience[0].company} current=${jr.work_experience[0].is_current}`, 'IT Lead@Acme current=true');
  eq('an empty preferred name is not carried', 'preferred_name' in jr, false);
  eq('nothing stored → nothing', JSON.stringify(m.profileFromJobright(undefined)), '{}');
  const merged = m.mergeProfiles(jr, {}, {}, { email: 'Maxokafordev@gmail.com', first_name: '' });
  eq('your profile with only an email: the name comes from Jobright', merged.first_name, 'Maxmilliam');
  eq('…and your email still wins', merged.email, 'Maxokafordev@gmail.com');
  eq('a value you set wins over Jobright\'s', m.mergeProfiles(jr, { city: 'London' }).city, 'London');
  eq('getProfile reads Jobright\'s snapshot underneath OptimHire and yours', /st\.getMulti\(\['candidateDetails', 'userDetails', JR_SNAPSHOT_KEY\]\)/.test(body('getProfile')) && /mergeProfiles\(profileFromJobright\(ohData\[JR_SNAPSHOT_KEY\]\), ud, cd, p\)/.test(body('getProfile')), true);
  const entry = fs.readFileSync(path.join(path.dirname(process.argv[2]), '../workday-engine/src/ua/entry.ts'), 'utf8');
  eq('the Workday engine reads it too', /"AUTOFILL_INFO_SNAPSHOT"\]\);\n  return mergeLayers\(jobrightProfile\(d\.AUTOFILL_INFO_SNAPSHOT\)/.test(entry), true);
  eq('…in the built bundle as well', /AUTOFILL_INFO_SNAPSHOT/.test(fs.readFileSync(path.join(path.dirname(process.argv[2]), 'ua-wd-engine.js'), 'utf8')), true);
  // Preferred name.
  for (const q of ['I have a preferred name', 'Do you have a preferred name?', 'Preferred Name?']) eq(`"${q}" is the preferred-name switch`, m.WD_PREFERRED_NAME_RE.test(q), true);
  for (const q of ['Preferred Name (First)', 'Given Name(s)', 'What name do you prefer to be called at work?']) eq(`"${q}" is not`, m.WD_PREFERRED_NAME_RE.test(q), false);
  const g = body('workdayEngineOutcome') && src.slice(src.indexOf('window.__uaWdGuess = async'), src.indexOf('window.__uaWdPick ='));
  eq('the engine\'s stand-in answers it "false" unless you have a different preferred name on file', /if \(!texts\.length\) return want \? 'true' : 'false';/.test(g), true);
  // Multiselect with a pick.
  new Function('exports', `${body('wdMultiselectHasPick')} const getLabel = () => ''; exports.ms = wdMultiselectHasPick;`)(m);
  const el = (aria) => ({ getAttribute: (k) => (k === 'aria-label' ? aria : null), closest: () => null, parentElement: null });
  eq('"1 item selected, LinkedIn" is answered', m.ms(el('1 item selected, LinkedIn')), true);
  eq('an empty multiselect is not', m.ms(el('How Did You Hear About Us?')), false);
  eq('the missing-fields list skips answered multiselects', /if \(wdMultiselectHasPick\(el\)\) continue;/.test(body('getMissingRequired')), true);
  // One flow per tab.
  eq('switching Fully Automated on mid-job does not start a second flow on that tab',
    /const driving = \(qActive && isRunnerTab\(\)\) \|\| _mgrDriving \|\| isBusy\(\);/.test(body('setAutoApply')) && /a queue job is already applying on this tab/.test(body('setAutoApply')), true);
}



/* ── 81. v17.31: one filler per Workday page; location everywhere; no popup ── */
console.log('v17.31: Jobright stays out of our Workday jobs; engine resumes; sign-in without automation ids; location; cover-letter PDF');
{
  const ext = path.dirname(process.argv[2]);
  const rd = (n) => fs.readFileSync(path.join(ext, n), 'utf8');
  const helper = rd('helper-app.41ea2652.js');
  const eng = fs.readFileSync(path.join(ext, '../workday-engine/src/ua/entry.ts'), 'utf8');
  const det = fs.readFileSync(path.join(ext, '../workday-engine/src/workday/detect.ts'), 'utf8');
  const auth = fs.readFileSync(path.join(ext, '../workday-engine/src/workday/auth.ts'), 'utf8');
  const ans = fs.readFileSync(path.join(ext, '../workday-engine/src/workday/answers.ts'), 'utf8');
  const bundle = rd('ua-wd-engine.js');
  const gc = (n) => src.match(new RegExp('\n  const ' + n + ' = [\\s\\S]*?;\n'))[0];
  // Jobright's own Workday autofill.
  eq('Jobright asks before auto-starting its Workday autofill after sign-in (our patch)', (helper.match(/globalThis\.__uaOwnsAutofill\?\.\(e&&e\.targetName\)\)return!1/g) || []).length, 2);
  eq('…and the answer is yes on a tab our engine or queue is driving', /globalThis\.__uaOwnsAutofill = \(target\) =>/.test(src) && /sessionStorage\.getItem\('uaWdRun'\)/.test(src) && /return isRunnerTab\(\) \|\| _mgrDriving/.test(src), true);
  eq('our flow no longer presses Jobright Autofill on Workday when the engine is there', /const engineHere = /.test(body('workdayAutomation')), true);
  // Popup.
  eq('"Add this job first" is answered "Not Now" and never drawn', /add-job-first[\s\S]{0,40}|if\(e\)\{setTimeout\(\(\)=>\{try\{r&&r\(\)\}catch\(_\)\{\}\},0\);return null\}/.test(helper) && /\[ua\] "Add this job first" is never shown/.test(helper), true);
  // Duplicate entries.
  for (const f of ['workdayFillExperience', 'workdayFillEducation']) {
    eq(`${f} no longer presses the first add-button on the page`, !/button\[data-automation-id="add-button"\]'\);/.test(body(f)) && /await wdAddFirstEntry\('(exp|edu)'\);/.test(body(f)), true);
  }
  eq('the first entry is added once per page, only when none exists, from its own section', /_wdAddedOnce\.has\(key\) \|\| wdHasEntry\(kind\)/.test(body('wdAddFirstEntry')) && /wdSection\(/.test(body('wdAddFirstEntry')), true);
  // Dates.
  eq('a year-only date gets its month through the engine\'s date setter', /eng\.setDate\(box, `\$\{y\}-\$\{end \? '12' : '01'\}`\)/.test(body('wdFillMissingMonths')), true);
  eq('…which the bridge exposes', /setDate: \(field: HTMLElement, ym: string\) => setDate\(field, ym\)/.test(eng), true);
  eq('"From"/"To" fallback matches only labels that ARE From / To', !/contains\(translate\(text\(\),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'\),'to'\)/.test(src), true);
  // Engine resume.
  eq('after the built-in flow clears the engine\'s paused step, the next step goes back to the engine (max 4)', /if \(n >= 4\) return false;/.test(body('workdayEngineResume')) && /eng\.resume\(id\)/.test(body('workdayEngineResume')), true);
  eq('…called when the step changes', /const back = await workdayEngineResume\(\);/.test(body('workdayMultiPageFlow')), true);
  eq('the bridge can resume a job', /resume: \(jobId: string\) => void resumeJob\(jobId\)/.test(eng) && /async function resumeJob/.test(eng), true);
  // Sign-in screens without automation ids.
  eq('the engine recognises sign-in / create-account by their boxes when the ids are missing', /if \(pws\.length >= 2\) return "createAccount";/.test(det) && /if \(pws\.length === 1 && authEmailInput\(\)\) return "signIn";/.test(det), true);
  eq('…and fills them', /byAid\("email"\) \?\? authEmailInput\(\)/.test(auth) && /byAid\("verifyPassword"\) \?\? authPasswordInputs\(\)\[1\]/.test(auth), true);
  eq('…pressing the form\'s own Submit, not the "Sign In" tab', /submitNear\(pw, label\)/.test(auth), true);
  eq('built into the bundle', /authPasswordInputs/.test(bundle) && /resumeJob/.test(bundle), true);
  eq('the account watcher does not pass with a password box on screen', /if \(!pwFields\.length && \(/.test(src), true);
  // Phone extension.
  eq('"Phone Extension" no longer gets the phone number', /ext\(ension\)\?\\b\|durchwahl/.test(ans), true);
  // Address with a line break.
  const m = {};
  new Function('exports', `${body('profileFromJobright')} exports.f = profileFromJobright;`)(m);
  const a = m.f({ personalInfo: { firstName: 'M' }, addressLine: '21 Mount Andrew Crescent\nLucan' });
  eq('"21 Mount Andrew Crescent⏎Lucan" → line 1 + line 2', `${a.address} | ${a.address_line_2}`, '21 Mount Andrew Crescent | Lucan');
  eq('the engine splits it the same way', /line1: pick\(s, "address", "address_line_1", "address1", "street"\)\.split\(/.test(eng), true);
  // Location: country defaults.
  new Function('exports', `${gc('COUNTRY_ALIASES')}${body('sameCountry')}${body('isCountryQuestion')} Object.assign(exports, { sameCountry, isCountryQuestion });`)(m);
  eq('"United States" is not Ireland', m.sameCountry('United States', 'Ireland'), false);
  eq('"USA" is the United States', m.sameCountry('USA', 'United States'), true);
  eq('"Ireland (+353)" is Ireland', m.sameCountry('Ireland (+353)', 'Ireland'), true);
  for (const q of ['Country *', 'Country', 'Country/Region']) eq(`"${q}" is a country box`, m.isCountryQuestion(q), true);
  for (const q of ['Country Phone Code', 'Country of citizenship', 'Which countries are you authorised to work in?', 'Country of birth']) eq(`"${q}" is not`, m.isCountryQuestion(q), false);
  eq('the fallback fill corrects a default country first, on every ATS', /try \{ filled \+= await fixCountryDefaults\(p\); \} catch \(_\) \{\}/.test(body('fallbackFill__impl')), true);
  eq('…never over a choice you made', /userTouched\(sel\)/.test(body('fixCountryDefaults')) && /userTouched\(combo\)/.test(body('fixCountryDefaults')), true);
  // References / date boxes.
  const gv = body('guessValue');
  eq('"References (Name, Company…)" is answered before the company rule', gv.indexOf("return 'Available upon request';") > 0 && gv.indexOf("return 'Available upon request';") < gv.indexOf("return p.current_company || p.company || '';"), true);
  new Function('exports', `${body('looksLikeDateBox')} exports.d = looksLikeDateBox;`)(m);
  const box = (attrs) => ({ tagName: 'INPUT', type: 'text', placeholder: attrs.placeholder || '', className: attrs.cls || '', getAttribute: (k) => attrs[k] || null, closest: () => null });
  eq('an mm/dd/yyyy box is a date box', m.d(box({ placeholder: 'mm/dd/yyyy' })), true);
  eq('a datepicker class too', m.d(box({ cls: 'fab-DatePicker-input' })), true);
  eq('a plain text box is not', m.d(box({})), false);
  eq('"Date Available" in a date box gets a date, not "Immediately"', /looksLikeDateBox\(el\)\) return availableDateFor\(el, p\);/.test(body('refineAnswerForControl')), true);
  // Cover letter PDF.
  const t = new Function(`${body('textToPdf')} return textToPdf;`)();
  const pdf = Buffer.from(t('Dear Hiring Team,\n\nI am “excited” — to apply (really).\n\nKind regards,\nMax')).toString('latin1');
  eq('the cover letter is a real PDF', pdf.startsWith('%PDF-1.4') && pdf.trim().endsWith('%%EOF') && /\/Type \/Page /.test(pdf), true);
  eq('…with the text in it, quotes and dashes simplified, brackets escaped', /\(I am "excited" - to apply \\\(really\\\)\.\) Tj/.test(pdf), true);
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  eq('…and a correct cross-reference table', pdf.slice(xref, xref + 4), 'xref');
}



/* ── 82. v17.32: every Workday role, not just the first ── */
console.log('v17.32: Workday adds a Work Experience per role from Jobright\'s profile (Accenture, Citi, …)');
{
  const m = {};
  new Function('exports', `${body('profileFromJobright')}${body('wdParseYM')}${body('wdWorkEntries')} Object.assign(exports, { profileFromJobright, wdWorkEntries });`)(m);
  const jr = m.profileFromJobright({ personalInfo: { firstName: 'M' }, workExperience: [
    { job_title: 'Senior Software Engineer', organization: 'Meta', dates: { start_date: '2023-01', is_current: true } },
    { job_title: 'AI Product Manager', organization: 'SolimHealth', dates: { start_date: '2022-08', completion_date: '2022-12' } },
    { job_title: 'Senior Solutions Architect', organization: 'Accenture', dates: { start_date: '2021-03', completion_date: '2022-07' } },
    { job_title: 'Senior Data Analyst', organization: 'Citi', dates: { start_date: 'Aug 2017', completion_date: 'Mar 2021' } },
  ] });
  const roles = m.wdWorkEntries(jr);
  eq('the built-in Workday filler sees all 4 roles (it saw only Meta)', roles.map((r) => r.company).join(', '), 'Meta, SolimHealth, Accenture, Citi');
  eq('…with their dates', roles.map((r) => `${r.start.m}/${r.start.y}-${r.current ? 'now' : r.end.m + '/' + r.end.y}`).join(' '), '01/2023-now 08/2022-12/2022 03/2021-07/2022 8/2017-3/2021');
  eq('…so wdMyExperience presses "Add Another" up to that count', /wdEnsureBlocks\(work, \['jobTitle', 'formField-jobTitle'\], roles\.length\)/.test(body('wdMyExperience')), true);
  const eng = fs.readFileSync(path.join(path.dirname(process.argv[2]), '../workday-engine/src/ua/entry.ts'), 'utf8');
  eq('the engine\'s own fallback mapping carries every role too', /if \(work\.length\) out\.work_experience = work;/.test(eng), true);
  eq('My Experience is work, not a stall, for the 15s watchdog', /withBusy\('filling My Experience'/.test(body('workdayMultiPageFlow')), true);
}



/* ── 83. v17.34: SpeedyApply fills Workday; refused sign-in skips; faster Apply ── */
console.log('v17.34: Workday — SpeedyApply mode, refused sign-in skipped at once, Apply without the 12s wait');
{
  const sa = body('workdaySpeedyApplyRun');
  eq('SpeedyApply mode is on unless you switch it off', /\(await st\.get\('ua_wd_mode'\)\) !== 'engine'/.test(body('workdayModeSpeedyApply')), true);
  eq('it is recognised by SpeedyApply\'s own element on the page', /speedyapply-autofill,speedyapply-modal/.test(src), true);
  eq('…and when it is not there, the engine applies as before', /SpeedyApply is not active on this page/.test(sa) && /return false;/.test(sa), true);
  eq('while SpeedyApply drives, our password watcher and engine stay out', /if \(_saDriving \|\| \(_saModeOn && speedyApplyPresent\(\)\)\) return;/.test(src) && /if \(_saDriving\) return false;/.test(body('workdayEngineRun')), true);
  eq('it only presses Next / Submit once the page has been still', /quiet > STILL_MS && pressed < 3/.test(sa) && /realClick\(n\); pressed\+\+;/.test(sa), true);
  eq('…fills only what SpeedyApply left, once per step; what is still empty fails the job, named', (sa.match(/await fallbackFill\(\)/g) || []).length === 1 && /SpeedyApply left required fields empty on/.test(sa), true);
  eq('called right after Apply, before anything of ours touches the page', body('workdayAutomation').indexOf('workdaySpeedyApplyRun()') > 0 && body('workdayAutomation').indexOf('workdaySpeedyApplyRun()') < body('workdayAutomation').indexOf('await clickApplyManually();'), true);
  eq('a switch in the Bulk card', /id="ua-sb-wdsa"/.test(src) && /st\.set\('ua_wd_mode', saCb\.checked \? 'speedyapply' : 'engine'\)/.test(src), true);
  // Refused sign-in.
  const RE = new RegExp(src.match(/const WD_SIGNIN_REFUSED_RE = \/(.*)\/i;/)[1], 'i');
  eq('Workday\'s "wrong email address or password … might be locked" is recognised', RE.test('You may have entered the wrong email address or password or your account might be locked.'), true);
  eq('…and skips the job at once (not more passwords)', /if \(onSignIn && WD_SIGNIN_REFUSED_RE\.test\(errText\) && !_wdCreatedThisJob\) return wdSkipRefusedSignIn\(errText\);/.test(src), true);
  eq('…unless this job just created the account (then it is created again)', /_wdCreatedThisJob = true;/.test(src), true);
  eq('the job is marked skipped, not failed', /else if \(_authSkip\) await finalize\('skipped', _authDeadEnd\);/.test(src) && /c\.status = 'skipped';\n\s*c\.error = _authDeadEnd;/.test(src), true);
  const auth = fs.readFileSync(path.join(path.dirname(process.argv[2]), '../workday-engine/src/workday/auth.ts'), 'utf8');
  eq('the engine no longer calls "might be locked" a lock', /const maybe = \/\\b\(might\|may\) be locked\\b\/i\.test\(errs\);/.test(auth), true);
  // Apply speed.
  eq('after Apply Manually the opener moves on the moment the choice is gone (was a 10.5s wait)', /await waitUntil\(\(\) => hasApplicationForm\(\) \|\| !findApplyManually\(\), 9000, 150\);/.test(body('openApplicationForm__impl')) && !/await sleep\(scaled\(1500, 750\)\);\n\s*if \(hasApplicationForm\(\)\) return true;/.test(body('openApplicationForm__impl')), true);
}



/* ── 84. v17.35: major-ATS replica sweep fixes ── */
console.log('v17.35: Ashby name / Yes-No buttons / picked location, Lever radios and city, EEO selects, "Why <Company>?"');
{
  // guessValue run for real, out of the same block section 20 lifts.
  const g = { company: 'Anthropic' };
  try {
    new Function('exports', `
      const getFullQuestionText = () => '', getLabel = () => '', LOG = () => {}, queue = [], workAuthorisationAnswer = () => '';
      const extractJDCompany = () => exports.company, extractJDTitle = () => '', isFieldRequired = () => false;
      const location = { hostname: 'job-boards.greenhouse.io', pathname: '/anthropic/jobs/1', search: '', href: 'https://job-boards.greenhouse.io/anthropic/jobs/1' };
      const document = { title: 'Research Engineer - Anthropic', querySelector: () => null, querySelectorAll: () => [] };
      const DEFAULTS = { years: '9', why: 'I admire the company culture and the opportunity to make a meaningful impact.', country: 'United Kingdom', cover: 'c', howHeard: 'LinkedIn', salary: '1' };
      ${src.slice(shapeStart, shapeEnd)}
      Object.assign(exports, { guessValue, pageCompanyName });
    `)(g);
  } catch (e) { g.err = e.message; }
  const P = { first_name: 'Max', last_name: 'Okafor', city: 'London', country: 'United Kingdom' };
  const gv = g.guessValue;
  g.guessValue = gv && ((l, p) => { try { return gv(l, p); } catch (e) { return 'ERR ' + e.message; } });
  if (g.guessValue) {
    eq('Ashby\'s "Name*" gets the full name (the * left it empty)', g.guessValue('Name*', P), 'Max Okafor');
    eq('"Why Anthropic?" names the company, not the generic line', /Anthropic's mission/.test(g.guessValue('Why Anthropic?', P)), true);
    g.company = '';
    eq('with nothing in the description, the board\'s path names the employer (job-boards.greenhouse.io/anthropic)', g.pageCompanyName(), 'Anthropic');
    g.company = 'Anthropic';
    eq('…but "Why are you leaving your current role?" is not a why-us answer', /mission/.test(g.guessValue('Why are you leaving?', P) || ''), false);
  } else {
    eq('guessValue runs out of the shipped block (' + g.err + ')', false, true);
  }
  const bq = body('answerButtonStyleQuestions');
  eq('Ashby\'s bare Yes/No button row is found as a question', /\[class\*="yesno" i\]/.test(bq), true);
  eq('…its question is read from the title above it', /question-title/.test(bq) && /rest\.length >= 8/.test(bq), true);
  eq('…and an already-picked button ("_active") is left alone', /button\[class\*="_active"\]/.test(bq), true);
  const rl = body('resolveLocationFields');
  eq('a combobox holding only a typed word is picked from its list', /const typedOnly = !_locPicked\.has\(inp\)/.test(rl) && /_locPicked\.add\(inp\)/.test(rl), true);
  // The exact town beats a place named after it.
  const m = {};
  new Function('exports', `const NOT_A_PLACE_RE = ${src.match(/const NOT_A_PLACE_RE = (\/.*\/i);/)[1]}; ${body('pickPlaceSuggestion')} exports.pick = pickPlaceSuggestion;`)(m);
  const rows = ['London Bridge, London, UK', 'London, England, United Kingdom', 'London, Ontario, Canada'].map((t) => ({ textContent: t }));
  eq('"London, United Kingdom" picks London, not London Bridge or London Ontario', m.pick(rows, 'London, United Kingdom').textContent, 'London, England, United Kingdom');
  eq('Lever\'s location picker scores its rows the same way', /pickPlaceSuggestion\(rows,/.test(body('leverLocation')), true);
  const kr = body('answerKnockoutRadioGroup');
  eq('a radio group whose box holds only "Yes No" climbs to the real question', /strip\(questionText\)\.length < 12/.test(kr), true);
  const ff = body('fallbackFill__impl');
  eq('EEO selects are not matched on a shared word ("not" → "White (Not Hispanic)")', /if \(!opt && !isEEO\)/.test(ff) && /STOPW/.test(ff), true);
  // A select's own options, not the page's.
  eq('deepAll(\'option\', select) is gone — it returned every option on the page', /deepAll\('option', (el|sel|inp)\)/.test(src), false);
  const ms = {};
  new Function('exports', `const PLACEHOLDER_OPT_RE = /^(select|choose|— make a selection —|-+)$/i; const toDays = () => NaN; const normMoney = (x) => x;
    ${src.match(/  const EDU_RANKS = \[[\s\S]*?\n  const eduRank = [^\n]*\n/)[0]} ${body('bestOptionIndex')} exports.best = bestOptionIndex;`)(ms);
  const edu = ['— Make a Selection —', 'High School', "Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate'];
  eq('Jobright\'s "Masters" picks "Master\'s Degree" (it got "High School")', edu[ms.best(edu, 'Masters', 'Highest level of education completed')], "Master's Degree");
  eq('…and the required-field pass asks the profile before taking the first option', /bestOptionIndex\(texts, profileTargetFor\(lbl, p\), lbl\)/.test(body('guaranteeRequiredFieldsPass')), true);
  eq('Submit is also looked for inside a same-origin frame (iCIMS)', /for \(const r of fieldRoots\(\)\.slice\(1\)\)/.test(body('autoSubmitOrNext__impl')), true);
  const lf = body('isLocationField');
  eq('"Race/Ethnicity" is not a location box (ethni-CITY) — Oracle got "London, United Kingdom" in it', /hay\.replace\(\/ethnicity\|ethnicities\|relocat/.test(lf) && /test\(hayPlace\)/.test(lf), true);
  const rf = body('refineAnswerForControl');
  eq('a date box never gets words with a number in them ("1 month notice" in BambooHR\'s mm/dd/yyyy)', /if \(v && !\/\\d\{1,4\}/.test(rf) && !/if \(v && !\/\\d\/\.test\(v\)/.test(rf), true);
  eq('a missing Jobright Autofill button is waited for once per page, not on every retry', /_autofillMissHref === location\.href/.test(body('triggerAutofill__impl')), true);
}



/* ── 85. v17.36: every ATS waits on the page, not the clock ── */
console.log('v17.36: faster on every ATS — the waits end when the page is ready');
{
  const ta = body('triggerAutofill__impl');
  eq('Jobright\'s Autofill button is clicked the moment it is ready (200ms checks, not 1.5s sleeps)', /setTimeout\(r, 200\)/.test(ta) && !/await sleep\(scaled\(1500, 750\)\)/.test(ta) && !/attempt < 5/.test(ta), true);
  eq('…and given up on after ~6s, not ~13s', /Date\.now\(\) \+ \(sb \? 6000 : 1500\)/.test(ta), true);
  const tf = body('tailorFirstFlow');
  eq('no flat 2s after the sidebar appears — it waits for its buttons', /await waitUntil\(\(\) => findAutofillButton\(\)/.test(tf) && !/await sleep\(scaled\(2000, 1000\)\);\n\n\s*\/\/ Step 1/.test(tf), true);
  eq('Jobright\'s fill is waited for only when it was started', /if \(jrFired\) await waitForJobrightFill\(sidebar\);/.test(tf), true);
  eq('…and only while its button reads "Filling…"', /if \(!idle\) started = true;/.test(body('waitForJobrightFill')), true);
  eq('a second fill pass only when the first changed something', /if \(\(await fallbackFill\(\)\) > 0\)/.test(tf) && /if \(\(await fallbackFill\(\)\) > 0\)/.test(body('directAutofillFlow')), true);
  eq('the direct flow no longer sleeps 5s after a click that never happened', !/await sleep\(scaled\(5000, 2500\)\)/.test(body('directAutofillFlow')), true);
  for (const fn of ['greenhouseAutomation', 'ashbyAutomation', 'bamboohrAutomation', 'jobviteAutomation'])
    eq(`${fn} starts once the form stops changing (was a flat 1.5s)`, /await waitForFormStable\(1200\);/.test(body(fn)), true);
  eq('iCIMS looks for its form inside the application frame (an 8s wait every job)', /await waitUntil\(\(\) => deepAll\('\.iCIMS_InfoMsg_Job/.test(body('icimsAutomation')), true);
  const NT = new RegExp(src.match(/const NOT_A_TITLE_RE = \/(.*)\/i;/)[1], 'i');
  eq('a job link is never used as the job title in the cover note', NT.test('job-boards.greenhouse.io/acme/jobs/4412392009') && NT.test('https://jobs.lever.co/x/1'), true);
  eq('…while real titles still are', NT.test('Senior Data Engineer') || NT.test('IT Lead - Supply Chain (US Remote)') || NT.test('Sr. Engineer, Node.js / React'), false);
  eq('SpeedyApply mode presses Next after 4s of quiet (was 6s)', /const STILL_MS = scaled\(4000, 2500\);/.test(body('workdaySpeedyApplyRun')), true);
}



/* ── 86. v17.37: a careers home is not a job (Workday "HTTP ERROR 406") ── */
console.log('v17.37: the Jobright page\'s link is a job, not the company\'s careers home');
{
  const m = {};
  const nextData = { props: { pageProps: { company: { name: 'College Board', jobUrl: 'https://collegeboard.wd1.myworkdayjobs.com' },
    job: { title: 'Engineer', applyLink: 'https://collegeboard.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_REQ-1234' } } } };
  new Function('exports', `
    const location = { href: 'https://jobright.ai/jobs/info/abc' };
    const document = {
      getElementById: (id) => (id === '__NEXT_DATA__' ? { textContent: exports.data } : null),
      querySelectorAll: () => exports.links || [],
    };
    ${body('looksLikeJobLink')}${body('jobrightApplyTarget')}
    Object.assign(exports, { looksLikeJobLink, jobrightApplyTarget });
  `)(Object.assign(m, { data: JSON.stringify(nextData) }));
  eq('the bare https://collegeboard.wd1.myworkdayjobs.com is not a job', m.looksLikeJobLink('https://collegeboard.wd1.myworkdayjobs.com'), false);
  eq('…nor its careers-site home', m.looksLikeJobLink('https://collegeboard.wd1.myworkdayjobs.com/en-US/Careers'), false);
  eq('a Workday /job/ link is', m.looksLikeJobLink('https://collegeboard.wd1.myworkdayjobs.com/en-US/Careers/job/NY/Engineer_REQ-1234'), true);
  eq('Greenhouse / Lever / Ashby job links still are', ['https://job-boards.greenhouse.io/acme/jobs/4412392011', 'https://jobs.lever.co/acme/1a2b', 'https://jobs.ashbyhq.com/acme/0d1e'].every(m.looksLikeJobLink), true);
  eq('a careers home on the employer\'s own site is not', m.looksLikeJobLink('https://www.acme.com/careers') || m.looksLikeJobLink('https://acme.com/'), false);
  eq('the job\'s applyLink wins over the company record\'s jobUrl', m.jobrightApplyTarget(), 'https://collegeboard.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_REQ-1234');
  m.data = JSON.stringify({ props: { company: { jobUrl: 'https://collegeboard.wd1.myworkdayjobs.com' } } });
  m.links = [{ href: 'https://collegeboard.wd1.myworkdayjobs.com/', textContent: 'College Board careers' }];
  eq('with only the careers home, nothing is opened (Jobright\'s own Apply is used)', m.jobrightApplyTarget(), '');
}



/* ── 87. v17.38: SpeedyApply built in — it takes Workday over; Jobright's sign-up / sign-in ── */
console.log('v17.38: SpeedyApply built in — Workday account flow, profile pick, engine fallback');
{
  // Its saved Workday account goes first (after a site-specific login).
  eq('Create Account uses SpeedyApply\'s saved password on Workday', /const sa = await saWorkdayAccount\(\);\n\s*if \(sa\) return sa\.password;/.test(body('getAppPassword')), true);
  eq('…and its email', /const sa = await saWorkdayAccount\(\);\n\s*if \(sa\) return sa\.email;/.test(body('getAppEmail')), true);
  eq('sign-in tries the password that worked here before, then SpeedyApply\'s', body('workdayPasswordCandidates').indexOf('WD_SITE_PW_KEY') < body('workdayPasswordCandidates').indexOf('saWorkdayAccount'), true);
  eq('"use profile email" is honoured', /a\.useProfileEmail \? prof && prof\.contactData && prof\.contactData\.email : a\.accountEmail/.test(body('saSettings')), true);
  // The account page is handled at once: SpeedyApply only types, never presses.
  const sa = body('workdaySpeedyApplyRun');
  eq('SpeedyApply mode presses Create Account / Sign In after 1.5s, not 6s', /quiet > \(_wdCreatedThisJob \|\| _saAccountTurns \? 2000 : 1500\)/.test(sa), true);
  eq('no profile in SpeedyApply → the job fails saying so (Jobright does not fill in its place)', /return cannot\('SpeedyApply has no profile yet/.test(sa), true);
  eq('premium with no profile it can pick → the job fails saying so (sign in to SpeedyApply)', /cfg && cfg\.premium && !\(await saAutoPickProfile\(\)[\s\S]{0,40}\)\)\n\s+return cannot\(/.test(sa), true);
  eq('handed back → SpeedyApply no longer counts as present (the account watcher works for the engine)', /!_saDeclined && \(/.test(src.match(/const speedyApplyPresent = [^\n]+/)[0]), true);
  eq('on Workday Jobright\'s own autofill stands aside for SpeedyApply', /if \(_saDriving \|\| saOwnsWorkday\(\)\) return true;/.test(src), true);
  // The profile pick, run for real against a fake SpeedyApply.
  const run = async (answers) => {
    const sent = [];
    const m = {};
    new Function('exports', `
      const LOG = (x) => exports.logs.push(x); const location = { href: 'https://acme.wd1.myworkdayjobs.com/x/job/y/apply' };
      const saEmbedded = () => true;
      const chrome = { runtime: { lastError: undefined, sendMessage: (msg, cb) => { exports.sent.push(msg.type + (msg.profileId ? ':' + msg.profileId : '')); setTimeout(() => cb(exports.answers[msg.type]), 0); } } };
      ${body('saAutoPickProfile')}
      exports.pick = saAutoPickProfile;
    `)(Object.assign(m, { sent, answers, logs: [] }));
    const r = await m.pick();
    return { r, sent };
  };
  asyncChecks.push((async () => {
    const a = await run({ getSelectedProfile: undefined, premiumFetchJobScores: { scores: true, profiles: [{ id: 'p5', profileName: 'Data', score: 41 }, { id: 'p6', profileName: 'Product', score: 87 }] }, setSelectedProfile: { profileName: 'Product' } });
    eq('the best-scoring SpeedyApply profile is picked for the tab', a, { r: 'Product', sent: ['getSelectedProfile', 'premiumFetchJobScores', 'setSelectedProfile:p6'] });
    const b = await run({ getSelectedProfile: { profileName: 'Mine', profile: {} } });
    eq('a profile you already picked for the tab stands', b, { r: 'Mine', sent: ['getSelectedProfile'] });
    const c = await run({ premiumFetchJobScores: { error: 'Not authenticated' }, premiumFetchProfileList: [{ id: 'a1', profileName: 'First' }, { id: 'a2', profileName: 'Second' }], setSelectedProfile: {} });
    eq('no scores → your first profile', c.sent, ['getSelectedProfile', 'premiumFetchJobScores', 'premiumFetchProfileList', 'setSelectedProfile:a1']);
    const d = await run({});
    eq('signed out (nothing to pick) → "" so the engine applies', d.r, '');
  })().catch((e) => eq('the SpeedyApply profile pick runs', String(e && e.message), '')));
  eq('SpeedyApply\'s settings / popup are a right-click away', /id: 'ua-sa-settings'/.test(orch) && /options\.html#\/profile/.test(orch) && /popup\.html/.test(orch), true);
  eq('our menu setup removes only our own items (SpeedyApply\'s stay)', /removeOurMenus\(\(\) => \{/.test(orch) && !/chrome\.contextMenus\.removeAll\(/.test(orch), true);
}



/* ── 88. v17.39: Workday is SpeedyApply's only — Jobright fills nothing there ── */
console.log('v17.39: Workday = SpeedyApply only; this extension signs in / creates the account and presses the buttons');
{
  eq('one switch: Workday + "let SpeedyApply fill" + SpeedyApply built in (or on the page)', /return isWorkday\(\) && _saModeOn && \(saEmbedded\(\) \|\| speedyApplyPresent\(\)\);/.test(body('saOwnsWorkday')), true);
  for (const fn of ['fallbackFill', 'resolveDependentQuestions'])   // the wrappers (body() returns the __impl)
    eq(`${fn} does nothing on SpeedyApply's Workday`, new RegExp('async function ' + fn + '\\(\\.\\.\\.a\\) \\{\\n\\s+if \\(saOwnsWorkday\\(\\)\\) return').test(src), true);
  for (const fn of ['multiPageLoop', 'workdayEngineRun', 'wdEnginePass', 'workdayMultiPageFlow'])
    eq(`${fn} does nothing on SpeedyApply's Workday`, /^\s+if \(saOwnsWorkday\(\)\) return/m.test(body(fn).split('\n').slice(1, 3).join('\n')), true);
  for (const fn of ['guaranteeRequiredFields', 'fillCustomDropdowns', 'handleValidationErrors', 'autoSubmitOrNext'])
    eq(`${fn} does nothing on SpeedyApply's Workday`, new RegExp('async function ' + fn + '\\(\\.\\.\\.a\\) \\{ if \\(saOwnsWorkday\\(\\)\\) return').test(src), true);
  eq('no page walk after the Workday driver', /if \(saOwnsWorkday\(\)\) return;\s+\/\/ Workday: SpeedyApply's pages/.test(body('dispatchATSAutomation')), true);
  eq('no engine assist either', /!_uaJobKey && !saOwnsWorkday\(\) && window\.__uaWdEngine/.test(body('workdayAutomation')), true);
  const sa = body('workdaySpeedyApplyRun');
  eq('SpeedyApply mode never hands a built-in job to the engine', !/using the Workday engine for this job/.test(sa), true);
  eq('fully automated: required fields SpeedyApply left empty — only those — are answered, then Next is pressed',
    /_saLeftoverPass = true;\n\s+try \{ await wdEnginePass\(await getProfile\(\)\); await fallbackFill\(\); \} catch \(_\) \{\} finally \{ _saLeftoverPass = false; \}/.test(sa) && /if \(_saLeftoverPass\) return false;/.test(body('saOwnsWorkday')), true);
  eq('…SpeedyApply\'s saved responses (its responseList) are in the answer bank, loaded last so they win', /'responses', 'responseList'\]/.test(body('loadAnswerBank')), true);
  eq('Jobright\'s sidebar is tucked on Workday from page load, not only in a run', /tuckJobrightOnWorkday\(\);\n\s+try \{ if \(!window\.__uaJrTuckTimer\)/.test(body('workdayAutomation')), true);
  eq('…unless you open it from the toolbar icon', /_jrUserShown = true;/.test(src) && /if \(_jrUserShown \|\| !saOwnsWorkday\(\)\) return;/.test(body('tuckJobrightOnWorkday')), true);
  eq('the buttons SpeedyApply does not press are pressed: account, Apply Manually, Save and Continue, Submit',
    /await fillWorkdayCreateAccount\(true\)/.test(sa) && /await clickApplyManually\(\)/.test(sa) && /pressing \$\{isSubmit \? 'Submit' : 'Save and Continue'\}/.test(sa), true);
  eq('Jobright\'s sidebar is tucked away while SpeedyApply fills, so its "Autofill in progress…" shows', /tuckJobrightOnWorkday\(\);/.test(sa) && /el\.style\.display = 'none'/.test(body('tuckJobrightForSpeedyApply')) && /!\(_saDriving && host\.getAttribute\('data-ua-sa-tucked'\)\)/.test(body('forceOpenSidebar')), true);
  eq('errors SpeedyApply left fail the job only when nobody is answering them', /Date\.now\(\) - errorsSince > STUCK_MS && quiet > 30000/.test(sa), true);
  eq('SpeedyApply add-on\'s "N required fields need you" box is hidden (its file unchanged)', /st\.textContent = '#sa-status\{display:none!important\}';/.test(src), true);
  eq('…but never on a step showing errors (that would only re-validate an empty field)', sa.indexOf('} else if (wdPageErrors()) {') < sa.indexOf('} else if (quiet > STILL_MS && pressed < 3) {'), true);
}


setTimeout(() => Promise.all(asyncChecks).then(() => {
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}), 50);
