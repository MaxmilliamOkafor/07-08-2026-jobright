/* ua-keepalive.js — keeps a job tab running at full speed while it is in the
 * background (v17.60).
 *
 * Chrome slows a tab you are not looking at: its timers fire at most once a
 * second, after five minutes at most once a minute, and later it may freeze the
 * tab or unload it to save memory. A run fills jobs in tabs you are not looking
 * at, so every short wait in the fill became a one-second (or one-minute) wait,
 * and a frozen tab stopped answering the worker's ping and was replaced — "The
 * runner tab froze on this job twice". Three things here, used only while a run
 * is driving THIS tab:
 *
 *   1. Timers that fire on time. A small dedicated worker keeps the clock;
 *      Chrome does not slow a worker's timers the way it slows a background
 *      page's. Where a site's security policy refuses the worker (Greenhouse,
 *      Workday and others do), the extension's own service worker keeps the
 *      clock instead and messages the tab when each wait is over (v17.65):
 *      a message is not a timer, so Chrome delivers it at once. Before, the
 *      fallback was the page's own timer, and on those sites a job got about
 *      one second of work a minute and ran out its time limit mid-form.
 *   2. A Web Lock held for the run. Chrome does not freeze a tab that holds
 *      one. The service worker is also asked to mark the tab "not discardable",
 *      so Chrome does not unload it mid-application.
 *   2b. A loopback WebRTC data channel for the run, which exempts the page's
 *      own timers (the site's scripts, Jobright's autofill) from Chrome's
 *      once-a-minute throttling. Local only; nothing is sent anywhere.
 *   3. A record of time the tab spent frozen anyway, so a job's time limit can
 *      leave that time out instead of skipping a job for Chrome's pause.
 *
 * Nothing changes for a tab no run is using: no lock, no worker, no message.
 * Exposed as globalThis.__uaKeep to the extension's own content scripts only
 * (they share this isolated world; the page cannot see it).
 */
