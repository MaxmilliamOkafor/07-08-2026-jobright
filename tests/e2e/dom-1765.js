/* v17.65 real-DOM check: the shipped hasApplicationForm/isJobSearchWidget in
   Chromium against a copy of a SuccessFactors job page (search + alert boxes
   above the job) and against a real three-field application.
   Usage: node tests/e2e/dom-1765.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../AAAA - Jobright Autofill/ua-enhancement.js'), 'utf8');
const fn = (n) => { const m = new RegExp('^  (async )?function ' + n + '\\(', 'm').exec(src); let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) return src.slice(m.index, j + 1); } };
const line = (name) => src.match(new RegExp('  const ' + name + ' = [^\\n]*\\n'))[0];
const lib = `
  const deepAll = (s) => [...document.querySelectorAll(s)];
  const isVisible = (el) => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const getLabel = (el) => (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || el.getAttribute('aria-label') || '';
  ${line('JOB_SEARCH_LABEL_RE')}${line('JOB_SEARCH_ATTR_RE')}
  ${['isJobSearchWidget', 'hasApplicationForm'].map(fn).join('\n')}
  window.T = { hasApplicationForm };`;
const SF = `<!doctype html><body><div class="keywordsearch-panel">
  <label for="keywordsearch-q">Search by Keyword</label><input id="keywordsearch-q" name="q">
  <label for="locationsearch-q">Search by Location</label><input id="locationsearch-q" name="locationsearch" value="Dublin, Dublin">
  <button>Search Jobs</button></div>
  <label for="alertFrequency">Select how often (in days) to receive an alert:</label><input id="alertFrequency" type="number" value="7"><button>Create Alert</button>
  <a class="btn" href="#">Apply now</a><h1>Lead AI Engineer</h1></body>`;
const FORM = `<!doctype html><body><label for="a">First Name</label><input id="a"><label for="b">Last Name</label><input id="b"><label for="c">Email</label><input id="c" type="email"></body>`;
(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true });
  const p = await b.newPage();
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
  await p.setContent(SF); await p.addScriptTag({ content: lib });
  ok(await p.evaluate(() => T.hasApplicationForm()) === false, 'SuccessFactors job page with search + alert boxes is not a form (so Apply now is pressed)');
  await p.setContent(FORM); await p.addScriptTag({ content: lib });
  ok(await p.evaluate(() => T.hasApplicationForm()) === true, 'a real three-field application is still a form');
  await b.close();
  console.log(`  dom-1765: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
