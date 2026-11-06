/* The toolbar popup: the one autofill switch (see "THE ONE AUTOFILL SWITCH"
   in ua-orchestrator.js). The worker owns the logic; this page only shows the
   state and asks it to change. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (msg) => new Promise((r) => { try { chrome.runtime.sendMessage(msg, (v) => { void chrome.runtime.lastError; r(v || null); }); } catch (_) { r(null); } });

  function paint(s) {
    if (!s) { $('state').textContent = '?'; $('what').textContent = 'The extension did not answer. Reload it in chrome://extensions.'; return; }
    const live = s.on || s.running;
    const sw = $('sw');
    sw.setAttribute('aria-checked', live ? 'true' : 'false');
    sw.classList.toggle('running', !!s.running);
    $('state').textContent = s.running ? 'RUNNING' : (s.on ? 'ON' : 'OFF');
    $('what').textContent = s.running
      ? (s.queue ? 'A queue is applying. Switching OFF stops it: its tabs close and unfinished jobs go back into the queue.'
        : 'The single-tab run is applying. Switching OFF stops it.')
      : s.on
        ? 'Application pages are filled and submitted automatically.'
        : 'Nothing fills, clicks, submits or pops up. Pages behave as if the extension were not there.';
  }

  async function refresh() { paint(await send({ type: 'UA_SWITCH', op: 'get' })); }

  $('sw').addEventListener('click', async () => {
    const live = $('sw').getAttribute('aria-checked') === 'true';
    $('sw').disabled = true;
    paint(await send({ type: 'UA_SWITCH', on: !live, source: 'toolbar' }));
    $('sw').disabled = false;
  });
  $('jr').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && typeof tab.id === 'number') await send({ type: 'UA_OPEN_JOBRIGHT', tabId: tab.id });
    } catch (_) {}
    window.close();
  });
  $('qm').addEventListener('click', () => {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('ua-queue.html') }); } catch (_) {}
    window.close();
  });
  try { chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && ['ua_aa', 'ua_mgr_active', 'ua_qa'].some((k) => k in c)) refresh(); }); } catch (_) {}
  refresh();
})();
