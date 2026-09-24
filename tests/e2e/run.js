/* Real-browser check of the whole CSV path: loads the unpacked extension in
   Chromium, seeds a profile + CV, queues one job whose URL (a real ATS host) is
   served a local fixture form, starts the run exactly as the Queue Manager does,
   and records what the automation did — every field value, how many times each
   was written, scroll direction changes, and what was finally submitted.

   Usage:  node tests/e2e/run.js [fixture.html] [job-url] [max-ms]
   Needs Playwright + Chromium; results in $TMPDIR/ua-e2e-out.json. */
// Drives the real extension: seeds a profile, queues a job whose URL is served
// the local fixture, starts the run and records what the autofill did.
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '../../AAAA - Jobright Autofill');
const FIXTURE = process.argv[2] || path.join(__dirname, 'form.html');
const JOB_URL = (process.argv[3] || 'https://job-boards.greenhouse.io/acme/jobs/4412392009');
const WAIT = Number(process.argv[4] || 90000);

(async () => {
  const userDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ua-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-proxy-server', '--ignore-certificate-errors',
      `--host-resolver-rules=MAP ${new URL(JOB_URL).hostname} 127.0.0.1:8443, MAP * ~NOTFOUND`],
  });
  process.env.FIXTURE = FIXTURE; require('./server.js');
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const logs = [];
  ctx.on('page', (p) => {
    p.on('console', (m) => { const t = m.text(); if (/\[UA|UA\]|Jobright|automation|Multi-page|fill/i.test(t)) logs.push(t.slice(0, 300)); });
    p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  });

  // A worker cannot message itself — drive it from the Queue Manager page, as you do.
  const extId = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/ua-queue.html`);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  await panel.evaluate(async ({ pdf }) => {
    await chrome.storage.local.set({
      ua_profile: {
        first_name: 'Maxmilliam', last_name: 'Okafor', email: 'max.test@example.com', phone: '+44 7700 900123',
        city: 'London', country: 'United Kingdom', linkedin: 'linkedin.com/in/maxtest',
        years_experience: '7', expected_salary: '85000', notice_period: '1 month', degree: 'Master of Science', education_level: "Master's",
      },
      ua_resume_data: { base64: 'data:application/pdf;base64,' + pdf, fileName: 'Maxmilliam_Okafor_CV.pdf', mimeType: 'application/pdf' },
      ua_aa: true,
    });
  }, { pdf });

  const send = (m) => panel.evaluate((m) => new Promise((r) => { chrome.runtime.sendMessage(m, r); setTimeout(() => r('timeout'), 4000); }), m);
  console.log('add:', JSON.stringify(await send({ type: 'UA_MGR_CMD', cmd: 'add', url: JOB_URL })));
  console.log('start:', JSON.stringify(await send({ type: 'UA_MGR_CMD', cmd: 'start' })));

  const t0 = Date.now();
  let jobPage = null, snapshots = [];
  while (Date.now() - t0 < WAIT) {
    await new Promise((r) => setTimeout(r, 3000));
    jobPage = ctx.pages().find((p) => p.url().startsWith(JOB_URL.split('?')[0]));
    if (!jobPage) continue;
    const s = await jobPage.evaluate(() => {
      const vals = {};
      for (const el of document.querySelectorAll('#application_form input,#application_form select,#application_form textarea')) {
        const k = el.name || el.id; if (!k) continue;
        if (el.type === 'radio') { if (el.checked) vals[k] = el.value; else if (!(k in vals)) vals[k] = ''; }
        else if (el.type === 'checkbox') vals[k] = el.checked;
        else if (el.type === 'file') vals[k] = el.files && el.files[0] ? 'FILE:' + el.files[0].name : '';
        else vals[k] = el.value;
      }
      return { t: Math.round(performance.now() / 1000), rounds: window.__rounds, seq: window.__seq, lastErrors: window.__lastErrors, vals, ev: window.__events, submitted: window.__submitted || null, body: document.body.innerText.slice(0, 80) };
    }).catch((e) => ({ err: e.message }));
    snapshots.push(s);
    if (s.submitted || (s.body && /thank you/i.test(s.body))) break;
  }
  const q = await panel.evaluate(async () => new Promise((r) => chrome.storage.local.get(null, (d) => r({ q: (d.ua_mgr_queue || d.ua_q || []).map((j) => ({ status: j.status, reason: j.reason || j.error || j.result })) , keys: Object.keys(d) }))));
  if (jobPage) await jobPage.screenshot({ path: path.join(require('os').tmpdir(), 'ua-e2e-shot.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(require('os').tmpdir(), 'ua-e2e-out.json'), JSON.stringify({ snapshots, logs, q }, null, 1));
  console.log('last snapshot:', JSON.stringify(snapshots[snapshots.length - 1], null, 1));
  console.log('queue:', JSON.stringify(q.q));
  console.log('log lines:', logs.length);
  await ctx.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
