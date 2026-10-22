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

const T0 = Date.now();
(async () => {
  const userDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ua-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-proxy-server', '--ignore-certificate-errors',
      `--host-resolver-rules=${[new URL(JOB_URL).hostname, ...(process.env.EXTRA_HOSTS || '').split(',').filter(Boolean)].map((h) => 'MAP ' + h + ' 127.0.0.1:8443').join(', ')}, MAP * ~NOTFOUND`],
  });
  process.env.FIXTURE = FIXTURE; require('./server.js');
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const logs = [];
  ctx.on('page', (p) => {
    if (process.env.LOG_TABS) { const t0 = Date.now(); setTimeout(() => logs.push('TAB opened: ' + p.url()), 1500); p.on('close', () => logs.push('TAB closed: ' + p.url())); }
    p.on('console', (m) => { const t = m.text(); if (/\[UA|UA\]|Jobright|automation|Multi-page|fill|SUBMITTED|SRSTATE|SIGNEDIN|PIN_ACCEPTED|FX_|APPLY_CHOICE|verification|code/i.test(t)) logs.push((process.env.LOG_TIMES ? '+' + Math.round((Date.now() - T0) / 1000) + 's ' : '') + t.slice(0, /^SUBMITTED /.test(t) ? 3000 : 300)); });
    p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  });

  // A worker cannot message itself — drive it from the Queue Manager page, as you do.
  const extId = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/ua-queue.html`);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  await panel.evaluate(async ({ pdf, extra, profileExtra }) => {
    await chrome.storage.local.set({
      ua_profile: {
        first_name: 'Maxmilliam', last_name: 'Okafor', email: 'max.test@example.com', phone: '+44 7700 900123',
        city: 'London', country: 'United Kingdom', address: '1 Grand Canal Square', postal_code: 'D02 P820',
        current_company: 'Acme Cloud', current_title: 'Senior Solutions Architect', school: 'Trinity College Dublin', major: 'Computer Science', work_start_year: '2019', linkedin: 'linkedin.com/in/maxtest',
        years_experience: '7', expected_salary: '85000', notice_period: '1 month', degree: 'Master of Science', education_level: "Master's",
        ...(profileExtra || {}),   // PROFILE_EXTRA='{"availability":"2025-12-02"}'
      },
      ua_resume_data: { base64: 'data:application/pdf;base64,' + pdf, fileName: 'Maxmilliam_Okafor_CV.pdf', mimeType: 'application/pdf' },
      ua_aa: true,
      ...(extra || {}),
    });
  }, { pdf, extra: JSON.parse(process.env.EXTRA_STORAGE || '{}'), profileExtra: JSON.parse(process.env.PROFILE_EXTRA || '{}') });

  const send = (m) => panel.evaluate((m) => new Promise((r) => { chrome.runtime.sendMessage(m, r); setTimeout(() => r('timeout'), 4000); }), m);
  console.log('add:', JSON.stringify(await send({ type: 'UA_MGR_CMD', cmd: 'add', url: JOB_URL })));
  console.log('start:', JSON.stringify(await send({ type: 'UA_MGR_CMD', cmd: 'start' })));

  const t0 = Date.now();
  let jobPage = null, snapshots = [];
  while (Date.now() - t0 < WAIT) {
    await new Promise((r) => setTimeout(r, 3000));
    jobPage = ctx.pages().find((p) => p.url().startsWith(JOB_URL.split('?')[0])) || ctx.pages().find((p) => /^https:/.test(p.url()) && !/chrome-extension/.test(p.url()));
    if (!jobPage) continue;
    const s = await jobPage.evaluate(() => {
      const vals = {};
      for (const el of document.querySelectorAll('form input,form select,form textarea')) {
        const k = el.name || el.id; if (!k) continue;
        if (el.type === 'radio') { if (el.checked) vals[k] = el.value; else if (!(k in vals)) vals[k] = ''; }
        else if (el.type === 'checkbox') vals[k] = el.checked;
        else if (el.type === 'file') vals[k] = el.files && el.files[0] ? 'FILE:' + el.files[0].name : '';
        else vals[k] = el.value;
      }
      return { t: Math.round(performance.now() / 1000), rounds: window.__rounds, seq: window.__seq, lastErrors: window.__lastErrors, vals, ev: window.__events, submitted: window.__submitted || null, body: document.body.innerText.slice(0, 80),
        // The Workday mock exposes its own state: where the application got to.
        mock: window.__mock ? { route: window.__mock.route, step: window.__mock.step, data: window.__mock.data, files: window.__mock.files } : undefined };
    }).catch((e) => ({ err: e.message }));
    // MUT_PROBE=1: what keeps changing the page (an engine waiting for quiet never gets it).
    if (process.env.MUT_PROBE) {
      const m = await jobPage.evaluate(() => {
        if (!window.__mutProbe) {
          window.__mutProbe = { n: 0, who: {} };
          new MutationObserver((list) => { for (const r of list) { window.__mutProbe.n++; const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
            const k = (t && (t.id ? '#' + t.id : t.tagName + (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : ''))) + ':' + r.type + (r.attributeName ? '@' + r.attributeName : '');
            window.__mutProbe.who[k] = (window.__mutProbe.who[k] || 0) + 1; } }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
        }
        const p = window.__mutProbe; const top = Object.entries(p.who).sort((a, b) => b[1] - a[1]).slice(0, 4); p.who = {}; const n = p.n; p.n = 0; return { n, top };
      }).catch(() => null);
      if (m) logs.push('MUT ' + JSON.stringify(m));
    }
    snapshots.push(s);
    if (s.submitted || (s.body && /thank you/i.test(s.body))) break;
  }
  // The page submits a few seconds before the job reports back — wait for the verdict.
  const readQ = () => panel.evaluate(async () => new Promise((r) => chrome.storage.local.get(null, (d) => r({ q: (d.ua_mgr_queue || d.ua_q || []).map((j) => ({ status: j.status, reason: j.reason || j.error || j.result, stage: j.stage })) , keys: Object.keys(d) }))));
  let q = await readQ();
  for (let i = 0; i < 20 && q.q[0] && q.q[0].status === 'applying' && Date.now() - t0 < WAIT + 20000; i++) { await new Promise((r) => setTimeout(r, 1000)); q = await readQ(); }
  if (jobPage) await jobPage.screenshot({ path: path.join(require('os').tmpdir(), 'ua-e2e-shot.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(require('os').tmpdir(), 'ua-e2e-out.json'), JSON.stringify({ snapshots, logs, q }, null, 1));
  console.log('last snapshot:', JSON.stringify(snapshots[snapshots.length - 1], null, 1));
  console.log('queue:', JSON.stringify(q.q));
  // How many web tabs the run left open (a Jobright apply that opens its own tab adds one).
  console.log('tabs:', ctx.pages().filter((pg) => /^https:/.test(pg.url())).map((pg) => new URL(pg.url()).hostname).join(','));
  // The tab can close on success before a 3s snapshot sees the thank-you page;
  // the queue's own verdict is the authority.
  const outcome = (q.q[0] && q.q[0].status) || 'unknown';
  console.log('OUTCOME:', outcome === 'done' || (snapshots.at(-1) || {}).submitted ? 'submitted' : outcome);
  // What the form actually received (the fixtures log it on a successful submit).
  const sub = logs.map((l) => (l.match(/^SUBMITTED (.*)$/) || [])[1]).filter(Boolean).pop();
  if (sub) console.log('SUBMITTED:', sub.slice(0, 600));
  console.log('log lines:', logs.length);
  if (process.env.LOG_DUMP) for (const l of logs) console.log('  | ' + l);
  await ctx.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
