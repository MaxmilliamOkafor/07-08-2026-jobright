# Jobright Autofill — 1.19.0 base + full CSV auto-apply automation

Unpacked Chrome extension (Manifest V3) built on the **official Jobright Autofill
1.19.0** patch (last updated 2026-08-03), with a fully automated, unattended
bulk-apply queue layered on top. Jobright's own UI, autofill engine and background
worker are shipped **unmodified** — the automation is additive.

Load the folder **`AAAA - Jobright Autofill`**.

```
chrome://extensions → Developer mode → Load unpacked → "AAAA - Jobright Autofill"
```

---

## What changed in this build

### Rebased onto the 1.19.0 patch (was 1.16.0)

| | 1.16.0 | 1.19.0 |
| --- | --- | --- |
| `contents.d42e7fcf.js` | 3.2 MB monolith | 14 KB bootstrap that lazy-loads the helper app |
| `helper-app.41ea2652.js` | 6.0 MB | 6.6 MB |
| `answer.d77729c7.js`, `dom.ed166d80.js` | present | **removed by Jobright** — deleted here too |
| permissions | — | `webNavigation` added |
| content script timing | `document_idle` | `document_start` |

The DOM anchors the automation hooks into (`#jobright-helper-id`,
`.jobright-helper-content-container`, `.auto-fill-button`, the `plasmo-csui`
shadow host) all still exist in 1.19.0, so the enhancement layer attaches exactly
as before.

### The CSV queue now runs in the service worker

This is the big one. The orchestrator used to live inside the side-panel page
(`ua-queue.html`). **Chrome destroys a side-panel document the moment the panel is
closed**, which meant closing the panel — or Chrome collapsing it — killed the run
mid-way: job tabs were left open, jobs sat on `applying` forever, and nothing ever
opened the next one.

The engine now lives in `ua-orchestrator.js`, loaded into Jobright's background
service worker by a single appended `importScripts()` line. All run state is in
`chrome.storage.local` and a 1-minute `chrome.alarms` heartbeat rebuilds it, so a
run survives:

- closing the Queue Manager panel or tab,
- the service worker being torn down for idleness and restarted,
- a job tab being closed by hand (that job goes back to `pending` and refills),
- a page that hangs (per-job watchdog, default 6 min, configurable).

`ua-queue.html` / `ua-queue.js` is now purely a view.

### Assignment is pull-based, not push-only

A job tab used to wait for the worker to *push* it its assignment. On a fast ATS
page reached through two redirects, every push could land before the content
script booted, and the job then sat idle until the watchdog killed it. Each tab now
**asks** the worker "which job am I?" by tab id (`UA_MGR_WHOAMI`) — correct no
matter how many times the page redirected on the way there. Pushes and the
`window.name` tag remain as belt-and-braces; a per-job guard means a job is never
driven twice.

### Fixes

| Fix | Symptom it caused |
| --- | --- |
| RFC-4180 CSV parser with delimiter sniffing (`, ; \t \|`) and BOM stripping | quoted cells (`"Engineer, Backend"`) split into a bogus second "URL"; Chrome percent-encoded it and Workday answered **HTTP 406**. Semicolon exports from European Excel imported as one giant cell |
| Multi-round apply-target probe (`probeApplyTarget`) | jobs marked **"No application form found"** while the tab was still redirecting from Jobright to the ATS — silently dropped, never retried |
| `http(s)`-only URL validation everywhere a URL is queued, rendered or navigated to | a `javascript:` cell in a CSV became a clickable link on a privileged extension page and a `tabs.create` target |
| HTML-escaped queue rendering in the on-page sidebar | a crafted CSV title injected markup into the page through `innerHTML` |
| Identical URL normalisation in all three components | the same posting added from a CSV row and from right-click "add this page" counted as two jobs and got applied to twice |
| Coalesced slot refills in the worker | two jobs finishing at the same instant left a slot empty until the next watchdog tick |
| Serialized read-modify-write on the queue | a slow writer holding a stale array reverted a sibling tab's result ("finished, then back to pending") |
| `sendResponse` called synchronously for `UA_ASSIGN_JOB` | the worker's callback hung until the port closed, so assignment retries looked like failures |
| Terminal status reported over runtime messaging *and* storage, de-duplicated on `(id, ts)` | a result lost when the worker was mid-restart stalled the whole run |

### Improvements

