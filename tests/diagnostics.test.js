/* The run recorder (ua-diagnostics.js), driven for real against a fake
   chrome.storage. Everything here exercises the shipped code — the module is
   loaded as-is into a sandbox with the chrome APIs it expects. */
const fs = require('path') && require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');

/* A fake service-worker global: chrome.storage.local backed by a plain object,
   and a message listener we can call directly. */
function makeWorker() {
  const store = {};
  const listeners = [];
  const sandbox = {
    self: {},
    console,
    setTimeout,
    URL,
    Date,
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
      storage: {
        local: {
          get: (k, cb) => cb(typeof k === 'string' ? { [k]: store[k] } : {}),
          set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); cb && cb(); },
        },
      },
    },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(file) });
  return { api: sandbox.self.__uaDiag, store, listeners };
}

console.log('the recorder keeps a durable, bounded account of every run');

/* ── it records outcomes, not only failures ───────────────────────────────── */
{
  const { api } = makeWorker();
  const run = async () => {
    for (let i = 0; i < 12; i++) await api.record({ ats: 'Greenhouse', code: 'job.done', url: 'https://g/' + i });
    for (let i = 0; i < 3; i++) await api.record({ ats: 'Greenhouse', code: 'job.failed', reason: 'Submit was clicked but no confirmation appeared', url: 'https://g/f' + i });
    for (let i = 0; i < 9; i++) await api.record({ ats: 'iCIMS', code: 'job.failed', reason: 'Sign-in required', url: 'https://i/' + i });
    await api.record({ ats: 'iCIMS', code: 'job.skipped', reason: 'The posting has closed', url: 'https://i/x' });
    // Five Greenhouse skips: 12/(12+3) is 80%, but 12/(12+3+5) would be 60%.
    for (let i = 0; i < 5; i++) await api.record({ ats: 'Greenhouse', code: 'job.skipped', reason: 'Already applied', url: 'https://g/s' + i });
    return api.report();
  };
  run().then((text) => {
    eq('the report leads with outcomes, not failures',
      text.indexOf('OUTCOMES BY ATS') < text.indexOf('WHAT WENT WRONG'), true);
    /* The point of recording successes: 3 Greenhouse failures out of 15 is a
       different problem from 9 iCIMS failures out of 9. */
    eq('a platform that mostly works shows its rate', /80%\s+Greenhouse/.test(text), true);
    eq('a platform that never works shows that too', /0%\s+iCIMS/.test(text), true);
    eq('the worst platform is listed first', text.indexOf('iCIMS') < text.indexOf('Greenhouse'), true);
    /* A skip was never attempted, so counting it as a miss would understate
       every platform. With five skips present the rate must still read 80%
       (12 of 15), not 60% (12 of 20). */
    eq('a skip is not counted against the success rate — it was never attempted',
      /80%\s+Greenhouse/.test(text) && !/60%\s+Greenhouse/.test(text), true);
    eq('though it is still shown in its own column',
      /\s5\s+0\s+80%\s+Greenhouse/.test(text), true);
    eq('and there is a total line', /ALL \(30 jobs\)/.test(text), true);
    eq('the reason is named, with its count', /9x\s+job\.failed: Sign-in required/.test(text), true);
    const wrongSection = text.slice(text.indexOf('WHAT WENT WRONG'), text.indexOf('RECENT EVENTS'));
    eq('a successful job is not listed as a problem', /job\.done/.test(wrongSection), false);

    next1();
  });
}

/* ── the store cannot grow with the size of a run ─────────────────────────── */
function next1() {
  const { api, store } = makeWorker();
  (async () => {
    // One reason, two thousand jobs — the shape a bulk run actually has.
    for (let i = 0; i < 2000; i++) {
      await api.record({ ats: 'Workday', code: 'job.failed', reason: 'Account wall', url: 'https://w/' + i });
    }
    const agg = store.ua_diag_agg;
    const events = store.ua_diag_events;
    eq('2000 identical failures collapse to ONE aggregate row', Object.keys(agg).length, 1);
    eq('which still knows there were 2000 of them', agg['Workday|job.failed|Account wall'].n, 2000);
    eq('it keeps a handful of URLs to go and look at, not two thousand',
      agg['Workday|job.failed|Account wall'].urls.length, 6);
    eq('the event ring is capped', events.length, 1200);
    eq('and it kept the NEWEST events, not the oldest',
      events[events.length - 1].url, 'https://w/1999');
    next1b();
  })();
}

