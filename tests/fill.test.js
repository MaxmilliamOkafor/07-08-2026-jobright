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

/* Body of a top-level function in the module (2-space indent, closes on "  }"). */
function body(name) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l));
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
  'guaranteeRequiredFields', // last-resort filler before submit
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
  /if \(waited < HUMAN_GRACE_MS\) continue;/.test(orch), true);
eq('but the wait is bounded', /HUMAN_GRACE_MS = 15 \* 60 \* 1000/.test(orch), true);
eq('a new run clears stale needs-you markers', /delete j\.needsHuman;/.test(orch), true);
eq('no CAPTCHA-solving is attempted (no solver service, no token injection)',
  /2captcha|anticaptcha|capmonster|deathbycaptcha|g-recaptcha-response\s*=/i.test(src), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