- **Pause / Resume** a run — in-flight jobs finish, no new tabs open.
- **Concurrency up to 8** parallel background tabs (was 5).
- **Drag & drop** a CSV anywhere on the panel; **Paste URLs** dialog for a quick list.
- **Per-run settings** in the panel: skip already-applied, tailor resume, per-job timeout.
- **Import feedback** — `added / duplicates / already applied / invalid`, not just a count.
- **Log survives** the panel closing (kept in storage, 200-line ring buffer).
- **Clickable stat tiles** filter the table; per-row **retry**; table capped at 400 rows so a 5,000-row CSV doesn't lock the panel.
- **Context menu** (right-click any page): open the Queue Manager in the side panel or a tab, add the current page or a link to the queue.
- **Desktop notification** when a run finishes.
- Export includes `startedAt` and `duration`, with a BOM so Excel opens it cleanly.

---

## v14.1 — new ATS coverage and the dialog freeze

### The `Remove "…_CV"?` freeze

A SmartRecruiters run died on a native `confirm()` dialog:

```
Remove "Maxmilliam_Okafor_CV"?
```

A native confirm **blocks the page's JavaScript thread** until a human answers it.
Nothing can run behind one — not the filler, not the submit, not the per-page
timeout — so the job sat frozen until the manager's watchdog killed the tab six
minutes later. Fixed in three independent layers, any one of which is enough:

1. **The dialog can no longer block.** `ua-page-hooks.js` is a **MAIN-world**
   content script (`"world": "MAIN"`), so it overrides the *page's own*
   `confirm` / `alert` / `prompt` — an isolated-world content script cannot, which
   is why this needed a new file. Destructive prompts ("Remove…", "Delete…",
   "Discard…") are answered **no**, so the résumé you already uploaded stays
   attached; everything else ("Submit your application?") is answered **yes** so a
   confirmation step can't stall the run. Every intercepted dialog is logged.
2. **The dialog is not opened in the first place.** `realClick` — the single choke
   point every driver clicks through — now refuses destructive controls: anything
   named Remove/Delete/Discard/Withdraw, and unlabelled `×` icon buttons sitting
   inside an attachment row.
3. **In-page modals too.** `resolveBlockingDialog()` answers modal confirms the
   same way (Cancel/Keep for destructive, OK/Continue otherwise, Escape if there is
   no safe button), and runs at the top of every multi-page step.

The hooks are **inert unless a job is actually running** — the content script sets
`data-ua-auto="1"` on `<html>` for the lifetime of a job and removes it afterwards.
While you are browsing normally, every dialog behaves exactly as the site intended.

### SmartRecruiters, rewritten

The old driver queried `document.querySelector('#firstName')`. Modern
SmartRecruiters renders its whole form as `spl-*` web components, **each with its
own shadow root**, which `querySelector` cannot cross — so the driver filled
nothing, then clicked around the page looking for something to press. That is how
it reached the résumé's remove button.

The driver now uses shadow-piercing queries (`deepQuery`/`deepQueryAll`) and a full
pointer-event sequence (`triggerMouse`) — `spl` components ignore a bare `.click()`.
It handles `spl-input`, `spl-select-option` comboboxes (including the location
typeahead, which must have its suggestion committed or the step is rejected),
`spl-radio` knockout groups, consent boxes, and the multi-step Next → Submit flow,
matching buttons by visible text so it survives SmartRecruiters renaming its test
ids.

### New drivers

| Platform | Why it needed one |
| --- | --- |
| **ADP `myjobs.adp.com`** | ADP's candidate app, a different product from the `workforcenow.adp.com` flow the old driver targeted. The old broad `adp.com.*\/job` pattern was matching myjobs URLs first and sending them down the wrong path. |
| **Oracle Recruiting Cloud** | All `*.oraclecloud.com` HCM `CandidateExperience` sites, plus the white-labelled deployments on company domains (detected by the `/hcmUI/CandidateExperience` path). Previously these were claimed by the classic-Taleo entry. |
| **Taleo** | Now scoped to genuine classic Taleo (`taleo.net`, `/careersection/`) instead of also swallowing Oracle. |

Also added to detection: SuccessFactors' `sapsf.com`/`sapsf.eu` hosts, Phenom,
Radancy/TalentBrew, join.com, softgarden, HRMDirect, and Greenhouse's newer
`job-boards.greenhouse.io` host.

**Registry ordering matters** and is now tested: `detectATS()` returns the first
pattern that matches, so specific platforms are listed before the broad legacy
entries. Two real mis-routings were caught this way — `myjobs.adp.com` resolving to
the generic ADP entry, and every Oracle URL resolving to Taleo.

### Verification

`./tests/run.sh` now runs **114 assertions**, including two new suites:

