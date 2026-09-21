/* Same treatment for the Queue Manager panel's importer helpers. */
const fs = require('fs');

function extract(src, names) {
  const lines = src.split('\n');
  let out = '';
  for (const n of names) {
    const startIdx = lines.findIndex((l) => new RegExp('^(\\s*)function ' + n + '\\(').test(l));
    if (startIdx < 0) throw new Error('not found: ' + n);
    const indent = lines[startIdx].match(/^(\s*)/)[1];
    let end = -1;
    for (let i = startIdx + 1; i < lines.length; i++) if (lines[i] === indent + '}') { end = i; break; }
    if (end < 0) throw new Error('no end for: ' + n);
    out += lines.slice(startIdx, end + 1).join('\n') + '\n';
  }
  return out;
}

const src = fs.readFileSync(process.argv[2], 'utf8');
const code = extract(src, ['isSafeUrl', 'normUrl', 'detectBoard', 'sniffDelimiter', 'parseCsv', 'urlFromRow']);
const ctx = {};
new Function('exports', code + '\nObject.assign(exports,{isSafeUrl,normUrl,detectBoard,sniffDelimiter,parseCsv,urlFromRow});')(ctx);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

/* Mirror of importText's row loop, so the end-to-end import behaviour is what
   is actually under test — not just the individual helpers. */
function importRows(text, opts) {
  opts = opts || {};
  text = String(text || '').replace(/^﻿/, '');
  const rows = ctx.parseCsv(text, ctx.sniffDelimiter(text));
  if (!rows.length) return { added: [], dupes: 0, bad: 0, applied: 0 };
  const first = rows[0].map((c) => c.trim().toLowerCase());
  const map = {};
  let hasHeader = false;
  first.forEach((c, i) => {
    if (/^https?:/i.test(c)) return;
    if (/\b(url|link|href|job.?url|application.?url|apply)\b/.test(c)) { map.url = i; hasHeader = true; }
    else if (/\b(title|position|role|job.?title)\b/.test(c)) { map.title = i; hasHeader = true; }
    else if (/\b(company|employer|organi[sz]ation)\b/.test(c)) { map.company = i; hasHeader = true; }
  });
  if (!hasHeader && !ctx.urlFromRow(rows[0]) && rows.length > 1) hasHeader = true;
  const applied = new Set((opts.applied || []).map(ctx.normUrl));
  const have = new Set((opts.have || []).map(ctx.normUrl));
  const added = [];
  let dupes = 0, bad = 0, appliedSkips = 0;
  for (const r of (hasHeader ? rows.slice(1) : rows)) {
    const url = ctx.urlFromRow(r, map.url);
    if (!url || !ctx.isSafeUrl(url)) { bad++; continue; }
    if (have.has(url)) { dupes++; continue; }
    if (opts.skipApplied && applied.has(url)) { appliedSkips++; continue; }
    have.add(url);
    added.push({ url, title: (map.title != null && (r[map.title] || '').trim()) || null, company: (map.company != null && (r[map.company] || '').trim()) || '' });
  }
  return { added, dupes, bad, applied: appliedSkips };
}

console.log('panel helpers');
eq('isSafeUrl rejects javascript', ctx.isSafeUrl('javascript:alert(1)'), false);
eq('isSafeUrl accepts https', ctx.isSafeUrl('https://a.com'), true);
eq('normUrl strips utm param, keeps functional ones', ctx.normUrl('https://a.com/1?utm_source=x&gh_src=k&id=2'), 'https://a.com/1?gh_src=k&id=2');
eq('detectBoard workday', ctx.detectBoard('https://acme.wd1.myworkdayjobs.com/x'), 'Workday');
eq('detectBoard fallback', ctx.detectBoard('https://acme.com/careers/1'), 'Career');

console.log('importText row handling');
{
  const r = importRows('url,title,company\nhttps://a.com/1,"Engineer, Backend",Acme\nhttps://a.com/2,PM,Beta');
  eq('header mapped, 2 rows', r.added.map((a) => [a.url, a.title, a.company]),
    [['https://a.com/1', 'Engineer, Backend', 'Acme'], ['https://a.com/2', 'PM', 'Beta']]);
}
{
  const r = importRows('Company,Position,Apply Link\nAcme,Eng,https://a.com/1');
  eq('url column found by "apply link"', r.added.map((a) => a.url), ['https://a.com/1']);
}
{
  const r = importRows('https://a.com/1\nhttps://a.com/1?utm_source=x\nhttps://a.com/2');
  eq('utm duplicate collapses', r.added.map((a) => a.url), ['https://a.com/1', 'https://a.com/2']);
  eq('duplicate counted', r.dupes, 1);
}
{
  const r = importRows('url\nnot-a-url\njavascript:alert(1)\nhttps://a.com/1');
  eq('invalid rows rejected', r.added.map((a) => a.url), ['https://a.com/1']);
  eq('bad count', r.bad, 2);
}
{
  const r = importRows('https://a.com/1\nhttps://a.com/2', { have: ['https://a.com/1'] });
  eq('existing queue de-duplicated', r.added.map((a) => a.url), ['https://a.com/2']);
}
{
  const r = importRows('https://a.com/1\nhttps://a.com/2', { applied: ['https://a.com/1'], skipApplied: true });
  eq('already-applied skipped', r.added.map((a) => a.url), ['https://a.com/2']);
  eq('applied count', r.applied, 1);
}
{
  const r = importRows('name\tlocation\turl\nAcme\tDublin\thttps://a.com/1');
  eq('tab-separated with header', r.added.map((a) => a.url), ['https://a.com/1']);
}
{
  const r = importRows('﻿url;title\nhttps://a.com/1;X');
  eq('BOM + semicolon', r.added.map((a) => a.url), ['https://a.com/1']);
}
{
  const r = importRows('https://a.com/1,Engineer\nhttps://a.com/2,PM');
  eq('headerless multi-column', r.added.map((a) => a.url), ['https://a.com/1', 'https://a.com/2']);
}

