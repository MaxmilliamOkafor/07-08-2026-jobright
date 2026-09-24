/**
 * ua-diagnostics.js — the run recorder. Lives in the service worker.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four screenshots of a failing 685-job run arrived carrying nothing but a
 * count: "37 failed". The reasons existed — every job records one — but they
 * were scattered across job objects and a per-tab console buffer that dies with
 * the page. There was no way to answer the only question that matters after a
 * bulk run: WHICH ATS is failing, HOW, and HOW OFTEN.
 *
 * So: one durable store, written by every tab, surviving navigations, tab
 * closes and service-worker restarts, and extractable as a single block of text
 * after any run.
 *
 * WHAT IT RECORDS
 * ---------------
 * Two layers, because they answer different questions and have different costs.
 *
 *   AGGREGATE (`ua_diag_agg`) — a counter per `ats|code|reason`. This never
 *   grows with the size of a run, only with the number of DISTINCT problems, so
 *   it is safe to keep forever. It is what says "iCIMS: sign-in wall, 43 jobs".
 *
 *   EVENTS (`ua_diag_events`) — a ring buffer of the most recent individual
 *   events, with the URL and any detail. Capped, because a 685-job run would
 *   otherwise fill storage. It is what lets you look at one specific failure.
 *
 * WHAT IT DOES NOT RECORD
 * -----------------------
 * Field VALUES, never. A diagnostic that carries the answers you gave is a copy
 * of your personal data sitting in extension storage and pasted into whatever
 * you send the report to. Question LABELS are recorded — "Ethnicity",
 * "How many years of Kubernetes experience" — because the label is the whole
 * diagnostic value and the answer is none of it.
 *
 * READING IT
 * ----------
 * `UA_DIAG_REPORT` returns formatted text, in a deliberate order:
 *
 *   1. Outcomes by ATS      — including successes, because "12 failed" means
 *                             nothing without the number that got through.
 *   2. Boards with trouble  — the employer's own domain. Greenhouse is one
 *                             platform served from a hundred careers domains,
 *                             and they do not behave alike; this is the level a
 *                             fix is usually made at.
 *   3. What went wrong      — reasons, counted, worst platform first.
 *   4. Unanswered questions — the exact wording of every required question the
 *                             filler had no answer for. The most actionable
 *                             section in the file.
 *   5. Recent events        — the trail through one particular job.
 */