- **`ats.test.js`** — detection routing for every platform above (built from the
  shipped `ATS` table and predicates, so it cannot drift), the `confirm()` answer
  policy including the exact `Remove "Maxmilliam_Okafor_CV"?` string, and the
  destructive-control guard (Remove/Delete blocked; Cancel, Submit, Upload allowed).
- **`references.test.js`** — every function *called* in the shipped scripts must be
  *declared*. `node --check` accepts a call to a helper that does not exist; it only
  fails at runtime, on a live ATS page, as a silent job failure. This caught two
  such calls (`answerFor`, `smartGuess`) in the new SmartRecruiters driver.

### Not verified

These drivers have not been run against the live sites — there is no browser in
this environment. The dialog handling, detection routing and CSV paths are covered
by tests; the per-ATS selectors are written to degrade gracefully (visible-text
button matching, shadow-piercing queries, and the existing generic filler as the
fallback) rather than depending on exact attribute names I could not confirm. Run
one job per new ATS with concurrency 1 before a large batch.

---

## v14.2 — the Fully Automated toggle actually means off

Three separate faults, all reported together: automation fired on recognised ATS
pages with the toggle OFF, autofill ran during manual use without anyone pressing
Autofill, and the switch kept turning itself back on.

### Why "off" wasn't off

The toggle only ever gated the **main dispatcher**. Roughly a dozen other modules
in `ua-enhancement.js` live in their own IIFEs, cannot see the toggle's variable,
and acted on any page that merely looked like a job application:

| Module | What it did with the toggle OFF |
| --- | --- |
| Autofill-confirm auto-dismiss | Auto-clicked **Yes** on Jobright's *"Are you sure to autofill again?"* — **this is autofill starting without you pressing Autofill** |
| ATS chatbot answerer | Polled every 4s and answered Paradox/Phenom/HireVue chat widgets |
| Work-authorisation auto-answer | Ticked every 1.2s and selected Yes/No on right-to-work questions |

There is now **one gate** — `window.__uaAutoAllowed()` — installed before every
other module in the file. It answers yes only when the toggle is ON, this tab is
the in-page queue runner, or this tab is running a CSV Queue Manager job. It is
**fail-closed**: until `chrome.storage` has actually been read the answer is *no*,
so a module booting at `document_start` can't act in the gap before the preference
is known. `autoStopped()` used to return "not stopped" on any error — it now fails
closed too.

### Why the switch turned itself back on

**Alt+A.** It toggled Fully Automated *and* immediately started applying
(`setAutoApply(!autoApply, true)`). Its "is the user typing?" guard only checked
`document.activeElement.tagName` — which **stops at a shadow boundary**, so on a
SmartRecruiters or Workday form it reports `SPL-INPUT`, not `INPUT`, and a stray
Alt+A while typing went straight through.

- **Alt+A is now a kill switch only** — it can turn automation OFF, never ON.
  Turning it on is a deliberate act and goes through the on-screen switch.
- The typing guard now walks shadow roots and covers `contenteditable`.
- Every change is logged with **who made it** (`switch`, `drawer checkbox`,
  `Alt+A`), so if the state ever appears to move on its own again the log names
  what moved it.

### One more leak

A Fully-Automated dispatch set the internal `data-ua-auto` flag and never cleared
it, so on that page the gate stayed open even after you switched the toggle off.
A queue job owns that flag for its lifetime; a dispatch now only borrows it and
hands it back in a `finally`.

### Persistence

`ua_aa` is written in exactly one place, on every change, and read on every page
load — so off stays off across reloads, new tabs, browser restarts and
service-worker recycles. That single-writer property is now asserted by a test.

### Verified

`tests/gate.test.js` runs the shipped gate IIFE against a fake `chrome.storage`:
28 assertions covering fail-closed boot, toggle OFF, unset preference, live
ON/OFF switching, queue-job ownership, "a normal tab opened during a run is not
hijacked", storage failure, and the source rules that stop the switch moving on
its own. Total suite: **142 assertions**.

---

## v14.3 — jobs were being marked applied without ever being submitted

Reported symptom: the form fills, Jobright shows *"4/4 required fields filled ·
100%"*, and the queue moves to the next job — nothing was submitted. Three
independent causes, all platform-agnostic, so this affected **every ATS**.

### 1. Ordinary job URLs were read as confirmation pages

```js
SUCCESS_URL_RE = /(thanks|thank.?you|success|confirm|complete|received|submitted|done|applied)/i
```

Tested as a bare **substring** of the path. So these declared the application
submitted *on arrival*, before a single field was filled:

