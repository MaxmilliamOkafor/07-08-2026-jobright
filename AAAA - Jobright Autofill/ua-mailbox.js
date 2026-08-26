/**
 * ua-mailbox.js — read-only mailbox access for ATS email verification.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several ATS put a hard stop in the middle of an application: create an
 * account, then go and click a link (or type a code) that has just been emailed
 * to you. Workday does it per tenant, iCIMS and Taleo do it on some
 * configurations, and ADP does it when it does not recognise your details. A
 * queue running 500 jobs unattended dies at every one of them.
 *
 * This module signs in to Gmail with a READ-ONLY scope, finds the verification
 * message that has just arrived for the employer being applied to, and hands
 * back either the code or the link.
 *
 * SCOPE AND LIMITS — deliberate, and not negotiable in code
 * --------------------------------------------------------
 * These are not squeamishness; each one is what makes it safe to leave running
 * unattended on a real mailbox.
 *
 *   • READ ONLY. gmail.readonly. Nothing here can send, delete, modify, archive
 *     or forward. The scope makes that true at the API level, not just here.
 *   • RECENT ONLY. Every query is bounded to the last few minutes. A
 *     verification mail that arrived yesterday is not the one we are waiting
 *     for, and reaching further back is how you end up reading unrelated mail.
 *   • RELEVANT ONLY. The query is built from the employer and ATS host of the
 *     job in hand. There is no code path that lists the mailbox generally.
 *   • THE LINK MUST LEAD BACK TO THE JOB. A verification link is followed only
 *     when its host matches the ATS or employer we are already applying to.
 *     Inboxes contain phishing; an unattended agent that clicks any link in any
 *     recent mail is a liability. This check is what makes the feature usable
 *     while you are away from the machine.
 *   • MINIMAL RETENTION. The access token lives in chrome.storage.session, so
 *     it dies with the browser session. Message bodies are never stored — the
 *     code or link is extracted and the body is dropped.
 *   • REVOCABLE. Disconnect removes the token from Chrome's cache and from
 *     session storage, and tells Google to revoke it.
 *
 * AUTH
 * ----
 * Two paths, tried in order:
 *   1. chrome.identity.getAuthToken — Chrome manages the token and its refresh,
 *      and there is no client secret anywhere. Requires the user to be signed
 *      into Chrome and the extension ID to be registered as a Chrome-app OAuth
 *      client.
 *   2. chrome.identity.launchWebAuthFlow with PKCE — works when (1) does not
 *      (no Chrome sign-in, or a different provider later). PKCE means no client
 *      secret is needed, which matters because an extension cannot keep one.
 *
 * Setup is in README under "Connecting a mailbox".
 */
'use strict';

