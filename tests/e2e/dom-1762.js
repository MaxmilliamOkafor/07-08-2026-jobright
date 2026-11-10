/* v17.62 real-DOM checks: the shipped functions run in Chromium against small
   copies of the page shapes that went wrong on 9 Nov.
   Usage: node tests/e2e/dom-1762.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../AAAA - Jobright Autofill/ua-enhancement.js'), 'utf8');
const fn = (n) => { const m = new RegExp('^  (async )?function ' + n + '\\(', 'm').exec(src); let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) return src.slice(m.index, j + 1); } };
const lib = `
  const isVisible = (el) => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const getLabel = (el) => (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || el.getAttribute('aria-label') || '';
  ${src.match(/  const QTEXT_CTRL_SEL = [^\n]*\n/)[0]}
  ${src.match(/  const NOT_APPLICATION_SUBMIT_RE = [^\n]*\n/)[0]}
  ${['visibleTextOf', 'holdsOtherFields', 'getFullQuestionText', 'controlLabel', 'notAnApplicationSubmit', 'applyLinkBehind'].map(fn).join('\n')}
  window.T = { getFullQuestionText, notAnApplicationSubmit, applyLinkBehind };
`;
const PAGE = `<!doctype html><meta charset="utf-8"><body>
<!-- Pinpoint: one fieldset around the whole section, labels not tied to boxes, a data script inside -->
<fieldset id="pin"><legend>1.Personal Details</legend><p>We'll need these details.</p>
  <div><span>First Name</span><input id="pfn" aria-label="First Name"></div>
  <div><span>Last Name</span><input id="pln" aria-label="Last Name"></div>
  <div><span>Phone</span><input id="pph" type="tel" aria-label="Phone"></div>
  <script type="application/json">{"railsEnv":"production"}</script>
  <div><span>Cover Letter</span><textarea id="pcl" aria-label="Cover Letter"></textarea></div>
</fieldset>
<!-- Current Vacancies: the field's own block carries an inline script -->
<div class="form-group" id="cv"><label for="pc">Postcode *</label><script>function checkpostcode(inElement) { var sPostcode = 1; }</script><input id="pc"></div>
<!-- a normal one-field block is unchanged -->
<div class="form-group"><label for="one">Why do you want to work here?</label><p>In 5 sentences or less.</p><textarea id="one"></textarea></div>
<!-- companions: dial code beside the phone box -->
<div class="field"><label for="ph2">Phone</label><select id="cc"><option>+353</option></select><input id="ph2" type="tel"></div>
<!-- two names in one row are two fields -->
<div class="form-group"><span>First name</span><input id="r1" aria-label="First name"><span>Last name</span><input id="r2" aria-label="Last name"></div>
<!-- a radio question keeps its container -->
<fieldset><legend>Do you have the right to work in the UK?</legend><label><input type="radio" name="rtw" id="ry">Yes</label><label><input type="radio" name="rtw">No</label></fieldset>
<!-- EY / SuccessFactors: Apply is a dropdown toggle carrying the link -->
<div class="btn-group btn-social-apply"><button id="ey" class="btn dropdown-toggle" data-toggle="dropdown" href="/talentcommunity/apply/1453896933/?locale=en_GB">Apply now</button>
  <ul><li><a href="#">Start applying with LinkedIn</a></li><li><a href="#">Apply Now</a></li></ul></div>
<a id="plain" href="/apply/1">Apply now</a>
<div class="dropdown"><button id="li" class="dropdown-toggle" aria-haspopup="true">Apply</button><ul><li><a href="https://www.linkedin.com/apply/1">Apply with LinkedIn</a></li></ul></div>
<!-- syntax.com: a job search form -->
<form role="search" action="/search/"><input name="locationsearch" aria-label="Search by Location"><input id="srch" type="submit" value="Search Jobs"></form>
<form action="/alerts"><input name="e"><input id="alert" type="submit" value="Create Alert"></form>
<form action="/apply/submit"><input name="n"><input id="real" type="submit" value="Submit Application"><button id="real2" type="submit">Submit</button></form>
</body>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://careers.example.com/ey/job/Hoboken/1453896933/');
  await page.addScriptTag({ content: lib });
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
  const q = (id) => page.evaluate((i) => window.T.getFullQuestionText(document.getElementById(i)), id);

  console.log('a question is the field\'s own text');
  ok((await q('pfn')) === 'First Name', 'Pinpoint first name: "' + (await q('pfn')) + '"');
  ok((await q('pln')) === 'Last Name', 'Pinpoint last name');
  ok((await q('pph')) === 'Phone', 'Pinpoint phone');
  ok(!/cover letter/i.test(await q('pfn')), '…no "Cover Letter" from the same section');
  ok((await q('pc')) === 'Postcode *', 'Current Vacancies postcode has no script text: "' + (await q('pc')) + '"');
  ok((await q('one')) === 'Why do you want to work here?In 5 sentences or less.' || /Why do you want to work here\?\s*In 5 sentences or less\./.test(await q('one')), 'a one-field block still gives its whole question');
  ok(/^Phone/.test(await q('ph2')), 'a dial-code select beside the phone box is a companion, not another field');
  ok((await q('r1')) === 'First name' && (await q('r2')) === 'Last name', 'two names in one row are two questions');
  ok(/right to work in the UK/.test(await q('ry')), 'a radio question keeps its container');

  console.log('an Apply button that only opens a menu');
  const link = (id) => page.evaluate((i) => window.T.applyLinkBehind(document.getElementById(i)), id);
  ok((await link('ey')) === 'https://careers.example.com/talentcommunity/apply/1453896933/?locale=en_GB', 'EY: the toggle\'s own link is followed');
  ok((await link('plain')) === '', 'a plain Apply link is not a menu');
  ok((await link('li')) === '', 'a menu with only "Apply with LinkedIn" gives nothing');

  console.log('a search button is never the application\'s Submit');
  const not = (id) => page.evaluate((i) => window.T.notAnApplicationSubmit(document.getElementById(i)), id);
  ok((await not('srch')) === true, '"Search Jobs" in a search form');
  ok((await not('alert')) === true, '"Create Alert"');
  ok((await not('real')) === false && (await not('real2')) === false, '"Submit Application" and "Submit" are still pressed');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