| URL | matched |
| --- | --- |
| `/jobs/customer-success-manager` | `success` |
| `/jobs/applied-scientist-ii` | `applied` |
| `/careers/complete-care-nurse` | `complete` |
| `/job/donegal-warehouse-operative` | `done` |

Two of the most common job titles in tech trip it. Once `checkSuccess()` returned
true, `dispatchATSAutomation` skipped `multiPageLoop()` entirely — the submit step
never ran — and the verification loop immediately agreed the job was done.

Now matched only as a **complete path segment**, against a narrower token list.

### 2. "Apply" was being clicked as if it were "Submit"

`submitSels` contained `button[aria-label*="Apply" i]` and
`[data-testid="apply-button"]`, and the text fallback matched `/^apply/`. Clicking
Apply returned `'submitted'` and started the confirmation grace timer on a form
that had not been sent. Apply *opens* an application — `openApplicationForm()`
owns it, and the submit step no longer touches it.

### 3. Any success-ish word counted as confirmation

A `[role="alert"]` whose text matched `/submit|success|thank|received|complete/`
was treated as a submitted application — so the validation error **"Please
complete all required fields"** confirmed success. Status regions now require
confirmation-grade wording.

### Evidence, not guesswork

`confirmSubmitted()` now distinguishes two kinds of signal:

- **Hard** — the page states the application was submitted (confirmation text or a
  known confirmation element). Trusted on its own.
- **Soft** — a confirmation-looking URL. Trusted **only** once a submit control was
  actually pressed for this job.

The submit attempt is persisted (`ua_submit_mark`) so it survives the navigation
between "clicked Submit" and "confirmation page" — multi-page platforms like
Taleo, Oracle and iCIMS render the confirmation in a new document where the
in-memory flag is gone, and without this a genuine submission could never be
confirmed there. Each job clears it before starting.

A job that fills but never submits is now **failed with the reason**, not a silent
`done`:

- `Form filled but no Submit control was found — nothing was submitted`
- `Submit was clicked but no confirmation appeared`
- `Validation errors could not be resolved`

### Submit buttons are named differently on every ATS

One shared recogniser, `isSubmitLabel()` + `findSubmitControl()`, used by
`autoSubmitOrNext` and by the SmartRecruiters, Oracle and ADP drivers. It matches
a submit verb **anywhere** in the label rather than only at the start, so these now
work: *Submit Application · Review and Submit · Accept & Submit · I Agree and
Submit · Confirm and Submit · Sign and Submit · Send my application · Complete
Application · Bewerbung absenden · Envoyer ma candidature · Enviar solicitud ·
Invia candidatura · Verzenden*.

It excludes anything that isn't the final action — Apply/Apply Now/Easy Apply,
Next, Continue, Save as draft, Save this job, Upload, Sign in, Subscribe, Submit
feedback, Submit a question, Withdraw — and it is **shadow-piercing**, so it
reaches submit buttons inside web components (SmartRecruiters `spl-button`, Oracle
`oj-button`) that a document-level query could never see.

When several candidates qualify, they are **scored** — submit verb, the word
"application", membership of the form holding the most inputs, and position down
the page — so the application's real submit wins over a newsletter or support
widget that also says "Submit".

### Verified

`tests/submit.test.js` — 98 assertions: 27 labels that must submit, 33 that must
not, confirmation URLs vs. real job slugs, confirmation text vs. validation errors
and the *"4/4 required fields filled"* readout, plus the evidence rules in the
shipped source. Mutation-checked: restoring the old substring URL regex fails 7
assertions, re-allowing "Apply" as a submit fails 3. Suite total: **240
assertions**.

---

## v14.4 — autofill coverage across every ATS

Before any per-platform cleverness, autofill depends on one thing: **can the
filler see the fields?** It often could not.

`$` / `$$` are `document.querySelector(All)`. They stop at a shadow boundary and
never enter a frame — and *every* universal filler used them:

| Function | Blind queries |
| --- | --- |
| `fallbackFill` | 11 |
| `handleValidationErrors` | 3 |
| `getMissingRequired` | 2 |
| `guaranteeRequiredFields` | 2 |
| `hasApplicationForm` | 2 |
| `analyzeCurrentForm`, `answerChoiceGroups`, `learnFromFilledFields` | 1 each |

So on any ATS that renders its form in web components or an embedded frame, the
universal filler enumerated **zero fields** and did nothing — which is why
"autofill doesn't work here" looked like a different bug on every platform:

| ATS | Where the fields actually live |
| --- | --- |
| SmartRecruiters | `spl-input` / `spl-select` — open shadow roots |
| Oracle Recruiting | `oj-input-text` — open shadow roots |
| Greenhouse embed, iCIMS, SuccessFactors, Taleo, BrassRing | a **cross-origin `<iframe>`** |

