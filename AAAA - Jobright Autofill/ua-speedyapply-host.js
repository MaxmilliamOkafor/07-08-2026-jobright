/* SpeedyApply 2.28.2 (+ Workflow Add-on), embedded unchanged.

   Its files sit at the paths it ships with (background.js, content-scripts/,
   chunks/, options.html, popup.html, sidepanel.html, sa-enhancement.js, …) and
   none of them is edited. This file loads its background into Jobright's
   service worker and keeps four of its calls to what is SpeedyApply's own —
   inside one extension they would otherwise reach Jobright's too:

   1. chrome.storage.local.clear() — SpeedyApply runs it when its sign-in token
      goes away (sign-out, or a refresh that fails). Here that would also erase
      your Jobright sign-in, the queue, your profile and saved Workday accounts.
      From SpeedyApply it removes SpeedyApply's keys only.
   2. Its runtime.onMessage listener returns true for EVERY message and logs
      "Unhandled message type" for each of Jobright's — a message nobody answers
      would then hang instead of failing fast. It gets SpeedyApply's own types.
   3. contextMenus.removeAll() — from SpeedyApply it removes its own two items,
      not Jobright's.
   4. runtime.setUninstallURL() — SpeedyApply's install step would point the
      whole extension's uninstall page at speedyapply.com. Skipped.

   And one thing it cannot do by itself here: its defaults (settings, profile
   list, autofill account) are written only on a fresh INSTALL, and reloading
   Jobright is an UPDATE. If SpeedyApply has never set itself up, its own
   install step is run once — which also opens its "new profile" page, where a
   profile JSON can be imported. */
