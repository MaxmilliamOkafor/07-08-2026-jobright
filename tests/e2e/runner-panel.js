/* The single-tab runner's "Automation In Progress" panel, on a page whose CSS is
   hostile to it (hostile-css.html). Starts the runner the way the sidebar card
   does (a queue + ua_qa + this tab as the runner tab), screenshots the panel, and
   checks the page cannot reach into it.
   Usage: node tests/e2e/runner-panel.js <out-dir> */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = path.resolve(__dirname, '../../AAAA - Jobright Autofill');
const OUT = process.argv[2] || os.tmpdir();
const URL_ = 'https://job-boards.greenhouse.io/acme/jobs/5550001';
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ua-rp-')), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-proxy-server', '--ignore-certificate-errors',
      `--host-resolver-rules=MAP ${new URL(URL_).hostname} 127.0.0.1:8443, MAP * ~NOTFOUND`],
  });
  process.env.FIXTURE = path.join(__dirname, 'hostile-css.html'); require('./server.js');
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/ua-queue.html`);
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'about:blank' })).pop().id);
  await panel.evaluate(async ({ url, tabId }) => {
    await chrome.storage.local.set({
      ua_profile: { first_name: 'Maxmilliam', last_name: 'Okafor', email: 'max.test@example.com' },
      ua_q: [{ id: 'rp1', url, status: 'pending', title: 'Data Engineer', companyName: 'Acme Corp', jobBoard: 'greenhouse' }],
      ua_qa: true, ua_runner_tab: tabId, ua_qp: false,
    });
  }, { url: URL_, tabId });
  await page.goto(URL_);
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const host = document.querySelector('ua-run-panel');
    return { host: !!host, closed: !!host && host.shadowRoot === null, oldDivInPage: !!document.getElementById('ua-ctrl'),
      leakedStyles: [...document.querySelectorAll('style')].some((s) => /#ua-ctrl-card\{width:300px/.test(s.textContent)),
      rect: host ? JSON.stringify(host.getBoundingClientRect()) : null };
  });
  console.log('PANEL:', JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, 'runner-panel-hostile.png') });
  await ctx.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