### What changed

**One shared enumerator.** `deepAll()` walks every open shadow root and every
same-origin frame document (depth- and count-bounded). All 23 blind queries in the
universal fillers now go through it.

**Labels resolve in the right root.** `getLabel()` looked up `label[for=…]` and
`aria-labelledby` against `document`, which finds nothing for a field inside a
shadow root — leaving it unlabelled, and an unlabelled field is one no guesser can
fill. Lookups are now scoped to the element's own root node.

**Fields in modals are visible again.** `isVisible()` required
`offsetParent !== null`, which is **null for `position: fixed`** — so every field
in an apply-in-a-dialog modal read as invisible to the filler *and* to the submit
search. It now uses the box + computed style from the element's own window. Five
more bare `offsetParent` checks elsewhere were paired with `getClientRects()`.

**Cross-origin frames are reached.** No same-origin walk can enter them. For a
queue job — and only a queue job — the orchestrator injects the content script
into every frame of that tab (`scripting`, `allFrames: true`), re-running it after
each navigation. Sub-frames run a **fill-only** path: no UI, no queue, no submit —
the top frame still owns navigation. It is gated on the automation gate, ignores
frames without a form, and is bounded to six passes. The content script carries an
idempotency guard so re-injection is a no-op in the top frame. The manifest still
declares `all_frames: false`, so the heavy module is *not* loaded into every ad
frame of every page you browse.

**You can now see the result.** `fillReport()` counts required fields and names
the ones still empty; it's logged before every submit:

```
Before submit: 11/12 required fields filled (92%) — still missing: Desired salary
```

If a job can't be completed, that detail is what tells you why. A third fill pass
now runs when the form is still incomplete, since SPA forms mount fields after
first paint.

### Verified

`tests/fill.test.js` — 41 assertions: every universal filler is checked to contain
**zero** blind queries and to use the enumerator, plus the bounds, the label
scoping, the visibility rules, the all-frames injection wiring, and the sub-frame
gating. Suite total: **281 assertions**.

### Honest limits

This is a large coverage increase, not a guarantee. Not verified against live ATS
pages — there is no browser in this environment. Still out of reach by design: a
CAPTCHA (the run pauses for you), an ATS account wall needing email verification,
and questions with no answer in your profile or answer bank — those are reported
in the fill report rather than guessed at.

---

## v14.5 — custom dropdowns, and CAPTCHAs that no longer eat a job

### The biggest remaining reason a "filled" form wouldn't submit

Native `<select>` was handled well. But most modern ATS don't use one — Greenhouse,
Ashby, Lever, Workable, SmartRecruiters (`spl-select`) and Oracle (`oj-select`) all
render a `role="combobox"` plus a popup listbox, and the universal filler had **no
handler for those at all**. Any required custom dropdown stayed empty, and an empty
required field blocks submission no matter how complete the rest of the form is.

`commitCustomDropdown()` now handles every flavour: it opens the control with a
full pointer sequence, falls back to `ArrowDown`, then to typing (many comboboxes
only render their options once you type), picks the best match, and **verifies the
control actually took a value** before calling it done.

Two deliberate limits: it never invents an answer to a gender / disability /
veteran / race question — it picks "prefer not to say" or leaves it — and the blind
"just take the first option" last resort fires **only on a required field**, where
the alternative is a form that cannot be submitted at all.

### CAPTCHA

This does not solve CAPTCHAs. That check exists to tell humans and bots apart, and
defeating it isn't something I'll build. What was actually broken is everything
around it:

- **Detection was `document`-only** — a challenge inside the ATS's own iframe (where
  the application form usually lives) was invisible, so the run just sat there
  filling nothing until the watchdog killed it. Now shadow- and frame-aware.
- **Only three providers were recognised.** Added Arkose/FunCaptcha, GeeTest,
  DataDome/PerimeterX, AWS WAF and press-and-hold challenges.
- **The job runs in a background tab you never see.** The on-page banner and
  scroll-into-view were drawn where nobody was looking; the job waited three
  minutes in silence and then died to the watchdog with nothing in the log
  explaining why.

Now a blocked job tells the queue. You get a **desktop notification**, the row
shows an amber **needs you** badge with an **↗** button that focuses that tab, and
the watchdog **stops counting** while a person is genuinely needed — bounded to 15
minutes, so one unsolved challenge can't hold a slot for the rest of the run. When
you solve it, the job reports itself unblocked and carries on by itself.

### Verified

