/* Drives ua-orchestrator.js against a fake chrome.* so the queue engine's real
   behaviour (slot filling, results, requeue-on-close, watchdog, finish) is
   exercised end to end without a browser. */
const fs = require('fs');
const vm = require('vm');

function makeChrome() {
  const store = {};
  const listeners = { changed: [], msg: [], tabUpdated: [], tabRemoved: [], alarm: [], menu: [] };
  let nextTabId = 100;
  const tabs = new Map();          // tabId → {id, url, windowId, active}
  /* Windows, modelled the way Chrome behaves: a tab created with no windowId
     lands in whichever window has focus at that moment. */
  const windows = new Map([[1, { id: 1, type: 'normal', focused: true }]]);
  let nextWinId = 2;
  const focusedWin = () => { for (const w of windows.values()) if (w.focused) return w.id; return null; };
  const sent = [];                 // messages the worker sent into tabs

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const fire = (changes) => listeners.changed.forEach((l) => l(changes, 'local'));

  const chrome = {
    runtime: {
      lastError: undefined,
      getURL: (p) => 'chrome-extension://fake/' + p,
      onMessage: { addListener: (l) => listeners.msg.push(l) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
    storage: {
      local: {
        get(key, cb) {
          const out = {};
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) out[k] = clone(store[k]);
          setTimeout(() => cb(out), 0);
        },
        set(obj, cb) {
          const changes = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { oldValue: clone(store[k]), newValue: clone(obj[k]) };
            store[k] = clone(obj[k]);
          }
          setTimeout(() => { if (cb) cb(); fire(changes); }, 0);
        },
      },
    },
    tabs: {
      create(opts, cb) {
        const id = nextTabId++;
        const windowId = opts.windowId != null ? opts.windowId : focusedWin();
        if (!windows.has(windowId)) { chrome.runtime.lastError = { message: 'No window' }; setTimeout(() => { cb && cb(undefined); chrome.runtime.lastError = undefined; }, 0); return; }
        const t = { id, url: opts.url, windowId, active: opts.active !== false };
        tabs.set(id, t);
        setTimeout(() => cb && cb({ ...t }), 0);
      },
      get(id, cb) {
        setTimeout(() => {
          if (tabs.has(id)) { chrome.runtime.lastError = undefined; cb(tabs.get(id)); }
          else { chrome.runtime.lastError = { message: 'No tab' }; cb(undefined); chrome.runtime.lastError = undefined; }
        }, 0);
      },
      remove(id, cb) { tabs.delete(id); setTimeout(() => cb && cb(), 0); },
      update(id, props, cb) {
        const t = tabs.get(id);
        if (t && props.url && !chrome.__blockNav) {
          t.url = props.url;
          setTimeout(() => listeners.tabUpdated.forEach((l) => l(id, { status: 'loading', url: props.url }, { ...t })), 0);
        }
        if (t && props.active) t.active = true;
        setTimeout(() => cb && cb(t ? { ...t } : undefined), 0);
      },
      sendMessage(tabId, payload, opts, cb) {
        sent.push({ tabId, payload });
        setTimeout(() => cb && cb({ ok: true }), 0);
      },
      onUpdated: { addListener: (l) => listeners.tabUpdated.push(l) },
      onRemoved: { addListener: (l) => listeners.tabRemoved.push(l) },
    },
    windows: {
      get(id, opts, cb) {
        setTimeout(() => {
          if (windows.has(id)) { chrome.runtime.lastError = undefined; cb({ ...windows.get(id) }); }
          else { chrome.runtime.lastError = { message: 'No window' }; cb(undefined); chrome.runtime.lastError = undefined; }
        }, 0);
      },
      getLastFocused(opts, cb) { setTimeout(() => cb(focusedWin() != null ? { ...windows.get(focusedWin()) } : undefined), 0); },
      create(opts, cb) {
        const wid = nextWinId++;
        windows.set(wid, { id: wid, type: 'normal', focused: opts.focused !== false });
        if (opts.focused !== false) for (const w of windows.values()) w.focused = w.id === wid;
        const tid = nextTabId++;
        const t = { id: tid, url: opts.url, windowId: wid, active: true };
        tabs.set(tid, t);
        setTimeout(() => cb && cb({ id: wid, tabs: [{ ...t }] }), 0);
      },
    },
    alarms: {
      create: () => {}, clear: () => {},
      onAlarm: { addListener: (l) => listeners.alarm.push(l) },
    },
    contextMenus: {
      removeAll: (cb) => cb && cb(),
      create: (o, cb) => cb && cb(),
      onClicked: { addListener: (l) => listeners.menu.push(l) },
    },
    notifications: { create: (id, o, cb) => cb && cb() },
    sidePanel: { open: () => Promise.resolve() },
  };
  return { chrome, store, listeners, tabs, sent, windows,
    focus(id) { for (const w of windows.values()) w.focused = w.id === id; },
    openWindow() { const wid = nextWinId++; windows.set(wid, { id: wid, type: 'normal', focused: false }); return wid; },
    closeWindow(id) { windows.delete(id); for (const [tid, t] of tabs) if (t.windowId === id) tabs.delete(tid); } };
}