/* ── the board view, which is not the platform view ───────────────────────── */
function next1b() {
  const { api } = makeWorker();
  (async () => {
    /* Greenhouse is one ATS served from many domains, and they do NOT behave
       alike — a white-labelled board wraps the same form in its own navigation,
       account wall and consent text. The platform table would show "Greenhouse
       67%" and hide the fact that one employer's domain never works at all. */
    for (let i = 0; i < 8; i++) await api.record({ ats: 'Greenhouse', code: 'job.done', url: 'https://job-boards.greenhouse.io/acme/jobs/' + i });
    for (let i = 0; i < 4; i++) await api.record({ ats: 'Greenhouse', code: 'job.failed', reason: 'Sign-in required', url: 'https://careers.awkward.com/x/' + i });
    await api.record({ ats: 'Greenhouse', code: 'job.failed', reason: 'Cover Letter is required', url: 'https://careers.awkward.com/x/9' });
    const text = await api.report();
    eq('a board with trouble is named in full, not collapsed to its platform',
      /careers\.awkward\.com\s+\[Greenhouse\]/.test(text), true);
    eq('with the platform it runs, so a pattern across employers is visible',
      /\[Greenhouse\]/.test(text), true);
    eq('and its own success rate, which the platform average hid',
      /careers\.awkward\.com\s+\[Greenhouse\]\s+—\s+0 applied, 5 failed/.test(text), true);
    eq('its commonest reason comes with it', /4x\s+Sign-in required/.test(text), true);
    /* A board that simply works needs no attention and would only be noise. */
    eq('a board with no failures is not listed among the troubled ones',
      /job-boards\.greenhouse\.io\s+\[Greenhouse\]\s+—/.test(text), false);
    eq('the board view is separate from the platform view',
      text.indexOf('OUTCOMES BY ATS') < text.indexOf('BOARDS WITH TROUBLE'), true);
    next1c();
  })();
}

/* ── a breadcrumb is not a problem ────────────────────────────────────────── */
function next1c() {
  const { api } = makeWorker();
  (async () => {
    /* A real report read "ADP WorkforceNow — 261 problems", of which 259 were
       the stage trail: answering dropdowns, filling fields, attaching the CV.
       The two entries worth reading were buried under them. */
    for (const st of ['answering dropdowns', 'filling fields', 'attaching the CV']) {
      for (let i = 0; i < 40; i++) await api.record({ ats: 'ADP', code: 'stage', reason: st, url: 'https://adp/1' });
    }
    await api.record({ ats: 'ADP', code: 'stage.fill', reason: 'Before submit', url: 'https://adp/1' });
    await api.record({ ats: 'ADP', code: 'job.failed', reason: 'Verification code never arrived', url: 'https://adp/1' });
    await api.record({ ats: 'ADP', code: 'field.unanswered', reason: 'Enter the Verification Code', url: 'https://adp/1' });
    const text = await api.report();
    const wrong = text.slice(text.indexOf('WHAT WENT WRONG'), text.indexOf('REQUIRED QUESTIONS'));
    eq('the stage trail is kept out of the problem list', /stage/.test(wrong), false);
    eq('and so the count reflects real problems', /ADP\s+—\s+2 problems/.test(wrong), true);
    eq('the failure is still there', /Verification code never arrived/.test(wrong), true);
    eq('and so is the unanswered question', /Enter the Verification Code/.test(wrong), true);
    /* The trail is not thrown away — it belongs in the event log, which is a
       capped window on the most RECENT events, so the latest stage is there and
       the oldest has rolled off. */
    const recent = text.slice(text.indexOf('RECENT EVENTS'));
    eq('the trail is still recorded, in RECENT EVENTS', /attaching the CV/.test(recent), true);
    eq('and the oldest of it has rolled out of that window',
      /answering dropdowns/.test(recent), false);
    next2();
  })();
}

/* ── the unanswered-question table ────────────────────────────────────────── */
function next2() {
  const { api, store } = makeWorker();
  (async () => {
    for (let i = 0; i < 14; i++) {
      await api.record({ ats: 'Workday', code: 'field.unanswered', reason: 'Are you a protected veteran?', url: 'https://w/' + i });
    }
    await api.record({ ats: 'Lever', code: 'field.unanswered', reason: 'What is your visa status?', url: 'https://l/1' });
    const text = await api.report();
    eq('the questions that blocked a submit get their own section',
      /REQUIRED QUESTIONS LEFT UNANSWERED/.test(text), true);
    eq('counted, and in the employer\'s own words',
      /14x\s+\[Workday\] Are you a protected veteran\?/.test(text), true);
    eq('the commonest first', text.indexOf('protected veteran') < text.indexOf('visa status'), true);
    eq('and kept in a table of their own, separate from the event ring',
      Object.keys(store.ua_diag_q).length, 2);
    next3();
  })();
}

