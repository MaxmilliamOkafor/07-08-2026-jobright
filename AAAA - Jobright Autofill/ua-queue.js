/**
 * ua-queue.js — Docked Queue Manager for the Jobright CSV auto-apply queue.
 *
 * Modeled on OptimHire's jobQueue.js orchestrator: this EXTENSION PAGE (openable as a
 * tab or docked in Chrome's side panel, where it stays in place across navigations)
 * owns the tab lifecycle. Each pending job opens in its OWN background tab; the
 * ua-enhancement content script detects manager mode, applies, writes a terminal
 * status + an advance request; this page closes that tab and opens the next. Up to
 * 5 jobs run in parallel tabs for speed.
 *
 * Storage protocol (chrome.storage.local):
 *   ua_q               : Job[]  — the SAME queue the on-page sidebar uses
 *   ua_mgr_active      : boolean — manager run in progress
 *   ua_mgr_advance     : {id,status,ts} — content script → manager "job finished"
 *   ua_mgr_concurrency : number 1..5
 * Job statuses: pending | applying | done | failed | timeout | skipped
 */
(function () {
  'use strict';
  const ST = chrome.storage.local;
  const KEY_Q = 'ua_q';
  const KEY_ACTIVE = 'ua_mgr_active';
  const KEY_ADVANCE = 'ua_mgr_advance';
  const KEY_CONC = 'ua_mgr_concurrency';
  const KEY_OLD_RUNNER = 'ua_qa'; // the on-page single-tab runner flag — mutually exclusive
  const JOB_HARD_CAP_MS = 6 * 60 * 1000; // manager-side watchdog (content script caps itself at 150s/page)

  let queue = [];
  let view = { filter: 'all', search: '' };
  let _tabMap = new Map();   // jobId → tabId (only tabs WE opened)
  let _lastAdvanceTs = 0;
  let _filling = false;

  const get = (k) => new Promise(r => ST.get(k, d => r(d[k])));
  const set = (o) => new Promise(r => ST.set(o, r));

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTs(ts) {
    if (!ts) return '—';
    const d = Date.now() - ts;
    if (d < 60000) return Math.round(d / 1000) + 's ago';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    return Math.round(d / 86400000) + 'd ago';
  }
  function log(msg, cls) {
    const el = document.getElementById('log');
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg;
    el.appendChild(div);
    while (el.children.length > 60) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  /* ── storage (always read-modify-write so we never clobber content-script updates) ── */
  async function loadQ() { queue = (await get(KEY_Q)) || []; }
  async function mutateQ(fn) {
    await loadQ();
    fn(queue);
    await set({ [KEY_Q]: queue });
    render();
  }

  /* ── CSV (RFC-4180-ish, ported from OptimHire jobQueue.js) ── */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (inQ) {
        if (ch === '"' && nx === '"') { field += '"'; i++; }
        else if (ch === '"') inQ = false;
        else field += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r') { /* skip */ }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length && r.some(c => c.trim()));
  }
  function normUrl(u) {
    let s = String(u || '').trim().replace(/[)\]}>"'.,;]+$/, '');
    try { const x = new URL(s); x.hash = ''; return x.href.replace(/\/$/, ''); } catch (_) { return s; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function detectBoard(url) {
    const P = [[/greenhouse/i, 'Greenhouse'], [/lever\.co/i, 'Lever'], [/myworkday/i, 'Workday'],
      [/ashbyhq/i, 'Ashby'], [/icims/i, 'iCIMS'], [/smartrecruiters/i, 'SmartRecruiters'],
      [/workable/i, 'Workable'], [/breezy/i, 'Breezy'], [/jobvite/i, 'Jobvite'],
      [/bamboohr/i, 'BambooHR'], [/taleo|oraclecloud/i, 'Oracle/Taleo'], [/successfactors/i, 'SuccessFactors'],
      [/linkedin\.com/i, 'LinkedIn'], [/indeed\.com/i, 'Indeed'], [/rippling/i, 'Rippling'],
      [/recruitee/i, 'Recruitee'], [/teamtailor/i, 'Teamtailor'], [/ziprecruiter/i, 'ZipRecruiter']];
    for (const [re, n] of P) if (re.test(url)) return n;
    return 'Career';
  }
  async function importCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) return log('CSV is empty', 'err');
    const first = rows[0].map(c => c.trim().toLowerCase());
    const hasHeader = first.some(c => /\b(url|link|job_url|application_url)\b/.test(c));
    const map = {};
    if (hasHeader) {
      first.forEach((c, i) => {
        if (/\b(url|link|job_url|application_url)\b/.test(c)) map.url = i;
        else if (/title|position/.test(c)) map.title = i;
        else if (/company|employer/.test(c)) map.company = i;
      });
    }
    if (map.url == null) map.url = 0;
    let added = 0, dupes = 0, bad = 0;
    await loadQ();
    const have = new Set(queue.map(j => normUrl(j.url)));
    for (const r of (hasHeader ? rows.slice(1) : rows)) {
      let url = (r[map.url] || '').trim();
      // Bare-URL lines / URL anywhere in the row (matches the sidebar importer's tolerance)
      if (!/^https?:\/\//i.test(url)) {
        const seg = r.find(c => /^https?:\/\//i.test((c || '').trim()));
        if (seg) url = seg.trim(); else if (url && /\w\.\w/.test(url)) url = 'https://' + url; else { bad++; continue; }
      }
      const n = normUrl(url);
      if (have.has(n)) { dupes++; continue; }
      have.add(n);
      queue.push({
        id: uid(), url: n, title: (map.title != null && r[map.title] || '').trim() || n.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50),
        status: 'pending', addedAt: Date.now(), jobBoard: detectBoard(n),
        companyName: (map.company != null && r[map.company] || '').trim(),
        error: null, startedAt: null, completedAt: null, duration: null,
      });
      added++;
    }
    await set({ [KEY_Q]: queue });
    render();
    log(`Import: ${added} added, ${dupes} duplicates, ${bad} invalid`, added ? 'ok' : undefined);
  }
  function exportCsv() {
    const cols = ['url', 'title', 'companyName', 'jobBoard', 'status', 'error', 'addedAt', 'completedAt'];
    const escC = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = [cols.join(',')].concat(queue.map(j => cols.map(c => escC(j[c])).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `jobright-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log(`Exported ${queue.length} jobs`, 'ok');
  }

  /* ── render ── */
  function counts() {
    const c = { all: queue.length, pending: 0, applying: 0, done: 0, failed: 0, timeout: 0, skipped: 0 };
    for (const j of queue) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }
  function render() {
    const c = counts();
    document.getElementById('counter').textContent = c.all + ' jobs';
    document.getElementById('stats').innerHTML =
      `<div class="stat"><b>${c.all}</b>Total</div>` +
      `<div class="stat s-pending"><b>${c.pending}</b>Pending</div>` +
      `<div class="stat s-applying"><b>${c.applying}</b>Applying</div>` +
      `<div class="stat s-done"><b>${c.done}</b>Done</div>` +
      `<div class="stat s-failed"><b>${c.failed + c.timeout}</b>Failed</div>` +
      `<div class="stat s-skipped"><b>${c.skipped}</b>Skipped</div>`;
    const doneish = c.done + c.failed + c.timeout + c.skipped;
    const pw = document.getElementById('progressWrap');
    if (c.all && (c.applying || (doneish && doneish < c.all))) {
      pw.classList.add('show');
      const pct = c.all ? Math.round(doneish / c.all * 100) : 0;
      document.getElementById('progressPct').textContent = pct + '%';
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressLabel').textContent = c.applying ? `Applying to ${c.applying} job${c.applying > 1 ? 's' : ''}…` : 'Run progress';
    } else pw.classList.remove('show');

    const q = view.search.toLowerCase();
    const visible = queue.filter(j => {
      if (view.filter !== 'all' && j.status !== view.filter) return false;
      if (q && !((j.url + ' ' + (j.title || '') + ' ' + (j.companyName || '')).toLowerCase().includes(q))) return false;
      return true;
    });
    const tbl = document.getElementById('tbl');
    const empty = document.getElementById('empty');
    if (!queue.length) { tbl.classList.add('hidden'); empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    tbl.classList.remove('hidden');
    document.getElementById('tbody').innerHTML = visible.map((j, i) =>
      `<tr>
        <td>${i + 1}</td>
        <td><span class="badge b-${esc(j.status)}">${esc(j.status)}</span></td>
        <td><a class="url" href="${esc(j.url)}" target="_blank" rel="noopener" title="${esc((j.error ? j.error + ' — ' : '') + j.url)}">${esc(j.title || j.url)}</a></td>
        <td>${esc(j.jobBoard || '—')}</td>
        <td>${fmtTs(j.completedAt || j.startedAt || j.addedAt)}</td>
        <td><button class="del" data-del="${esc(j.id)}" title="Remove">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="6" style="padding:24px;text-align:center;color:#64748b">Nothing matches this filter.</td></tr>';
  }

  /* ── orchestrator ── */
  function getConc() {
    let n = parseInt(document.getElementById('conc').value, 10) || 1;
    return Math.min(5, Math.max(1, n));
  }
  function runningWithTab() {
    let n = 0;
    for (const j of queue) if (j.status === 'applying' && _tabMap.has(j.id)) n++;
    return n;
  }
  /* Push the job assignment into the tab. The content script may not be ready the
     instant the tab is created, and the page redirects (Jobright → ATS → apply form),
     so we retry and also re-send on every completed navigation (see onUpdated below). */
  function assignToTab(tabId, job) {
    let tries = 0;
    const payload = { type: 'UA_ASSIGN_JOB', job: { id: job.id, url: job.url, title: job.title, jobBoard: job.jobBoard, startedAt: job.startedAt } };
    const send = () => {
      tries++;
      try {
        chrome.tabs.sendMessage(tabId, payload, () => {
          const err = chrome.runtime.lastError; // no receiver yet → content script still booting
          if (err && tries < 12 && _tabMap.get(job.id) === tabId) setTimeout(send, 1500);
        });
      } catch (_) { if (tries < 12) setTimeout(send, 1500); }
    };
    setTimeout(send, 1200);
  }

  async function fillSlots() {
    if (_filling) return; _filling = true;
    try {
      if ((await get(KEY_ACTIVE)) !== true) return;
      await loadQ();
      const slots = getConc() - runningWithTab();
      if (slots <= 0) { render(); return; }
      // Mark the whole batch applying and save ONCE, so a mid-loop storage.onChanged
      // can't reset our array and leave only one tab opened (the bug you hit).
      const toOpen = [];
      for (const j of queue) {
        if (toOpen.length >= slots) break;
        if (j.status === 'pending') { j.status = 'applying'; j.startedAt = Date.now(); j.error = null; toOpen.push(j); }
      }
      if (!toOpen.length) { if (runningWithTab() === 0) await finish(); render(); return; }
      await set({ [KEY_Q]: queue });
      for (const job of toOpen) {
        // Background tab: a big run never hijacks the screen. active:false keeps focus
        // on whatever you're doing while jobs apply in the background.
        const tab = await new Promise(res => {
          try { chrome.tabs.create({ url: job.url, active: false }, res); } catch (_) { res(null); }
        });
        if (tab && tab.id != null) { _tabMap.set(job.id, tab.id); assignToTab(tab.id, job); log(`▶ ${job.title || job.url}`, 'act'); }
        else { job.status = 'failed'; job.error = 'Could not open tab'; await set({ [KEY_Q]: queue }); }
      }
      render();
      if (!queue.some(j => j.status === 'pending' || (j.status === 'applying' && _tabMap.has(j.id)))) await finish();
    } catch (e) { log('fillSlots error: ' + (e && e.message), 'err'); } finally { _filling = false; }
  }

  /* Re-assign on every completed navigation so the content script on the FINAL apply
     page (after redirects) is the one that receives its job. */
  try {
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.status !== 'complete') return;
      let jobId = null;
      for (const [jid, tid] of _tabMap) if (tid === tabId) { jobId = jid; break; }
      if (!jobId) return;
      const job = queue.find(j => j.id === jobId);
      if (job) assignToTab(tabId, job);
    });
  } catch (_) {}
  function closeJobTab(jobId) {
    const tabId = _tabMap.get(jobId);
    if (tabId == null) return;
    _tabMap.delete(jobId);
    try { chrome.tabs.remove(tabId, () => void chrome.runtime.lastError); } catch (_) {}
  }
  async function handleAdvance(req) {
    if (!req || !req.ts || req.ts === _lastAdvanceTs) return;
    _lastAdvanceTs = req.ts;
    const j = queue.find(x => x.id === req.id);
    log(`${req.status === 'done' ? '✔' : req.status === 'skipped' ? '↷' : '✖'} ${j ? (j.title || j.url) : req.id} — ${req.status}`, req.status === 'done' ? 'ok' : req.status === 'skipped' ? undefined : 'err');
    closeJobTab(req.id);
    await set({ [KEY_ADVANCE]: null });
    await fillSlots();
  }
  async function finish() {
    if ((await get(KEY_ACTIVE)) !== true) return;
    await set({ [KEY_ACTIVE]: false, [KEY_ADVANCE]: null });
    setRunning(false);
    const c = counts();
    log(`Queue complete — ${c.done} applied, ${c.failed + c.timeout} failed, ${c.skipped} skipped`, 'ok');
  }
  async function start() {
    await loadQ();
    if (!queue.some(j => j.status === 'pending' || j.status === 'applying')) return log('No pending jobs — import a CSV first', 'err');
    // Mutually exclusive with the on-page single-tab runner.
    if (await get(KEY_OLD_RUNNER)) { await set({ [KEY_OLD_RUNNER]: false }); log('Stopped the in-page runner (manager takes over)'); }
    for (const j of queue) if (j.status === 'applying') j.status = 'pending'; // orphans from a previous run
    _tabMap.clear();
    await set({ [KEY_Q]: queue, [KEY_ACTIVE]: true, [KEY_ADVANCE]: null });
    setRunning(true);
    const conc = getConc();
    log(`Started — up to ${conc} job${conc > 1 ? 's' : ''} in parallel background tabs`, 'act');
    await fillSlots();
  }
  async function stop() {
    await set({ [KEY_ACTIVE]: false, [KEY_ADVANCE]: null });
    for (const [, tabId] of _tabMap) { try { chrome.tabs.remove(tabId, () => void chrome.runtime.lastError); } catch (_) {} }
    _tabMap.clear();
    await mutateQ(q => { for (const j of q) if (j.status === 'applying') j.status = 'pending'; });
    setRunning(false);
    log('Stopped — job tabs closed, running jobs back to pending');
  }
  function setRunning(on) {
    document.getElementById('pulse').classList.toggle('on', on);
    document.getElementById('btnStart').disabled = on;
    document.getElementById('btnStop').disabled = !on;
  }

  /* Watchdog: close tabs of finished jobs the advance message missed, hard-cap stuck
     jobs, keep slots full. Runs every 12s while active. */
  setInterval(async () => {
    if ((await get(KEY_ACTIVE)) !== true) return;
    await loadQ();
    let dirty = false;
    for (const j of queue) {
      if (j.status !== 'applying') { if (_tabMap.has(j.id)) closeJobTab(j.id); continue; }
      if (_tabMap.has(j.id) && j.startedAt && Date.now() - j.startedAt > JOB_HARD_CAP_MS) {
        j.status = 'timeout'; j.error = 'Manager watchdog: no result in 6 min'; j.completedAt = Date.now();
        dirty = true;
        closeJobTab(j.id);
        log(`⏱ ${j.title || j.url} — watchdog timeout`, 'err');
      }
    }
    if (dirty) await set({ [KEY_Q]: queue });
    await fillSlots();
    render();
  }, 12000);

  /* User closed a job tab by hand → re-queue that job. */
  try {
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      let jobId = null;
      for (const [jid, tid] of _tabMap) if (tid === tabId) { jobId = jid; break; }
      if (jobId == null) return;
      _tabMap.delete(jobId);
      if ((await get(KEY_ACTIVE)) !== true) return;
      await mutateQ(q => { const j = q.find(x => x.id === jobId); if (j && j.status === 'applying') j.status = 'pending'; });
      await fillSlots();
    });
  } catch (_) {}

  /* Live sync: the content scripts and the on-page sidebar write ua_q too. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[KEY_Q]) { queue = changes[KEY_Q].newValue || []; render(); }
    if (changes[KEY_ACTIVE]) setRunning(!!changes[KEY_ACTIVE].newValue);
    if (changes[KEY_ADVANCE] && changes[KEY_ADVANCE].newValue) handleAdvance(changes[KEY_ADVANCE].newValue);
  });

  /* ── wiring ── */
  document.getElementById('btnStart').addEventListener('click', start);
  document.getElementById('btnStop').addEventListener('click', stop);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('csvFile').click());
  document.getElementById('csvFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importCsv(String(r.result));
    r.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('btnExport').addEventListener('click', exportCsv);
  document.getElementById('btnRetry').addEventListener('click', () => mutateQ(q => {
    let n = 0;
    for (const j of q) if (j.status === 'failed' || j.status === 'timeout') { j.status = 'pending'; j.error = null; n++; }
    log(n ? `${n} failed jobs back to pending` : 'No failed jobs', n ? 'ok' : undefined);
  }));
  document.getElementById('btnClearDone').addEventListener('click', () => mutateQ(q => {
    const n = q.length;
    for (let i = q.length - 1; i >= 0; i--) if (q[i].status === 'done' || q[i].status === 'skipped') q.splice(i, 1);
    log(`Cleared ${n - q.length} finished jobs`);
  }));
  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (!queue.length || !confirm(`Delete ALL ${queue.length} jobs?`)) return;
    mutateQ(q => q.splice(0, q.length));
    log('Queue cleared');
  });
  document.getElementById('search').addEventListener('input', e => { view.search = e.target.value; render(); });
  document.getElementById('statusFilter').addEventListener('change', e => { view.filter = e.target.value; render(); });
  document.getElementById('conc').addEventListener('change', e => set({ [KEY_CONC]: parseInt(e.target.value, 10) || 3 }));
  document.getElementById('tbody').addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.del;
    if (!id) return;
    closeJobTab(id);
    mutateQ(q => { const i = q.findIndex(x => x.id === id); if (i >= 0) q.splice(i, 1); });
  });

  /* ── boot ── */
  (async () => {
    await loadQ();
    const conc = await get(KEY_CONC);
    if (conc) document.getElementById('conc').value = String(Math.min(5, Math.max(1, conc)));
    const active = (await get(KEY_ACTIVE)) === true;
    setRunning(active);
    render();
    log('Queue Manager ready');
    if (active) {
      // Manager page reloaded mid-run: our tab map is gone — re-queue and refill.
      await mutateQ(q => { for (const j of q) if (j.status === 'applying') j.status = 'pending'; });
      log('Resuming interrupted run…', 'act');
      await fillSlots();
    }
  })();
})();
