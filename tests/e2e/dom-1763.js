/* v17.63 real-DOM checks: the shipped pick-list and location functions run in
   Chromium against copies of the Phenom school box and TeamTailor's
   "Standorte" checkboxes.
   Usage: node tests/e2e/dom-1763.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../AAAA - Jobright Autofill/ua-enhancement.js'), 'utf8');
const fn = (n) => { const m = new RegExp('^  (async )?function ' + n + '\\(', 'm').exec(src); let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) return src.slice(m.index, j + 1); } };
const line = (name) => src.match(new RegExp('  const ' + name + ' = [^\\n]*\\n'))[0];
const lib = `
  const LOG = () => {}, DIAG = () => {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)], $ = (s, r) => (r || document).querySelector(s);
  const deepAll = (s) => [...document.querySelectorAll(s)], deepOne = (s) => document.querySelector(s);
  const isVisible = (el) => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const getLabel = (el) => (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || el.getAttribute('aria-label') || '';
  const scrollIfNeeded = () => {};
  const realClick = (el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); };
  const isWorkday = () => false, isSelectSearchBox = () => false, isTransientSearchBox = () => false;
  const nativeSet = (el, v) => { if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type || '')) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return true; };
  const wdNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\\s+/g, ' ').trim();
  const guessFieldValue = () => '';
  ${line('PICK_LIST_HINT_RE')}${line('PICK_LIST_SUBJECT_RE')}${line('PICK_OTHER_RE')}
  const _pickTries = new WeakMap();
  ${['isYesNoLocationQuestion', 'isLocationField', 'typeInto', 'waitUntil', 'findAutocompleteDropdown', 'wdSimilarity', 'wdBestIndex', 'isPickListField', 'pickListValue', 'pickListItems', 'pickListSearch', 'pickListClick', 'commitPickList'].map(fn).join('\n')}
  window.T = { isLocationField, isPickListField, pickListValue, commitPickList };
`;
const PAGE = `<!doctype html><meta charset="utf-8"><body>
<style>.lb{border:1px solid #ccc;margin:0;padding:0;list-style:none}.lb li{padding:2px}</style>
<div class="field" id="f1"><label for="s1">School or University*</label><input id="s1" role="combobox" aria-controls="l1" autocomplete="off">
  <p>Please select "Other" from the list if no results are found</p><ul id="l1" class="lb" role="listbox" hidden></ul></div>
<div class="field" id="f2"><label for="s2">School or University*</label><input id="s2" role="combobox" aria-controls="l2" autocomplete="off">
  <p>Please select "Other" from the list if no results are found</p><ul id="l2" class="lb" role="listbox" hidden></ul></div>
<div class="field" id="f3"><label for="s3">Institution*</label><input id="s3" role="combobox" aria-controls="l3" autocomplete="off"><ul id="l3" class="lb" role="listbox" hidden></ul></div>
<div class="field"><label for="city">City</label><input id="city"></div>
<fieldset><legend>Standorte*</legend>
  <label><input type="checkbox" id="c1" value="Düsseldorf">Düsseldorf</label>
  <label><input type="checkbox" id="c2" value="Köln">Köln</label></fieldset>
<script>
  const SCHOOLS = ['University of Derby', 'Derby College', 'University College Dublin', 'Imperial Valley College'];
  function wire(inp, ul, withOther) {
    let picked = '';
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase(); ul.innerHTML = '';
      if (!q) { ul.hidden = true; return; }
      const hits = SCHOOLS.filter((s) => s.toLowerCase().includes(q));
      if (withOther && 'other'.startsWith(q)) hits.push('Other');
      hits.forEach((h) => { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = h;
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => { picked = h; inp.value = h; ul.hidden = true; }); ul.appendChild(li); });
      ul.hidden = !hits.length;
    });
    // Phenom: text that was not picked from the list is cleared on blur.
    inp.addEventListener('blur', () => setTimeout(() => { if (inp.value !== picked) inp.value = ''; ul.hidden = true; }, 50));
  }
  wire(s1, l1, true); wire(s2, l2, true); wire(s3, l3, false);
</script></body>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://careers.example.com/us/en/apply');
  await page.addScriptTag({ content: lib });
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
  const ev = (f, arg) => page.evaluate(f, arg);
  const P = { education: [{ school: 'University of Derby' }, { school: 'Imperial College London' }] };

  console.log('which boxes are search-and-pick');
  ok(await ev(() => T.isPickListField(s1)), 'the Phenom school box (its "select Other" hint)');
  ok(await ev(() => T.isPickListField(s3)), 'a school-type combobox without the hint');
  ok(!(await ev(() => T.isPickListField(city))), 'a plain City box is not');

  console.log('each school box gets its own school');
  const v1 = await ev((p) => T.pickListValue(s1, 'School or University*', p), P); ok(v1 === 'University of Derby', 'first box → first school (' + v1 + ')');
  ok((await ev((p) => T.pickListValue(s2, 'School or University*', p), P)) === 'Imperial College London', 'second box → second school');

  console.log('picking');
  ok(await ev(() => T.commitPickList(s1, 'University of Derby')), 'your school is in the list: picked');
  await page.evaluate(() => s1.blur()); await page.waitForTimeout(150);
  ok((await ev(() => s1.value)) === 'University of Derby', '…and it stays after blur (not "Derby College")');
  ok(await ev(() => T.commitPickList(s2, 'Imperial College London')), 'not in the list: the list\'s own "Other"');
  await page.evaluate(() => s2.blur()); await page.waitForTimeout(150);
  ok((await ev(() => s2.value)) === 'Other', '…not "Imperial Valley College"');
  ok(!(await ev(() => T.commitPickList(s3, 'Imperial College London'))), 'no match and no "Other" offered: left for you');
  ok((await ev(() => s3.value)) === '', '…with the box clear, not a near-miss school');

  console.log('TeamTailor checkboxes');
  ok(!(await ev(() => T.isLocationField(c1))), 'a "Düsseldorf" checkbox is not a location box');
  ok(await ev(() => T.isLocationField(city)), 'the City box still is');
  ok((await ev(() => { nativeSet(c1, 'Dublin, Ireland'); return c1.value; })) === 'Düsseldorf', 'the checkbox still submits "Düsseldorf"');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