`tests/fill.test.js` is now 58 assertions, including one that asserts **no**
CAPTCHA-solving service or token injection exists in the source. Suite total:
**298 assertions**.

---

## v14.6 — a stuck job costs seconds, not minutes

Every timeout in the run used to be **wall-clock**: a job that made zero progress
looked exactly like one working hard, and sat out the full per-job cap (6 min by
default) before the queue moved on. One dead page could cost more time than a
dozen good applications.

Nothing measured whether anything was actually *happening*. Now three things do:

**1. Progress, not elapsed time.** The content script records real activity —
fields filled, a dropdown answered, Apply clicked, a submit pressed, the page
itself changing. If nothing happens for **75 seconds** (configurable), the job is
abandoned and the next one starts immediately. A spinner that never resolves, a
redirect loop, or a form that refuses every value now costs ~75s instead of six
minutes.

**2. A heartbeat, so a dead tab is obvious.** Job tabs report every 10s. If a tab
goes silent — it crashed, or navigated somewhere the content script isn't injected
— the queue reclaims the slot after 75s instead of waiting out the full cap. That
state used to be indistinguishable from "busy".

**3. A CAPTCHA is a wait, not a stall.** It's explicitly exempt from both, so the
run doesn't skip a job out from under you while you're solving it — bounded at 15
minutes, then it moves on.

### You can see it happening

Each running row now shows what the job is actually doing, live:

```
Senior Engineer — Acme        92% · filled 11 field(s) · idle 34s
```

and when a job is dropped, the reason is specific:

- `Stalled — no progress for 78s (last activity: clicked Apply)`
- `Stopped responding after 42s (last: filling fields)`
- `hCaptcha was not solved within 15 min`

All are `timeout`/`failed` status, so **Retry failed** re-queues them.

### Setting

**Skip if stuck `[75]` s** in the panel, next to the per-job timeout. Lower it for
a faster run that gives up sooner; raise it for slow ATS on a slow connection.

### Verified

`tests/orchestrator.test.js` grew to 43 assertions, driving the real engine
through: a healthy heartbeat recording stage and completeness, a beating job being
left alone, a silent job being dropped with the slot reused immediately, a CAPTCHA
holding its slot against the watchdog, clearing it resuming, and an unsolved one
finally yielding. Mutation-checked — removing the heartbeat reclamation fails 3
assertions, removing the CAPTCHA grace fails 1. Suite total: **311 assertions**.

---

## v14.7 — timings that make sense, and the CV actually gets attached

### The waits were far too long

Fair criticism. A bulk run should not sit on a single job for minutes. Every
threshold is now short, and — more importantly — **waiting no longer costs
throughput**.

| | originally | now |
| --- | --- | --- |
| No progress → skip the job | 75s | **15s** (`Skip if stuck`, 5–600s) |
| Tab silent → reclaim the slot | 75s (7 missed beats) | **15s** (3 missed beats) |
| CAPTCHA waits for you | **15 min, holding a slot** | **1 min, holding nothing** (`Wait for me`, 0.5–30 min) |
| Hard cap per job | 6 min | **3 min** (`Timeout`, 1–30 min) |

A 15-second window only means "stuck" if two other things change with it, and both
did:

- **The heartbeat runs every 5s** (was 10s). At the old interval, 15s of silence
  was 1.5 beats — a single delayed one would have killed a healthy job.
- **Progress is credited as it happens, not at the end of a pass.** `fallbackFill`
  paces itself ~200ms per field and only reported progress once the whole pass
  finished; on a long form that pass alone exceeds 15s, so the watchdog would have
  skipped a job that was filling perfectly. Each field now counts, as do waiting
  for a slow page, a navigation, and a CV upload in flight.

With those in place, 15s genuinely means nothing is happening — the fill loop,
the page, and the upload all keep the clock alive while they work.

The 15-minute CAPTCHA wait was the worst of it, and the real problem wasn't only
the number: the waiting job **kept its concurrency slot**, so a run at 3 tabs
quietly dropped to 2 for the duration. Now a job blocked on a CAPTCHA stops
counting against concurrency the instant it reports in, the next job starts
immediately, and its tab stays open so you can still solve it. At most 3 such tabs
park at once. The default wait is **1 minute** — long enough to catch it if you're
at the keyboard, short enough that an unattended run barely notices.

One clarification on an earlier log example: `Stopped responding after 42s` was
badly worded — 42s was how long the job had been *alive*, not the threshold. It
now reports the thing the decision was actually made on:

```
Tab went silent for 41s — dropped (was: filling fields)
```

### CV attachment

