/**
 * ua-debugger.js — the run debugger's recorder. Lives in the service worker.
 *
 * WHY THIS EXISTS
 * ---------------
 * "1 applied · 3 skipped · 120 failed — Most failures: Form filled but no Submit
 * control was found (5)". 120 failures and a headline that explains five of
 * them: the reasons were grouped by their exact text (which carries a field
 * name, a host, a number), and everything that led up to each one was gone
 * with the tab. There was no way to look at job 37 and see what it did.
 *
 * So every queue job now leaves a complete record, kept after the tab closes:
 *   • its timeline — every [UA] log line, each page it reached (URL + ATS), each
 *     stage, every diagnostic, every error, every Workday-engine step;
 *   • a snapshot of the page when it ended — every field with its label, value
 *     (passwords masked), required flag and error; the unanswered required
 *     questions; the error banners; the buttons that were on screen;
 *   • a screenshot when a job did not succeed (when its tab was the one showing);
 *   • its outcome and reason, plus the reason's GROUP ("Validation errors could
 *     not be resolved"), so 120 failures fold into the handful of causes they are.
 * The Debugger page (ua-debug.html) reads it.
 *
 * Everything stays in this browser's extension storage. Nothing is sent
 * anywhere; Export / Copy on the Debugger page are the only ways out, and you
 * press them.
 *
 * Storage (chrome.storage.local, unlimitedStorage):
 *   ua_dbg_index          [{ id, url, title, company, board, ats, status, reason, group, startedAt, endedAt, lines, pages, shot, snap }]
 *   ua_dbg_job:<id>       { id, lines: [{t, k, m, p}], pages: [{t, url, ats, title}], snap }
 *   ua_dbg_shot:<id>      data:image/jpeg… (the most recent SHOT_CAP only)
 */
