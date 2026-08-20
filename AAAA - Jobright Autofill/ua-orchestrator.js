/**
 * ua-orchestrator.js — background (service-worker) queue engine for the
 * CSV bulk-apply automation. Loaded from `static/background/index.js` with a
 * single appended `importScripts()` line; nothing in Jobright's own bundle is
 * modified, so a future Jobright patch can be dropped in and re-appended.
 *
 * WHY IT LIVES HERE
 * -----------------
 * Previously the whole orchestrator ran inside ua-queue.html (the side panel).
 * Chrome destroys a side-panel document the moment the panel is closed, so
 * closing the panel — or letting Chrome collapse it — killed the run mid-way:
 * job tabs were left open, jobs stayed stuck on `applying` forever, and nothing
 * ever opened the next tab. Running the engine in the service worker fixes that
 * class of failure outright: the panel is now only a view, and the run survives
 * the panel closing, the manager tab closing, and service-worker restarts
 * (all state is in chrome.storage.local, and a chrome.alarms heartbeat rebuilds
 * the in-memory view and refills slots after every restart).
 *
 * STORAGE PROTOCOL (chrome.storage.local) — shared with ua-queue.js + ua-enhancement.js
 *   ua_q               : Job[]                       the queue itself
 *   ua_mgr_active      : boolean                     a run is in progress
 *   ua_mgr_paused      : boolean                     run is paused (no new tabs open)
 *   ua_mgr_concurrency : number 1..8                 parallel background tabs
 *   ua_mgr_settings    : { skipApplied, tailor, jobTimeoutMs, interJobDelayMs }
 *   ua_mgr_tabs        : { [jobId]: tabId }          tabs WE own (persisted)
 *   ua_mgr_advance     : { id, status, ts }          last terminal result (legacy channel)
 *   ua_mgr_log         : string[]                    ring buffer rendered by the panel
 *   ua_mgr_run         : { startedAt, total }        current run summary
 *
 * Job.status: pending | applying | done | failed | timeout | skipped
 */
