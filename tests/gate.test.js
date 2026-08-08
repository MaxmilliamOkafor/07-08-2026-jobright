/* The Fully Automated toggle is the whole safety story: with it OFF, nothing may
   act on a page by itself. This exercises the master gate (window.__uaAutoAllowed)
   exactly as it is shipped — the IIFE is lifted out of ua-enhancement.js and run
   against a fake chrome.storage — plus the two rules that stop the switch moving
   on its own.

   Usage: node tests/gate.test.js "<ua-enhancement.js>" */
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const src = fs.readFileSync(process.argv[2], 'utf8');

/* The gate is the first IIFE in the file, between the banner and the main module. */
const startMarker = '(function () {\n  \'use strict\';\n  if (window.__uaAutoAllowed) return;';
const start = src.indexOf(startMarker);
if (start < 0) throw new Error('master automation gate not found — it must be the first IIFE');
const end = src.indexOf('\n})();', start);
if (end < 0) throw new Error('gate IIFE has no terminator');
const gateSrc = src.slice(start, end + '\n})();'.length);

function makeEnv({ storage = {}, windowName = '', autoAttr = null, storageThrows = false } = {}) {
  const listeners = [];
  const docEl = {
    _attrs: autoAttr ? { 'data-ua-auto': autoAttr } : {},
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
  };
  const chrome = {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get(keys, cb) {
          if (storageThrows) throw new Error('no storage');
          const out = {};
          for (const k of keys) out[k] = storage[k];
          // Deliberately asynchronous — the gate must be fail-closed until this lands.
          setTimeout(() => cb(out), 0);
        },
      },
      onChanged: { addListener: (l) => listeners.push(l) },
    },
  };
  const sandbox = { chrome, console, setTimeout, clearTimeout, document: { documentElement: docEl } };
  sandbox.window = sandbox;
  sandbox.window.name = windowName;
  vm.createContext(sandbox);
  vm.runInContext(gateSrc, sandbox);
  const fire = (changes) => listeners.forEach((l) => l(changes, 'local'));
  return { sandbox, fire, docEl };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  console.log('master automation gate');

  // Fail-closed before storage answers — a module booting at document_start must
  // not be able to act during the gap.
  {
    const env = makeEnv({ storage: { ua_aa: true } });
    eq('blocked before the preference has loaded', env.sandbox.window.__uaAutoAllowed(), false);
    eq('reason says so', env.sandbox.window.__uaAutoReason(), 'preference not loaded');
    await settle();
    eq('allowed once the stored ON is read', env.sandbox.window.__uaAutoAllowed(), true);
  }

  // The reported problem: toggle OFF, browsing lands on a recognised ATS.
  {
    const env = makeEnv({ storage: { ua_aa: false } });
    await settle();
    eq('toggle OFF → blocked', env.sandbox.window.__uaAutoAllowed(), false);
    eq('reason is the toggle', env.sandbox.window.__uaAutoReason(), 'toggle OFF');
  }

  // A missing/never-set preference is OFF, not ON.
  {
    const env = makeEnv({ storage: {} });
    await settle();
    eq('unset preference defaults to blocked', env.sandbox.window.__uaAutoAllowed(), false);
  }

  // Turning it on and off again takes effect immediately, in every tab.
  {
    const env = makeEnv({ storage: { ua_aa: false } });
    await settle();
    env.fire({ ua_aa: { newValue: true } });
    eq('switching ON unblocks without a reload', env.sandbox.window.__uaAutoAllowed(), true);
    env.fire({ ua_aa: { newValue: false } });
    eq('switching OFF blocks again immediately', env.sandbox.window.__uaAutoAllowed(), false);
  }

  // A CSV queue job owns its tab regardless of the toggle.
  {
    const env = makeEnv({ storage: { ua_aa: false }, autoAttr: '1' });
    await settle();
    eq('queue job tab is allowed with the toggle OFF', env.sandbox.window.__uaAutoAllowed(), true);
    eq('reason is the queue job', env.sandbox.window.__uaAutoReason(), 'queue job');
    env.docEl.removeAttribute('data-ua-auto');
    eq('and blocked again the moment the job releases the tab', env.sandbox.window.__uaAutoAllowed(), false);
  }

  // The in-page runner needs BOTH the run flag and the runner-tab tag, so an
  // ordinary tab opened during a run is not hijacked.
  {
    const env = makeEnv({ storage: { ua_aa: false, ua_qa: true }, windowName: 'UAQRUN::' });
    await settle();
    eq('runner tab during a run is allowed', env.sandbox.window.__uaAutoAllowed(), true);
  }
  {
    const env = makeEnv({ storage: { ua_aa: false, ua_qa: true }, windowName: '' });
    await settle();
    eq('a normal tab during a run is NOT hijacked', env.sandbox.window.__uaAutoAllowed(), false);
  }
  {
    const env = makeEnv({ storage: { ua_aa: false, ua_qa: false }, windowName: 'UAQRUN::' });
    await settle();
    eq('a stale runner tag with no run is blocked', env.sandbox.window.__uaAutoAllowed(), false);
  }

  // No storage access at all must not mean "assume on".
  {
    const env = makeEnv({ storageThrows: true });
    await settle();
    eq('storage failure stays blocked', env.sandbox.window.__uaAutoAllowed(), false);
  }

  /* ── the switch must not move by itself ────────────────────────────────── */
  console.log('toggle cannot turn itself back on');

  // Alt+A is a kill switch: it may turn automation OFF, never ON.
  const altA = src.match(/case 'a':\s*\n\s*e\.preventDefault\(\);\s*\n\s*if \(autoApply\) setAutoApply\(false[^\n]*\n\s*else LOG/);
  eq('Alt+A can only switch OFF', !!altA, true);
  eq('Alt+A no longer calls setAutoApply(true)', /setAutoApply\(!autoApply, true\)(?!,)/.test(src), false);

  // Exactly one place writes the preference, and it writes on every change.
  const writes = (src.match(/st\.set\(SK\.AA/g) || []).length;
  eq('the preference is written in exactly one place', writes, 1);
  eq('every setAutoApply call names its source', /setAutoApply\([^)]*\)/.test(src) &&
    !/setAutoApply\((?:!autoApply|e\.target\.checked|true|false), (?:true|false)\)\s*[;)]/.test(src), true);

  // The shortcut guard must see through shadow DOM, or typing in a
  // SmartRecruiters/Workday field flips the switch.
  eq('typing guard walks shadow roots', /shadowRoot\.activeElement/.test(src), true);
  eq('typing guard covers contenteditable', /isContentEditable/.test(src), true);

  // autoStopped must fail closed.
  const autoStopped = src.match(/function autoStopped\(\)[\s\S]{0,400}?\n  \}/);
  eq('autoStopped exists', !!autoStopped, true);
  eq('autoStopped fails closed on error', /catch \(_\) \{ return true; \}/.test(autoStopped ? autoStopped[0] : ''), true);
  eq('autoStopped defers to the master gate', /__uaAutoAllowed/.test(autoStopped ? autoStopped[0] : ''), true);

  /* ── autonomous modules consult the gate ───────────────────────────────── */
  console.log('autonomous modules respect the gate');
  const guarded = [
    ['autofill-confirm auto-dismiss', /findAndDismissPopup\(document\);?\s*\n?\s*\}\)/],
  ];
  // Each of these acted on any job-looking page regardless of the toggle.
  eq('autofill-confirm watcher is gated', /if \(!window\.__uaAutoAllowed \|\| !window\.__uaAutoAllowed\(\)\) \{\s*\n\s*console\.log\('\[UA\] autofill-confirm watcher not installed/.test(src), true);
  eq('chatbot answerer is gated', /if \(!window\.__uaAutoAllowed \|\| !window\.__uaAutoAllowed\(\)\) return;\s*\n\s*try \{ scanChatUI\(\); \}/.test(src), true);
  eq('work-authorisation auto-answer is gated', /function processAll\(\) \{[\s\S]{0,400}?__uaAutoAllowed\(\)\) return;/.test(src), true);
  eq('Fully-Automated dispatch hands the flag back', /finally \{\s*\n\s*if \(!ownedElsewhere\) setAutomationFlag\(false\);/.test(src), true);
  void guarded;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
