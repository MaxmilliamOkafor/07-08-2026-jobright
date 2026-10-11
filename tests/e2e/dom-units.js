/* Real-DOM checks for logic that depends on layout (hit-testing, visibility),
   which the node tests cannot model: the shipped functions are lifted out of
   ua-enhancement.js and run in Chromium against small pages.
   Usage: node tests/e2e/dom-units.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../AAAA - Jobright Autofill/ua-enhancement.js'), 'utf8');
const fn = (n) => { const m = new RegExp('^  (async )?function ' + n + '\\(', 'm').exec(src); let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) return src.slice(m.index, j + 1); } };
const lib = `
  const deepAll = (sel, cap) => [...document.querySelectorAll(sel)].slice(0, cap || 500);
  const isVisible = (el) => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  ${src.match(/  const WD_STEP_LABELS = [^\n]*\n/)[0]}
  ${['normLabel', 'safeClass', 'isSelect2Native', 'coveredBy', 'describeControl', 'workdayOnAccountWall', 'workdayApplicationReady'].map(fn).join('\n')}
  window.T = { coveredBy, describeControl, workdayOnAccountWall, workdayApplicationReady };`;
let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); } };
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const run = async (html, expr) => { await page.setContent(html); await page.addScriptTag({ content: lib }); return page.evaluate(expr); };

  console.log('Workday: the account wall vs the application');
  eq('a visible password box is the wall', await run('<div data-automation-id="applyFlowContainer"><input type=email><input type=password></div>', 'T.workdayApplicationReady()'), false);
  eq('the step bar naming two steps is the application', await run('<div data-automation-id="progressBar">My Information My Experience Application Questions Review</div><input>', 'T.workdayApplicationReady()'), true);
  eq('a step heading is the application', await run('<h2 data-automation-id="pageHeaderTitle">My Information</h2>', 'T.workdayApplicationReady()'), true);
  eq('three Workday form fields are the application', await run('<div data-automation-id="formField-legalName"><input></div><div data-automation-id="formField-email"><input></div><div data-automation-id="formField-phone"><input></div>', 'T.workdayApplicationReady()'), true);
  eq('a sign-in dialog left mounted but hidden does not count as the wall',
    await run('<div style="display:none"><input type=password></div><h2 data-automation-id="pageHeaderTitle">My Experience</h2>', 'T.workdayApplicationReady()'), true);

  console.log('what is covering a control');
  const cover = '<button id=b style="position:absolute;top:100px;left:10px">Submit</button>';
  eq('nothing on top → nothing', await run(cover, 'T.coveredBy(document.getElementById("b"))'), '');
  eq('a cookie banner on top is named', await run(cover + '<div id="onetrust-banner-sdk" style="position:fixed;inset:0;background:#000">We use cookies</div>', 'T.coveredBy(document.getElementById("b"))'), 'a cookie banner');
  eq('a modal on top is named', await run(cover + '<div role="dialog" style="position:fixed;inset:0;background:#000">Hi</div>', 'T.coveredBy(document.getElementById("b"))'), 'a dialog');
  eq('its own label is not an obstruction', await run('<label style="position:relative;display:block"><input type=checkbox id=b> I agree<span style="position:absolute;inset:0"></span></label>', 'T.coveredBy(document.getElementById("b"))'), '');

  console.log('describing a control without its contents');
  eq('select2', await run('<select id=s class="select2-hidden-accessible" required><option>a</option></select><span class="select2-container" style="display:block">x</span>', 'T.describeControl(document.getElementById("s"))'), 'select2 · required · 1 options');
  eq('a covered required text box', await run('<input id=b required style="position:absolute;top:100px"><div class="modal" style="position:fixed;inset:0"></div>', 'T.describeControl(document.getElementById("b"))'), 'text box · required · covered by a dialog');
  eq('a Workday field', await run('<div data-automation-id="formField-city"><input id=b aria-invalid=true></div>', 'T.describeControl(document.getElementById("b"))'), 'workday text · marked invalid');
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
