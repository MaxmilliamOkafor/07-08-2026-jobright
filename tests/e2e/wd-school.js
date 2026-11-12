/* v17.66 — Workday "School or University" in Chromium. A copy of Workday's
   search box: results appear only after Enter, a pick becomes a pill. The
   shipped engine (ua-wd-engine.js) is loaded into the page and its pickSchool
   is driven against four lists.
   Usage: node tests/e2e/wd-school.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path');
const ENGINE = fs.readFileSync(path.resolve(__dirname, '../../AAAA - Jobright Autofill/ua-wd-engine.js'), 'utf8');

const page = (schools) => `<!doctype html><meta charset="utf-8"><body>
<div data-automation-id="formField-school"><label for="s">School or University*</label>
  <div data-automation-id="multiselectInputContainer"><div id="pills"></div><input id="s" data-automation-id="searchBox" type="text"></div></div>
<div id="pop"></div>
<script>
  const SCHOOLS = ${JSON.stringify(schools)};
  const s = document.getElementById('s'), pop = document.getElementById('pop'), pills = document.getElementById('pills');
  s.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;            // Workday: no search until Enter
    const q = s.value.trim().toLowerCase(); pop.innerHTML = '';
    const words = q.split(/\\s+/).filter(Boolean);
    const hits = SCHOOLS.filter((x) => words.every((w) => x.toLowerCase().includes(w)));
    const ul = document.createElement('ul'); ul.setAttribute('role', 'listbox');
    if (!hits.length) { const li = document.createElement('li'); li.textContent = 'No Items.'; ul.appendChild(li); }
    for (const h of hits) {
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.setAttribute('data-automation-id', 'promptOption'); li.textContent = h;
      li.addEventListener('click', () => {
        const p = document.createElement('div'); p.setAttribute('data-automation-id', 'selectedItem'); p.textContent = h; pills.appendChild(p);
        pop.innerHTML = ''; s.value = '';
      });
      ul.appendChild(li);
    }
    pop.appendChild(ul);
  });
</script></body>`;

(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true });
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
  const run = async (schools, name) => {
    const p = await b.newPage();
    await p.route('https://acme.wd1.myworkdayjobs.com/**', (r) => r.fulfill({ contentType: 'text/html', body: page(schools) }));
    await p.goto('https://acme.wd1.myworkdayjobs.com/en-US/External/job/x/apply');
    await p.addScriptTag({ content: 'window.chrome = window.chrome || {}; chrome.runtime = chrome.runtime || { sendMessage(){}, onMessage: { addListener(){} }, getURL: (x) => x }; chrome.storage = chrome.storage || { local: { get: (k, cb) => cb ? cb({}) : Promise.resolve({}), set: () => Promise.resolve() }, onChanged: { addListener(){} } };' });
    await p.addScriptTag({ content: ENGINE });
    const res = await p.evaluate(async (name) => {
      const e = window.__uaWdEngine;
      if (!e || typeof e.pickSchool !== 'function') return { err: 'no engine' };
      const okv = await e.pickSchool(document.getElementById('s'), name);
      return { ok: okv, picked: [...document.querySelectorAll('[data-automation-id="selectedItem"]')].map((x) => x.textContent) };
    }, name);
    await p.close();
    return res;
  };
  let r = await run(['University of Dundee', 'University of Derby', 'Derby College', 'Other'], 'University of Derby');
  ok(r.ok && JSON.stringify(r.picked) === '["University of Derby"]', 'your school is picked, after Enter (' + JSON.stringify(r) + ')');
  r = await run(['Technological University Dublin (TU Dublin)', 'Dublin City University', 'Other'], 'Technological University Dublin');
  ok(r.ok && JSON.stringify(r.picked) === '["Technological University Dublin (TU Dublin)"]', 'a longer listed name of the same school (' + JSON.stringify(r) + ')');
  r = await run(['University of Dundee', 'Derby College', 'Other - Not Listed'], 'University of Derby');
  ok(r.ok && JSON.stringify(r.picked) === '["Other - Not Listed"]', 'not listed → the list\'s own "Other", never Dundee or Derby College (' + JSON.stringify(r) + ')');
  r = await run(['University of Dundee', 'Derby College'], 'University of Derby');
  ok(!r.ok && r.picked.length === 0, 'not listed and no "Other" → left empty for you, no wrong school (' + JSON.stringify(r) + ')');
  await b.close();
  console.log(`  wd-school: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
