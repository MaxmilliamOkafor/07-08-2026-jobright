/* The mailbox module reads a real inbox. Its limits are the whole design, so
   they are what these lock in — and the two functions that decide what gets read
   and what gets clicked are pure, so they run for real here.

   Usage: node tests/mailbox.test.js "<ua-mailbox.js>" "<ua-enhancement.js>" */
const fs = require('fs');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const src = fs.readFileSync(process.argv[2], 'utf8');
const enh = fs.readFileSync(process.argv[3], 'utf8');

function grabFn(s, name) {
  const start = s.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') { depth++; seen = true; }
    else if (s[i] === '}') { depth--; if (seen && depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* ── 1. scope: read-only, and nothing else ────────────────────────────────── */
console.log('the mailbox is read-only by construction');
eq('the only scope requested is gmail.readonly',
  (src.match(/googleapis\.com\/auth\/[a-z.]+/g) || []), ['googleapis.com/auth/gmail.readonly']);
for (const bad of ['gmail.modify', 'gmail.send', 'gmail.compose', 'gmail.labels', 'mail.google.com', 'gmail.insert'])
  eq(`the ${bad} scope is never requested`, src.includes(bad), false);
eq('no request ever uses a mutating verb on the mail API',
  /method:\s*'(DELETE|PUT|PATCH)'/.test(src), false);
eq('there is no trash, delete, modify or send endpoint',
  /\/(trash|untrash|batchDelete|batchModify|send|drafts)\b/.test(src), false);
eq('the API base is pinned to the signed-in user', /users\/me/.test(src), true);

/* ── 2. the token ─────────────────────────────────────────────────────────── */
console.log('the token is short-lived and revocable');
eq('it lives in session storage, so it dies with the browser',
  /TOKEN: 'ua_mail_token',\s*\/\/ session only/.test(src), true);
eq('and is read and written through the session helper only',
  /sess\.get\(K\.TOKEN\)/.test(src) && /sess\.set\(K\.TOKEN/.test(src), true);
eq('it is never written to local storage', /local\.set\(K\.TOKEN/.test(src), false);
eq('disconnecting drops Chrome\'s cached copy', /removeCachedAuthToken/.test(src), true);
eq('and revokes the grant with Google', /oauth2\.googleapis\.com\/revoke/.test(src), true);
eq('PKCE is used, because an extension cannot keep a client secret',
  /code_challenge_method', 'S256'/.test(src), true);
eq('no client secret appears anywhere', /client_secret/.test(src), false);

/* ── 3. what gets read: recent, and only for this employer ────────────────── */
console.log('only recent mail, and only about the job in hand');
const ctx = {};
new Function('exports', grabFn(src, 'buildQuery') + '\nexports.buildQuery = buildQuery;')(ctx);
const q = ctx.buildQuery({ hosts: ['myworkdayjobs.com', 'guidehouse.com'], companies: ['Guidehouse'] });
eq('the query names the employer', /from:myworkdayjobs\.com/.test(q) && /from:guidehouse\.com/.test(q), true);
eq('and is bounded in time', /newer_than:1h/.test(q), true);
eq('it asks only for verification-shaped mail', /verify OR verification OR confirm/.test(q), true);
eq('a query with no employer still cannot list the mailbox generally',
  /newer_than:1h/.test(ctx.buildQuery({})), true);
eq('the age cutoff is minutes, not days', /MAX_AGE_MIN = 15/.test(src), true);
eq('and it is actually applied to each message',
  /if \(Number\(msg\.internalDate \|\| 0\) < cutoff\) continue;/.test(src), true);
eq('a caller must name the employer — there is no "list my mail" path',
  /if \(!hosts\.length\) return sendResponse\(\{ ok: false, reason: 'no-hosts' \}\);/.test(src), true);
eq('the message body is never returned to the caller',
  /body: /.test(src.slice(src.indexOf('return { ok: true'), src.indexOf('return { ok: true') + 200)), false);
eq('nor stored', /local\.set\([^)]*body/.test(src), false);

/* ── 4. what gets clicked ─────────────────────────────────────────────────── */
/* Inboxes contain phishing. An unattended agent that opens any link in any
   recent mail is a liability — this is the check that makes the feature safe to
   leave running while you are away from the machine. */
console.log('a link is only followed back to the employer being applied to');
const linkCtx = {};
new Function('exports', grabFn(src, 'pickLink') + '\nexports.pickLink = pickLink;')(linkCtx);
const pick = linkCtx.pickLink;
const HOSTS = ['guidehouse.wd1.myworkdayjobs.com', 'guidehouse.com'];

eq('the real verification link is returned',
  pick('Please https://guidehouse.wd1.myworkdayjobs.com/verify?token=abc to continue', HOSTS),
  'https://guidehouse.wd1.myworkdayjobs.com/verify?token=abc');
eq('a link on the employer\'s own domain counts too',
  pick('Confirm: https://careers.guidehouse.com/activate?id=9', HOSTS),
  'https://careers.guidehouse.com/activate?id=9');
eq('a phishing link in the same mail is NOT followed',
  pick('Verify here https://guidehouse-verify.evil.com/verify?token=abc', HOSTS), null);
eq('nor a lookalike subdomain of someone else',
  pick('https://myworkdayjobs.com.evil.io/verify', HOSTS), null);
eq('nor an unrelated newsletter link',
  pick('https://news.example.com/verify-your-subscription', HOSTS), null);
eq('plain http is refused even on the right host',
  pick('http://guidehouse.com/verify?token=abc', HOSTS), null);
eq('a link that is not verification-shaped is left alone',
  pick('https://guidehouse.com/about-us', HOSTS), null);
eq('with no allow-list, nothing is followed',
  pick('https://guidehouse.com/verify?token=abc', []), null);
eq('and no link at all returns null', pick('Your code is 481920', HOSTS), null);

/* ── 5. codes ─────────────────────────────────────────────────────────────── */
console.log('one-time codes are extracted');
const CODE_RE = new Function('return ' + src.match(/const CODE_RE = (\/[\s\S]*?\/i);/)[1])();
const BARE = new Function('return ' + src.match(/const BARE_CODE_RE = (\/[\s\S]*?\/);/)[1])();
const codeOf = (t) => { const m = t.match(CODE_RE) || t.match(BARE); return m ? m[1] : null; };
eq('"Your verification code is 481920"', codeOf('Your verification code is 481920'), '481920');
eq('"Code: 4819"', codeOf('Code: 4819'), '4819');
eq('"one-time PIN 55213"', codeOf('Your one-time PIN 55213'), '55213');
eq('a bare six-digit code is picked up', codeOf('Enter 902114 to continue'), '902114');
eq('ordinary prose yields nothing', codeOf('Thanks for applying to Guidehouse.'), null);

/* ── 6. the content-script side ───────────────────────────────────────────── */
console.log('the wall is detected and handed over when no mailbox is connected');
const WALL = new Function('return ' + enh.match(/const VERIFY_WALL_RE = (\/[\s\S]*?\/i);/)[1])();
for (const [copy, want] of [
  ['Please verify your email to continue', true],
  ['We have sent you an email with a verification link', true],
  ['Check your inbox for the code', true],
  ['Enter the code we sent to your email', true],
  ['One-time passcode', true],
  // Oracle Recruiting (JPMorgan, Dell, EY…) — its PIN screen.
  ['Confirm your identity. We sent a verification code to m***@gmail.com', true],
  ['Enter the PIN we sent to your email address', true],
  ['Verify your identity', true],
  ['Please confirm your email address below', true],
  ['Tell us about your work experience', false],
  ['Upload your resume', false],
]) eq(`verification wall: "${copy.slice(0, 40)}" → ${want}`, WALL.test(copy), want);

eq('a code is typed in preference to following a link',
  /if \(r\.code && box && !tried\.has\(r\.code\)\) \{/.test(enh), true);
eq('a code that was already rejected is not typed again', /tried\.add\(r\.code\);/.test(enh), true);
eq('the wait is bounded', /Date\.now\(\) < deadline/.test(enh), true);
eq('and turning the automation off stops it', /if \(autoStopped\(\)\) return false;/.test(enh), true);
eq('with no mailbox connected the job is handed over, not failed silently',
  /reason === 'disabled' \|\| r\.reason === 'not-connected'/.test(enh), true);
eq('the queue is told a person is needed', /function reportNeedsHuman\(reason\)/.test(enh), true);
eq('the stall watchdog stands down while waiting for the mail',
  /withBusy\('waiting for the verification email'/.test(enh), true);
eq('a password box is never mistaken for a code box',
  /if \(\/password\/i\.test\(hay\)\) return false;/.test(enh), true);

/* ── 7. a code only from mail sent for THIS wall ──────────────────────────── */
console.log('only mail sent since the wall appeared is read');
eq('the worker takes the caller\'s "since"', /since: Number\(msg\.since\) \|\| 0/.test(src), true);
eq('and the cutoff is the later of the two', /const cutoff = Math\.max\(Date\.now\(\) - MAX_AGE_MIN \* 60000, since\);/.test(src), true);
eq('the page sends when the wall appeared', /askMailboxForVerification\(hosts, company \? \[company\] : \[\], since\)/.test(enh), true);
eq('Oracle\'s own senders are searched on Oracle pages', /if \(isOracleCloud\(\)\) hosts\.push\('oraclecloud\.com', 'oracle\.com'\);/.test(enh), true);

/* ── 8. one box per digit ─────────────────────────────────────────────────── */
console.log('a split PIN is typed one digit per box');
{
  const grab = (name) => {
    const a = enh.search(new RegExp('^  function ' + name + '\\(', 'm'));
    let d = 0, seen = false;
    for (let i = a; i < enh.length; i++) {
      if (enh[i] === '{') { d++; seen = true; } else if (enh[i] === '}') { d--; if (seen && !d) return enh.slice(a, i + 1); }
    }
  };
  const mk = (n, max) => Array.from({ length: n }, () => ({ maxLength: max, value: '', disabled: false, readOnly: false, focus() {} }));
  const run = (boxes, code) => {
    new Function('boxes', 'code', `
      const deepAll = () => boxes, isVisible = () => true;
      const nativeSet = (el, v) => { el.value = v; };
      ${grab('codeBoxGroup')}
      ${grab('typeVerificationCode')}
      typeVerificationCode(boxes[0], code);
    `)(boxes, code);
    return boxes.map((b) => b.value);
  };
  eq('six one-digit boxes get one digit each', run(mk(6, 1), '482913'), ['4', '8', '2', '9', '1', '3']);
  eq('a single code box gets the whole code', run(mk(1, 6), '482913'), ['482913']);
  eq('a normal-width box is not split', run(mk(1, -1), '4829'), ['4829']);
  eq('three one-char inputs are not taken for a PIN', run(mk(3, 1), '482913'), ['482913', '', '']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