(() => {
  'use strict';
  const SA_FILE = /\/background\.js:\d+:\d+/;            // SpeedyApply's worker file in a stack
  const fromSA = () => { try { return SA_FILE.test(String(new Error().stack || '')); } catch (_) { return false; } };

  // Every key SpeedyApply's background, content scripts and pages read or write
  // (2.28.2), plus Supabase's session keys ("sb-<ref>-auth-token" …), plus any
  // key its worker writes at run time.
  const SA_KEYS = new Set(['appliedList', 'autofillAccount', 'autofillEnabled', 'boardCardOrder', 'configList', 'dailyGoal',
    'initialSyncComplete', 'lastSync', 'lastSyncAppliedList', 'lastSyncProfile', 'lastSyncResponseList', 'lastSyncSettings',
    'profile', 'responseList', 'settings', 'subscription', 'timestamp']);
  const SEEN_KEY = 'ua_sa_written_keys';
  const isSaKey = (k, seen) => SA_KEYS.has(k) || /^sb-/.test(k) || (seen && seen.includes(k));
  const SA_MENU_IDS = ['link-save-application', 'page-save-application'];
  // SpeedyApply's message types (its onMessage switch + its frame relays).
  const SA_TYPES = new Set(['clearJobDetails', 'getAutofillConfig', 'getSelectedProfile', 'initialSyncApplications',
    'openOptionsFeedback', 'openOptionsLogin', 'openOptionsProfilePage', 'openOptionsSubscription', 'overwriteResponses',
    'premiumFetchJobScores', 'premiumFetchProfileList', 'premiumResponseFeedback', 'saveApplication', 'saveResponses',
    'setSelectedProfile', 'storeJobDetails', 'syncDeleteAllApplications', 'syncDeleteAllResponses', 'syncDeletedApplication',
    'syncDeletedResponse', 'syncNewResponses', 'syncProfile', 'syncSettings', 'syncUpdatedApplication', 'syncUpdatedResponses',
    'autofill.provideProfile', 'autofill.requestProfile', 'autofill.statusUpdate', 'feedback.showDialog', 'feedback.submit',
    'modal.close', 'modal.show', 'timedModal.show', 'userLoggedIn']);

  const area = chrome.storage && chrome.storage.local;
  try {
    // Keys SpeedyApply's worker writes are remembered, so its "clear" finds them.
    const rawSet = area.set.bind(area);
    area.set = function (items, cb) {
      if (fromSA() && items && typeof items === 'object') {
        const ks = Object.keys(items).filter((k) => !isSaKey(k));
        if (ks.length) {
          area.get(SEEN_KEY, (d) => {
            void chrome.runtime.lastError;
            const seen = new Set((d && d[SEEN_KEY]) || []); ks.forEach((k) => seen.add(k));
            rawSet({ [SEEN_KEY]: [...seen] }, () => void chrome.runtime.lastError);
          });
        }
      }
      return cb === undefined ? rawSet(items) : rawSet(items, cb);
    };
    const rawClear = area.clear.bind(area);
    area.clear = function (cb) {
      if (!fromSA()) return cb === undefined ? rawClear() : rawClear(cb);
      const done = new Promise((resolve) => {
        area.get(null, (all) => {
          void chrome.runtime.lastError;
          const seen = (all && all[SEEN_KEY]) || [];
          const ks = Object.keys(all || {}).filter((k) => isSaKey(k, seen));
          console.log('[UA] SpeedyApply signed out — clearing its own data only (' + ks.length + ' keys); Jobright\'s is kept');
          area.remove(ks, () => { void chrome.runtime.lastError; resolve(); });
        });
      });
      if (typeof cb === 'function') { done.then(() => cb()); return undefined; }
      return done;
    };
  } catch (e) { console.warn('[UA] SpeedyApply storage guard failed', e); }

  try {
    const cm = chrome.contextMenus;
    const rawRemoveAll = cm.removeAll.bind(cm);
    cm.removeAll = function (cb) {
      if (!fromSA()) return cb === undefined ? rawRemoveAll() : rawRemoveAll(cb);
      let left = SA_MENU_IDS.length;
      const one = () => { void chrome.runtime.lastError; if (--left === 0 && typeof cb === 'function') cb(); };
      SA_MENU_IDS.forEach((id) => { try { cm.remove(id, one); } catch (_) { one(); } });
      return undefined;
    };
  } catch (e) { console.warn('[UA] SpeedyApply menu guard failed', e); }

  try {
    const rawUninstall = chrome.runtime.setUninstallURL.bind(chrome.runtime);
    chrome.runtime.setUninstallURL = function (url, cb) {
      if (fromSA()) { if (typeof cb === 'function') cb(); return Promise.resolve(); }
      return cb === undefined ? rawUninstall(url) : rawUninstall(url, cb);
    };
  } catch (_) {}

  // Listeners SpeedyApply registers while its file loads.
  const onMsg = chrome.runtime.onMessage, onInst = chrome.runtime.onInstalled;
  const rawMsgAdd = onMsg.addListener, rawInstAdd = onInst.addListener;
  const saInstalled = [];
  onMsg.addListener = function (fn) {
    return rawMsgAdd.call(onMsg, function (msg, sender, sendResponse) {
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !SA_TYPES.has(msg.type)) return false;
      return fn(msg, sender, sendResponse);
    });
  };
  onInst.addListener = function (fn) { saInstalled.push(fn); return rawInstAdd.call(onInst, fn); };
  try {
    importScripts('/background.js');
    console.log('[UA] SpeedyApply 2.28.2 loaded inside Jobright');
  } catch (e) {
    console.warn('[UA] SpeedyApply failed to load', e);
  } finally {
    onMsg.addListener = rawMsgAdd;
    onInst.addListener = rawInstAdd;
  }

  // SpeedyApply never set up (Jobright was reloaded, not freshly installed):
  // run its own install step once. A real fresh install sets `settings` itself
  // within moments, so this waits and looks again first.
  setTimeout(() => {
    try {
      area.get(['settings', 'ua_sa_setup_done'], (d) => {
        void chrome.runtime.lastError;
        if ((d && d.settings) || (d && d.ua_sa_setup_done)) return;
        area.set({ ua_sa_setup_done: Date.now() }, () => void chrome.runtime.lastError);
        console.log('[UA] Setting up SpeedyApply for the first time (its own install step)');
        for (const fn of saInstalled) { try { fn({ reason: chrome.runtime.OnInstalledReason.INSTALL }); } catch (e) { console.warn('[UA] SpeedyApply setup failed', e); } }
      });
    } catch (_) {}
  }, 3000);
})();
