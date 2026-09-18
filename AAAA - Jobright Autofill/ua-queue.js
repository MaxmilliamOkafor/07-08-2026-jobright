/**
 * ua-queue.js — Queue Manager UI for the Jobright CSV auto-apply automation.
 *
 * This page (a tab, or docked in Chrome's side panel) is now a pure VIEW. The
 * run itself is driven by ua-orchestrator.js inside the background service
 * worker, so closing this panel no longer kills the run, orphans job tabs, or
 * leaves jobs stuck on "applying". Everything here is either a render of
 * chrome.storage.local or a command message to the orchestrator.
 *
 * Storage keys are documented in ua-orchestrator.js.
 */
(function () {
  'use strict';

  const ST = chrome.storage.local;
  const K = {
    Q: 'ua_q', ACTIVE: 'ua_mgr_active', PAUSED: 'ua_mgr_paused', CONC: 'ua_mgr_concurrency',
    SETTINGS: 'ua_mgr_settings', LOG: 'ua_mgr_log', HISTORY: 'ua_app_history',
  };

  let queue = [];
  let history = [];
  let view = { filter: 'all', search: '' };
  let running = false, paused = false;

  const get = (k) => new Promise((r) => ST.get(k, (d) => { void chrome.runtime.lastError; r(d[k]); }));
  const set = (o) => new Promise((r) => ST.set(o, () => { void chrome.runtime.lastError; r(); }));
  const cmd = (c, extra) => new Promise((r) => {
    try { chrome.runtime.sendMessage(Object.assign({ type: 'UA_MGR_CMD', cmd: c }, extra || {}), (resp) => { void chrome.runtime.lastError; r(resp || {}); }); }
    catch (_) { r({}); }
  });
  const $ = (id) => document.getElementById(id);

  /* ─────────────────────────── helpers ─────────────────────────── */
  function fmtTs(ts) {
    if (!ts) return '—';
    const d = Date.now() - ts;
    if (d < 60000) return Math.round(d / 1000) + 's ago';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    return Math.round(d / 86400000) + 'd ago';
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* Only http(s) rows are ever accepted. This page runs with extension
     privileges, so a `javascript:` or `data:` cell in a CSV must never become a
     link href or a tab we open. */
  function isSafeUrl(u) {
    try { const p = new URL(String(u)).protocol; return p === 'http:' || p === 'https:'; }
    catch (_) { return false; }
  }
  function normUrl(u) {
    let s = String(u == null ? '' : u).trim()
      .replace(/^[\s"'<([]+/, '')
      .replace(/[)\]}>"'.,;]+$/, '');
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[\w-]+(\.[\w-]+)+\//.test(s)) s = 'https://' + s;
    try {
      const x = new URL(s);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
      x.hash = '';
      // Tracking noise makes identical jobs look like different URLs, which
      // defeats de-duplication across imports.
      for (const p of [...x.searchParams.keys()]) {
        if (/^(utm_[\w-]*|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|_ga|trk|trackingId)$/i.test(p)) x.searchParams.delete(p);
      }
      return x.href.replace(/\/$/, '');
    } catch (_) { return ''; }
  }
  function detectBoard(url) {
    const P = [[/greenhouse/i, 'Greenhouse'], [/lever\.co/i, 'Lever'], [/myworkday|workday/i, 'Workday'],
      [/ashbyhq/i, 'Ashby'], [/icims/i, 'iCIMS'], [/smartrecruiters/i, 'SmartRecruiters'],
      [/workable/i, 'Workable'], [/breezy/i, 'Breezy'], [/jobvite/i, 'Jobvite'],
      [/bamboohr/i, 'BambooHR'], [/taleo|oraclecloud/i, 'Oracle/Taleo'], [/successfactors/i, 'SuccessFactors'],
      [/linkedin\.com/i, 'LinkedIn'], [/indeed\.com/i, 'Indeed'], [/rippling/i, 'Rippling'],
      [/recruitee/i, 'Recruitee'], [/teamtailor/i, 'Teamtailor'], [/ziprecruiter/i, 'ZipRecruiter'],
      [/jazz\.co|applytojob/i, 'JazzHR'], [/eightfold/i, 'Eightfold'], [/paylocity/i, 'Paylocity'],
      [/adp\.com/i, 'ADP'], [/jobright\.ai/i, 'Jobright'], [/dover/i, 'Dover'], [/pinpointhq/i, 'Pinpoint'],
      [/joinhandshake/i, 'Handshake'], [/usajobs\.gov/i, 'USAJOBS'], [/phenom/i, 'Phenom']];
    for (const [re, n] of P) if (re.test(url)) return n;
    return 'Career';
  }

  /* ─────────────────────────── CSV ─────────────────────────── */
  /* RFC-4180 parser with delimiter sniffing. Real exports are comma, semicolon
     (European Excel), tab (pasted spreadsheets) or pipe delimited, and often
     carry a UTF-8 BOM that used to break header detection. */
  function sniffDelimiter(text) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
    let best = ',', bestN = 0;
    for (const d of [',', ';', '\t', '|']) {
      const n = line.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    }
    return bestN ? best : ',';
  }
  function parseCsv(text, delim) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (inQ) {
        if (ch === '"' && nx === '"') { field += '"'; i++; }
        else if (ch === '"') inQ = false;
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\r') { /* handled by \n */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length && r.some((c) => c.trim()));
  }

  /* Pull the job URL out of a row however it was written: a dedicated column, a
     bare URL in any cell, a markdown/HTML link, or a hostname without a scheme. */
  function urlFromRow(row, urlIdx) {
    const cells = urlIdx != null && row[urlIdx] != null ? [row[urlIdx], ...row] : row;
    for (const raw of cells) {
      const cell = String(raw == null ? '' : raw).trim();
      if (!cell) continue;
      const m = cell.match(/https?:\/\/[^\s,"'<>)\]]+/i);
      if (m) { const u = normUrl(m[0]); if (u) return u; }
      const u = normUrl(cell);
      if (u && /^https?:\/\/[^/]+\./i.test(u)) return u;
    }
    return '';
  }

  async function importText(text, sourceName) {
    text = String(text || '').replace(/^﻿/, '');   // strip BOM
    if (!text.trim()) return log('Nothing to import', 'err');
    const rows = parseCsv(text, sniffDelimiter(text));
    if (!rows.length) return log('CSV is empty', 'err');

    const first = rows[0].map((c) => c.trim().toLowerCase());
    const map = {};
    let hasHeader = false;
    first.forEach((c, i) => {
      if (/^https?:/i.test(c)) return;                       // a URL is data, not a header
      if (/\b(url|link|href|job.?url|application.?url|apply)\b/.test(c)) { map.url = i; hasHeader = true; }
      else if (/\b(title|position|role|job.?title)\b/.test(c)) { map.title = i; hasHeader = true; }
      else if (/\b(company|employer|organi[sz]ation)\b/.test(c)) { map.company = i; hasHeader = true; }
    });
    // A header row with no recognised URL column still gets skipped as long as
    // it clearly isn't data (no URL anywhere in it).
    if (!hasHeader && !urlFromRow(rows[0]) && rows.length > 1) hasHeader = true;

    const applied = new Set(history.filter((h) => h.status === 'applied').map((h) => normUrl(h.url)));
    const skipApplied = $('optSkip').checked;
    const have = new Set(queue.map((j) => normUrl(j.url)));
    const additions = [];
    let dupes = 0, bad = 0, alreadyApplied = 0;

    for (const r of (hasHeader ? rows.slice(1) : rows)) {
      const url = urlFromRow(r, map.url);
      if (!url || !isSafeUrl(url)) { bad++; continue; }
      if (have.has(url)) { dupes++; continue; }
      if (skipApplied && applied.has(url)) { alreadyApplied++; continue; }
      have.add(url);
      additions.push({
        id: uid(),
        url,
        title: (map.title != null && (r[map.title] || '').trim()) || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60),
        status: 'pending',
        addedAt: Date.now(),
        jobBoard: detectBoard(url),
        companyName: (map.company != null && (r[map.company] || '').trim()) || '',
        error: null, startedAt: null, completedAt: null, duration: null,
      });
    }

    if (additions.length) {
      await mutateQ((q) => { q.push(...additions); });
    } else {
      render();
    }
    const parts = [`${additions.length} added`];
    if (dupes) parts.push(`${dupes} duplicate${dupes === 1 ? '' : 's'}`);
    if (alreadyApplied) parts.push(`${alreadyApplied} already applied`);
    if (bad) parts.push(`${bad} invalid`);
    log(`${sourceName ? sourceName + ': ' : 'Import: '}${parts.join(', ')}`, additions.length ? 'ok' : 'err');
  }

  /* Every failure with its reason, grouped and counted, as plain text.
     A run that reports "15 failed" and nothing else cannot be acted on — the
     reasons are all recorded per job, they were just never anywhere you could
     get at them in one go. Grouped because fifteen failures are usually three
     causes, and the counts are what say which one to fix first. */
  /* The whole recorder, as one block of text. "Copy failures" covers the run
     you just did; this covers everything the extension has ever seen — which
     ATS are working, which are not, and the exact questions it could not
     answer. Downloaded as well as copied, because a long report is past what
     most places will take on a paste. */
  function extractDiagnostics() {
    chrome.runtime.sendMessage({ type: 'UA_DIAG_REPORT' }, (r) => {
      void chrome.runtime.lastError;
      const text = (r && r.text) || 'Diagnostics unavailable — the service worker did not answer.';
      const done = () => log('Diagnostics copied and downloaded', 'ok');
      try {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } catch (_) { fallbackCopy(text, done); }
      try {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `jobright-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (_) {}
    });
  }

  function copyFailures() {
    const bad = queue.filter((j) => j.status === 'failed' || j.status === 'timeout' || j.status === 'skipped');
    if (!bad.length) { log('No failures to copy', 'ok'); return; }
    const byReason = new Map();
    for (const j of bad) {
      const key = `${j.status}: ${j.error || 'no reason recorded'}`;
      if (!byReason.has(key)) byReason.set(key, []);
      byReason.get(key).push(j.url);
    }
    const groups = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);
    const done = queue.filter((j) => j.status === 'done').length;
    const out = [
      `Jobright queue — ${queue.length} jobs, ${done} applied, ${bad.length} not`,
      '',
    ];
    for (const [reason, urls] of groups) {
      out.push(`${urls.length}x  ${reason}`);
      for (const u of urls.slice(0, 8)) out.push(`      ${u}`);
      if (urls.length > 8) out.push(`      …and ${urls.length - 8} more`);
      out.push('');
    }
    const text = out.join('\n');
    const ok = () => log(`Copied ${bad.length} failure${bad.length === 1 ? '' : 's'} in ${groups.length} group${groups.length === 1 ? '' : 's'}`, 'ok');
    try {
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } catch (_) { fallbackCopy(text, ok); }
  }
  // Clipboard access can be refused in a side panel; a textarea always works.
  function fallbackCopy(text, ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      ok();
    } catch (_) { log('Could not copy — use ⬇ Export instead', 'err'); }
  }

  function exportCsv() {
    const cols = ['url', 'title', 'companyName', 'jobBoard', 'status', 'error', 'addedAt', 'startedAt', 'completedAt', 'duration'];
    const esc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = [cols.join(',')].concat(queue.map((j) => cols.map((c) => esc(j[c])).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `jobright-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    log(`Exported ${queue.length} jobs`, 'ok');
  }

  /* ─────────────────────────── state ─────────────────────────── */
  async function loadQ() { queue = (await get(K.Q)) || []; }
  /* Read-modify-write against fresh storage: job tabs and the service worker
     write ua_q too, so writing a stale in-memory array would clobber results. */
  async function mutateQ(fn) {
    await loadQ();
    fn(queue);
    await set({ [K.Q]: queue });
    render();
  }

  /* ─────────────────────────── log ─────────────────────────── */
  /* The log lives in storage so it survives the panel being closed and reopened
     — the whole point of moving the engine into the service worker. */
  async function renderLog() {
    const buf = (await get(K.LOG)) || [];
    const el = $('log');
    el.textContent = '';
    for (const raw of buf.slice(-60)) {
      let e;
      try { e = JSON.parse(raw); } catch (_) { continue; }
      const div = document.createElement('div');
      if (e.c) div.className = e.c;
      div.textContent = new Date(e.t).toTimeString().slice(0, 8) + '  ' + e.m;
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }
  async function log(msg, cls) {
    const buf = (await get(K.LOG)) || [];
    buf.push(JSON.stringify({ t: Date.now(), m: msg, c: cls || '' }));
    while (buf.length > 200) buf.shift();
    await set({ [K.LOG]: buf });   // storage.onChanged re-renders
  }

  /* ─────────────────────────── render ─────────────────────────── */
  function counts() {
    const c = { all: queue.length, pending: 0, applying: 0, done: 0, failed: 0, timeout: 0, skipped: 0 };
    for (const j of queue) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }

  function render() {
    const c = counts();
    $('counter').textContent = c.all + (c.all === 1 ? ' job' : ' jobs');

    const stats = [
      ['all', 'Total', c.all, ''],
      ['pending', 'Pending', c.pending, 's-pending'],
      ['applying', 'Applying', c.applying, 's-applying'],
      ['done', 'Done', c.done, 's-done'],
      ['failed', 'Failed', c.failed + c.timeout, 's-failed'],
      ['skipped', 'Skipped', c.skipped, 's-skipped'],
    ];
    const statsEl = $('stats');
    statsEl.textContent = '';
    for (const [key, label, n, cls] of stats) {
      const d = document.createElement('div');
      d.className = 'stat ' + cls + (view.filter === key ? ' sel' : '');
      d.dataset.filter = key;
      d.title = 'Filter by ' + label.toLowerCase();
      const b = document.createElement('b');
      b.textContent = String(n);
      d.appendChild(b);
      d.appendChild(document.createTextNode(label));
      statsEl.appendChild(d);
    }

    const doneish = c.done + c.failed + c.timeout + c.skipped;
    const pw = $('progressWrap');
    if (c.all && (c.applying || (doneish && doneish < c.all))) {
      pw.classList.add('show');
      const pct = Math.round(doneish / c.all * 100);
      $('progressPct').textContent = pct + '%';
      $('progressFill').style.width = pct + '%';
      $('progressLabel').textContent = c.applying
        ? `Applying to ${c.applying} job${c.applying > 1 ? 's' : ''}…`
        : (running ? 'Run progress' : 'Paused / stopped');
    } else pw.classList.remove('show');

    const q = view.search.toLowerCase();
    const visible = queue.filter((j) => {
      if (view.filter === 'failed') { if (j.status !== 'failed' && j.status !== 'timeout') return false; }
      else if (view.filter !== 'all' && j.status !== view.filter) return false;
      if (q && !((j.url + ' ' + (j.title || '') + ' ' + (j.companyName || '')).toLowerCase().includes(q))) return false;
      return true;
    });

    const tbl = $('tbl'), empty = $('empty'), rowCount = $('rowCount');
    if (!queue.length) {
      tbl.classList.add('hidden');
      rowCount.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    tbl.classList.remove('hidden');

    const tbody = $('tbody');
    tbody.textContent = '';
    if (!visible.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.cssText = 'padding:24px;text-align:center;color:#64748b';
      td.textContent = 'Nothing matches this filter.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    // Cap the DOM at 400 rows — a 5,000-row CSV used to lock the panel up.
    const shown = visible.slice(0, 400);
    for (let i = 0; i < shown.length; i++) {
      const j = shown[i];
      const tr = document.createElement('tr');

      const tdN = document.createElement('td');
      tdN.textContent = String(i + 1);
      tr.appendChild(tdN);

      const tdS = document.createElement('td');
      const badge = document.createElement('span');
      const blocked = !!(j.needsHuman && j.needsHuman.since);
      badge.className = 'badge ' + (blocked ? 'b-needsyou' : 'b-' + j.status);
      badge.textContent = blocked ? 'needs you' : j.status;
      if (blocked) badge.title = (j.needsHuman.provider || 'CAPTCHA') + ' — open the tab and solve it';
      tdS.appendChild(badge);
      tr.appendChild(tdS);

      const tdJ = document.createElement('td');
      const a = document.createElement('a');
      a.className = 'url';
      a.textContent = j.title || j.url;
      a.title = j.url;
      if (isSafeUrl(j.url)) { a.href = j.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      tdJ.appendChild(a);
      if (j.status === 'applying' && j.stage) {
        const st = document.createElement('span');
        st.className = 'stage-txt';
        const idle = j.beatAt ? Math.round((Date.now() - j.beatAt) / 1000) : null;
        st.textContent = (j.pct != null ? j.pct + '% · ' : '') + j.stage + (idle != null && idle > 20 ? ` · idle ${idle}s` : '');
        st.title = 'What this job is currently doing';
        tdJ.appendChild(st);
      }
      if (j.error) {
        const e = document.createElement('span');
        e.className = 'err-txt';
        e.textContent = j.error;
        e.title = j.error;
        tdJ.appendChild(e);
      }
      tr.appendChild(tdJ);

      const tdB = document.createElement('td');
      tdB.textContent = j.jobBoard || '—';
      tr.appendChild(tdB);

      const tdW = document.createElement('td');
      tdW.textContent = fmtTs(j.completedAt || j.startedAt || j.addedAt);
      tr.appendChild(tdW);

      const tdA = document.createElement('td');
      tdA.style.whiteSpace = 'nowrap';
      if (j.needsHuman && j.needsHuman.tabId != null) {
        const open = document.createElement('button');
        open.className = 'rowbtn';
        open.dataset.focus = String(j.needsHuman.tabId);
        open.title = 'Open this job\'s tab so you can solve the challenge';
        open.textContent = '↗';
        tdA.appendChild(open);
      }
      if (j.status !== 'pending' && j.status !== 'applying') {
        const retry = document.createElement('button');
        retry.className = 'rowbtn';
        retry.dataset.retry = j.id;
        retry.title = 'Queue this job again';
        retry.textContent = '↻';
        tdA.appendChild(retry);
      }
      const del = document.createElement('button');
      del.className = 'rowbtn del';
      del.dataset.del = j.id;
      del.title = 'Remove';
      del.textContent = '✕';
      tdA.appendChild(del);
      tr.appendChild(tdA);

      tbody.appendChild(tr);
    }
    if (visible.length > shown.length) {
      rowCount.classList.remove('hidden');
      rowCount.textContent = `Showing ${shown.length} of ${visible.length} matching jobs — use search or a status filter to narrow down.`;
    } else rowCount.classList.add('hidden');
  }

  function setRunning(on, isPaused) {
    running = on; paused = !!isPaused;
    $('pulse').classList.toggle('on', on && !paused);
    $('pulse').classList.toggle('paused', on && paused);
    $('btnStart').disabled = on;
    $('btnStop').disabled = !on;
    $('btnPause').disabled = !on;
    $('btnPause').textContent = paused ? '▶ Resume' : '⏸ Pause';
  }

  /* ─────────────────────────── settings ─────────────────────────── */
  async function saveSettings() {
    await set({
      [K.SETTINGS]: {
        skipApplied: $('optSkip').checked,
        tailor: $('optTailor').checked,
        jobTimeoutMs: Math.max(1, Math.min(30, parseInt($('optTimeout').value, 10) || 3)) * 60000,
        stallMs: Math.max(5, Math.min(600, parseInt($('optStall').value, 10) || 15)) * 1000,
        humanGraceMs: Math.max(0.5, Math.min(30, parseFloat($('optHuman').value) || 1)) * 60000,
      },
      // The content script reads these two directly for the in-page runner too.
      // Parallel tabs. The orchestrator reads this key directly when it refills
      // slots, so a change takes effect on the very next job — no restart.
      ua_mgr_concurrency: Math.max(1, Math.min(12, parseInt($('optConc').value, 10) || 3)),
      ua_skip_applied: $('optSkip').checked,
      ua_queue_tailor: $('optTailor').checked,
    });
  }

  /* ─────────────────────────── wiring ─────────────────────────── */
  $('btnStart').addEventListener('click', async () => {
    await saveSettings();
    const r = await cmd('start');
    if (r && r.ok === false && r.reason === 'empty') log('No pending jobs — import a CSV first', 'err');
  });
  $('btnStop').addEventListener('click', () => cmd('stop'));
  $('btnPause').addEventListener('click', () => cmd(paused ? 'resume' : 'pause'));

  $('btnImport').addEventListener('click', () => $('csvFile').click());
  $('csvFile').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      const text = await f.text().catch(() => '');
      await importText(text, f.name);
    }
  });

  // Drag & drop a CSV anywhere on the panel.
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) document.body.classList.add('drag'); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag'); } });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('drag');
    const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    if (files.length) {
      for (const f of files) await importText(await f.text().catch(() => ''), f.name);
      return;
    }
    const text = e.dataTransfer && e.dataTransfer.getData('text');
    if (text) await importText(text, 'Dropped text');
  });

  const dlg = $('pasteDlg');
  $('btnPaste').addEventListener('click', () => { $('pasteBox').value = ''; dlg.showModal(); $('pasteBox').focus(); });
  $('pasteCancel').addEventListener('click', () => dlg.close());
  $('pasteAdd').addEventListener('click', async () => {
    const text = $('pasteBox').value;
    dlg.close();
    await importText(text, 'Pasted');
  });

  $('btnExport').addEventListener('click', exportCsv);
  $('btnCopyFails').addEventListener('click', copyFailures);
  $('btnDiag').addEventListener('click', extractDiagnostics);
  $('btnRetry').addEventListener('click', async () => {
    let n = 0;
    await mutateQ((q) => {
      for (const j of q) if (j.status === 'failed' || j.status === 'timeout') { j.status = 'pending'; j.error = null; j.startedAt = null; j.completedAt = null; n++; }
    });
    log(n ? `${n} failed job${n === 1 ? '' : 's'} back to pending` : 'No failed jobs', n ? 'ok' : '');
    if (n && running) cmd('kick');
  });
  $('btnClearDone').addEventListener('click', async () => {
    let removed = 0;
    await mutateQ((q) => {
      for (let i = q.length - 1; i >= 0; i--) if (q[i].status === 'done' || q[i].status === 'skipped') { q.splice(i, 1); removed++; }
    });
    log(`Cleared ${removed} finished job${removed === 1 ? '' : 's'}`);
  });
  $('btnClearAll').addEventListener('click', async () => {
    if (!queue.length) return;
    if (running && !confirm('A run is in progress. Stop it and delete all jobs?')) return;
    if (!running && !confirm(`Delete ALL ${queue.length} jobs?`)) return;
    if (running) await cmd('stop');
    await mutateQ((q) => q.splice(0, q.length));
    log('Queue cleared');
  });

  $('search').addEventListener('input', (e) => { view.search = e.target.value; render(); });
  $('statusFilter').addEventListener('change', (e) => { view.filter = e.target.value; render(); });
  $('stats').addEventListener('click', (e) => {
    const el = e.target.closest('[data-filter]');
    if (!el) return;
    view.filter = el.dataset.filter;
    $('statusFilter').value = view.filter === 'failed' ? 'failed' : view.filter;
    render();
  });
  $('conc').addEventListener('change', (e) => set({ [K.CONC]: parseInt(e.target.value, 10) || 3 }));
  for (const id of ['optSkip', 'optTailor', 'optConc', 'optTimeout', 'optStall', 'optHuman']) $(id).addEventListener('change', saveSettings);
  wireMailbox();

  $('tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.focus) {
      const tabId = parseInt(btn.dataset.focus, 10);
      try {
        chrome.tabs.update(tabId, { active: true }, (t) => {
          void chrome.runtime.lastError;
          if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }, () => void chrome.runtime.lastError);
        });
      } catch (_) {}
      return;
    }
    if (btn.dataset.del) {
      const id = btn.dataset.del;
      await mutateQ((q) => { const i = q.findIndex((x) => x.id === id); if (i >= 0) q.splice(i, 1); });
      if (running) cmd('kick');
    } else if (btn.dataset.retry) {
      const id = btn.dataset.retry;
      await mutateQ((q) => {
        const j = q.find((x) => x.id === id);
        if (j) { j.status = 'pending'; j.error = null; j.startedAt = null; j.completedAt = null; }
      });
      if (running) cmd('kick');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '/') { e.preventDefault(); $('search').focus(); }
    else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) cmd(running ? 'stop' : 'start');
    else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && running) cmd(paused ? 'resume' : 'pause');
  });

  /* Live sync — job tabs, the service worker and the on-page sidebar all write
     these keys. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[K.Q]) { queue = changes[K.Q].newValue || []; render(); }
    if (changes[K.HISTORY]) history = changes[K.HISTORY].newValue || [];
    if (changes[K.LOG]) renderLog();
    if (changes[K.ACTIVE] || changes[K.PAUSED]) {
      const on = changes[K.ACTIVE] ? !!changes[K.ACTIVE].newValue : running;
      const pz = changes[K.PAUSED] ? !!changes[K.PAUSED].newValue : paused;
      setRunning(on, pz);
      render();
    }
    if (changes[K.CONC] && changes[K.CONC].newValue) $('conc').value = String(changes[K.CONC].newValue);
  });

  // Keep "…s ago" honest without re-rendering constantly.
  setInterval(() => { if (queue.length) render(); }, 15000);

  /* ─────────────────────────── boot ─────────────────────────── */
  (async () => {
    await loadQ();
    history = (await get(K.HISTORY)) || [];

    const conc = await get(K.CONC);
    if (conc) {
      const opt = [...$('conc').options].find((o) => o.value === String(conc));
      $('conc').value = opt ? String(conc) : '3';
    }
    const s = (await get(K.SETTINGS)) || {};
    $('optSkip').checked = s.skipApplied !== false;
    if (typeof s.concurrency === 'number') $('optConc').value = String(s.concurrency);
    $('optTailor').checked = s.tailor === true;
    $('optTimeout').value = String(Math.round((s.jobTimeoutMs || 180000) / 60000));
    $('optStall').value = String(Math.round((s.stallMs || 15000) / 1000));
    $('optHuman').value = String((s.humanGraceMs || 60000) / 60000);

    const state = await cmd('state');
    setRunning(state.active === true, state.paused === true);
    render();
    await renderLog();
    if (state.active === true) cmd('kick');   // service worker may have just woken up
  })();
})();

