/* Extracts the CSV/URL helpers out of the shipped files by brace-matching and
   runs them against real-world-shaped inputs. */
const fs = require('fs');

/* These helpers all live at one indent level inside the file's IIFE, so the
   function ends at the first line that is exactly that indent + "}". Brace
   counting is unreliable here (regex literals contain braces and slashes). */
function extract(src, names) {
  const lines = src.split('\n');
  let out = '';
  for (const n of names) {
    const startIdx = lines.findIndex((l) => new RegExp('^(\\s*)function ' + n + '\\(').test(l));
    if (startIdx < 0) throw new Error('not found: ' + n);
    const indent = lines[startIdx].match(/^(\s*)/)[1];
    let end = -1;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i] === indent + '}') { end = i; break; }
    }
    if (end < 0) throw new Error('no end for: ' + n);
    out += lines.slice(startIdx, end + 1).join('\n') + '\n';
  }
  return out;
}

const enh = fs.readFileSync(process.argv[2], 'utf8');
const code = extract(enh, ['isSafeJobUrl', 'normalizeUrl', 'sniffDelimiter', 'parseCsvRows', 'urlFromCsvRow', 'parseCSV', 'parseBulkUrls']);
const ctx = {};
new Function('exports', code + '\nObject.assign(exports,{isSafeJobUrl,normalizeUrl,sniffDelimiter,parseCsvRows,urlFromCsvRow,parseCSV,parseBulkUrls});')(ctx);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

console.log('normalizeUrl');
eq('strips hash + trailing slash', ctx.normalizeUrl('https://jobs.lever.co/acme/123/#apply'), 'https://jobs.lever.co/acme/123');
eq('strips utm noise', ctx.normalizeUrl('https://x.com/j/1?utm_source=li&gh_jid=9'), 'https://x.com/j/1?gh_jid=9');
eq('rejects javascript:', ctx.normalizeUrl('javascript:alert(1)'), '');
eq('rejects data:', ctx.normalizeUrl('data:text/html,<script>x</script>'), '');
eq('rejects file:', ctx.normalizeUrl('file:///etc/passwd'), '');
eq('adds scheme to bare host+path', ctx.normalizeUrl('boards.greenhouse.io/acme/jobs/7'), 'https://boards.greenhouse.io/acme/jobs/7');
eq('rejects plain prose', ctx.normalizeUrl('Software Engineer'), '');
eq('trims wrapping punctuation', ctx.normalizeUrl('<https://a.com/b>,'), 'https://a.com/b');

console.log('sniffDelimiter');
eq('comma', ctx.sniffDelimiter('url,title\nhttps://a.com/1,X'), ',');
eq('semicolon', ctx.sniffDelimiter('url;title\nhttps://a.com/1;X'), ';');
eq('tab', ctx.sniffDelimiter('url\ttitle\nhttps://a.com/1\tX'), '\t');

console.log('parseCSV (structured)');
eq('quoted comma in title does not create a second url',
  ctx.parseCSV('url,title\nhttps://a.com/1,"Engineer, Backend"\nhttps://a.com/2,"Manager, Ops"'),
  ['https://a.com/1', 'https://a.com/2']);
eq('quoted newline inside a cell',
  ctx.parseCSV('url,notes\nhttps://a.com/1,"line1\nline2"\nhttps://a.com/2,ok'),
  ['https://a.com/1', 'https://a.com/2']);
eq('semicolon export',
  ctx.parseCSV('url;company\nhttps://a.com/1;Acme\nhttps://a.com/2;Beta'),
  ['https://a.com/1', 'https://a.com/2']);
eq('BOM + header skipped', ctx.parseCSV('﻿url,title\nhttps://a.com/1,X'), ['https://a.com/1']);
eq('url not in the first column',
  ctx.parseCSV('company,title,link\nAcme,Eng,https://a.com/1'),
  ['https://a.com/1']);
eq('bare-url lines', ctx.parseCSV('https://a.com/1\nhttps://a.com/2\n'), ['https://a.com/1', 'https://a.com/2']);
eq('dedupes equivalent urls', ctx.parseCSV('https://a.com/1/\nhttps://a.com/1#x\n'), ['https://a.com/1']);
eq('drops javascript row', ctx.parseCSV('url\njavascript:alert(1)\nhttps://a.com/1'), ['https://a.com/1']);
eq('empty input', ctx.parseCSV(''), []);

console.log('parseBulkUrls (loose paste)');
eq('newline list', ctx.parseBulkUrls('https://a.com/1\nhttps://a.com/2'), ['https://a.com/1', 'https://a.com/2']);
eq('mixed separators', ctx.parseBulkUrls('https://a.com/1, https://a.com/2\thttps://a.com/3'), ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
eq('skips header words', ctx.parseBulkUrls('url\nhttps://a.com/1'), ['https://a.com/1']);
eq('rejects javascript:', ctx.parseBulkUrls('javascript:alert(1)\nhttps://a.com/1'), ['https://a.com/1']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
