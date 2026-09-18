/* Static check: every function the content script CALLS must actually be declared
   somewhere, or be a known global. There is no way to run ua-enhancement.js
   outside a browser, so a call to a helper that does not exist survives
   `node --check` (it is valid syntax) and only fails at runtime — on a live ATS
   page, mid-application, as a silent job failure. This catches it here instead.

   Usage: node tests/references.test.js "<path to ua-enhancement.js>" [more files] */
const fs = require('fs');

/* Strip comments and string/template/regex literals so their contents can't look
   like code. Deliberately conservative: when in doubt, keep the text (a false
   "declared" is harmless; a false "missing" would be noise). */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        // Template placeholders hold real code — keep them.
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2; const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ' ' + src.slice(start, i) + ' ';
          i++; continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    // Regex literal: only when a regex can legally start here — after an operator,
    // an opening bracket, OR a keyword. Missing the keyword case made `return /re/`
    // parse as division, which then swallowed the rest of the file as a string and
    // reported every later declaration as missing.
    if (c === '/') {
      let k = out.length - 1;
      while (k >= 0 && /\s/.test(out[k])) k--;
      const prev = k >= 0 ? out[k] : '';
      let word = '';
      let w = k;
      while (w >= 0 && /[A-Za-z]/.test(out[w])) { word = out[w] + word; w--; }
      const KEYWORD_BEFORE_REGEX = /^(return|typeof|case|in|of|do|else|void|delete|await|yield|new|instanceof|throw)$/;
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev) || KEYWORD_BEFORE_REGEX.test(word)) {
        i++;
        let inClass = false;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i++; break; }
          else if (src[i] === '\n') break;
          i++;
        }
        while (i < n && /[gimsuyd]/.test(src[i])) i++;
        out += ' ';
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

const GLOBALS = new Set([
  // language
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Proxy', 'Reflect', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'eval', 'Function', 'Intl', 'structuredClone',
  'require', 'escape', 'unescape',
  // timers / platform
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'fetch', 'atob', 'btoa',
  // DOM constructors and APIs used throughout
  'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'InputEvent',
  'FocusEvent', 'DragEvent', 'ClipboardEvent', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileList', 'FileReader',
  'FormData', 'DataTransfer', 'XMLHttpRequest', 'Notification', 'Image', 'Node', 'Element',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'DocumentFragment', 'Range',
  'NodeFilter', 'CSS', 'AbortController', 'TextEncoder', 'TextDecoder', 'getComputedStyle',
  'alert', 'confirm', 'prompt', 'open', 'close', 'postMessage', 'matchMedia', 'scrollTo',
  'Response', 'Request', 'Headers', 'ArrayBuffer', 'Uint8Array', 'Uint16Array', 'Int8Array',
  'Float32Array', 'Float64Array', 'DataView', 'WebSocket', 'Worker', 'BroadcastChannel',
]);

function declaredNames(src) {
  const names = new Set();
  const add = (re, group) => {
    let m;
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = r.exec(src))) names.add(m[group]);
  };
  add(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, 1);                       // function decls & exprs
  add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 1);                     // assigned bindings
  add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[,;\n]/, 1);                // plain bindings
  add(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\()/, 1);          // object-literal methods
  add(/\bclass\s+([A-Za-z_$][\w$]*)/, 1);
  // destructuring: const { a, b } = ... / const [a, b] = ...
  let m;
  const dre = /\b(?:const|let|var)\s*[{[]([^}\]]{0,300})[}\]]\s*=/g;
  while ((m = dre.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].replace(/[.\s]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // function parameters (any arity, including arrow params)
  const pre = /(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*|\bfunction\s*|=>\s*|\(\s*)\(([^()]{0,400})\)\s*(?:=>|\{)/g;
  while ((m = pre.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^\.\.\./, '').split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  const are = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g;                        // single-param arrows
  while ((m = are.exec(src))) names.add(m[1]);
  const cre = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = cre.exec(src))) names.add(m[1]);
  const fre = /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fre.exec(src))) names.add(m[1]);
  return names;
}

function calledNames(src) {
  const calls = new Map();      // name → first line number
  const lines = src.split('\n');
  // A call NOT preceded by a dot (so `foo.bar()` and `.map()` are ignored) and not
  // a keyword that takes parentheses.
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'case', 'yield', 'instanceof',
    'constructor', 'async', 'get', 'set', 'throw', 'try', 'finally']);
  for (let i = 0; i < lines.length; i++) {
    const re = /(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(lines[i]))) {
      const name = m[2];
      if (KEYWORDS.has(name)) continue;
      if (!calls.has(name)) calls.set(name, i + 1);
    }
  }
  return calls;
}

let fail = 0;
for (const file of process.argv.slice(2)) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripLiterals(raw);
  const declared = declaredNames(src);
  const calls = calledNames(src);
  const missing = [];
  for (const [name, line] of calls) {
    if (declared.has(name) || GLOBALS.has(name)) continue;
    missing.push({ name, line });
  }
  const label = file.split('/').pop();
  if (missing.length) {
    console.log(`  FAIL ${label}: ${missing.length} call(s) to undeclared function(s)`);
    for (const x of missing.slice(0, 25)) console.log(`       ${label}:${x.line}  ${x.name}(...)`);
    fail++;
  } else {
    console.log(`  ok   ${label}: every called function is declared (${calls.size} distinct calls, ${declared.size} declarations)`);
  }
}

/* ── redeclaration in the same scope ──────────────────────────────────────────
   JavaScript lets a later `function f(){}` silently replace an earlier one in
   the same scope. No error, no warning — the first is simply gone, and any edit
   made to it does nothing at all.

   A second, older smartRecruitersAutomation was sitting in this file doing
   exactly that. It happened to be the dead one rather than the live one, so it
   cost nothing this time; had the order been reversed, every SmartRecruiters
   job would have run the naive driver and no amount of reading the shadow-aware
   code would have explained why.

   The file is a series of top-level IIFEs, and each is its own scope — the same
   helper name appearing in two different IIFEs is fine and deliberate. Only a
   pair inside ONE of them is a bug. */
console.log('no function is silently replaced by a later one');
for (const file of process.argv.slice(2)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const scopes = [];
  lines.forEach((l, i) => {
    if (/^\(\s*(async\s+)?function\s*\(/.test(l)) scopes.push({ start: i, end: -1 });
    if (/^\}\)\(\);?\s*$/.test(l)) {
      for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].end < 0) { scopes[k].end = i; break; }
    }
  });
  const dupes = [];
  for (const sc of scopes) {
    const seen = new Map();
    const last = sc.end < 0 ? lines.length - 1 : sc.end;
    for (let i = sc.start; i <= last; i++) {
      const m = lines[i].match(/^  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) continue;
      if (seen.has(m[1])) dupes.push(`${m[1]} at line ${i + 1} replaces the one at line ${seen.get(m[1])}`);
      else seen.set(m[1], i + 1);
    }
  }
  const label = file.split('/').pop();
  if (dupes.length) {
    console.log(`  FAIL ${label}: ${dupes.length} function(s) redeclared in the same scope`);
    for (const d of dupes.slice(0, 15)) console.log(`       ${label}: ${d}`);
    fail++;
  } else {
    console.log(`  ok   ${label}: no function is redeclared within a single scope`);
  }
}

process.exit(fail ? 1 : 0);