/* ── Mailbox (read-only) ───────────────────────────────────────────────────
   Several ATS put a hard stop mid-application: create an account, then click a
   link or type a code that has just been emailed. Connecting a mailbox lets the
   queue clear those unattended.

   What it can do is bounded in ua-mailbox.js, not here: read-only scope, only
   mail from the last few minutes, only from the employer being applied to, and a
   link is only ever followed when it points back at that same employer. */
function mailSend(msg) {
  return new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || {}); }); }
    catch (_) { res({}); }
  });
}
async function refreshMailbox() {
  const s = await mailSend({ type: 'UA_MAIL_STATUS' });
  const state = $('mailState'), connect = $('mailConnect'), disconnect = $('mailDisconnect'), id = $('mailClientId');
  if (!state) return;
  if (s.enabled && s.address) {
    state.textContent = 'Mailbox: ' + s.address + ' (read-only)';
    if (connect) connect.style.display = 'none';
    if (disconnect) disconnect.style.display = '';
    if (id) id.style.display = 'none';
  } else {
    state.textContent = 'Mailbox: not connected';
    if (connect) connect.style.display = '';
    if (disconnect) disconnect.style.display = 'none';
    if (id) { id.style.display = ''; if (s.hasClientId && !id.value) id.placeholder = 'client ID saved'; }
  }
}
function wireMailbox() {
  const connect = $('mailConnect'), disconnect = $('mailDisconnect'), id = $('mailClientId'), state = $('mailState');
  if (connect) connect.addEventListener('click', async () => {
    state.textContent = 'Mailbox: opening Google sign-in…';
    const r = await mailSend({ type: 'UA_MAIL_CONNECT', clientId: id ? id.value.trim() : '' });
    if (!r.ok) state.textContent = 'Mailbox: sign-in failed (' + (r.reason || 'unknown') + ')';
    await refreshMailbox();
  });
  if (disconnect) disconnect.addEventListener('click', async () => {
    await mailSend({ type: 'UA_MAIL_DISCONNECT' });
    await refreshMailbox();
  });
  refreshMailbox();
}