/* ── it must never record what was typed ──────────────────────────────────── */
function next3() {
  const { api, store } = makeWorker();
  (async () => {
    /* A recorder that captures answers is a copy of the user's personal data,
       sitting in extension storage and pasted into wherever the report goes.
       Only the question is ever recorded. */
    await api.record({
      ats: 'Greenhouse',
      code: 'field.unanswered',
      reason: 'What is your desired salary?',
      url: 'https://g/1',
      value: '85000',                       // must be ignored even if passed
    });
    const blob = JSON.stringify(store);
    eq('a value handed in anyway is not stored', /85000/.test(blob), false);
    eq('but the question is', /desired salary/.test(blob), true);
    next4();
  })();
}

/* ── multi-tenant hosts must not look like separate problems ──────────────── */
function next4() {
  const { api } = makeWorker();
  eq('forty SmartRecruiters employers are one platform',
    api.hostKey('https://jobs.smartrecruiters.com/DeutscheTelekom/744000150079584-devops'),
    'smartrecruiters.com');
  eq('and so are Workday tenants', api.hostKey('https://acme.wd3.myworkdayjobs.com/x'), 'myworkdayjobs.com');
  eq('a company on a country domain keeps its own name', api.hostKey('https://careers.acme.co.uk/j/1'), 'acme.co.uk');
  eq('a bare two-label host is left alone', api.hostKey('https://lever.co/x'), 'lever.co');
  eq('a malformed URL does not throw', api.hostKey('not a url'), '?');
  /* The board view needs the opposite: two employers on the same platform are
     different boards with different walls, and collapsing them loses the one
     thing that tells them apart. */
  eq('the board view keeps the employer', api.fullHost('https://careers-amd.icims.com/jobs/1/login'), 'careers-amd.icims.com');
  eq('and the Oracle pod it is served from', api.fullHost('https://dnn.fa.em2.oraclecloud.com/hcmUI/x'), 'dnn.fa.em2.oraclecloud.com');
  next5();
}

/* ── concurrent writers ───────────────────────────────────────────────────── */
function next5() {
  const { api, store } = makeWorker();
  /* Twelve job tabs report at once. A read-modify-write on a shared counter
     loses increments without serialisation, which would make the one number
     this whole file exists to produce quietly wrong. */
  Promise.all(Array.from({ length: 60 }, (_, i) =>
    api.record({ ats: 'Ashby', code: 'job.failed', reason: 'same', url: 'https://a/' + i })
  )).then(() => {
    eq('sixty concurrent reports all land', store.ua_diag_agg['Ashby|job.failed|same'].n, 60);
    next6();
  });
}

/* ── an empty store says so rather than printing an empty skeleton ────────── */
function next6() {
  const { api } = makeWorker();
  api.report().then((text) => {
    eq('nothing recorded yet reads as nothing recorded yet',
      /nothing recorded yet/.test(text), true);

    // And clearing works.
    const w = makeWorker();
    w.api.record({ ats: 'X', code: 'job.failed', reason: 'y' })
      .then(() => w.api.clear())
      .then(() => w.api.report())
      .then((t2) => {
        eq('clearing empties it', /nothing recorded yet/.test(t2), true);
        next7();
      });
  });
}

/* ── the message plumbing ─────────────────────────────────────────────────── */
function next7() {
  const { listeners, store } = makeWorker();
  eq('the worker listens for reports', listeners.length, 1);
  const handle = listeners[0];

  /* The URL is taken from the SENDER's tab, not from the message. A content
     script can be wrong about where it is after a redirect, and the tab's URL is
     the one that still makes sense when the report is read later. */
  handle({ type: 'UA_DIAG', ev: { ats: 'Lever', code: 'job.failed', reason: 'r', url: 'https://lied-about/' } },
    { tab: { url: 'https://real.example/job/1' } }, () => {});

  setTimeout(() => {
    const row = store.ua_diag_agg['Lever|job.failed|r'];
    eq('the tab\'s own URL is what gets recorded', row.urls, ['https://real.example/job/1']);

    let out = null;
    const async1 = handle({ type: 'UA_DIAG_REPORT' }, {}, (r) => { out = r; });
    eq('the report reply is asynchronous, so the channel is held open', async1, true);
    setTimeout(() => {
      eq('and it answers with text', typeof out.text, 'string');
      eq('which contains what was recorded', /Lever/.test(out.text), true);

      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 30);
  }, 30);
}
