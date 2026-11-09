/* v17.60 — ua-keepalive.js: background job tabs keep time and are not frozen.
   Runs the shipped file in a sandbox with a fake Worker, Web Locks, document
   and chrome.runtime, plus source checks on the places that use it.

   Usage: node tests/keepalive.test.js "<ext dir>" */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const EXT = process.argv[2] || path.resolve(__dirname, '../AAAA - Jobright Autofill');
const src = fs.readFileSync(path.join(EXT, 'ua-keepalive.js'), 'utf8');
const enh = fs.readFileSync(path.join(EXT, 'ua-enhancement.js'), 'utf8');
const eng = fs.readFileSync(path.join(EXT, 'ua-wd-engine.js'), 'utf8');
const orch = fs.readFileSync(path.join(EXT, 'ua-orchestrator.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  FAIL ' + n); } };

function sandbox(opts = {}) {
  const sent = [], locks = [], listeners = {};
  let workers = 0;
  class FakeWorker {
    constructor() {
      workers++;
      if (opts.workerThrows) throw new Error('CSP');
      this.timers = {};
      FakeWorker.last = this;
    }
    postMessage(d) {
      if (d.c) { clearTimeout(this.timers[d.id]); return; }
      this.timers[d.id] = setTimeout(() => this.onmessage && this.onmessage({ data: d.id }), d.ms);
    }
    terminate() {}
  }
  const doc = {
    visibilityState: opts.visible ? 'visible' : 'hidden',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  };
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Math, Date, Number, Object, Blob,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Worker: FakeWorker,
    document: doc,
    navigator: {
      locks: {
        request: (name, fn) => { const l = { name, held: true }; locks.push(l); return Promise.resolve(fn()).then(() => { l.held = false; }); },
      },
    },
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(m); cb && cb(); }, lastError: undefined } },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { k: ctx.__uaKeep, sent, locks, listeners, doc, workers: () => workers, FakeWorker };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Idle tab: nothing happens at all.
  {
    const s = sandbox();
    ok(s.k && typeof s.k.timeout === 'function', 'exposes __uaKeep');
    let fired = false;
    s.k.timeout(() => { fired = true; }, 5);
    await wait(20);
    ok(fired, 'timeout fires with no run');
    ok(s.workers() === 0, 'no worker is made for a tab no run is using');
    ok(s.locks.length === 0 && s.sent.length === 0, 'no lock and no message for an idle tab');
  }
  // Run drives a hidden tab: worker clock, lock, not-discardable message.
  {
    const s = sandbox();
    s.k.set(true);
    ok(s.k.active, 'set(true) marks the tab active');
    ok(s.locks.length === 1 && s.locks[0].held, 'a Web Lock is held during the run');
    ok(s.sent.some((m) => m.type === 'UA_KEEP_TAB' && m.on === true), 'asks the worker to keep the tab loaded');
    let n = 0;
    s.k.timeout(() => { n++; }, 5);
    await s.k.sleep(5);
    await wait(10);
    ok(n === 1, 'worker timeout fires once');
    ok(s.k.usingWorker, 'hidden tab during a run uses the worker clock');
    const id = s.k.timeout(() => { n += 10; }, 5);
    s.k.clear(id);
    await wait(15);
    ok(n === 1, 'clear() cancels a worker timeout');
    let rounds = 0;
    const ev = s.k.every(() => { rounds++; }, 5);
    await wait(40);
    s.k.stopEvery(ev);
    const at = rounds;
    await wait(20);
    ok(at >= 3 && rounds === at, 'every() repeats and stopEvery() stops it');
    s.k.set(true);
    ok(s.locks.length === 1 && s.sent.filter((m) => m.on).length === 1, 'set(true) twice does nothing more');
    s.k.set(false);
    await wait(0);
    ok(!s.locks[0].held, 'lock released when the run lets go');
    ok(s.sent.some((m) => m.type === 'UA_KEEP_TAB' && m.on === false), 'tab handed back to Chrome when the run lets go');
  }
  // Visible tab during a run: plain timers.
  {
    const s = sandbox({ visible: true });
    s.k.set(true);
    let fired = false;
    s.k.timeout(() => { fired = true; }, 5);
    await wait(15);
    ok(fired && s.workers() === 0, 'visible tab keeps plain timers');
    s.k.set(false);
  }
  // Site forbids the worker: falls back to setTimeout.
  {
    const s = sandbox({ workerThrows: true });
    s.k.set(true);
    let fired = false;
    s.k.timeout(() => { fired = true; }, 5);
    await wait(15);
    ok(fired, 'falls back to setTimeout when the worker is refused');
    s.k.set(false);
  }
  // Worker refused late (onerror): pending timers still run.
  {
    const s = sandbox();
    s.k.set(true);
    let fired = false;
    s.k.timeout(() => { fired = true; }, 1000);
    s.FakeWorker.last.onerror({ preventDefault() {} });
    await wait(15);
    ok(fired, 'a worker error runs what was waiting, on the normal timer');
    s.k.set(false);
  }
  // Frozen time is recorded from Chrome's freeze/resume events.
  {
    const s = sandbox();
    s.k.set(true);
    const t0 = Date.now() - 10;
    const realNow = Date.now;
    s.listeners.freeze.forEach((f) => f());
    const base = realNow();
    Date.now = () => base + 30000;     // 30s later
    try { s.listeners.resume.forEach((f) => f()); } finally { Date.now = realNow; }
    const fz = s.k.frozenSince(t0);
    ok(fz >= 29000 && fz <= 31000, 'freeze→resume of 30s is recorded (' + fz + ')');
    ok(s.k.frozenSince(base + 40000) === 0, 'a freeze before t0 does not count');
    s.k.set(false);
  }

  // ── wiring ──
  const csEnh = (manifest.content_scripts || []).find((c) => (c.js || []).includes('ua-enhancement.js'));
  ok(csEnh && csEnh.js.indexOf('ua-keepalive.js') === csEnh.js.indexOf('ua-enhancement.js') - 1,
    'manifest loads ua-keepalive.js right before ua-enhancement.js');
  ok(csEnh && !csEnh.world && csEnh.all_frames === false, 'keep-alive runs in the isolated world, top frame only');
  ok(/const sleep = ms => new Promise\(r => uaTimeout\(r,/.test(enh), 'content-script sleep uses the run clock');
  ok(/stallIv = uaEvery\(/.test(enh) && /beatIv = uaEvery\(beat, 5000\)/.test(enh), 'job heartbeat and stall check use the run clock');
  ok(/uaStopEvery\(stallIv\); uaStopEvery\(beatIv\);/.test(enh), 'job heartbeat and stall check are stopped the same way');
  ok(enh.includes('function stalledFor() { return Math.max(0, Date.now() - _lastProgressAt - frozenSince(_lastProgressAt)); }'),
    'stall clock leaves out frozen time');
  ok((enh.match(/const owed = frozenSince\(jobStart\) - frozenCredited;/g) || []).length === 2,
    'both job time limits give back frozen time');
  ok(/function keepAliveWanted\(\)[\s\S]{0,200}isRunnerTab\(\)[\s\S]{0,80}_mgrDriving/.test(enh),
    'keep-alive only for the runner tab or a Queue Manager job');
  ok(eng.includes('globalThis.__uaKeep ? globalThis.__uaKeep.timeout(r, ms) : setTimeout(r, ms)'), 'Workday engine sleep uses the run clock');
  ok(/msg\.type === 'UA_KEEP_TAB'[\s\S]{0,400}autoDiscardable: !msg\.on/.test(orch), 'service worker sets autoDiscardable for the asking tab');
  ok(/UA_KEEP_TAB'\)[\s\S]{0,200}sender\.id !== chrome\.runtime\.id/.test(orch), 'service worker only accepts it from this extension');

  console.log(`  keepalive: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); process.exit(1); });