const tick = (n = 30) => new Promise((r) => { let i = 0; const step = () => (++i >= n ? r() : setTimeout(step, 0)); step(); });

async function send(listeners, msg) {
  return new Promise((resolve) => {
    let answered = false;
    for (const l of listeners.msg) {
      const kept = l(msg, {}, (resp) => { answered = true; resolve(resp); });
      if (kept === true) return;               // async responder
    }
    if (!answered) resolve(undefined);
  });
}

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const SRC = fs.readFileSync(process.argv[2], 'utf8');

function load(env) {
  const sandbox = { chrome: env.chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, JSON, Date, Math, Promise, Object, Array, Number, String, isNaN, parseInt };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

const job = (id, url, status) => ({ id, url, title: id, status: status || 'pending', addedAt: 1, jobBoard: 'X', error: null, startedAt: null, completedAt: null, duration: null });

(async () => {
  /* ── 1. slot filling honours concurrency, results advance the queue ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2'), job('c', 'https://a.com/3')];
    env.store.ua_mgr_concurrency = 2;
    load(env);
    await tick();

    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    eq('opens exactly `concurrency` tabs', env.tabs.size, 2);
    eq('two jobs marked applying', env.store.ua_q.filter((j) => j.status === 'applying').map((j) => j.id), ['a', 'b']);
    eq('third still pending', env.store.ua_q[2].status, 'pending');
    await new Promise((r) => setTimeout(r, 1300));   // assignment pushes are delayed ~900ms
    eq('assignment pushed to each tab', env.sent.length >= 2, true);

    // The tab asks who it is (the pull path the content script now uses).
    const firstTabId = [...env.tabs.keys()][0];
    const who = await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_MGR_WHOAMI' }, { tab: { id: firstTabId } }, resolve);
        if (kept === true) return;
      }
      resolve(undefined);
    });
    eq('WHOAMI answers with the tab\'s job', who && who.job && who.job.id, 'a');
    eq('WHOAMI carries run settings', !!(who && who.settings && who.settings.jobTimeoutMs), true);

    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'a', status: 'done', ts: 111 });
    await tick(60);
    eq('finished job recorded done', env.store.ua_q.find((j) => j.id === 'a').status, 'done');
    eq('its tab was closed and the next opened', env.tabs.size, 2);
    eq('third job now applying', env.store.ua_q.find((j) => j.id === 'c').status, 'applying');

    // A replayed result (both channels report) must not double-advance.
    const before = env.tabs.size;
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'a', status: 'done', ts: 111 });
    await tick(30);
    eq('duplicate result is a no-op', env.tabs.size, before);

    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'b', status: 'failed', error: 'nope', ts: 222 });
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'c', status: 'skipped', ts: 333 });
    await tick(80);
    eq('run finished', env.store.ua_mgr_active, false);
    eq('all tabs closed', env.tabs.size, 0);
    eq('statuses preserved', env.store.ua_q.map((j) => j.status), ['done', 'failed', 'skipped']);
    eq('error preserved', env.store.ua_q[1].error, 'nope');
  }

  /* ── 2. unsafe URLs never reach tabs.create ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('x', 'javascript:alert(1)'), job('y', 'https://a.com/ok')];
    env.store.ua_mgr_concurrency = 3;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    eq('javascript: row skipped, not opened', env.store.ua_q.find((j) => j.id === 'x').status, 'skipped');
    eq('only the safe url got a tab', [...env.tabs.values()].map((t) => t.url), ['https://a.com/ok']);
  }

  /* ── 3. a job tab closed by hand goes back to pending and refills ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    const tabId = [...env.tabs.keys()][0];
    env.tabs.delete(tabId);
    for (const l of env.listeners.tabRemoved) l(tabId, {});
    await tick(80);
    eq('job requeued and a fresh tab opened', env.store.ua_q[0].status, 'applying');
    eq('exactly one tab running', env.tabs.size, 1);
  }

  /* ── 4. watchdog times out a stuck job and moves on ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    env.store.ua_mgr_settings = { jobTimeoutMs: 60000 };
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    // Pretend the job started well over the cap ago.
    env.store.ua_q[0].startedAt = Date.now() - 10 * 60 * 1000;
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(90);
    eq('stuck job marked timeout', env.store.ua_q[0].status, 'timeout');
    eq('next job picked up', env.store.ua_q[1].status, 'applying');
    eq('still one tab', env.tabs.size, 1);
  }

  /* ── 5. pause holds new tabs; resume refills ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'pause' });
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'a', status: 'done', ts: 9 });
    await tick(80);
    eq('paused: no new tab opened', env.tabs.size, 0);
    eq('second job still pending', env.store.ua_q[1].status, 'pending');
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'resume' });
    await tick(80);
    eq('resume opens the next tab', env.tabs.size, 1);
    eq('second job applying', env.store.ua_q[1].status, 'applying');
  }

  /* ── 6. service-worker restart mid-run recovers (state is all in storage) ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 2;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    eq('two tabs before restart', env.tabs.size, 2);

    // Simulate the worker being torn down and re-evaluated: same storage, same
    // tabs, brand new script instance with no in-memory state.
    env.listeners.msg.length = 0;
    env.listeners.changed.length = 0;
    env.listeners.tabRemoved.length = 0;
    env.listeners.alarm.length = 0;
    load(env);
    await tick(80);
    eq('run still active after restart', env.store.ua_mgr_active, true);
    eq('existing job tabs not duplicated', env.tabs.size, 2);
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'a', status: 'done', ts: 5 });
    await tick(80);
    eq('restarted worker still processes results', env.store.ua_q[0].status, 'done');
  }

  /* ── 7. add-to-queue from the context menu ── */
  {
    const env = makeChrome();
    env.store.ua_q = [];
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'add', url: 'https://a.com/1?utm_source=x', meta: { title: 'Eng' } });
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'add', url: 'https://a.com/1' });
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'add', url: 'javascript:alert(1)' });
    await tick(40);
    eq('one job queued, duplicate and unsafe rejected', env.store.ua_q.map((j) => j.url), ['https://a.com/1']);
  }

  /* ── 8. a job that stops responding is dropped and the slot reused ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    const tabId = [...env.tabs.keys()][0];

    // A healthy heartbeat keeps the job alive and records what it is doing.
    await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_JOB_PROGRESS', stage: 'filling fields', pct: 60 }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve();
    });
    await tick(40);
    eq('heartbeat records the stage', env.store.ua_q[0].stage, 'filling fields');
    eq('heartbeat records completeness', env.store.ua_q[0].pct, 60);

    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(60);
    eq('a beating job is left alone', env.store.ua_q[0].status, 'applying');

    // Now go silent: older than the dead-heartbeat window.
    env.store.ua_q[0].beatAt = Date.now() - 5 * 60 * 1000;
    env.store.ua_q[0].startedAt = Date.now() - 5 * 60 * 1000;
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(90);
    eq('an unresponsive job is dropped', env.store.ua_q[0].status, 'timeout');
    eq('and says how long it was silent', /Tab went silent for \d+s/.test(env.store.ua_q[0].error || ''), true);
    eq('the next job takes the slot straight away', env.store.ua_q[1].status, 'applying');
    eq('still only one tab open', env.tabs.size, 1);
  }

  /* ── 9. a CAPTCHA holds the slot, but not forever ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    const tabId = [...env.tabs.keys()][0];

    await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_JOB_NEEDS_HUMAN', blocked: true, provider: 'hCaptcha' }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve();
    });
    await tick(60);
    eq('the job is marked as needing a person', !!env.store.ua_q[0].needsHuman, true);
    eq('with the provider named', env.store.ua_q[0].needsHuman.provider, 'hCaptcha');

    env.store.ua_q[0].startedAt = Date.now() - 30 * 60 * 1000;   // way past the job cap
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(60);
    eq('the watchdog does not kill it while you are solving', env.store.ua_q[0].status, 'applying');

    // Solve it: the job reports itself unblocked and carries on.
    await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_JOB_NEEDS_HUMAN', blocked: false }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve();
    });
    await tick(40);
    eq('clearing the challenge removes the marker', !!env.store.ua_q[0].needsHuman, false);
  }

  /* ── 10. an unsolved CAPTCHA eventually yields the slot ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    const tabId = [...env.tabs.keys()][0];
    await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_JOB_NEEDS_HUMAN', blocked: true, provider: 'reCAPTCHA' }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve();
    });
    await tick(60);
    env.store.ua_q[0].needsHuman.since = Date.now() - 30 * 60 * 1000;   // never solved
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(90);
    eq('an unsolved challenge gives up after the grace period', env.store.ua_q[0].status, 'failed');
    eq('and the run continues', env.store.ua_q[1].status, 'applying');
  }

  /* ── 11. a CAPTCHA'd job does not hold a concurrency slot ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2'), job('c', 'https://a.com/3')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    eq('one job running', env.tabs.size, 1);
    const tabId = [...env.tabs.keys()][0];

    await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_JOB_NEEDS_HUMAN', blocked: true, provider: 'hCaptcha' }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve();
    });
    await tick(90);
    eq('the next job starts immediately, it does not wait', env.store.ua_q[1].status, 'applying');
    eq('the blocked tab stays open so it can still be solved', env.tabs.has(tabId), true);
    eq('so two tabs exist at concurrency 1 — one working, one parked', env.tabs.size, 2);
    eq('the parked job is still marked as needing you', !!env.store.ua_q[0].needsHuman, true);
  }

  /* ── 12. the wait for a person is short and configurable ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1')];
    env.store.ua_mgr_concurrency = 1;
    env.store.ua_mgr_settings = { humanGraceMs: 30000 };   // 30s, not 15 minutes
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    const tabId = [...env.tabs.keys()][0];
    await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_JOB_NEEDS_HUMAN', blocked: true, provider: 'reCAPTCHA' }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve();
    });
    await tick(60);
    env.store.ua_q[0].needsHuman.since = Date.now() - 20000;    // 20s in: still waiting
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(60);
    eq('still waiting inside the configured window', env.store.ua_q[0].status, 'applying');
    env.store.ua_q[0].needsHuman.since = Date.now() - 45000;    // past 30s
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(90);
    eq('dropped once the configured wait expires', env.store.ua_q[0].status, 'failed');
    eq('and the reason names the configured window', /not solved within/.test(env.store.ua_q[0].error || ''), true);
  }

  /* ── 13. reloading a job tab must NOT stop the job ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);
    const tabId = [...env.tabs.keys()][0];

    // The tab has been quiet long enough to look dead...
    env.store.ua_q[0].beatAt = Date.now() - 5 * 60 * 1000;
    env.store.ua_q[0].startedAt = Date.now() - 5 * 60 * 1000;
    // ...but it is quiet because the user hit reload.
    for (const l of env.listeners.tabUpdated) l(tabId, { status: 'loading' });
    await tick(60);
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(60);
    eq('a reloading tab is not mistaken for a dead one', env.store.ua_q[0].status, 'applying');
    eq('its tab stays open', env.tabs.has(tabId), true);
    eq('the next job has NOT been started in its place', env.store.ua_q[1].status, 'pending');

    // The page comes back and asks who it is — that alone proves it is alive.
    for (const l of env.listeners.tabUpdated) l(tabId, { status: 'complete' });
    await tick(60);
    const who = await new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_MGR_WHOAMI' }, { tab: { id: tabId } }, resolve);
        if (kept === true) return;
      }
      resolve(undefined);
    });
    await tick(40);
    eq('the reloaded page is handed its job straight back', who && who.job && who.job.id, 'a');
    eq('and it is still the running job', env.store.ua_q[0].status, 'applying');

    // A genuinely dead tab (no navigation) is still reclaimed.
    env.store.ua_q[0].navAt = Date.now() - 5 * 60 * 1000;
    env.store.ua_q[0].beatAt = Date.now() - 5 * 60 * 1000;
    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(90);
    eq('a tab that is silent WITHOUT navigating is still dropped', env.store.ua_q[0].status, 'timeout');
  }

  /* ── 14. a run must never stall silently with jobs left ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2'), job('c', 'https://a.com/3')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);

    // Simulate the failure shape: the run is active, jobs are still pending, but
    // nothing is running — every tab gone and no job marked applying.
    for (const id of [...env.tabs.keys()]) env.tabs.delete(id);
    env.store.ua_mgr_tabs = {};
    env.store.ua_q[0].status = 'skipped';
    env.store.ua_q[1].status = 'pending';
    env.store.ua_q[2].status = 'pending';
    await tick(20);

    for (const l of env.listeners.alarm) l({ name: 'ua_mgr_watchdog' });
    await tick(120);
    eq('the supervisor restarts a stalled run', env.store.ua_q[1].status, 'applying');
    eq('and a tab is open again', env.tabs.size, 1);
    eq('the run is still active', env.store.ua_mgr_active, true);
    const logged = (env.store.ua_mgr_log || []).map((l) => JSON.parse(l).m).join(' | ');
    eq('and it said so rather than vanishing', /Queue stalled with \d+ job/.test(logged), true);
  }

  /* ── 15. finish() refuses to end a run that still has work ── */
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });
    await tick(60);

    // Job a completes; b is still pending. Nothing may end the run here.
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'a', status: 'skipped', ts: 1 });
    await tick(90);
    eq('run continues while a job is pending', env.store.ua_mgr_active, true);
    eq('the pending job was picked up', env.store.ua_q[1].status, 'applying');

    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'b', status: 'done', ts: 2 });
    await tick(90);
    eq('run ends only when nothing is left', env.store.ua_mgr_active, false);
    const logged = (env.store.ua_mgr_log || []).map((l) => JSON.parse(l).m).join(' | ');
    eq('the ending is announced with a breakdown', /Queue complete — \d+ applied/.test(logged), true);
  }

    /* ── N. the run stays in ONE window, in the background ──
     "It keeps switching tabs… and stop switching the tab into a different
     window." A tab created with no window lands wherever you are working. */
  console.log('a run stays in its own window and never takes the front');
  {
    const env = makeChrome();
    env.store.ua_q = [job('a', 'https://a.com/1'), job('b', 'https://a.com/2'), job('c', 'https://a.com/3')];
    env.store.ua_mgr_concurrency = 1;
    load(env);
    await tick();
    await send(env.listeners, { type: 'UA_MGR_CMD', cmd: 'start' });   // pressed in window 1
    await tick(60);
    eq('the run records the window it was started in', env.store.ua_run_window, 1);
    const first = [...env.tabs.values()][0];
    eq('the first job opens there', first && first.windowId, 1);
    eq('in the background', first && first.active, false);

    // You move to another window and carry on working.
    const mine = env.openWindow();
    env.focus(mine);
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'a', status: 'done', ts: 501 });
    await tick(80);
    const next = [...env.tabs.values()].find((t) => /a\.com\/2/.test(t.url));
    eq('the next job opens in the RUN\'s window, not the one you are using', next && next.windowId, 1);
    eq('still in the background', next && next.active, false);
    eq('nothing was opened in your window', [...env.tabs.values()].some((t) => t.windowId === mine), false);

    // You close the run's window; the run must not move into yours.
    env.closeWindow(1);
    await send(env.listeners, { type: 'UA_JOB_RESULT', id: 'b', status: 'done', ts: 502 });
    await tick(120);
    const third = [...env.tabs.values()].find((t) => /a\.com\/3/.test(t.url));
    eq('with its window gone, the run opens a window of its own', !!third && third.windowId !== mine && third.windowId !== 1, true);
    eq('which does not take focus', env.windows.get(third && third.windowId) && env.windows.get(third.windowId).focused, false);
    eq('and your window keeps focus', env.windows.get(mine).focused, true);
  }

  /* ── N+1. single-tab mode moves to the next job in the SAME tab ── */
  console.log('the single-tab runner moves to the next job in place');
  {
    const env = makeChrome();
    load(env);
    await tick();
    env.chrome.tabs.create({ url: 'https://ats.com/job/1', active: false, windowId: 1 }, () => {});
    await tick();
    const tab = [...env.tabs.values()][0];
    const nav = (url) => new Promise((resolve) => {
      for (const l of env.listeners.msg) {
        const kept = l({ type: 'UA_NAV_NEXT', url }, { tab: { id: tab.id, index: 0, windowId: 1, active: false } }, resolve);
        if (kept === true) return;
      }
      resolve(undefined);
    });
    await nav('https://ats.com/job/2');
    await new Promise((r) => setTimeout(r, 3300));
    eq('no new tab is opened', env.tabs.size, 1);
    eq('the same tab now shows the next job', env.tabs.get(tab.id) && env.tabs.get(tab.id).url, 'https://ats.com/job/2');

    // A page that holds the navigation: the swap stays in that window, in the background.
    env.chrome.__blockNav = true;
    await nav('https://ats.com/job/3');
    await new Promise((r) => setTimeout(r, 3300));
    const repl = [...env.tabs.values()].find((t) => /job\/3/.test(t.url));
    eq('a held page is swapped out', !!repl && !env.tabs.has(tab.id), true);
    eq('into the same window', repl && repl.windowId, 1);
    eq('without coming to the front', repl && repl.active, false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
