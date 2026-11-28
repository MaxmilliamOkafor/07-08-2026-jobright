/* v17.82 — the Workday engine and a Submit button on a step that is not Review.
   It ended the run with no word ("the engine stopped on this page without
   finishing") and the built-in flow had to finish the job. Now that step is the
   last one: submitted when the run may submit, held for you when it may not, and
   off a non-Review step only Workday's own confirmation counts as sent.

   Usage: node tests/v1782.test.js "<extension dir>" */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = process.argv[2];
const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');
const ts = fs.readFileSync(path.join(EXT, '../workday-engine/src/workday/engine.ts'), 'utf8');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const body = (code, name) => {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l));
  if (start < 0) throw new Error('no ' + name);
  const end = lines.findIndex((l, i) => i > start && l === '  }');
  return lines.slice(start, end + 1).join('\n');
};

/* submitOrHold, run with stand-ins for what it calls. */
async function lastStep({ autoSubmit, page = 'myInformation' }) {
  const calls = [];
  const c = {
    hooks: { autoSubmit: () => autoSubmit },
    submitApplication: async (ctx, btn, from) => { calls.push(['submit', from]); return 'stop'; },
    holdForReview: async () => { calls.push(['hold']); return 'stop'; },
  };
  vm.createContext(c);
  vm.runInContext(body(eng, 'submitOrHold') + '\nthis.f = submitOrHold;', c);
  const logs = [];
  const r = await c.f({ page, log: (m) => logs.push(m) }, {});
  return { r, calls, logs };
}

(async () => {
  console.log('Submit on a step that is not Review');
  eq('clickNext hands it to submitOrHold (no more quiet stop)', /if \(isSubmitButton\(btn\)\) return submitOrHold\(ctx, btn\);/.test(body(eng, 'clickNext')), true);
  let x = await lastStep({ autoSubmit: true });
  eq('a queue job (may submit): submitted, from this step', x.calls, [['submit', 'myInformation']]);
  eq('…and the log says why', /Submit is on this step \(myInformation\)/.test(x.logs.join('\n')), true);
  x = await lastStep({ autoSubmit: false });
  eq('a run that may not submit: held for you, as on Review', x.calls, [['hold']]);

  console.log('\nwhat counts as sent');
  const sa = body(eng, 'submitApplication');
  eq('Review is still the default step', /async function submitApplication\(ctx, btn, from = "review"\)/.test(sa), true);
  eq('"moved" is measured from the step Submit was pressed on', /const moved = \(\) => detectPage\(\) !== from/.test(sa), true);
  eq('off a non-Review step, only Workday\'s confirmation counts (no "left the page" guess)', /outcome === "timeout" && from === "review" && detectPage\(\) !== "review"/.test(sa), true);
  eq('Review still holds for you when the run may not submit', /return holdForReview\(ctx, btn\);/.test(eng.slice(eng.indexOf('case "review": {'), eng.indexOf('case "review": {') + 900)), true);

  console.log('\nthe source matches the bundle');
  eq('engine.ts: submitOrHold', /async function submitOrHold\(ctx: Ctx, btn: HTMLElement\)/.test(ts) && /if \(isSubmitButton\(btn\)\) return submitOrHold\(ctx, btn\);/.test(ts), true);
  eq('engine.ts: submitApplication from a step', /from: PageKind = "review"/.test(ts) && /from === "review" && detectPage\(\) !== "review"/.test(ts), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