/* eslint-env serviceworker */
(function () {
  'use strict';

  if (self.__uaOrchestratorLoaded) return;
  self.__uaOrchestratorLoaded = true;

  const K = {
    Q: 'ua_q',
    ACTIVE: 'ua_mgr_active',
    PAUSED: 'ua_mgr_paused',
    CONC: 'ua_mgr_concurrency',
    SETTINGS: 'ua_mgr_settings',
    TABS: 'ua_mgr_tabs',
    ADVANCE: 'ua_mgr_advance',
    LOG: 'ua_mgr_log',
    RUN: 'ua_mgr_run',
    OLD_RUNNER: 'ua_qa',      // the legacy in-page single-tab runner — mutually exclusive
  };
  const ALARM = 'ua_mgr_watchdog';
  // At most this many CAPTCHA'd tabs are left open waiting for you at once. Past
  // that the oldest is given up on, so a challenge-heavy CSV cannot bury you in
  // parked tabs.
  const MAX_PARKED = 3;
  /* A job tab reports a heartbeat every 5s, so this is three missed beats. The
     beat had to be made twice as fast to support a window this tight: at the old
     10s interval, 15s of silence was 1.5 beats and a single delayed one would
     have looked like a dead tab. */
  const HEARTBEAT_DEAD_MS = 15 * 1000;
  /* A page that is LOADING has no content script, so it cannot beat — a reload,
     a redirect or a slow ATS page would otherwise look exactly like a crashed
     tab and get killed mid-run. This is how long a tab may take to come back
     after a navigation before we stop giving it the benefit of the doubt. */
  const NAV_GRACE_MS = 45 * 1000;
  const LOG_CAP = 200;
  const DEFAULTS = {
    skipApplied: true,
    tailor: false,
    jobTimeoutMs: 3 * 60 * 1000,   // hard cap per job — the backstop, not the usual exit
    stallMs: 15 * 1000,            // no progress for this long → skip the job and move on
    humanGraceMs: 60 * 1000,       // how long a CAPTCHA'd job waits for you before it is dropped
    interJobDelayMs: 800,          // breathing room between tab opens
  };

  /* ─────────────────────────── storage helpers ─────────────────────────── */
  const get = (k) => new Promise((res) => {
    try { chrome.storage.local.get(k, (d) => { void chrome.runtime.lastError; res(d ? d[k] : undefined); }); }
    catch (_) { res(undefined); }
  });
  const set = (obj) => new Promise((res) => {
    try { chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; res(); }); }
    catch (_) { res(); }
  });

  /* Every queue mutation goes through one serialized read-modify-write chain.
     Job tabs, the panel and the watchdog all write `ua_q` concurrently; without
     this, a slower writer holding a stale array silently reverted a sibling
     tab's result (the "job finished but went back to pending" bug). */
  let _chain = Promise.resolve();
  function withQueue(fn) {
    const next = _chain.then(async () => {
      const q = (await get(K.Q)) || [];
      const out = await fn(q);
      await set({ [K.Q]: q });
      return out;
    }).catch((e) => { log('queue error: ' + (e && e.message), 'err'); });
    _chain = next.catch(() => {});
    return next;
  }

  async function log(msg, cls) {
    try {
      const line = JSON.stringify({ t: Date.now(), m: String(msg), c: cls || '' });
      const buf = (await get(K.LOG)) || [];
      buf.push(line);
      while (buf.length > LOG_CAP) buf.shift();
      await set({ [K.LOG]: buf });
    } catch (_) {}
  }

  /* ─────────────────────────── tab-map helpers ─────────────────────────── */
  async function tabMap() { return (await get(K.TABS)) || {}; }
  async function setTabMap(m) { await set({ [K.TABS]: m }); }
  async function jobIdForTab(tabId) {
    const m = await tabMap();
    for (const id of Object.keys(m)) if (m[id] === tabId) return id;
    return null;
  }
  async function untrack(jobId) {
    const m = await tabMap();
    if (!(jobId in m)) return undefined;
    const tabId = m[jobId];
    delete m[jobId];
    await setTabMap(m);
    return tabId;
  }
  function closeTab(tabId) {
    if (tabId == null) return;
    try { chrome.tabs.remove(tabId, () => void chrome.runtime.lastError); } catch (_) {}
  }
  async function closeJobTab(jobId) { closeTab(await untrack(jobId)); }

  /* Drop map entries whose tab no longer exists (browser restart, crash, user
     closed everything). Returns the live map. */
  async function reconcileTabs() {
    const m = await tabMap();
    const ids = Object.keys(m);
    if (!ids.length) return m;
    const live = {};
    await Promise.all(ids.map((jobId) => new Promise((res) => {
      try {
        chrome.tabs.get(m[jobId], (tab) => {
          if (!chrome.runtime.lastError && tab) live[jobId] = m[jobId];
          res();
        });
      } catch (_) { res(); }
    })));
    if (Object.keys(live).length !== ids.length) await setTabMap(live);
    return live;
  }

  /* ─────────────────────────── settings ─────────────────────────── */
  async function settings() {
    const s = (await get(K.SETTINGS)) || {};
    return {
      skipApplied: typeof s.skipApplied === 'boolean' ? s.skipApplied : DEFAULTS.skipApplied,
      tailor: typeof s.tailor === 'boolean' ? s.tailor : DEFAULTS.tailor,
      jobTimeoutMs: Math.max(60000, Number(s.jobTimeoutMs) || DEFAULTS.jobTimeoutMs),
      stallMs: Math.max(5000, Number(s.stallMs) || DEFAULTS.stallMs),
      humanGraceMs: Math.max(15000, Number(s.humanGraceMs) || DEFAULTS.humanGraceMs),
      interJobDelayMs: Math.max(0, Number(s.interJobDelayMs) ?? DEFAULTS.interJobDelayMs),
      // Lives in its own key (the slot filler reads it directly on every pass, so
      // a change takes effect on the next job rather than the next run), but it is
      // reported here so the panel can show the value actually in force.
      concurrency: Math.min(8, Math.max(1, parseInt(await get(K.CONC), 10) || 3)),
    };
  }
  async function concurrency() {
    const n = parseInt(await get(K.CONC), 10);
    return Math.min(8, Math.max(1, isNaN(n) ? 3 : n));
  }

  /* Only ever navigate to real web pages. A CSV can contain anything, and this
     runs with extension privileges — `javascript:`, `data:` and `file:` rows
     must never reach chrome.tabs.create. */
  function isSafeUrl(u) {
    try { const p = new URL(String(u)).protocol; return p === 'http:' || p === 'https:'; }
    catch (_) { return false; }
  }

  /* ─────────────────────────── assignment ─────────────────────────── */
  /* Push the job assignment into a tab. The content script may not be ready the
     instant the tab is created, and the page redirects (Jobright → ATS → apply
     form), so we retry and also re-send on every completed navigation. The
     content script can additionally PULL its assignment (UA_MGR_WHOAMI), which
     covers the case where every push landed before it booted. */
  /* Reach the frames the manifest cannot. The content script is declared
     all_frames:false (running the full module in every ad frame of every page
     would be wasteful), but several ATS — Greenhouse embeds, iCIMS,
     SuccessFactors, Taleo, BrassRing — put the actual application form in a
     CROSS-ORIGIN iframe that the top document cannot see into. For a job tab, and
     only a job tab, inject the script into every frame; it runs a fill-only path
     there and is idempotent in the top frame. */
  function injectAllFrames(tabId) {
    try {
      if (!chrome.scripting || !chrome.scripting.executeScript) return;
      chrome.scripting.executeScript(
        { target: { tabId, allFrames: true }, files: ['ua-enhancement.js'] },
        () => void chrome.runtime.lastError,   // frames we may not touch just fail
      );
    } catch (_) {}
  }

  function assign(tabId, job, cfg) {
    const payload = {
      type: 'UA_ASSIGN_JOB',
      job: { id: job.id, url: job.url, title: job.title, jobBoard: job.jobBoard, startedAt: job.startedAt },
      settings: cfg,
    };
    let tries = 0;
    const send = () => {
      tries++;
      try {
        chrome.tabs.sendMessage(tabId, payload, { frameId: 0 }, () => {
          const err = chrome.runtime.lastError;   // no receiver yet → still booting
          if (err && tries < 10) setTimeout(send, 1200);
        });
      } catch (_) { if (tries < 10) setTimeout(send, 1200); }
    };
    setTimeout(send, 900);
  }

  /* ─────────────────────────── the engine ─────────────────────────── */
  let _filling = false, _refill = false;
  async function fillSlots() {
    // Calls that arrive while a fill is in flight are not dropped — they're
    // coalesced into one more pass afterwards. Dropping them left slots empty
    // until the next watchdog tick whenever two jobs finished at once.
    if (_filling) { _refill = true; return; }
    _filling = true;
    try {
      if ((await get(K.ACTIVE)) !== true) return;
      if ((await get(K.PAUSED)) === true) return;
      const [cfg, conc, map] = [await settings(), await concurrency(), await reconcileTabs()];

      const toOpen = (await withQueue((q) => {
        // Jobs parked on a CAPTCHA are deliberately excluded: they are waiting on
        // a person, not using the browser, so they must not cost a slot.
        const running = q.filter((j) => j.status === 'applying' && map[j.id] != null && !j.needsHuman).length;
        // An `applying` job with no tab is an orphan (crash / closed tab) — recycle it.
        for (const j of q) if (j.status === 'applying' && map[j.id] == null) { j.status = 'pending'; j.startedAt = null; }
        const slots = conc - running;
        const picked = [];
        if (slots <= 0) return picked;
        for (const j of q) {
          if (picked.length >= slots) break;
          if (j.status !== 'pending') continue;
          if (!isSafeUrl(j.url)) { j.status = 'skipped'; j.error = 'Unsupported URL scheme'; j.completedAt = Date.now(); continue; }
          j.status = 'applying'; j.startedAt = Date.now(); j.error = null;
          picked.push({ id: j.id, url: j.url, title: j.title, jobBoard: j.jobBoard, startedAt: j.startedAt });
        }
        return picked;
      })) || [];   // withQueue returns undefined if its callback threw

      for (const job of toOpen) {
        const tab = await new Promise((res) => {
          // active:false → a 200-job run never steals focus; keep browsing while it works.
          try { chrome.tabs.create({ url: job.url, active: false }, (t) => { void chrome.runtime.lastError; res(t); }); }
          catch (_) { res(null); }
        });
        if (tab && tab.id != null) {
          const m = await tabMap();
          m[job.id] = tab.id;
          await setTabMap(m);
          assign(tab.id, job, cfg);
          injectAllFrames(tab.id);
          log('▶ ' + (job.title || job.url), 'act');
        } else {
          await withQueue((q) => {
            const j = q.find((x) => x.id === job.id);
            if (j) { j.status = 'failed'; j.error = 'Could not open tab'; j.completedAt = Date.now(); }
          });
        }
        if (cfg.interJobDelayMs) await new Promise((r) => setTimeout(r, cfg.interJobDelayMs));
      }

      await maybeFinish();
    } catch (e) {
      log('fillSlots error: ' + (e && e.message), 'err');
    } finally {
      _filling = false;
      if (_refill) { _refill = false; setTimeout(fillSlots, 0); }
    }
  }

  async function maybeFinish() {
    if ((await get(K.ACTIVE)) !== true) return;
    const map = await tabMap();
    const q = (await get(K.Q)) || [];
    const busy = q.some((j) => j.status === 'pending' || (j.status === 'applying' && map[j.id] != null));
    if (busy) return;
    await finish();
  }

  async function finish() {
    const q = (await get(K.Q)) || [];
    const n = (st) => q.filter((j) => j.status === st).length;
    const pending = n('pending');
    /* Refuse to end a run that still has work. Ending here with jobs left is the
       "automation disappeared" symptom — better to say so and pick them up than
       to stop quietly. */
    if (pending > 0) {
      log(`Not finishing — ${pending} job${pending === 1 ? '' : 's'} still pending; restarting the queue`, 'err');
      await fillSlots();
      return;
    }
    await set({ [K.ACTIVE]: false, [K.PAUSED]: false, [K.ADVANCE]: null });
    try { chrome.alarms.clear(ALARM); } catch (_) {}
    const done = n('done'), failed = n('failed') + n('timeout'), skipped = n('skipped');
    await log(`Queue complete — ${done} applied, ${failed} failed, ${skipped} skipped (${q.length} in the list)`, 'ok');
    notify('Jobright queue complete', `${done} applied · ${failed} failed · ${skipped} skipped`);
  }

  function notify(title, message) {
    try {
      chrome.notifications && chrome.notifications.create({
        type: 'basic', iconUrl: chrome.runtime.getURL('icon128.plasmo.3c1ed2d2.png'), title, message,
      }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }

  /* A job reported a terminal status (message from the content script, or the
     legacy ua_mgr_advance storage write). Idempotent: replays are ignored. */
  const _seen = new Map();   // jobId → last ts handled
  async function onResult(res) {
    if (!res || !res.id || !res.status) return;
    const ts = res.ts || Date.now();
    if (_seen.get(res.id) === ts) return;
    _seen.set(res.id, ts);
    if (_seen.size > 500) _seen.clear();

    let label = res.id;
    await withQueue((q) => {
      const j = q.find((x) => x.id === res.id);
      if (!j) return;
      label = j.title || j.url;
      // Never downgrade a job that already reached a terminal state.
      if (j.status !== 'applying') return;
      j.status = res.status;
      j.error = res.error || null;
      j.completedAt = Date.now();
      j.duration = j.completedAt - (j.startedAt || j.completedAt);
    });
    const icon = res.status === 'done' ? '✔' : res.status === 'skipped' ? '↷' : '✖';
    log(`${icon} ${label} — ${res.status}${res.error ? ' (' + res.error + ')' : ''}`,
      res.status === 'done' ? 'ok' : res.status === 'skipped' ? '' : 'err');
    await closeJobTab(res.id);
    await set({ [K.ADVANCE]: { id: res.id, status: res.status, ts } });
    await fillSlots();
  }

  /* ─────────────────────────── commands ─────────────────────────── */
  async function start() {
    const q = (await get(K.Q)) || [];
    if (!q.some((j) => j.status === 'pending' || j.status === 'applying')) {
      await log('No pending jobs — import a CSV first', 'err');
      return { ok: false, reason: 'empty' };
    }
    // The legacy in-page single-tab runner and this manager must never both drive.
    if (await get(K.OLD_RUNNER)) {
      await set({ [K.OLD_RUNNER]: false });
      await log('Stopped the in-page runner (manager takes over)');
    }
    // Close anything left over from a previous run before re-queuing.
    const map = await tabMap();
    for (const id of Object.keys(map)) closeTab(map[id]);
    await setTabMap({});
    let total = 0;
    await withQueue((jobs) => {
      for (const j of jobs) {
        if (j.status === 'applying') { j.status = 'pending'; j.startedAt = null; }
        delete j.needsHuman; delete j.beatAt; delete j.stage; delete j.pct; delete j.navAt;
      }
      total = jobs.filter((j) => j.status === 'pending').length;
    });
    await set({ [K.ACTIVE]: true, [K.PAUSED]: false, [K.ADVANCE]: null, [K.RUN]: { startedAt: Date.now(), total } });
    const conc = await concurrency();
    await log(`Started — ${total} job${total === 1 ? '' : 's'}, up to ${conc} in parallel background tabs`, 'act');
    armWatchdog();
    await fillSlots();
    return { ok: true, total };
  }

  async function stop() {
    await set({ [K.ACTIVE]: false, [K.PAUSED]: false, [K.ADVANCE]: null });
    try { chrome.alarms.clear(ALARM); } catch (_) {}
    const map = await tabMap();
    for (const id of Object.keys(map)) closeTab(map[id]);
    await setTabMap({});
    await withQueue((q) => { for (const j of q) if (j.status === 'applying') { j.status = 'pending'; j.startedAt = null; } });
    await log('Stopped — job tabs closed, running jobs back to pending');
    return { ok: true };
  }

  async function pause() {
    await set({ [K.PAUSED]: true });
    await log('Paused — running jobs finish, no new tabs open');
    return { ok: true };
  }
  async function resume() {
    await set({ [K.PAUSED]: false });
    await log('Resumed', 'act');
    armWatchdog();
    await fillSlots();
    return { ok: true };
  }

  /* Add a URL to the queue from anywhere (context menu, on-page sidebar). */
  async function addUrl(url, meta) {
    if (!isSafeUrl(url)) return { ok: false, reason: 'bad-url' };
    const norm = normUrl(url);
    let added = false;
    await withQueue((q) => {
      if (q.some((j) => normUrl(j.url) === norm)) return;
      q.push(Object.assign({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        url: norm,
        title: (meta && meta.title) || norm.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60),
        status: 'pending', addedAt: Date.now(), jobBoard: (meta && meta.jobBoard) || '',
        companyName: (meta && meta.companyName) || '',
        error: null, startedAt: null, completedAt: null, duration: null,
      }));
      added = true;
    });
    if (added) await log('＋ queued ' + norm);
    return { ok: true, added };
  }
  /* Must stay byte-for-byte equivalent to the panel's and the content script's
     normalizers — otherwise the same posting queued from two places (a CSV row
     and a right-click "add this page", say) looks like two different jobs and
     gets applied to twice. Tracking params are the usual culprit. */
  function normUrl(u) {
    try {
      const x = new URL(String(u).trim());
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
      x.hash = '';
      for (const p of [...x.searchParams.keys()]) {
        if (/^(utm_[\w-]*|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|_ga|trk|trackingId)$/i.test(p)) x.searchParams.delete(p);
      }
      return x.href.replace(/\/$/, '');
    } catch (_) { return ''; }
  }

  /* ─────────────────────────── watchdog ─────────────────────────── */
  function armWatchdog() {
    try { chrome.alarms.create(ALARM, { periodInMinutes: 1 }); } catch (_) {}
  }

  async function watchdog() {
    if ((await get(K.ACTIVE)) !== true) { try { chrome.alarms.clear(ALARM); } catch (_) {} return; }
    const cfg = await settings();
    const map = await reconcileTabs();
    const stale = [];
    // Oldest-first, so when too many jobs are waiting on you it is the newest that
    // gets dropped rather than the one you are probably already looking at.
    const snapshot = (await get(K.Q)) || [];
    const parked = snapshot
      .filter((j) => j.status === 'applying' && j.needsHuman && j.needsHuman.since)
      .sort((a, b) => a.needsHuman.since - b.needsHuman.since)
      .map((j) => j.id);
    await withQueue((q) => {
      for (const j of q) {
        if (j.status !== 'applying') continue;
        if (map[j.id] == null) continue;              // orphan handling lives in fillSlots
        // Parked on a CAPTCHA: it costs no slot (see fillSlots), so the only
        // question is how long its tab stays open waiting for you.
        if (j.needsHuman && j.needsHuman.since) {
          const waited = Date.now() - j.needsHuman.since;
          const overParked = parked.indexOf(j.id) >= MAX_PARKED;   // oldest kept, newest dropped
          if (waited < cfg.humanGraceMs && !overParked) continue;
          j.status = 'failed';
          j.error = overParked
            ? `${j.needsHuman.provider || 'CAPTCHA'} — too many jobs waiting on you at once`
            : `${j.needsHuman.provider || 'CAPTCHA'} not solved within ${Math.round(cfg.humanGraceMs / 60000)} min`;
          j.completedAt = Date.now();
          delete j.needsHuman;
          stale.push({ id: j.id, label: j.title || j.url });
          continue;
        }
        // Heartbeat gone quiet → the tab or its content script is dead. Do not
        // wait out the full per-job cap for a job that cannot report at all.
        // Still coming back from a navigation (reload / redirect / next page):
        // give it room to boot rather than treating silence as death.
        if (j.navAt && Date.now() - j.navAt < NAV_GRACE_MS) continue;
        const lastBeat = j.beatAt || j.startedAt || 0;
        if (lastBeat && Date.now() - lastBeat > HEARTBEAT_DEAD_MS && Date.now() - (j.startedAt || 0) > HEARTBEAT_DEAD_MS) {
          j.status = 'timeout';
          const silentFor = Math.round((Date.now() - lastBeat) / 1000);
          j.error = j.beatAt
            ? `Tab went silent for ${silentFor}s — dropped (was: ${j.stage || 'unknown'})`
            : `Tab never responded in ${silentFor}s — dropped`;
          j.completedAt = Date.now();
          stale.push({ id: j.id, label: j.title || j.url, why: 'unresponsive' });
          continue;
        }
        if (j.startedAt && Date.now() - j.startedAt > cfg.jobTimeoutMs) {
          j.status = 'timeout';
          j.error = `Watchdog: no result in ${Math.round(cfg.jobTimeoutMs / 60000)} min`;
          j.completedAt = Date.now();
          stale.push({ id: j.id, label: j.title || j.url });
        }
      }
    });
    for (const s of stale) {
      log('⏱ ' + s.label + (s.why === 'unresponsive' ? ' — stopped responding, moving on' : ' — watchdog timeout'), 'err');
      await closeJobTab(s.id);
    }

    /* Stall supervisor. If the run is active with jobs still pending but nothing
       actually running, something went wrong between finishing one job and
       starting the next. That state used to be silent and permanent — the
       automation appeared to vanish while the queue still had work in it. */
    if ((await get(K.PAUSED)) !== true) {
      const liveMap = await reconcileTabs();
      const qNow = (await get(K.Q)) || [];
      const pending = qNow.filter((j) => j.status === 'pending').length;
      const running = qNow.filter((j) => j.status === 'applying' && liveMap[j.id] != null).length;
      if (pending > 0 && running === 0) {
        log(`Queue stalled with ${pending} job${pending === 1 ? '' : 's'} left and nothing running — restarting`, 'err');
        _filling = false;   // clear a guard left set by a crashed pass
        await fillSlots();
      }
    }
    // Close tabs belonging to jobs that are no longer running.
    const q = (await get(K.Q)) || [];
    for (const jobId of Object.keys(map)) {
      const j = q.find((x) => x.id === jobId);
      if (!j || j.status !== 'applying') await closeJobTab(jobId);
    }
    await fillSlots();
  }

  /* ─────────────────────────── chrome wiring ─────────────────────────── */
  try {
    chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === ALARM) watchdog(); });
  } catch (_) {}

  // Re-assign on every completed navigation so the content script on the FINAL
  // apply page (after Jobright → ATS redirects) is the one that gets the job.
  try {
    chrome.tabs.onUpdated.addListener(async (tabId, info) => {
      if ((await get(K.ACTIVE)) !== true) return;

      /* The tab started navigating — a manual reload, a redirect, or the next
         page of a multi-step form. Its content script is being torn down and
         cannot send a heartbeat until the new document boots, so mark the job as
         navigating and restart its liveness clock. Without this, refreshing a
         job tab killed the job and closed the tab. */
      if (info.status === 'loading') {
        const navJobId = await jobIdForTab(tabId);
        if (navJobId) {
          await withQueue((q) => {
            const j = q.find((x) => x.id === navJobId);
            if (j && j.status === 'applying') { j.navAt = Date.now(); j.beatAt = Date.now(); }
          });
        }
        return;
      }
      if (info.status !== 'complete') return;
      const jobId = await jobIdForTab(tabId);
      if (!jobId) return;
      const q = (await get(K.Q)) || [];
      const job = q.find((j) => j.id === jobId);
      if (job && job.status === 'applying') {
        await withQueue((qq) => {
          const j = qq.find((x) => x.id === jobId);
          if (j) { j.navAt = Date.now(); j.beatAt = Date.now(); }   // the page is back
        });
        assign(tabId, job, await settings());
        injectAllFrames(tabId);   // a new document means new frames to reach
      }
    });
  } catch (_) {}

  // A job tab the user closed by hand goes back to pending, and the slot refills.
  try {
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      const jobId = await jobIdForTab(tabId);
      if (!jobId) return;
      await untrack(jobId);
      if ((await get(K.ACTIVE)) !== true) return;
      await withQueue((q) => {
        const j = q.find((x) => x.id === jobId);
        if (j && j.status === 'applying') { j.status = 'pending'; j.startedAt = null; }
      });
      await fillSlots();
    });
  } catch (_) {}

  // Legacy channel: older content-script builds report via ua_mgr_advance only.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[K.ADVANCE] && changes[K.ADVANCE].newValue) onResult(changes[K.ADVANCE].newValue);
      if (changes[K.CONC] && changes[K.CONC].newValue) fillSlots();
    });
  } catch (_) {}

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;

      /* A CAPTCHA (or any other human-only wall) in a background job tab. We do
         not answer it — that check exists for a reason. We make it visible and
         stop it silently eating the job: notify, mark the row, and hold the
         watchdog off while a person is genuinely needed rather than timing the
         job out from under them. */
      if (msg.type === 'UA_JOB_NEEDS_HUMAN') {
        (async () => {
          const tabId = sender && sender.tab && sender.tab.id;
          const jobId = tabId == null ? null : await jobIdForTab(tabId);
          if (!jobId) return sendResponse({ ok: false });
          let label = jobId;
          await withQueue((q) => {
            const j = q.find((x) => x.id === jobId);
            if (!j) return;
            label = j.title || j.url;
            if (msg.blocked) {
              j.needsHuman = { reason: msg.reason || 'captcha', provider: msg.provider || '', since: Date.now(), tabId };
              j.error = (msg.provider ? msg.provider + ' — ' : '') + 'waiting for you to solve it';
            } else {
              delete j.needsHuman;
              if (/waiting for you/.test(j.error || '')) j.error = null;
            }
          });
          if (msg.blocked) {
            log(`✋ ${label} — ${msg.provider || 'CAPTCHA'}: needs you. Its tab stays open; the queue carries on.`, 'err');
            notify('A job needs you', `${msg.provider || 'CAPTCHA'} on ${label}. Open that tab to solve it — the rest of the queue keeps running.`);
            // The job no longer counts against concurrency, so a slot just came
            // free. Use it now rather than waiting for the next watchdog tick.
            await fillSlots();
          } else {
            log(`✓ ${label} — challenge cleared, resuming`, 'ok');
          }
          sendResponse({ ok: true });
        })();
        return true;
      }

      /* Progress heartbeat from a running job tab. */
      if (msg.type === 'UA_JOB_PROGRESS') {
        (async () => {
          const tabId = sender && sender.tab && sender.tab.id;
          const jobId = tabId == null ? null : await jobIdForTab(tabId);
          if (!jobId) return sendResponse({ ok: false });
          await withQueue((q) => {
            const j = q.find((x) => x.id === jobId);
            if (!j || j.status !== 'applying') return;
            j.beatAt = Date.now();
            j.stage = String(msg.stage || '').slice(0, 60);
            if (typeof msg.pct === 'number') j.pct = msg.pct;
          });
          sendResponse({ ok: true });
        })();
        return true;
      }

      if (msg.type === 'UA_JOB_RESULT') {
        onResult({ id: msg.id, status: msg.status, error: msg.error, ts: msg.ts || Date.now() })
          .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
        return true;
      }

      /* "Which tab am I?" — the one thing a content script cannot work out for
         itself, and the thing the in-page runner needs to survive a cross-origin
         navigation. window.name is the only per-tab scratch space a content
         script has, and Chrome CLEARS IT whenever a tab navigates between sites
         (window.name isolation). A CSV run drives ONE tab from greenhouse.io to
         lever.co to smartrecruiters.com, so the runner marker was wiped at the
         first cross-site hop. The service worker's view of a tab id is not
         affected by any of that. */
      if (msg.type === 'UA_WHICH_TAB') {
        const tabId = sender && sender.tab && sender.tab.id;
        sendResponse({ tabId: tabId == null ? null : tabId });
        return true;
      }

      /* Pull-based assignment: a content script that booted after every push
         asks "which job am I?". Answering from the tab id makes assignment
         immune to redirect timing entirely. */
      if (msg.type === 'UA_MGR_WHOAMI') {
        (async () => {
          const tabId = sender && sender.tab && sender.tab.id;
          if (tabId == null || (await get(K.ACTIVE)) !== true) return sendResponse({ job: null });
          const jobId = await jobIdForTab(tabId);
          if (!jobId) return sendResponse({ job: null });
          await withQueue((q) => {
            const j = q.find((x) => x.id === jobId);
            if (j && j.status === 'applying') j.beatAt = Date.now();   // it's alive
          });
          const q = (await get(K.Q)) || [];
          const job = q.find((j) => j.id === jobId && j.status === 'applying');
          sendResponse({ job: job || null, settings: await settings() });
        })();
        return true;
      }

      if (msg.type === 'UA_MGR_CMD') {
        (async () => {
          try {
            switch (msg.cmd) {
              case 'start':  return sendResponse(await start());
              case 'stop':   return sendResponse(await stop());
              case 'pause':  return sendResponse(await pause());
              case 'resume': return sendResponse(await resume());
              case 'kick':   await fillSlots(); return sendResponse({ ok: true });
              case 'add':    return sendResponse(await addUrl(msg.url, msg.meta));
              case 'openManager':
                chrome.tabs.create({ url: chrome.runtime.getURL('ua-queue.html') }, () => void chrome.runtime.lastError);
                return sendResponse({ ok: true });
              case 'state':  return sendResponse({
                ok: true,
                active: (await get(K.ACTIVE)) === true,
                paused: (await get(K.PAUSED)) === true,
                tabs: await tabMap(),
              });
              default: return sendResponse({ ok: false, reason: 'unknown-cmd' });
            }
          } catch (e) { sendResponse({ ok: false, reason: (e && e.message) || 'error' }); }
        })();
        return true;
      }
    });
  } catch (_) {}

  /* Context menu: reach the queue manager and enqueue pages without hunting
     through the puzzle menu. */
  function installMenus() {
    try {
      chrome.contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        chrome.contextMenus.create({ id: 'ua-open-panel', title: 'Jobright Queue Manager (side panel)', contexts: ['all'] }, () => void chrome.runtime.lastError);
        chrome.contextMenus.create({ id: 'ua-open-tab', title: 'Jobright Queue Manager (new tab)', contexts: ['all'] }, () => void chrome.runtime.lastError);
        chrome.contextMenus.create({ id: 'ua-add-page', title: 'Add this page to the Jobright queue', contexts: ['page'] }, () => void chrome.runtime.lastError);
        chrome.contextMenus.create({ id: 'ua-add-link', title: 'Add link to the Jobright queue', contexts: ['link'] }, () => void chrome.runtime.lastError);
      });
    } catch (_) {}
  }
  try {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      try {
        if (info.menuItemId === 'ua-open-panel') {
          const wid = tab && tab.windowId;
          if (chrome.sidePanel && chrome.sidePanel.open && wid != null) {
            chrome.sidePanel.open({ windowId: wid }).catch(() => {
              chrome.tabs.create({ url: chrome.runtime.getURL('ua-queue.html') });
            });
          } else chrome.tabs.create({ url: chrome.runtime.getURL('ua-queue.html') });
        } else if (info.menuItemId === 'ua-open-tab') {
          chrome.tabs.create({ url: chrome.runtime.getURL('ua-queue.html') });
        } else if (info.menuItemId === 'ua-add-page') {
          addUrl((tab && tab.url) || info.pageUrl, { title: tab && tab.title });
        } else if (info.menuItemId === 'ua-add-link') {
          addUrl(info.linkUrl, {});
        }
      } catch (_) {}
    });
  } catch (_) {}

  /* Boot / restart recovery. The service worker is torn down when idle; every
     wake-up re-reconciles tabs and refills slots so a run never silently dies. */
  async function boot() {
    try {
      installMenus();
      if ((await get(K.ACTIVE)) === true) {
        armWatchdog();
        await reconcileTabs();
        await log('Service worker resumed — reconciling running jobs', 'act');
        await fillSlots();
      }
    } catch (_) {}
  }
  try { chrome.runtime.onInstalled.addListener(() => { installMenus(); boot(); }); } catch (_) {}
  try { chrome.runtime.onStartup.addListener(boot); } catch (_) {}
  boot();
})();
