/* The one autofill switch, in a real browser. With it OFF, application pages
   opened by hand (not as queue jobs) are left exactly as they are: no field
   filled, nothing clicked, no panel added — by this extension, by Jobright's
   helper or by the embedded SpeedyApply and its Workflow Add-on — and the
   site's own "Leave site?" warning works. Then the toolbar popup switches it ON
   and the same page is filled.

   Usage:  node tests/e2e/switch-off.js            (the extension in this repo)
           EXT=/path/to/build node tests/e2e/switch-off.js
           SHOTS=/dir  saves the popup's OFF / ON screenshots there
   Prints one line per check and exits non-zero on a failure. */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT = path.resolve(process.env.EXT || path.join(__dirname, '../../AAAA - Jobright Autofill'));
const GH = 'https://job-boards.greenhouse.io/acme/jobs/4412392009';
const WD = 'https://acme.wd1.myworkdayjobs.com/en-US/External/job/London/Engineer_R100';
const WAIT = Number(process.env.WAIT || 20000);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

(async () => {
  process.env.FIXTURE = path.join(__dirname, 'form.html');
  process.env.FIXTURE_ROUTES = JSON.stringify([['/External/', 'workday-mock.html']]);
  require('./server.js');
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-switch-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-proxy-server', '--ignore-certificate-errors',
      `--host-resolver-rules=MAP job-boards.greenhouse.io 127.0.0.1:8443, MAP acme.wd1.myworkdayjobs.com 127.0.0.1:8443, MAP * ~NOTFOUND`],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  const logs = [];
  ctx.on('page', (p) => p.on('console', (m) => { const t = m.text(); if (/\[UA|\[SA|SpeedyApply|Jobright/i.test(t)) logs.push(t.slice(0, 200)); }));

  // Your profile and CV, a SpeedyApply profile with SpeedyApply's own autofill ON,
  // and the switch OFF.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/ua-queue.html`);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  const seed = async () => panel.evaluate(async (pdf) => chrome.storage.local.set({
    ua_profile: { first_name: 'Maxmilliam', last_name: 'Okafor', email: 'max.test@example.com', phone: '+44 7700 900123', city: 'London', country: 'United Kingdom' },
    ua_resume_data: { base64: 'data:application/pdf;base64,' + pdf, fileName: 'Maxmilliam_Okafor_CV.pdf', mimeType: 'application/pdf' },
    profile: { nameData: { firstName: 'Saffy', lastName: 'Applier' }, contactData: { email: 'sa@example.com', phoneNumber: '+44 7700 900999' }, addressData: { city: 'London', country: 'United Kingdom' } },
    autofillEnabled: true, settings: { configName: 'Default' }, ua_sa_setup_done: Date.now(),
    ua_aa: false,
  }), pdf);
  await seed();
  await new Promise((r) => setTimeout(r, 3500));
  await seed();   // after SpeedyApply's own first-run defaults, if it wrote any

  const badge = () => sw.evaluate(() => new Promise((r) => chrome.action.getBadgeText({}, r))).catch(() => '(none)');
  const values = (p) => p.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('input,select,textarea')) {
      if (el.closest('[id^="ua-"]')) continue;   // our own (hidden) settings drawer, not the page's form
      const k = el.name || el.id; if (!k) continue;
      out[k] = el.type === 'radio' || el.type === 'checkbox' ? (el.checked ? (el.value || 'on') : (out[k] || '')) : el.type === 'file' ? (el.files.length ? 'FILE' : '') : el.value;
    }
    return out;
  });
  const filled = (v) => Object.entries(v).filter(([, x]) => x).map(([k]) => k);
  /* Anything an extension added that you can SEE: ours, SpeedyApply's, Jobright's
     helper (its shadow host). The page's own elements are known from the fixture,
     so everything else under <body>/<html> that renders counts. (Our drawer
     elements exist but are display:none — kept for a keyboard shortcut.) */
  const added = (p) => p.evaluate(() => {
    const seen = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0; };
    const ext = (el) => /^(ua-|sa-|jobright|speedyapply|plasmo)/i.test(el.id || '') || /-/.test(el.tagName) || !!el.shadowRoot;
    return [...document.body.children, ...document.documentElement.children].filter((el) => el !== document.body && el.tagName !== 'HEAD' && ext(el) && seen(el))
      .map((el) => (el.id || el.tagName).toLowerCase()).slice(0, 10);
  });

  console.log(`Build: ${EXT}`);
  eq('the toolbar badge says OFF', await badge(), 'OFF');

  /* ── OFF: a Greenhouse application opened by hand ── */
  console.log('\nSwitch OFF — a Greenhouse application you open yourself');
  logs.length = 0;
  const gh = await ctx.newPage();
  await gh.goto(GH);
  await gh.waitForTimeout(WAIT);
  const ghVals = await values(gh);
  eq('no field is filled (ours, Jobright\'s or SpeedyApply\'s)', filled(ghVals), []);
  eq('nothing was submitted', /SUBMITTED/.test(await gh.evaluate(() => document.body.innerText)), false);
  eq('no panel or widget was added to the page', await added(gh), []);
  eq('SpeedyApply\'s Workflow Add-on stood down', logs.some((l) => /Autofill disabled by user — standing down/.test(l)), true);
  eq('…and did not start', logs.some((l) => /ATS application page confirmed/.test(l)), false);
  // The site's own "Leave site?" works when the switch is OFF.
  await gh.evaluate(() => { document.querySelector('input').value = 'typed by hand'; window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }); });
  await gh.mouse.click(5, 5);   // the browser only asks after a real interaction with the page
  let asked = false;
  gh.on('dialog', (d) => { if (d.type() === 'beforeunload') asked = true; d.accept().catch(() => {}); });   // you press Leave
  await gh.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1500));
  eq('the site\'s "Leave site?" warning protects your typing', asked, true);

  /* ── OFF: a Workday posting opened by hand ── */
  console.log('\nSwitch OFF — a Workday job posting you open yourself');
  logs.length = 0;
  const wd = await ctx.newPage();
  await wd.goto(WD);
  await wd.waitForTimeout(WAIT);
  eq('no Apply / Apply Manually was pressed (still the posting)', await wd.evaluate(() => !!document.querySelector('[data-automation-id="adventureButton"]') && !document.querySelector('[data-automation-id="applyManually"]') && !/My Information/.test(document.body.innerText)), true);
  eq('no field is filled', filled(await values(wd)), []);
  eq('no panel or widget was added to the page', await added(wd), []);
  await wd.close();

  /* ── The toolbar popup ── */
  console.log('\nThe toolbar popup');
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 300, height: 260 });
  await pop.goto(`chrome-extension://${extId}/ua-switch.html`);
  await pop.waitForTimeout(500);
  eq('it shows OFF', [await pop.textContent('#state'), await pop.getAttribute('#sw', 'aria-checked')], ['OFF', 'false']);
  if (process.env.SHOTS) await pop.screenshot({ path: path.join(process.env.SHOTS, 'switch-off.png') });
  await pop.click('#sw');
  await pop.waitForTimeout(600);
  eq('one click turns it ON', [await pop.textContent('#state'), await panel.evaluate(() => new Promise((r) => chrome.storage.local.get('ua_aa', (d) => r(d.ua_aa))))], ['ON', true]);
  eq('…and the badge says ON', await badge(), 'ON');
  if (process.env.SHOTS) await pop.screenshot({ path: path.join(process.env.SHOTS, 'switch-on.png') });

  /* ── ON: the same Greenhouse page is filled ── */
  console.log('\nSwitch ON — the same Greenhouse application');
  const gh2 = await ctx.newPage();
  await gh2.goto(GH);
  await gh2.waitForTimeout(WAIT);
  const on = filled(await values(gh2));
  eq('it is filled (so the OFF checks above could have seen a fill)', on.includes('first_name') && on.includes('email'), true);
  await gh2.close().catch(() => {});

  // And OFF again from the popup.
  await pop.click('#sw');
  await pop.waitForTimeout(600);
  eq('one click turns it OFF again', [await pop.textContent('#state'), await badge()], ['OFF', 'OFF']);

  console.log(`\n${pass} passed, ${fail} failed`);
  await ctx.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