Attaching the CV was **Workday-only**. Every other ATS relied on Jobright having
done it, and when it hadn't, the form failed validation with "Resume is required"
and the job died with no explanation.

The résumé is already stored locally as base64, so `attachResume()` now works on
any platform: it finds the file input across shadow DOM and frames, builds a real
`File` via `DataTransfer`, and also fires a `drop` event for dropzone-only widgets.

Three specific SmartRecruiters problems, all fixed:

1. **Advancing mid-upload.** Pressing Next while the upload was in flight made
   SmartRecruiters report no résumé — or silently drop the one being uploaded. No
   step advances, and no ATS submits, through an upload in flight.
2. **Re-attaching over a good file.** The attacher checks for an existing
   attachment first and leaves it alone, so it can never reach the remove control
   that opened the `Remove "…_CV"?` confirm.
3. **CV attached too late.** SmartRecruiters parses the CV to pre-fill the form, so
   it is now attached *before* the field sweep — fewer fields left to guess at.

If no résumé is saved in the extension, that is now said plainly in the log
instead of surfacing as a mysterious validation failure.

### Verified

Suite total: **336 assertions**, all green, including a new CAPTCHA-slot test
proving the next job starts immediately while a blocked tab stays parked.

---

## v14.8 — the `Remove "…_CV"?` freeze, fixed for good, on every ATS

The earlier fix had a hole, and it's the one that bit: the dialog hook only armed
itself **while a queue job was running**. On a manual apply — or in the gap after a
Fully-Automated pass hands its flag back — a script-driven
`Remove "Maxmilliam_Okafor_CV"?` still froze the page with nothing able to answer
it. A native `confirm()` blocks the JavaScript thread outright, which is why the
page becomes unclickable and the only way out is to start over.

Three layers now, none of them ATS-specific:

**1. A script-driven destructive confirm is always declined.** The hook tracks
whether a *trusted* gesture just happened. If a `Remove …?` / `Delete …?` confirm
arrives with no real click behind it, it was raised by script — it is answered
**no** (which keeps your CV) and the page never freezes. This works whether or not
automation is running, and whether the click came from our code or Jobright's own
bundle.

If **you** press Remove, the real dialog still appears and behaves normally — the
gesture window is 1.2s, so your own clicks are never swallowed.

**2. The remove control is unreachable across shadow boundaries.** `closest()`
stops dead at a shadow root, so on SmartRecruiters — where the upload widget is all
`spl-*` web components — the guard couldn't see the attachment container and let
the click through. It now walks out through the shadow host chain, reads the icon
inside the button's own shadow root, and treats `spl-*` / `oj-*` elements as
clickable controls.

**3. Both click paths are guarded.** `triggerMouse()` — the pointer-event path web
components require, since they ignore `.click()` — bypassed the guard entirely.
It's now checked the same as `realClick()`.

### Why this covers every ATS

| | scope |
| --- | --- |
| Dialog hook | `<all_urls>`, all frames, MAIN world, `document_start` |
| Destructive wording | generic verbs, matched anywhere in the message |
| Attachment containers | `spl-*` (SmartRecruiters), `oj-file-picker` (Oracle), plus generic `attachment` / `uploaded` / `file-item` / `dropzone` / `upload` / `resume` class patterns |
| Click paths | `realClick` and `triggerMouse`, both guarded |

Nothing in it keys off a hostname.

**If a tab is already frozen**, reload it — the hook installs at `document_start`,
so from the next load onward the dialog cannot block you again.

---

## Using the CSV queue

1. Right-click any page → **Jobright Queue Manager (side panel)** — or use the
   **🗂 Queue Manager** button in Jobright's own sidebar.
2. **⬆ Import CSV** (or drop the file on the panel, or **✎ Paste URLs**).
3. Pick how many tabs run at once, tick your options, hit **▶ Start**.

Jobs open in **background tabs**, so you can keep browsing. For each URL the
automation navigates to the job, clicks Apply if needed, creates or signs into the
ATS account, runs Jobright's autofill, fills any gaps, commits location/typeahead
fields, submits, and **verifies the submission was confirmed** before the job counts
as `done`. Unconfirmed submissions are marked `failed`, never a false "applied".

### CSV format

One job URL per row. Everything below imports correctly:

```csv
url,title,company
https://boards.greenhouse.io/acme/jobs/123,"Engineer, Backend",Acme
https://jobs.lever.co/acme/456,Product Manager,Acme
```

```csv
Company;Position;Apply Link
Acme;Engineer;https://acme.wd1.myworkdayjobs.com/x/job/123
```

```
https://boards.greenhouse.io/acme/jobs/123
https://jobs.lever.co/acme/456
```

