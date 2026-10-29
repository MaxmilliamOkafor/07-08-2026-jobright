/* ua-debug.js — the Debugger page. Reads what ua-debugger.js (service worker)
   and each job's tab recorded; nothing here writes except Clear. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const IDX = 'ua_dbg_index';
  const REC = (id) => 'ua_dbg_job:' + id;
  const SHOT = (id) => 'ua_dbg_shot:' + id;
  const BAD = ['failed', 'timeout'];
  const state = { index: [], sel: '', cause: '', tab: 'timeline', rec: null, shot: '', tlFilter: '', tlErrors: false };

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, (d) => r(d ? d[k] : undefined)));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  const when = (t) => t ? new Date(t).toLocaleString() : '';
  const dur = (a, b) => { if (!a || !b) return ''; const s = Math.round((b - a) / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
  const off = (t, t0) => { const s = Math.max(0, Math.round((t - t0) / 1000)); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const statusOf = (e) => e.status || 'applying';
  const label = (e) => e.company || e.title || host(e.url) || e.id;

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('job')) state.sel = h.get('job');
    if (h.get('cause')) state.cause = h.get('cause');
  }
  function writeHash() {
    const h = new URLSearchParams();
    if (state.sel) h.set('job', state.sel);
    if (state.cause) h.set('cause', state.cause);
    history.replaceState(null, '', '#' + h.toString());
  }

  /* ---------- header + causes ---------- */
  function renderStats() {
    const n = (f) => state.index.filter(f).length;
    const items = [
      ['', 'all', state.index.length],
      ['done', 'applied', n((e) => e.status === 'done')],
      ['bad', 'failed', n((e) => BAD.includes(e.status))],
      ['skipped', 'skipped', n((e) => e.status === 'skipped')],
      ['applying', 'running', n((e) => statusOf(e) === 'applying')],
    ];
    $('stats').innerHTML = items.map(([v, l, c]) => `<span class="stat${$('status').value === v ? ' on' : ''}" data-v="${v}"><b>${c}</b> ${l}</span>`).join('');
    $('stats').querySelectorAll('.stat').forEach((s) => s.onclick = () => { $('status').value = s.dataset.v; state.cause = ''; renderAll(); });
  }
  function causes() {
    const by = new Map();
    for (const e of state.index) {
      if (!BAD.includes(e.status) && !(e.status === 'skipped' && e.reason)) continue;
      const g = `${e.status === 'skipped' ? 'skipped' : 'failed'}: ${e.group || 'no reason recorded'}`;
      if (!by.has(g)) by.set(g, []);
      by.get(g).push(e);
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }
  function renderCauses() {
    const cs = causes();
    $('causes').innerHTML = cs.length ? cs.map(([g, list]) => {
      const ats = {};
      for (const e of list) ats[e.ats || e.board || '?'] = (ats[e.ats || e.board || '?'] || 0) + 1;
      const chips = Object.entries(ats).sort((a, b) => b[1] - a[1]).map(([a, k]) => `<span class="chip">${esc(a)} ${k}</span>`).join('');
      return `<div class="cause${state.cause === g ? ' on' : ''}" data-g="${esc(g)}"><span class="n">${list.length}</span>${esc(g)}<div class="ats">${chips}</div></div>`;
    }).join('') : '<div class="hint">No failures recorded.</div>';
    $('causes').querySelectorAll('.cause').forEach((c) => c.onclick = () => { state.cause = state.cause === c.dataset.g ? '' : c.dataset.g; writeHash(); renderAll(); });
  }

  /* ---------- job list ---------- */
  function filtered() {
    const q = $('q').value.trim().toLowerCase();
    const ats = $('ats').value, st = $('status').value;
    return state.index.filter((e) => {
      const s = statusOf(e);
      if (st === 'bad' ? !BAD.includes(s) : (st && s !== st)) return false;
      if (ats && (e.ats || e.board || '?') !== ats) return false;
      if (state.cause) {
        const g = `${e.status === 'skipped' ? 'skipped' : 'failed'}: ${e.group || 'no reason recorded'}`;
        if (g !== state.cause) return false;
      }
      if (q && ![e.url, e.title, e.company, e.reason, e.ats, e.id].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function renderJobs() {
    const atsSel = $('ats'), cur = atsSel.value;
    const atsList = [...new Set(state.index.map((e) => e.ats || e.board || '?'))].sort();
    atsSel.innerHTML = '<option value="">All ATS</option>' + atsList.map((a) => `<option${a === cur ? ' selected' : ''}>${esc(a)}</option>`).join('');
    const list = filtered();
    $('jobsTitle').textContent = `Jobs (${list.length}${list.length !== state.index.length ? ' of ' + state.index.length : ''})`;
    $('jobs').innerHTML = list.slice(0, 800).map((e) => `<div class="job s-${statusOf(e)}${e.id === state.sel ? ' on' : ''}" data-id="${esc(e.id)}">
      <span class="dot"></span><div><div class="t1">${esc(label(e))}${e.title && e.company ? ' — ' + esc(e.title) : ''}</div>
      <div class="t2">${esc(e.ats || e.board || host(e.url))} · ${esc(when(e.startedAt))}${e.endedAt ? ' · ' + dur(e.startedAt, e.endedAt) : ''} · ${e.lines || 0} lines</div>
      ${e.reason && e.status !== 'done' ? `<div class="t3">${esc(e.reason)}</div>` : ''}</div></div>`).join('') || '<div class="hint">No jobs match.</div>';
    $('jobs').querySelectorAll('.job').forEach((j) => j.onclick = () => select(j.dataset.id));
  }

  /* ---------- one job ---------- */
  async function select(id) {
    state.sel = id;
    writeHash();
    state.rec = (await get(REC(id))) || null;
    state.shot = (await get(SHOT(id))) || '';
    renderJobs();
    renderDetail();
  }
  function renderDetail() {
    const e = state.index.find((x) => x.id === state.sel);
    if (!e) { $('detail').innerHTML = '<div class="empty">Pick a job to see everything it did.</div>'; return; }
    const rec = state.rec || { lines: [], pages: [], snap: null };
    const s = statusOf(e);
    const head = `<div class="dh"><span class="badge b-${s}">${s === 'done' ? 'applied' : s}</span><span class="chip">${esc(e.ats || e.board || '?')}</span>
      <h3>${esc(label(e))}${e.title && e.company ? ' — ' + esc(e.title) : ''}</h3>
      <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url)}</a>
      ${e.reason && s !== 'done' ? `<div class="reason">${esc(e.reason)}</div>` : ''}
      <div class="meta">Started ${esc(when(e.startedAt))}${e.endedAt ? ' · took ' + dur(e.startedAt, e.endedAt) : ' · still running'} · ${rec.pages.length} page(s) · ${rec.lines.length} lines${e.group ? ' · cause: ' + esc(e.group) : ''}</div>
      <div class="btn-row"><button id="copyJob">Copy this job's report</button><button id="expJob">Export JSON</button><button id="openJob">Open the job page</button></div></div>`;
    const tabs = ['timeline', 'page', 'shot', 'pages'].map((t) => `<button data-t="${t}" class="${state.tab === t ? 'on' : ''}">${{ timeline: 'Timeline', page: 'Page at the end', shot: 'Screenshot', pages: 'Pages visited' }[t]}</button>`).join('');
    $('detail').innerHTML = head + `<div class="tabs">${tabs}</div><div class="pane" id="pane"></div>`;
    $('detail').querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { state.tab = b.dataset.t; renderDetail(); });
    $('copyJob').onclick = () => copy(jobReport(e, rec), $('copyJob'));
    $('expJob').onclick = () => download(`jobright-debug-${(label(e) || 'job').replace(/[^\w-]+/g, '_')}.json`, JSON.stringify({ job: e, record: rec }, null, 2));
    $('openJob').onclick = () => window.open(e.url, '_blank');
    const pane = $('pane');
    if (state.tab === 'timeline') renderTimeline(pane, rec, e);
    else if (state.tab === 'page') renderPage(pane, rec.snap);
    else if (state.tab === 'shot') pane.innerHTML = state.shot ? `<img class="shot" src="${state.shot}" alt="The page when the job ended">` : '<div class="hint">No screenshot. One is taken when a job does not succeed and its tab is the one on screen (Chrome can only capture the visible tab).</div>';
    else pane.innerHTML = rec.pages.length ? `<table><tr><th>When</th><th>ATS</th><th>Page</th></tr>${rec.pages.map((p) => `<tr><td>${off(p.t, e.startedAt)}</td><td>${esc(p.ats)}</td><td class="v">${esc(p.title)}<br><span class="muted">${esc(p.url)}</span></td></tr>`).join('')}</table>` : '<div class="hint">No pages recorded.</div>';
  }
  function renderTimeline(pane, rec, e) {
    pane.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><input id="tlq" placeholder="Filter the timeline…" value="${esc(state.tlFilter)}" style="flex:1">
      <label class="muted"><input type="checkbox" id="tlerr"${state.tlErrors ? ' checked' : ''}> errors, stages & pages only</label></div><div class="tl" id="tl"></div>`;
    const draw = () => {
      const q = state.tlFilter.toLowerCase();
      const keep = (l) => (!q || String(l.m).toLowerCase().includes(q)) && (!state.tlErrors || ['error', 'stage', 'page', 'end', 'diag', 'job'].includes(l.k));
      const t0 = e.startedAt || (rec.lines[0] && rec.lines[0].t) || 0;
      let lastP = -1, out = '';
      for (const l of rec.lines) {
        if (!keep(l)) continue;
        if (l.p !== lastP && rec.pages[l.p - 1] && l.k !== 'page') { out += `<div class="pg">▸ ${esc(rec.pages[l.p - 1].url)}</div>`; }
        lastP = l.p;
        out += `<div class="r k-${esc(l.k || 'log')}"><span class="o">${off(l.t, t0)}</span><span class="k">${esc(l.k || 'log')}</span><span class="m">${esc(l.m)}</span></div>`;
      }
      $('tl').innerHTML = out || '<div class="hint">Nothing recorded yet.</div>';
    };
    draw();
    $('tlq').oninput = (ev) => { state.tlFilter = ev.target.value; draw(); };
    $('tlerr').onchange = (ev) => { state.tlErrors = ev.target.checked; draw(); };
  }
  function renderPage(pane, snap) {
    if (!snap) { pane.innerHTML = '<div class="hint">No snapshot yet — it is taken when the job ends.</div>'; return; }
    const missing = new Set((snap.missing || []).map((m) => String(m).toLowerCase()));
    const rows = (snap.fields || []).map((f) => {
      const isMiss = f.required && !f.value;
      const cls = isMiss ? 'miss' : f.error ? 'err' : '';
      const opts = f.options ? `<div class="muted">options: ${esc(f.options.join(' | '))}</div>` : '';
      const lbl = String(f.label || '').replace(/\s*\*+\s*$/, '') || '(no label)';
      return `<tr class="${cls}"><td class="l">${esc(lbl)}${f.required ? ' <span class="yes">*</span>' : ''}${f.yours ? ' <span class="chip">you</span>' : ''}</td><td>${esc(f.type)}</td><td class="v">${f.value ? esc(f.value) : '<span class="muted">empty</span>'}${opts}</td><td>${esc(f.error || '')}</td></tr>`;
    }).join('');
    pane.innerHTML = `
      ${snap.banner || (snap.alerts || []).length ? `<div class="box"><h4>What the page is saying (errors, alerts)</h4>${snap.banner ? `<pre>${esc(snap.banner)}</pre>` : ''}${(snap.alerts || []).length ? `<ul>${snap.alerts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      ${(snap.missing || []).length ? `<div class="box"><h4>Required and still empty (${snap.missing.length})</h4><ul>${snap.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
      ${(snap.errors || []).length ? `<div class="box"><h4>Fields the form flagged (${snap.errors.length})</h4><ul>${snap.errors.map((x) => `<li><b>${esc(x.label)}</b> — ${esc(x.message)} <span class="muted">(${esc(x.kind)})</span></li>`).join('')}</ul></div>` : ''}
      <div class="box"><h4>Buttons on screen</h4>${(snap.buttons || []).length ? esc(snap.buttons.join(' · ')) : '<span class="muted">none</span>'}
        <div style="margin-top:6px">Counted as Submit: ${snap.submitControl ? `<b>${esc(snap.submitControl)}</b>` : '<span style="color:var(--bad)">none — nothing on the page reads as a final Submit</span>'}</div>
        <div class="muted" style="margin-top:4px">${esc(snap.url)} · ${snap.frames || 0} iframe(s)${snap.snapError ? ' · snapshot error: ' + esc(snap.snapError) : ''}</div></div>
      <table><tr><th>Question / field</th><th>Type</th><th>Value</th><th>Error</th></tr>${rows || '<tr><td colspan="4" class="muted">No fields on the page.</td></tr>'}</table>
      <div class="box"><h4>Page text (start)</h4><pre>${esc(snap.text || '')}</pre></div>`;
    void missing;
  }

  /* ---------- text reports ---------- */
  function jobReport(e, rec) {
    const t0 = e.startedAt || 0;
    const out = [`Job: ${label(e)}${e.title ? ' — ' + e.title : ''}`, `URL: ${e.url}`, `ATS: ${e.ats || e.board || '?'}`, `Outcome: ${statusOf(e)}${e.reason ? ' — ' + e.reason : ''}`,
      `Started: ${when(e.startedAt)}  Took: ${dur(e.startedAt, e.endedAt) || '-'}`, ''];
    const snap = rec.snap;
    if (snap) {
      if (snap.banner) out.push('Errors on the page: ' + snap.banner);
      if ((snap.alerts || []).length) out.push('Page says: ' + snap.alerts.join(' | '));
      if ((snap.missing || []).length) out.push('Required and empty: ' + snap.missing.join('; '));
      if ((snap.errors || []).length) out.push('Flagged: ' + snap.errors.map((x) => `${x.label}: ${x.message}`).join('; '));
      out.push('Buttons: ' + (snap.buttons || []).join(' · '), 'Submit: ' + (snap.submitControl || 'none'), '', 'Fields:');
      for (const f of snap.fields || []) out.push(`  ${f.required ? '*' : ' '} ${f.label || '(no label)'} [${f.type}] = ${f.value || '(empty)'}${f.error ? '   ! ' + f.error : ''}`);
      out.push('');
    }
    out.push('Timeline:');
    for (const l of rec.lines) out.push(`${off(l.t, t0)} ${(l.k || 'log').padEnd(6)} ${l.m}`);
    return out.join('\n');
  }
  function summary() {
    const n = (f) => state.index.filter(f).length;
    const out = [`Jobright Debugger — ${state.index.length} jobs: ${n((e) => e.status === 'done')} applied, ${n((e) => BAD.includes(e.status))} failed, ${n((e) => e.status === 'skipped')} skipped`, ''];
    for (const [g, list] of causes()) {
      out.push(`${list.length}x  ${g}`);
      for (const e of list.slice(0, 5)) out.push(`      ${e.ats || e.board || '?'}  ${e.url}${e.reason && e.reason !== e.group ? '\n        ' + e.reason.slice(0, 200) : ''}`);
      if (list.length > 5) out.push(`      …and ${list.length - 5} more`);
      out.push('');
    }
    return out.join('\n');
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (_) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    if (btn) { const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = t), 1200); }
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- wiring ---------- */
  function renderAll() { renderStats(); renderCauses(); renderJobs(); }
  async function load() {
    state.index = (await get(IDX)) || [];
    renderAll();
    if (state.sel) await select(state.sel);
  }
  $('q').oninput = renderJobs;
  $('ats').onchange = renderJobs;
  $('status').onchange = () => { renderStats(); renderJobs(); };
  $('copySummary').onclick = () => copy(summary(), $('copySummary'));
  // One file with everything (built by the service worker — the same as the sidebar's button).
  $('exportAll').onclick = () => {
    const b = $('exportAll'), t = b.textContent;
    b.textContent = 'Preparing…';
    chrome.runtime.sendMessage({ type: 'UA_DBG_BUNDLE', page: { url: location.href, userAgent: navigator.userAgent } }, (r) => {
      void chrome.runtime.lastError;
      if (r && r.ok && r.json) { download(r.name, r.json); b.textContent = 'Saved ✓'; } else b.textContent = 'Could not prepare it';
      setTimeout(() => (b.textContent = t), 2500);
    });
  };
  $('clear').onclick = () => {
    if (!confirm('Delete every recorded job from the Debugger?')) return;
    chrome.runtime.sendMessage({ type: 'UA_DBG_CLEAR' }, () => { void chrome.runtime.lastError; state.sel = ''; state.rec = null; load(); });
  };
  // Live: the index and the open job update as the run goes.
  let pending = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !$('live').checked) return;
    if (!(IDX in changes) && !(state.sel && (REC(state.sel) in changes || SHOT(state.sel) in changes))) return;
    clearTimeout(pending);
    pending = setTimeout(async () => {
      if (IDX in changes) { state.index = changes[IDX].newValue || []; renderAll(); }
      if (state.sel) {
        state.rec = (await get(REC(state.sel))) || state.rec;
        state.shot = (await get(SHOT(state.sel))) || state.shot;
        const pane = $('pane'), y = pane ? $('detail').scrollTop : 0;
        renderDetail();
        $('detail').scrollTop = y;
      }
    }, 400);
  });
  window.addEventListener('hashchange', () => { readHash(); load(); });
  readHash();
  load();
})();
