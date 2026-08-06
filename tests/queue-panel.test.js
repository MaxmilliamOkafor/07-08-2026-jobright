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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