(function () {
  const K = {
    TOKEN: 'ua_mail_token',          // session only
    ACCOUNT: 'ua_mail_account',      // which address is connected (local, for the UI)
    ENABLED: 'ua_mail_enabled',
    CLIENT_ID: 'ua_mail_client_id',  // the user's own OAuth client id
    LOG: 'ua_mail_log',
  };
  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const MAX_AGE_MIN = 15;            // never look further back than this
  const MAX_RESULTS = 10;

  const sess = {
    get: (k) => new Promise((r) => { try { chrome.storage.session.get([k], (d) => { void chrome.runtime.lastError; r(d && d[k]); }); } catch (_) { r(undefined); } }),
    set: (k, v) => new Promise((r) => { try { chrome.storage.session.set({ [k]: v }, () => { void chrome.runtime.lastError; r(); }); } catch (_) { r(); } }),
    del: (k) => new Promise((r) => { try { chrome.storage.session.remove([k], () => { void chrome.runtime.lastError; r(); }); } catch (_) { r(); } }),
  };
  const local = {
    get: (k) => new Promise((r) => { try { chrome.storage.local.get([k], (d) => { void chrome.runtime.lastError; r(d && d[k]); }); } catch (_) { r(undefined); } }),
    set: (k, v) => new Promise((r) => { try { chrome.storage.local.set({ [k]: v }, () => { void chrome.runtime.lastError; r(); }); } catch (_) { r(); } }),
  };

  function log(msg, level) {
    const line = { ts: Date.now(), msg: String(msg).slice(0, 300), level: level || 'info' };
    try { console.log('[UA mail]', line.msg); } catch (_) {}
    local.get(K.LOG).then((prev) => local.set(K.LOG, [...(prev || []), line].slice(-120)));
  }

  /* ── auth ────────────────────────────────────────────────────────────────── */

  function chromeToken(interactive) {
    return new Promise((resolve) => {
      try {
        if (!chrome.identity || !chrome.identity.getAuthToken) return resolve(null);
        chrome.identity.getAuthToken({ interactive: !!interactive, scopes: [SCOPE] }, (t) => {
          void chrome.runtime.lastError;
          resolve(t || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  function b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function pkcePair() {
    const v = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return { verifier: v, challenge: b64url(new Uint8Array(digest)) };
  }

  /* PKCE flow — no client secret, which is the whole point: an extension is a
     public client and cannot keep one. */
  async function webAuthToken() {
    const clientId = await local.get(K.CLIENT_ID);
    if (!clientId) { log('No OAuth client id saved — add one in the Queue Manager to connect a mailbox', 'err'); return null; }
    if (!chrome.identity || !chrome.identity.launchWebAuthFlow) return null;
    const redirect = chrome.identity.getRedirectURL();
    const { verifier, challenge } = await pkcePair();
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('redirect_uri', redirect);
    auth.searchParams.set('scope', SCOPE);
    auth.searchParams.set('code_challenge', challenge);
    auth.searchParams.set('code_challenge_method', 'S256');
    auth.searchParams.set('prompt', 'consent');
    auth.searchParams.set('access_type', 'online');

    const redirected = await new Promise((resolve) => {
      try {
        chrome.identity.launchWebAuthFlow({ url: auth.toString(), interactive: true }, (u) => {
          void chrome.runtime.lastError; resolve(u || null);
        });
      } catch (_) { resolve(null); }
    });
    if (!redirected) { log('Mailbox sign-in was cancelled', 'warn'); return null; }
    let code = '';
    try { code = new URL(redirected).searchParams.get('code') || ''; } catch (_) {}
    if (!code) return null;

    const body = new URLSearchParams({
      client_id: clientId, code, code_verifier: verifier,
      grant_type: 'authorization_code', redirect_uri: redirect,
    });
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      const json = await res.json();
      if (json && json.access_token) return json.access_token;
      log('Token exchange failed: ' + (json && (json.error_description || json.error) || 'unknown'), 'err');
    } catch (e) { log('Token exchange error: ' + (e && e.message), 'err'); }
    return null;
  }

  async function getToken(interactive) {
    const cached = await sess.get(K.TOKEN);
    if (cached) return cached;
    let t = await chromeToken(interactive);
    if (!t && interactive) t = await webAuthToken();
    if (t) await sess.set(K.TOKEN, t);
    return t || null;
  }

  async function dropToken() {
    const t = await sess.get(K.TOKEN);
    await sess.del(K.TOKEN);
    if (!t) return;
    try { chrome.identity.removeCachedAuthToken({ token: t }, () => void chrome.runtime.lastError); } catch (_) {}
    // Tell Google as well, so the grant does not outlive the disconnect.
    try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch (_) {}
  }

  async function api(path, token) {
    const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) { await sess.del(K.TOKEN); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error('gmail ' + res.status);
    return res.json();
  }

  /* ── finding the verification message ────────────────────────────────────── */

  /* The query is built from the job in hand and bounded to the last few minutes.
     There is deliberately no way to ask this module for "recent mail" in
     general — every caller must say which employer it is waiting on. */
  function buildQuery(hints) {
    const terms = [];
    const from = [];
    for (const h of (hints && hints.hosts) || []) {
      const d = String(h || '').replace(/^www\./, '').trim();
      if (d) from.push('from:' + d);
    }
    for (const c of (hints && hints.companies) || []) {
      const w = String(c || '').replace(/[^\w .-]/g, '').trim();
      if (w) from.push('from:' + w.split(/\s+/)[0]);
    }
    if (from.length) terms.push('(' + from.join(' OR ') + ')');
    terms.push('(verify OR verification OR confirm OR "confirm your email" OR activate OR "one-time" OR code)');
    terms.push('newer_than:1h');
    return terms.join(' ');
  }

  function headerOf(payload, name) {
    const hs = (payload && payload.headers) || [];
    const h = hs.find((x) => String(x.name || '').toLowerCase() === name);
    return h ? String(h.value || '') : '';
  }
  function decodeB64Url(data) {
    try {
      const s = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(s)));
    } catch (_) { return ''; }
  }
  function collectBody(payload, out) {
    if (!payload) return out;
    if (payload.body && payload.body.data) out.push(decodeB64Url(payload.body.data));
    for (const part of payload.parts || []) collectBody(part, out);
    return out;
  }

  const CODE_RE = /\b(?:code|otp|pin|token)\b[^0-9a-z]{0,24}([0-9]{4,8}|[A-Z0-9]{6,10})\b/i;
  const BARE_CODE_RE = /\b([0-9]{6})\b/;

  /* A link is only ever offered when its host belongs to the ATS or employer we
     are already on. Inboxes contain phishing, and an unattended agent that opens
     any link in any recent mail is a liability. */
  function pickLink(text, hosts) {
    const urls = String(text || '').match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
    const allow = (hosts || []).map((h) => String(h || '').replace(/^www\./, '').toLowerCase()).filter(Boolean);
    for (const raw of urls) {
      let u;
      try { u = new URL(raw); } catch (_) { continue; }
      if (u.protocol !== 'https:') continue;
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      const ok = allow.some((a) => host === a || host.endsWith('.' + a) || a.endsWith('.' + host));
      if (!ok) continue;
      if (!/verify|confirm|activate|token|validate|account|register/i.test(raw)) continue;
      return raw;
    }
    return null;
  }

  async function findVerification(hints) {
    const token = await getToken(false);
    if (!token) return { ok: false, reason: 'not-connected' };
    const q = buildQuery(hints);
    let list;
    try { list = await api('/messages?maxResults=' + MAX_RESULTS + '&q=' + encodeURIComponent(q), token); }
    catch (e) { return { ok: false, reason: String(e.message || e) }; }
    const ids = ((list && list.messages) || []).map((m) => m.id);
    if (!ids.length) return { ok: false, reason: 'no-message' };

    const cutoff = Date.now() - MAX_AGE_MIN * 60000;
    for (const id of ids) {
      let msg;
      try { msg = await api('/messages/' + id + '?format=full', token); } catch (_) { continue; }
      if (Number(msg.internalDate || 0) < cutoff) continue;      // too old to be ours
      const subject = headerOf(msg.payload, 'subject');
      const body = collectBody(msg.payload, []).join('\n');
      const haystack = subject + '\n' + body;
      const link = pickLink(haystack, hints && hints.hosts);
      const m = haystack.match(CODE_RE) || haystack.match(BARE_CODE_RE);
      const code = m ? m[1] : null;
      if (link || code) {
        log(`Verification mail found for ${(hints && hints.hosts || []).join(', ') || 'this job'} — ${link ? 'link' : 'code'}`);
        // The body itself is deliberately not returned or stored.
        return { ok: true, code: code || null, link: link || null, subject: subject.slice(0, 140) };
      }
    }
    return { ok: false, reason: 'no-code' };
  }

  /* ── messages ────────────────────────────────────────────────────────────── */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('UA_MAIL_') !== 0) return;

    if (msg.type === 'UA_MAIL_CONNECT') {
      (async () => {
        if (msg.clientId) await local.set(K.CLIENT_ID, String(msg.clientId).trim());
        const t = await getToken(true);
        if (!t) return sendResponse({ ok: false, reason: 'sign-in-failed' });
        let address = '';
        try { const me = await api('/profile', t); address = (me && me.emailAddress) || ''; } catch (_) {}
        await local.set(K.ACCOUNT, address);
        await local.set(K.ENABLED, true);
        log('Mailbox connected: ' + (address || 'unknown address') + ' (read-only)');
        sendResponse({ ok: true, address });
      })();
      return true;
    }

    if (msg.type === 'UA_MAIL_DISCONNECT') {
      (async () => {
        await dropToken();
        await local.set(K.ENABLED, false);
        await local.set(K.ACCOUNT, '');
        log('Mailbox disconnected and the token revoked');
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'UA_MAIL_STATUS') {
      (async () => {
        sendResponse({
          enabled: (await local.get(K.ENABLED)) === true,
          address: (await local.get(K.ACCOUNT)) || '',
          hasClientId: !!(await local.get(K.CLIENT_ID)),
          connected: !!(await sess.get(K.TOKEN)),
        });
      })();
      return true;
    }

    /* The only way to read anything. The caller must name the employer/ATS it is
       waiting on; there is no "list my mail" path. */
    if (msg.type === 'UA_MAIL_FIND_VERIFICATION') {
      (async () => {
        if ((await local.get(K.ENABLED)) !== true) return sendResponse({ ok: false, reason: 'disabled' });
        const hosts = Array.isArray(msg.hosts) ? msg.hosts.slice(0, 6) : [];
        // Fall back to the requesting tab's own host, never to "anything".
        if (!hosts.length && sender && sender.tab && sender.tab.url) {
          try { hosts.push(new URL(sender.tab.url).hostname); } catch (_) {}
        }
        if (!hosts.length) return sendResponse({ ok: false, reason: 'no-hosts' });
        try { sendResponse(await findVerification({ hosts, companies: (msg.companies || []).slice(0, 3) })); }
        catch (e) { sendResponse({ ok: false, reason: String(e.message || e) }); }
      })();
      return true;
    }
  });

  log('Mailbox module loaded (read-only, verification mail only)');
})();
