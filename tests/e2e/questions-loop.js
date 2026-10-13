/* The "Questions to answer" loop, end to end in a real browser:
   1. a job whose form asks something the autofill cannot know is run — it cannot submit;
   2. the question appears in the Queue Manager's ❓ Questions to answer, and is answered there once;
   3. a second job with the same question is run — it is filled with that answer and submits.
   Usage: node tests/e2e/questions-loop.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../../AAAA - Jobright Autofill');
process.env.FIXTURE = path.join(__dirname, 'form-unknown.html'); require('./server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ua-q-')), { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP job-boards.greenhouse.io 127.0.0.1:8443, MAP * ~NOTFOUND'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${new URL(sw.url()).host}/ua-queue.html`);
  const submitted = [];
  ctx.on('page', (p) => p.on('console', (m) => { const t = m.text(); if (/^SUBMITTED /.test(t)) submitted.push(JSON.parse(t.slice(10))); }));
  const pdf = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
  await panel.evaluate((pdf) => new Promise((r) => chrome.storage.local.set({
    ua_profile: { first_name: 'Maxmilliam', last_name: 'Okafor', email: 'max.test@example.com', phone: '+44 7700 900123', city: 'London', country: 'United Kingdom', linkedin: 'https://linkedin.com/in/maxtest', years_experience: '7', expected_salary: '85000', notice_period: '1 month' },
    ua_resume_data: { base64: 'data:application/pdf;base64,' + pdf, fileName: 'CV.pdf', mimeType: 'application/pdf' }, ua_aa: true, 'ua-timeout': '60000' }, r)), pdf);
  const send = (m) => panel.evaluate((m) => new Promise((r) => { chrome.runtime.sendMessage(m, r); setTimeout(() => r('timeout'), 4000); }), m);
  const runJob = async (url, maxMs) => {
    await send({ type: 'UA_MGR_CMD', cmd: 'add', url }); await send({ type: 'UA_MGR_CMD', cmd: 'start' });
    const t0 = Date.now();
    for (;;) { await sleep(3000);
      const q = await panel.evaluate(() => new Promise((r) => chrome.storage.local.get('ua_q', (d) => r(d.ua_q || []))));
      const j = q.find((x) => x.url && x.url.includes(url.split('/').pop()));
      if (j && /done|failed|timeout|skipped/.test(j.status)) return j.status;
      if (Date.now() - t0 > maxMs) return 'harness-timeout';
    }
  };
  console.log('run 1:', await runJob('https://job-boards.greenhouse.io/acme/jobs/1001', 200000));
  // The question as the Queue Manager lists it.
  await panel.reload();
  await panel.click('#btnQuestions'); await sleep(800);
  const rows = await panel.$$eval('#qList .dlg-row .q', (els) => els.map((e) => e.textContent));
  console.log('Questions to answer:', JSON.stringify(rows));
  const idx = rows.findIndex((t) => /current manager/i.test(t));
  if (idx < 0) { console.log('RESULT: question not listed'); await ctx.close(); process.exit(1); }
  const row = (await panel.$$('#qList .dlg-row'))[idx];
  await (await row.$('input')).fill('Jane Murphy');
  await (await row.$('button.b-accent')).click(); await sleep(800);
  await panel.click('#qClose');
  console.log('run 2:', await runJob('https://job-boards.greenhouse.io/acme/jobs/1002', 200000));
  const last = submitted.pop();
  console.log('RESULT:', last && last.q_mgr === 'Jane Murphy' ? 'PASS — second job submitted with your answer' : 'FAIL', JSON.stringify(last || {}).slice(0, 300));
  await ctx.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