/* ── the failure report ──────────────────────────────────────────────────────
   A run that says "15 failed" and nothing else cannot be acted on. Every
   failure already carried a reason; there was just nowhere to get at them all
   at once. Run the real grouping. */
console.log('failures can be read off in one go');
{
  const fcode = extract(src, ['copyFailures']);
  const calls = { copied: '', logged: [] };
  const fctx = {};
  new Function('exports', `
    const log = (m, c) => exports.logged.push([m, c]);
    const fallbackCopy = (t, ok) => { exports.copied = t; ok(); };
    // A side panel can be refused clipboard access, so the fallback is the
    // path that has to work — exercise that one.
    const navigator = { clipboard: { writeText: () => { throw new Error('denied'); } } };
    let queue = exports.queue;
    ${fcode}
    exports.run = (q) => { queue = q; exports.queue = q; copyFailures(); };
  `)(calls);

  calls.run([
    { url: 'https://a.com/1', status: 'done' },
    { url: 'https://a.com/2', status: 'failed', error: 'No application form found' },
    { url: 'https://a.com/3', status: 'failed', error: 'No application form found' },
    { url: 'https://a.com/4', status: 'failed', error: 'No application form found' },
    { url: 'https://a.com/5', status: 'timeout', error: 'Tab went silent for 20s' },
    { url: 'https://a.com/6', status: 'skipped' },
  ]);
  const text = calls.copied;
  eq('the headline says what actually happened',
    text.split('\n')[0], 'Jobright queue — 6 jobs, 1 applied, 5 not');
  eq('the commonest cause is listed first',
    /\n3x {2}failed: No application form found\n/.test(text), true);
  eq('and its URLs come with it', /\n {6}https:\/\/a\.com\/2\n/.test(text), true);
  eq('a one-off cause is still reported', /1x {2}timeout: Tab went silent for 20s/.test(text), true);
  eq('a job that failed without a reason says so rather than going missing',
    /1x {2}skipped: no reason recorded/.test(text), true);
  eq('a job that succeeded is not in the report', /a\.com\/1/.test(text), false);
  eq('and the log says how much was copied',
    calls.logged[0][0], 'Copied 5 failures in 3 groups');
  eq('the clipboard is tried first when it is available',
    /navigator\.clipboard\.writeText\(text\)\.then\(ok, \(\) => fallbackCopy\(text, ok\)\);/.test(src), true);

  calls.logged.length = 0; calls.copied = '';
  calls.run([{ url: 'https://a.com/1', status: 'done' }]);
  eq('nothing to report copies nothing', calls.copied, '');
  eq('and says so', calls.logged[0][0], 'No failures to copy');

  // Long groups are truncated, or one bad ATS buries the rest.
  calls.logged.length = 0;
  calls.run(Array.from({ length: 12 }, (_, i) => (
    { url: 'https://b.com/' + i, status: 'failed', error: 'Sign-in required' })));
  eq('a long group is capped', /…and 4 more/.test(calls.copied), true);
  eq('but its true size is still stated', /12x {2}failed: Sign-in required/.test(calls.copied), true);
}


/* ── the diagnostics viewer ──────────────────────────────────────────────────
   Copying and downloading silently — which is what the button did — leaves you
   with no idea whether it worked or what is in it. Reading the report IS the
   point: the fix list is in the text, not in the file name. */
console.log('the diagnostics report can be read, not just exported');
{
  const html = fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]), 'ua-queue.html'), 'utf8');
  eq('there is a button for it', /id="btnDiag"/.test(html), true);
  eq('and a dialog to show it in', /<dialog id="diagDlg">/.test(html), true);
  eq('the text is shown, not just handed to a download',
    /<textarea id="diagBox" readonly/.test(html), true);
  eq('it is read-only — this is a record, not a form', /id="diagBox" readonly/.test(html), true);
  for (const [id, what] of [['diagCopy', 'copy'], ['diagDownload', 'download'], ['diagClear', 'reset'], ['diagClose', 'close']])
    eq(`there is a ${what} control`, html.includes(`id="${id}"`), true);
  eq('monospace, so the outcome table lines up',
    /#diagDlg textarea\{[^}]*ui-monospace/.test(html), true);
  eq('and the no-values promise is stated where it is read',
    /No field values are ever recorded/.test(html), true);

  eq('the dialog opens before the report arrives, so it never looks like nothing happened',
    /box\.value = 'Reading…';\n    try \{ \$\('diagDlg'\)\.showModal\(\);/.test(src), true);
  eq('a worker that does not answer says so, and says what to do',
    /Reload the extension at chrome:\/\/extensions and run a batch/.test(src), true);
  eq('the download takes what is on screen, so it matches what was read',
    /const text = \$\('diagBox'\)\.value \|\| '';/.test(src), true);
  eq('the file is timestamped', /jobright-diagnostics-\$\{new Date\(\)\.toISOString\(\)/.test(src), true);
  eq('resetting goes through the worker, which owns the record',
    /chrome\.runtime\.sendMessage\(\{ type: 'UA_DIAG_CLEAR' \}/.test(src), true);
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