/* eslint-env serviceworker */
(function () {
  'use strict';

  if (self.__uaDiagnosticsLoaded) return;
  self.__uaDiagnosticsLoaded = true;

  const K = {
    AGG: 'ua_diag_agg',       // { "ats|code|reason": {n, firstAt, lastAt, urls[]} }
    EVENTS: 'ua_diag_events', // ring of recent events
    RUNS: 'ua_diag_runs',     // one summary per run
    QUESTIONS: 'ua_diag_q',   // { "ats|label": {n, kind, lastUrl} }
    BOARDS: 'ua_diag_boards', // { host: {ats, applied, failed, skipped, timeout, reasons} }
  };

  // A 685-job run produces thousands of events. These caps are what keep the
  // store a fixed size rather than one that grows with how much you use it.
  const EVENT_CAP = 1200;
  const URLS_PER_GROUP = 6;     // enough to go and look; not a second copy of the queue
  const RUN_CAP = 10;
  const QUESTION_CAP = 400;
  const BOARD_CAP = 300;
  const MSG_CAP = 240;

  const get = (k) => new Promise((res) => {
    try { chrome.storage.local.get(k, (d) => { void chrome.runtime.lastError; res(d ? d[k] : undefined); }); }
    catch (_) { res(undefined); }
  });
  const set = (obj) => new Promise((res) => {
    try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
    catch (_) { res(); }
  });

  /* Every write is serialized. Twelve job tabs report concurrently, and a
     read-modify-write on a shared counter loses increments otherwise — which
     would make the one number the report exists to provide quietly wrong. */
  let _chain = Promise.resolve();
  function serial(fn) {
    const next = _chain.then(fn).catch(() => {});
    _chain = next;
    return next;
  }

  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || MSG_CAP);

  /* The host, with the tenant stripped where a platform is multi-tenant. Without
     this, 40 SmartRecruiters employers look like 40 separate problems instead of
     one. */
  // A two-letter-ish second level that is part of the suffix, not the name:
  // acme.co.uk is the company, so the key has to keep three labels there.
  const PUBLIC_SLD = /^(co|com|org|net|ac|gov|edu|gouv|mil)$/;
  /* The board view wants the OPPOSITE of hostKey: the full hostname, because
     careers-amd.icims.com and careers-xyz.icims.com are different employers
     with different walls, and collapsing them to "icims.com" throws away the
     one thing that tells them apart. */
  function fullHost(url) {
    try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); }
    catch (_) { return '?'; }
  }
  function hostKey(url) {
    try {
      const h = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
      const parts = h.split('.').filter(Boolean);
      if (parts.length <= 2) return h;
      const take = PUBLIC_SLD.test(parts[parts.length - 2]) && parts.length > 2 ? 3 : 2;
      return parts.slice(-take).join('.');
    } catch (_) { return '?'; }
  }

  async function record(ev) {
    const ats = clip(ev.ats || 'unknown', 40) || 'unknown';
    const code = clip(ev.code || 'unknown', 40) || 'unknown';
    const reason = clip(ev.reason || ev.msg || '', MSG_CAP);
    const at = Date.now();

    await serial(async () => {
      const agg = (await get(K.AGG)) || {};
      const key = `${ats}|${code}|${reason}`;
      const row = agg[key] || { n: 0, firstAt: at, urls: [], host: hostKey(ev.url) };
      row.n++;
      row.lastAt = at;
      if (ev.url && row.urls.length < URLS_PER_GROUP && !row.urls.includes(ev.url)) row.urls.push(ev.url);
      agg[key] = row;

      const events = (await get(K.EVENTS)) || [];
      events.push({
        t: at, ats, code,
        reason,
        url: clip(ev.url, 300),
        detail: ev.detail ? clip(JSON.stringify(ev.detail), 400) : '',
      });
      while (events.length > EVENT_CAP) events.shift();

      const patch = { [K.AGG]: agg, [K.EVENTS]: events };

      /* THE BOARD, as distinct from the platform. Greenhouse is one ATS, but it
         is served from job-boards.greenhouse.io and from a hundred employers'
         own careers domains, and those do not behave alike — a white-labelled
         board wraps the same form in its own navigation, its own account wall
         and its own consent text. Keeping the platform view and the board view
         separate is what makes it possible to say "Greenhouse is fine, but
         careers.acme.com specifically is not". */
      const OUTCOME_OF = { 'job.done': 'applied', 'job.failed': 'failed', 'job.skipped': 'skipped', 'job.timeout': 'timeout' };
      const kind = OUTCOME_OF[code];
      if (kind && ev.url) {
        const boards = (await get(K.BOARDS)) || {};
        const host = fullHost(ev.url);
        const b = boards[host] || { ats, applied: 0, failed: 0, skipped: 0, timeout: 0, reasons: {} };
        b[kind]++;
        b.ats = ats !== 'unknown' ? ats : b.ats;   // a later, better detection wins
        if (reason) b.reasons[reason] = (b.reasons[reason] || 0) + 1;
        boards[host] = b;
        const bk = Object.keys(boards);
        if (bk.length > BOARD_CAP) {
          const size = (h) => boards[h].applied + boards[h].failed + boards[h].skipped + boards[h].timeout;
          bk.sort((x, y) => size(x) - size(y));
          for (const h of bk.slice(0, bk.length - BOARD_CAP)) delete boards[h];
        }
        patch[K.BOARDS] = boards;
      }

      /* A required question we could not answer is the single most actionable
         thing in here: it names, in the employer's own words, a question the
         filler has no answer for. Kept in its own table so it is not buried
         among a thousand routine events. */
      if (code === 'field.unanswered' && reason) {
        const qs = (await get(K.QUESTIONS)) || {};
        const qk = `${ats}|${reason}`;
        const q = qs[qk] || { n: 0, kind: clip(ev.kind, 20) };
        q.n++;
        q.lastUrl = clip(ev.url, 300);
        qs[qk] = q;
        // Oldest-first eviction, so a long-running store keeps what is current.
        const keys = Object.keys(qs);
        if (keys.length > QUESTION_CAP) {
          keys.sort((a, b) => (qs[a].n || 0) - (qs[b].n || 0));
          for (const k of keys.slice(0, keys.length - QUESTION_CAP)) delete qs[k];
        }
        patch[K.QUESTIONS] = qs;
      }

      await set(patch);
    });
  }

  async function noteRun(summary) {
    await serial(async () => {
      const runs = (await get(K.RUNS)) || [];
      runs.push({
        at: Date.now(),
        total: summary.total | 0,
        done: summary.done | 0,
        failed: summary.failed | 0,
        skipped: summary.skipped | 0,
      });
      while (runs.length > RUN_CAP) runs.shift();
      await set({ [K.RUNS]: runs });
    });
  }

  const when = (ts) => { try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 19); } catch (_) { return '?'; } };

  async function report() {
    const agg = (await get(K.AGG)) || {};
    const events = (await get(K.EVENTS)) || [];
    const runs = (await get(K.RUNS)) || [];
    const questions = (await get(K.QUESTIONS)) || {};

    const rows = Object.keys(agg).map((k) => {
      const [ats, code, reason] = k.split('|');
      return Object.assign({ ats, code, reason }, agg[k]);
    });
    if (!rows.length && !events.length) {
      return 'Jobright diagnostics — nothing recorded yet.\n\nRun a batch, then extract again.';
    }

    const out = [];
    out.push('JOBRIGHT AUTOFILL — DIAGNOSTIC REPORT');
    out.push(when(Date.now()));
    out.push('');

    if (runs.length) {
      out.push('RECENT RUNS');
      for (const r of runs.slice(-5).reverse()) {
        out.push(`  ${when(r.at)}  ${r.total} jobs — ${r.done} applied, ${r.failed} failed, ${r.skipped} skipped`);
      }
      out.push('');
    }

    /* OUTCOMES FIRST. A report that only lists failures cannot tell you whether
       an ATS is broken or merely rare: "SmartRecruiters, 12 failed" reads very
       differently next to 0 applied than next to 60. Successes are recorded for
       exactly that reason, and the rate is the number worth reading. */
    const OUTCOME = { 'job.done': 'applied', 'job.failed': 'failed', 'job.skipped': 'skipped', 'job.timeout': 'timeout' };
    const tally = new Map();
    for (const r of rows) {
      const kind = OUTCOME[r.code];
      if (!kind) continue;
      const cur = tally.get(r.ats) || { applied: 0, failed: 0, skipped: 0, timeout: 0 };
      cur[kind] += r.n;
      tally.set(r.ats, cur);
    }
    if (tally.size) {
      const totalOf = (t) => t.applied + t.failed + t.skipped + t.timeout;
      out.push('OUTCOMES BY ATS  (every job, not just the bad ones)');
      out.push('');
      out.push('      applied  failed  skipped  timeout   rate   ATS');
      const ordered = [...tally.entries()].sort((a, b) => (b[1].failed + b[1].timeout) - (a[1].failed + a[1].timeout));
      const sum = { applied: 0, failed: 0, skipped: 0, timeout: 0 };
      for (const [ats, t] of ordered) {
        for (const k of Object.keys(sum)) sum[k] += t[k];
        const attempted = t.applied + t.failed + t.timeout;   // a skip was never attempted
        const rate = attempted ? Math.round((t.applied / attempted) * 100) + '%' : '—';
        out.push(`  ${String(t.applied).padStart(9)}${String(t.failed).padStart(8)}` +
          `${String(t.skipped).padStart(9)}${String(t.timeout).padStart(9)}` +
          `${String(rate).padStart(7)}   ${ats}`);
      }
      const att = sum.applied + sum.failed + sum.timeout;
      out.push(`  ${String(sum.applied).padStart(9)}${String(sum.failed).padStart(8)}` +
        `${String(sum.skipped).padStart(9)}${String(sum.timeout).padStart(9)}` +
        `${String(att ? Math.round((sum.applied / att) * 100) + '%' : '—').padStart(7)}   ALL (${totalOf(sum)} jobs)`);
      out.push('');
    }

    /* Then the same cut by BOARD. An employer's own careers domain is where a
       platform that "works" turns out not to, and it is the level at which a
       fix is usually made. Only boards that actually had trouble are listed —
       the ones that simply work need no attention. */
    const boards = (await get(K.BOARDS)) || {};
    const bRows = Object.keys(boards).map((h) => Object.assign({ host: h }, boards[h]))
      .filter((b) => b.failed + b.timeout > 0)
      .sort((a, b) => (b.failed + b.timeout) - (a.failed + a.timeout));
    if (bRows.length) {
      out.push('BOARDS WITH TROUBLE  (the employer\'s own domain, not the platform)');
      out.push('');
      for (const b of bRows.slice(0, 40)) {
        const attempted = b.applied + b.failed + b.timeout;
        const rate = attempted ? Math.round((b.applied / attempted) * 100) + '%' : '—';
        out.push(`  ${b.host}  [${b.ats}]  —  ${b.applied} applied, ${b.failed + b.timeout} failed, ${b.skipped} skipped  (${rate})`);
        const top = Object.keys(b.reasons).sort((x, y) => b.reasons[y] - b.reasons[x]).slice(0, 3);
        for (const r of top) out.push(`        ${b.reasons[r]}x  ${r}`);
      }
      if (bRows.length > 40) out.push(`  …and ${bRows.length - 40} more boards`);
      out.push('');
    }

    /* Then the reasons. A bulk run's failures are almost never spread evenly;
       they pile up on two or three platforms, and that is the fix list. */
    /* A stage is a breadcrumb, not a problem. "ADP WorkforceNow — 261 problems",
       of which 259 were stage: answering dropdowns and friends, buried the two
       entries that actually needed reading. The trail still exists in RECENT
       EVENTS, where it belongs. */
    const NOT_A_PROBLEM = /^(job\.done|stage(\.|$))/;
    const byAts = new Map();
    for (const r of rows) {
      if (NOT_A_PROBLEM.test(r.code)) continue;
      const cur = byAts.get(r.ats) || { n: 0, rows: [] };
      cur.n += r.n;
      cur.rows.push(r);
      byAts.set(r.ats, cur);
    }
    const atsList = [...byAts.entries()].sort((a, b) => b[1].n - a[1].n);
    if (atsList.length) {
      out.push('WHAT WENT WRONG, BY ATS  (worst first — this is the fix list)');
      out.push('');
      for (const [ats, group] of atsList) {
        out.push(`  ${ats}  —  ${group.n} problem${group.n === 1 ? '' : 's'}`);
        for (const r of group.rows.sort((a, b) => b.n - a.n)) {
          out.push(`      ${String(r.n).padStart(4)}x  ${r.code}${r.reason ? ': ' + r.reason : ''}`);
          for (const u of r.urls) out.push(`            ${u}`);
        }
        out.push('');
      }
    }

    const qRows = Object.keys(questions).map((k) => {
      const i = k.indexOf('|');
      return { ats: k.slice(0, i), label: k.slice(i + 1), n: questions[k].n, kind: questions[k].kind, url: questions[k].lastUrl };
    }).sort((a, b) => b.n - a.n);
    if (qRows.length) {
      out.push('REQUIRED QUESTIONS LEFT UNANSWERED  (each one is a form that could not submit)');
      out.push('');
      for (const q of qRows.slice(0, 60)) {
        out.push(`  ${String(q.n).padStart(4)}x  [${q.ats}]${q.kind ? ' <' + q.kind + '>' : ''} ${q.label}`);
        if (q.url) out.push(`            ${q.url}`);
      }
      if (qRows.length > 60) out.push(`  …and ${qRows.length - 60} more`);
      out.push('');
    }

    out.push(`RECENT EVENTS  (last ${Math.min(events.length, 80)} of ${events.length})`);
    out.push('');
    for (const e of events.slice(-80)) {
      out.push(`  ${when(e.t)}  [${e.ats}] ${e.code}${e.reason ? ': ' + e.reason : ''}`);
      if (e.url) out.push(`            ${e.url}`);
      if (e.detail) out.push(`            ${e.detail}`);
    }

    return out.join('\n');
  }

  async function clear() {
    await serial(() => set({ [K.AGG]: {}, [K.EVENTS]: [], [K.QUESTIONS]: {}, [K.BOARDS]: {} }));
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'UA_DIAG') {
        /* The URL comes from the SENDER, not from the message. A content script
           can be wrong about where it is after a redirect, and the tab's own URL
           is the one that will still make sense when you read the report. */
        const url = (sender && sender.tab && sender.tab.url) || msg.url || '';
        record(Object.assign({}, msg.ev || {}, { url }));
        try { sendResponse({ ok: true }); } catch (_) {}
        return false;
      }
      if (msg.type === 'UA_DIAG_RUN') {
        noteRun(msg.summary || {});
        try { sendResponse({ ok: true }); } catch (_) {}
        return false;
      }
      if (msg.type === 'UA_DIAG_REPORT') {
        // Both outcomes reply. A report that throws must not leave the viewer
        // sitting on "Reading…" until the port is torn down.
        report().then((text) => { try { sendResponse({ ok: true, text }); } catch (_) {} },
          (e) => { try { sendResponse({ ok: false, text: 'Diagnostics failed to build: ' + ((e && e.message) || e) }); } catch (_) {} });
        return true;   // async
      }
      if (msg.type === 'UA_DIAG_CLEAR') {
        clear().then(() => { try { sendResponse({ ok: true }); } catch (_) {} },
          () => { try { sendResponse({ ok: false }); } catch (_) {} });
        return true;
      }
    });
  } catch (_) {}

  // Exposed for the tests, which drive these directly rather than through the
  // message plumbing.
  self.__uaDiag = { record, report, clear, noteRun, hostKey, fullHost };
})();
