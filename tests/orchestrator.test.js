/* Drives ua-orchestrator.js against a fake chrome.* so the queue engine's real
   behaviour (slot filling, results, requeue-on-close, watchdog, finish) is
   exercised end to end without a browser. */
const fs = require('fs');
const vm = require('vm');

function makeChrome() {
  const store = {};
  const listeners = { changed: [], msg: [], tabUpdated: [], tabRemoved: [], alarm: [], menu: [] };
  let nextTabId = 100;
  const tabs = new Map();          // tabId → {id, url}
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
        tabs.set(id, { id, url: opts.url });
        setTimeout(() => cb && cb({ id, url: opts.url }), 0);
      },
      get(id, cb) {
        setTimeout(() => {
          if (tabs.has(id)) { chrome.runtime.lastError = undefined; cb(tabs.get(id)); }
          else { chrome.runtime.lastError = { message: 'No tab' }; cb(undefined); chrome.runtime.lastError = undefined; }
        }, 0);
      },
      remove(id, cb) { tabs.delete(id); setTimeout(() => cb && cb(), 0); },
      sendMessage(tabId, payload, opts, cb) {
        sent.push({ tabId, payload });
        setTimeout(() => cb && cb({ ok: true }), 0);
      },
      onUpdated: { addListener: (l) => listeners.tabUpdated.push(l) },
      onRemoved: { addListener: (l) => listeners.tabRemoved.push(l) },
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
  return { chrome, store, listeners, tabs, sent };
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
    eq('and says so', /Stopped responding/.test(env.store.ua_q[0].error || ''), true);
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