(() => {
  'use strict';
  if (globalThis.__uaKeep) return;

  /* ── 1. worker clock ── */
  let worker = null, workerBroken = false, seq = 0;
  const pending = new Map();         // id → callback
  const WORKER_SRC =
    'var t={};onmessage=function(e){var d=e.data||{};' +
    'if(d.c){clearTimeout(t[d.id]);delete t[d.id];return;}' +
    't[d.id]=setTimeout(function(){delete t[d.id];postMessage(d.id);},d.ms);};';

  function getWorker() {
    if (worker || workerBroken) return worker;
    let url = '';
    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) => {
        const fn = pending.get(e.data);
        if (!fn) return;
        pending.delete(e.data);
        try { fn(); } catch (err) { setTimeout(() => { throw err; }); }
      };
      // A site whose security policy forbids the worker reports it here, not
      // from the constructor. Fall back for good, and run what was waiting.
      worker.onerror = (ev) => {
        try { ev && ev.preventDefault && ev.preventDefault(); } catch (_) {}
        workerBroken = true;
        try { worker.terminate(); } catch (_) {}
        worker = null;
        const waiting = [...pending.entries()];
        pending.clear();
        // Whatever was waiting on the worker moves to the extension's clock.
        for (const [id, fn] of waiting) { if (!viaExtension(id, fn, 0)) nativeIds.set(id, setTimeout(fn, 0)); }
      };
    } catch (_) {
      workerBroken = true;
      worker = null;
    } finally {
      // The worker has already read the script; the URL is no longer needed.
      if (url) setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 5000);
    }
    return worker;
  }

  const nativeIds = new Map();      // our id → setTimeout id, for the fallback path
  const wantsWorker = () => active && !workerBroken && document.visibilityState === 'hidden';

  /* ── 1b. the extension's clock (v17.65) ──
     For a hidden tab in a run whose site refused the worker. The service
     worker waits and answers; the answer arrives as a message. If the service
     worker cannot be reached (extension reloaded), the page's own timer takes
     over for whatever time is left. */
  const extPending = new Map();     // id → { fn, due }
  let extBroken = false, extUsed = false;
  const wantsExtension = () => active && !extBroken && document.visibilityState === 'hidden';
  function viaExtension(id, fn, ms) {
    if (!wantsExtension()) return false;
    const due = Date.now() + ms;
    const settle = (viaNative) => {
      const rec = extPending.get(id);
      if (!rec) return;                      // cleared, or already run
      extPending.delete(id);
      if (viaNative) { nativeIds.set(id, setTimeout(() => { nativeIds.delete(id); fn(); }, Math.max(0, due - Date.now()))); return; }
      try { fn(); } catch (err) { setTimeout(() => { throw err; }); }
    };
    try {
      extPending.set(id, { fn, due });
      chrome.runtime.sendMessage({ type: 'UA_CLOCK', ms }, (r) => {
        const failed = !!chrome.runtime.lastError || !r || r.ok !== true;
        if (failed) extBroken = true;
        settle(failed);
      });
      extUsed = true;
      return true;
    } catch (_) {
      extPending.delete(id);
      extBroken = true;
      return false;
    }
  }

  /* setTimeout that keeps time in a background tab during a run. Returns an id
     for clear(). In a visible tab, or with no run, it IS setTimeout. */
  function timeout(fn, ms) {
    const id = ++seq;
    ms = Math.max(0, Number(ms) || 0);
    const w = wantsWorker() ? getWorker() : null;
    if (w) {
      pending.set(id, fn);
      try { w.postMessage({ id, ms }); return id; } catch (_) { pending.delete(id); }
    }
    if (!w && viaExtension(id, fn, ms)) return id;
    nativeIds.set(id, setTimeout(() => { nativeIds.delete(id); fn(); }, ms));
    return id;
  }
  function clear(id) {
    if (pending.delete(id)) { try { worker && worker.postMessage({ id, c: 1 }); } catch (_) {} return; }
    if (extPending.delete(id)) return;       // its answer, when it comes, finds nothing to run
    const n = nativeIds.get(id);
    if (n != null) { clearTimeout(n); nativeIds.delete(id); }
  }
  const sleep = (ms) => new Promise((r) => timeout(r, ms));
  /* setInterval on the same clock. Each round is scheduled afresh, so a tab
     that goes into the background mid-run moves onto the worker clock. */
  const loops = new Map();
  function every(fn, ms) {
    const id = ++seq;
    const h = { t: 0 };
    const round = () => {
      if (!loops.has(id)) return;
      h.t = timeout(round, ms);
      try { fn(); } catch (err) { setTimeout(() => { throw err; }); }
    };
    loops.set(id, h);
    h.t = timeout(round, ms);
    return id;
  }
  function stopEvery(id) {
    const h = loops.get(id);
    if (!h) return;
    loops.delete(id);
    clear(h.t);
  }

  /* ── 2. hold the tab for the run ── */
  let active = false, lockRelease = null;
  const LOCK = 'ua-keepalive-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  function tellWorker(on) {
    try { chrome.runtime.sendMessage({ type: 'UA_KEEP_TAB', on: !!on }, () => void chrome.runtime.lastError); } catch (_) {}
  }
  function takeLock() {
    try {
      if (lockRelease || !navigator.locks || !navigator.locks.request) return;
      navigator.locks.request(LOCK, () => new Promise((res) => { lockRelease = res; })).catch(() => { lockRelease = null; });
    } catch (_) {}
  }
  function dropLock() {
    const r = lockRelease; lockRelease = null;
    try { r && r(); } catch (_) {}
  }
  /* ── 2b. keep the PAGE's timers on time too (v17.65) ──
     The clocks above are ours. The site's own scripts (a dropdown that opens
     after a debounce, a form that validates on a timer) and Jobright's
     autofill run on the page's timers, and in a background tab Chrome checks
     those once a minute ("intensive throttling"). Chrome's documented
     exception is a page with WebRTC in use: an RTCPeerConnection with an open
     data channel. So for the length of the run this tab holds one, connected
     to itself: two local ends, no servers, nothing sent anywhere. Closed the
     moment the run lets go of the tab. */
  let rtc = null;
  function startRtc() {
    try {
      if (rtc || typeof RTCPeerConnection !== 'function') return;
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      const mine = { a, b, ch: null };
      rtc = mine;
      const fail = () => { if (rtc === mine) stopRtc(); };
      a.onicecandidate = (e) => { if (e && e.candidate) Promise.resolve(b.addIceCandidate(e.candidate)).catch(() => {}); };
      b.onicecandidate = (e) => { if (e && e.candidate) Promise.resolve(a.addIceCandidate(e.candidate)).catch(() => {}); };
      mine.ch = a.createDataChannel('ua-keepalive');
      Promise.resolve(a.createOffer())
        .then((o) => a.setLocalDescription(o))
        .then(() => b.setRemoteDescription(a.localDescription))
        .then(() => b.createAnswer())
        .then((ans) => b.setLocalDescription(ans))
        .then(() => a.setRemoteDescription(b.localDescription))
        .catch(fail);
    } catch (_) { rtc = null; }
  }
  function stopRtc() {
    const r = rtc; rtc = null;
    if (!r) return;
    try { r.ch && r.ch.close(); } catch (_) {}
    try { r.a.close(); } catch (_) {}
    try { r.b.close(); } catch (_) {}
  }

  /* Called with true while a run drives this tab, false once it does not.
     Idempotent, so callers may call it on every check. */
  function set(on) {
    on = !!on;
    if (on === active) return;
    active = on;
    if (on) { takeLock(); startRtc(); startTicker(); tellWorker(true); }
    else { dropLock(); stopRtc(); stopTicker(); tellWorker(false); }
  }

  /* ── 3. time spent frozen ── */
  /* A one-second tick on the worker clock: if the page runs it much later than
     that, the page was not running at all — frozen — for the difference. Only
     while a run holds the tab. */
  const TICK_MS = 1000, GAP_MS = 4000;
  const gaps = [];                  // { end, ms } — most recent last, capped
  let tickId = 0, lastTick = 0;
  function noteGap(ms, end) {
    if (!(ms > 0)) return;
    gaps.push({ end, ms });
    if (gaps.length > 100) gaps.shift();
  }
  function tick() {
    const now = Date.now();
    if (lastTick && now - lastTick > GAP_MS) noteGap(now - lastTick - TICK_MS, now);
    lastTick = now;
    if (active) tickId = timeout(tick, TICK_MS);
  }
  function startTicker() { lastTick = Date.now(); clear(tickId); tickId = timeout(tick, TICK_MS); }
  function stopTicker() { clear(tickId); tickId = 0; lastTick = 0; }
  // Chrome's own lifecycle events say the same thing more exactly when it
  // freezes a tab; the tick then sees no gap because lastTick is reset.
  let frozeAt = 0;
  try {
    document.addEventListener('freeze', () => { frozeAt = Date.now(); }, { capture: true });
    document.addEventListener('resume', () => {
      if (!frozeAt) return;
      const now = Date.now();
      noteGap(now - frozeAt, now);
      frozeAt = 0;
      if (active) lastTick = now;
    }, { capture: true });
  } catch (_) {}

  /* How long this tab spent frozen since time t0 (ms since epoch). */
  function frozenSince(t0) {
    let sum = 0;
    for (const g of gaps) if (g.end > t0) sum += Math.min(g.ms, g.end - t0);
    return sum;
  }

  globalThis.__uaKeep = Object.freeze({
    timeout, clear, sleep, every, stopEvery, set, frozenSince,
    get active() { return active; },
    get usingWorker() { return !!worker; },
    // The loopback data channel's state: 'open' once the page's timers are exempt.
    get channel() { try { return rtc && rtc.ch ? rtc.ch.readyState : 'none'; } catch (_) { return 'none'; } },
    // Which clock a hidden tab in a run is on: 'worker', 'extension' or 'page'.
    get clock() { return worker ? 'worker' : (extUsed && !extBroken ? 'extension' : 'page'); },
  });
})();