/* eslint-env serviceworker */
(function () {
  'use strict';

  if (self.__uaDebuggerLoaded) return;
  self.__uaDebuggerLoaded = true;

  const IDX = 'ua_dbg_index';
  const REC = (id) => 'ua_dbg_job:' + id;
  const SHOT = (id) => 'ua_dbg_shot:' + id;
  const JOB_CAP = 600;          // jobs kept (oldest dropped with their records)
  const LINE_CAP = 3000;        // timeline lines per job
  const SHOT_CAP = 40;          // screenshots kept
  const TERMINAL = ['done', 'failed', 'timeout', 'skipped'];

  const get = (k) => new Promise((res) => {
    try { chrome.storage.local.get(k, (d) => { void chrome.runtime.lastError; res(d ? (typeof k === 'string' ? d[k] : d) : undefined); }); }
    catch (_) { res(undefined); }
  });
  const set = (obj) => new Promise((res) => {
    try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); } catch (_) { res(); }
  });
  const del = (keys) => new Promise((res) => {
    try { chrome.storage.local.remove(keys, () => { void chrome.runtime.lastError; res(); }); } catch (_) { res(); }
  });

  // One write at a time: lines from several tabs land in the same index.
  let chain = Promise.resolve();
  const serial = (fn) => (chain = chain.then(fn, fn).catch(() => {}));

  /* The cause, without the specifics that made every failure its own group:
     "Validation errors could not be resolved — First Name: required" and
     "… — Phone: invalid" are one problem. Same function as the run panel's. */
  function reasonGroup(r) {
    let s = String(r || '').trim();
    if (!s) return 'no reason recorded';
    s = s.split(/\s[—–]\s/)[0];
    s = s.replace(/https?:\/\/\S+/g, '<url>')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      .replace(/\b[\w-]+(\.[\w-]+)*\.(com|io|net|org|eu|co|ai|jobs|uk|ie|de)\b\S*/gi, '<site>')
      .replace(/"[^"]{1,160}"|“[^”]{1,160}”/g, '"…"')
      .replace(/\([^)]{0,200}\)/g, '')
      .replace(/\d+/g, 'N')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .split(/(?<=[a-z>)\]"…])[.!?]\s+(?=[A-Z<"“🔐])/)[0]
      .replace(/[\s.:,;]+$/, '')
      .trim();
    return s.slice(0, 140) || 'no reason recorded';
  }
  self.__uaReasonGroup = reasonGroup;

  async function loadIndex() { return (await get(IDX)) || []; }
  function entryFor(index, id) {
    let e = index.find((x) => x.id === id);
    if (!e) {
      e = { id, url: '', title: '', company: '', board: '', ats: '', status: 'applying', reason: '', group: '', startedAt: Date.now(), endedAt: 0, lines: 0, pages: 0, shot: false, snap: false };
      index.unshift(e);
    }
    return e;
  }
  async function trimIndex(index) {
    if (index.length <= JOB_CAP) return index;
    const drop = index.splice(JOB_CAP);
    await del(drop.flatMap((e) => [REC(e.id), SHOT(e.id)]));
    return index;
  }
  async function loadRec(id) { return (await get(REC(id))) || { id, lines: [], pages: [], snap: null }; }

  function start(id, meta, page) {
    return serial(async () => {
      const index = await loadIndex();
      const e = entryFor(index, id);
      if (meta) {
        for (const k of ['url', 'title', 'company', 'board']) if (meta[k] && !e[k]) e[k] = String(meta[k]).slice(0, 300);
        if (e.status !== 'applying' && meta.fresh) { e.status = 'applying'; e.reason = ''; e.group = ''; e.endedAt = 0; }
      }
      const rec = await loadRec(id);
      if (page && page.url) {
        const last = rec.pages[rec.pages.length - 1];
        if (!last || last.url !== page.url) {
          rec.pages.push({ t: Date.now(), url: String(page.url).slice(0, 500), ats: page.ats || '', title: String(page.title || '').slice(0, 160) });
          rec.lines.push({ t: Date.now(), k: 'page', m: `${page.ats ? '[' + page.ats + '] ' : ''}${page.url}`, p: rec.pages.length });
        }
        if (page.ats && !e.ats) e.ats = page.ats;
      }
      e.pages = rec.pages.length;
      e.lines = rec.lines.length;
      await set({ [IDX]: await trimIndex(index), [REC(id)]: rec });
    });
  }

  function addLines(id, lines) {
    return serial(async () => {
      const index = await loadIndex();
      const e = entryFor(index, id);
      const rec = await loadRec(id);
      for (const l of lines || []) {
        if (!l || l.m == null) continue;
        rec.lines.push({ t: Number(l.t) || Date.now(), k: String(l.k || '').slice(0, 12), m: String(l.m).slice(0, 1200), p: rec.pages.length });
      }
      if (rec.lines.length > LINE_CAP) rec.lines.splice(0, rec.lines.length - LINE_CAP);
      e.lines = rec.lines.length;
      await set({ [IDX]: index, [REC(id)]: rec });
    });
  }

  function finish(id, status, reason) {
    return serial(async () => {
      const index = await loadIndex();
      const e = index.find((x) => x.id === id);
      if (!e) return;
      if (e.endedAt && e.status === status && e.reason === (reason || '')) return;
      e.status = status;
      e.reason = String(reason || '').slice(0, 600);
      e.group = status === 'done' ? '' : reasonGroup(reason);
      e.endedAt = Date.now();
      const rec = await loadRec(id);
      rec.lines.push({ t: Date.now(), k: 'end', m: `${status.toUpperCase()}${reason ? ' — ' + reason : ''}`, p: rec.pages.length });
      e.lines = rec.lines.length;
      await set({ [IDX]: index, [REC(id)]: rec });
    });
  }

  function snapshot(id, snap, sender) {
    return serial(async () => {
      const index = await loadIndex();
      const e = entryFor(index, id);
      const rec = await loadRec(id);
      rec.snap = Object.assign({ at: Date.now() }, snap || {});
      e.snap = true;
      await set({ [IDX]: index, [REC(id)]: rec });
    }).then(() => (snap && snap.shot ? shot(id, sender) : undefined));
  }

  /* A picture of the page, when its tab is the one on screen (Chrome can only
     capture the visible tab of a window). Kept for the last SHOT_CAP jobs. */
  function shot(id, sender) {
    const tab = sender && sender.tab;
    if (!tab || !tab.active || tab.windowId == null) return Promise.resolve();
    return new Promise((res) => {
      try {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 }, (url) => {
          void chrome.runtime.lastError;
          if (!url) return res();
          serial(async () => {
            const index = await loadIndex();
            const e = index.find((x) => x.id === id);
            if (e) e.shot = true;
            const withShots = index.filter((x) => x.shot);
            const old = withShots.slice(SHOT_CAP);
            for (const o of old) o.shot = false;
            await set({ [IDX]: index, [SHOT(id)]: url });
            if (old.length) await del(old.map((o) => SHOT(o.id)));
          }).then(res, res);
        });
      } catch (_) { res(); }
    });
  }

  /* Outcomes from the queue itself — every path that ends a job (the runner,
     the Queue Manager, a timeout in this worker, a tab that died) writes it. */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.ua_q) return;
      const nv = changes.ua_q.newValue || [];
      const ov = changes.ua_q.oldValue || [];
      const was = new Map(ov.map((j) => [j && j.id, j && j.status]));
      for (const j of nv) {
        if (!j || !j.id || !TERMINAL.includes(j.status) || was.get(j.id) === j.status) continue;
        finish(String(j.id), j.status, j.error || j.reason || j.result || '');
      }
    });
  } catch (_) {}

  /* ── ONE FILE WITH EVERYTHING ──────────────────────────────────────────────
     What "Download debug log" saves: the summary (counts, failures by cause),
     every job's record (timeline, pages, end-of-page snapshot, screenshot),
     the diagnostics report, the queue and the Queue Manager's log, the Workday
     engine's and the mailbox's logs, settings, the profile, and the page's own
     in-memory log. Never passwords, site logins, tokens, or your CV file —
     their key names are listed under "omitted" so it is clear they exist. */
  const SECRET_KEY_RE = /password|passwd|token|secret|ats_logins|site_pw|WORKDAY_SIGNUP|client_id|cookie|_auth|credential|ua_resume|ua_resumes|cv_profile|mail_account/i;
  async function bundle(page) {
    const all = (await get(null)) || {};
    const index = all[IDX] || [];
    const n = (f) => index.filter(f).length;
    const causes = {};
    for (const e of index) {
      if (!['failed', 'timeout'].includes(e.status) && !(e.status === 'skipped' && e.reason)) continue;
      const g = `${e.status === 'skipped' ? 'skipped' : 'failed'}: ${e.group || reasonGroup(e.reason)}`;
      (causes[g] = causes[g] || { count: 0, ats: {}, examples: [] }).count++;
      causes[g].ats[e.ats || e.board || '?'] = (causes[g].ats[e.ats || e.board || '?'] || 0) + 1;
      if (causes[g].examples.length < 5) causes[g].examples.push({ url: e.url, reason: e.reason });
    }
    const jobs = index.map((e) => ({ ...e, record: all[REC(e.id)] || null, screenshot: all[SHOT(e.id)] || null }));
    const settings = {}, logs = {}, other = {}, omitted = [];
    for (const [k, v] of Object.entries(all)) {
      if (k === IDX || k.startsWith('ua_dbg_job:') || k.startsWith('ua_dbg_shot:')) continue;
      if (SECRET_KEY_RE.test(k)) { omitted.push(k); continue; }
      if (!/^(ua_|wd:|oh|candidateDetails|userDetails)/.test(k)) { omitted.push(k + ' (Jobright\'s own)'); continue; }
      let size = 0;
      try { size = JSON.stringify(v).length; } catch (_) {}
      if (size > 400000) { omitted.push(`${k} (${Math.round(size / 1024)} KB)`); continue; }
      if (/log|diag|events|_q$|_mgr_run|fails|unknown|created/.test(k)) logs[k] = v;
      else if (/^ua_(aa|q_speed|queue_tailor|wd_assist|wd_engine_off|mgr_settings|mgr_concurrency|skip|speed|mail_enabled|mail_gmail_session)/.test(k)) settings[k] = v;
      else other[k] = v;
    }
    let diagReport = '';
    try { diagReport = typeof self.__uaDiagReport === 'function' ? await self.__uaDiagReport() : ''; } catch (_) {}
    let version = '';
    try { version = chrome.runtime.getManifest().version; } catch (_) {}
    const out = {
      what: 'Jobright debug log — everything the Debugger and the recorder have',
      exportedAt: new Date().toISOString(),
      extensionVersion: version,
      page: page || null,
      summary: {
        jobs: index.length, applied: n((e) => e.status === 'done'), failed: n((e) => ['failed', 'timeout'].includes(e.status)),
        skipped: n((e) => e.status === 'skipped'), running: n((e) => !e.endedAt),
        causes: Object.entries(causes).sort((a, b) => b[1].count - a[1].count).map(([cause, c]) => ({ cause, ...c })),
      },
      diagnosticsReport: diagReport,
      jobs,
      logs,
      settings,
      other,
      omitted,
    };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return { name: `jobright-debug-${stamp}.json`, json: JSON.stringify(out, null, 1) };
  }

  function openPage(hash) {
    const url = chrome.runtime.getURL('ua-debug.html') + (hash ? '#' + hash : '');
    // Opened because you asked: in front, even during a run (the run's tab guard lets this one through).
    try { chrome.tabs.create({ url, active: true, __uaAllowFront: true, __uaOwn: true }, () => void chrome.runtime.lastError); } catch (_) {}
  }
  self.__uaOpenDebugger = openPage;

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('UA_DBG_') !== 0) return;
      if (sender && sender.id && sender.id !== chrome.runtime.id) return;
      const id = msg.jobId ? String(msg.jobId).slice(0, 200) : '';
      switch (msg.type) {
        case 'UA_DBG_START': if (id) start(id, msg.meta, msg.page); break;
        case 'UA_DBG_LINES': if (id) addLines(id, msg.lines); break;
        case 'UA_DBG_SNAPSHOT': if (id) snapshot(id, msg.snap, sender); break;
        case 'UA_DBG_END': if (id) finish(id, String(msg.status || 'failed'), msg.reason); break;
        case 'UA_DBG_OPEN': openPage(msg.hash || ''); break;
        case 'UA_DBG_BUNDLE':
          bundle(msg.page).then((b) => { try { sendResponse({ ok: true, ...b }); } catch (_) {} },
            (e) => { try { sendResponse({ ok: false, error: String((e && e.message) || e) }); } catch (_) {} });
          return true;
        case 'UA_DBG_CLEAR':
          serial(async () => {
            const index = await loadIndex();
            await del([IDX, ...index.flatMap((e) => [REC(e.id), SHOT(e.id)])]);
          }).then(() => { try { sendResponse({ ok: true }); } catch (_) {} });
          return true;
        default: return;
      }
      try { sendResponse({ ok: true }); } catch (_) {}
    });
  } catch (_) {}
})();