- Header row is auto-detected and skipped; a `url` / `link` / `apply link` /
  `job url` column is used if present, otherwise the URL is found in any cell.
- Comma, semicolon, tab and pipe delimiters; quoted cells with commas or newlines;
  UTF-8 BOM — all handled.
- Duplicates, previously-applied jobs (optional) and non-`http(s)` rows are
  reported and dropped.

### Keyboard

| Where | Key | Action |
| --- | --- | --- |
| Queue Manager | `S` | Start / stop |
| Queue Manager | `P` | Pause / resume |
| Queue Manager | `/` | Focus search |
| Any job page | `Alt+S` | Start / stop the in-page runner |
| Any job page | `Alt+P` | Pause / resume |
| Any job page | `Alt+J` | Add this page to the queue |
| Any job page | `Alt+F` | Manual fill pass |

---

## Two ways to run a queue

- **Queue Manager (recommended)** — parallel background tabs, driven by the service
  worker, survives everything. Use this for large CSV runs.
- **In-page runner** — the older single-tab mode in Jobright's sidebar
  (**Start Applying**), which navigates the tab you're in so you can watch each
  application happen. Still supported and fixed; the two are mutually exclusive and
  starting the manager stops the in-page runner.

---

## Layout

```
AAAA - Jobright Autofill/
├── manifest.json               1.19.0 manifest + automation hooks
├── contents.d42e7fcf.js        ┐
├── helper-app.41ea2652.js      │ official Jobright 1.19.0, unmodified
├── global.f36301ce.css         │
├── inter.42ee87cb.css          │
├── scroll-to-anchor.…js        ┘
├── static/background/index.js  official 1.19.0 SW + one appended importScripts line
├── ua-enhancement.js           automation content script (ATS drivers, autofill, queue runner)
├── ua-page-hooks.js            MAIN-world native-dialog hooks  ← new in v14.1
├── ua-orchestrator.js          service-worker queue engine  ← new
├── ua-queue.html / ua-queue.js Queue Manager UI (side panel or tab)
└── icon*.png
tests/
├── run.sh                      everything below, plus syntax + manifest checks
├── references.test.js          every called function is declared
├── ats.test.js                 ATS routing + dialog answer policy
├── gate.test.js                the Fully Automated toggle / automation gate
├── submit.test.js              submit-button recognition + submission evidence
├── fill.test.js                autofill field coverage (shadow DOM + frames)
├── csv-parsers.test.js         content-script CSV/URL parsing
├── queue-panel.test.js         panel CSV import behaviour
└── orchestrator.test.js        queue engine against a simulated chrome.*
```

## Tests

```bash
./tests/run.sh
```

336 assertions, no browser required: JS syntax for everything shipped, manifest
validity (including that every referenced file exists and the worker imports the
orchestrator), CSV/URL parsing in all three places it happens, and the queue engine
driven end to end — slot filling, results, duplicate results, requeue on tab close,
watchdog timeout, pause/resume, and a simulated service-worker restart mid-run.

Re-run it after dropping in a future Jobright patch: it will tell you immediately if
the new bundle removed a file the manifest still points at, or if the appended
`importScripts` line was lost.

## Applying the next Jobright patch

1. Copy the new `contents.*.js`, `helper-app.*.js`, `global.*.css`,
   `static/background/index.js`, `inter.*.css`, `scroll-to-anchor.*.js` and icons over.
2. Re-apply the manifest patch: `ua-enhancement.js` as the **first** content script
   (`document_start`, `all_frames: false`); `ua-enhancement.js`, `ua-queue.html`,
   `ua-queue.js` in `web_accessible_resources`; `side_panel.default_path` =
   `ua-queue.html`; permissions `sidePanel`, `alarms`, `contextMenus`, `notifications`.
3. Re-append to `static/background/index.js`:
   ```js
   try { importScripts("/ua-orchestrator.js"); } catch (e) { console.warn("[UA] orchestrator failed to load", e); }
   ```
4. `./tests/run.sh`

## Notes

- 150+ ATS platforms (Workday, Greenhouse, Lever, SmartRecruiters, iCIMS, Ashby,
  Workable, LinkedIn/Indeed Easy Apply…), multi-page forms, shadow DOM and iframes.
- Check **Your Autofill Information** in Jobright before a large run — name, phone,
  **city**, work authorisation — the autofill is only as good as that profile.
- Resume tailoring is **off** by default: Jobright's generator can stall on
  *"Opening resume generator…"*. Turn it on per run in the panel if you want it.
- A visible CAPTCHA pauses that job rather than failing it, so you can solve it.
