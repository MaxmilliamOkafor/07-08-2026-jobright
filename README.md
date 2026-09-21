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

## v14.9 — refreshing a page no longer stops the automation

Reloading a job tab killed the job. The dead-tab check treats silence as death,
and a page that is **loading has no content script at all**, so it cannot send a
heartbeat — a manual refresh, a redirect, or just a slow ATS page looked exactly
like a crashed tab. With the window tightened to 15s this became easy to hit: the
job was marked `timeout` and its tab closed out from under you.

Now a navigation restarts the liveness clock instead of ending the job:

- **`status: 'loading'` marks the job as navigating** and gives it a 45-second
  window to come back. A reload, a redirect and the next page of a multi-step form
  are all the same thing to this check.
- **Asking "which job am I?" counts as proof of life.** A freshly reloaded page
  does that before it can send its first heartbeat, so the gap closes immediately.
- **The first heartbeat is sent on pick-up**, not one interval later.
- **Re-assignment after the reload** refreshes the clock too.

A tab that goes silent **without** navigating is still dropped in 15s — that's a
genuine crash, and the distinction is what the test suite pins down.

### What survives a refresh

| | survives | how |
| --- | --- | --- |
| CSV queue job | ✓ | the worker owns the state; the reloaded page asks for its job by tab id and is handed it straight back |
| In-page runner (Start Applying) | ✓ | `window.name` carries the runner tag across the navigation, and the run flag is in storage |
| Fully Automated toggle | ✓ | read from storage on every page load |
| Queue Manager panel itself | ✓ | already only a view — the run is in the service worker |
| Submit evidence | ✓ | `ua_submit_mark` persists, so a submission mid-reload is still confirmable |

### Verified

Mutation-checked: removing the navigation grace fails 5 assertions, including
"a reloading tab is not mistaken for a dead one" and "a tab that is silent
WITHOUT navigating is still dropped". Suite total: **374 assertions**.

---

## v15.0 — a run can no longer stall silently

Reported: the automation "disappeared" after 3 skips and 3 applications, with a
Zoho Recruit job third in the queue.

I could not reproduce it without a browser, but reading the engine found a path
that produces exactly that shape — an active run with jobs left and nothing
running, permanently, with nothing in the log:

`withQueue()` swallows an error from its callback and returns `undefined`.
`fillSlots` then does `for (const job of toOpen)` on `undefined`, which throws a
`TypeError`, which the outer handler catches — so **no tabs are opened and
`maybeFinish` is never reached**. The next watchdog tick repeats the same crash a
minute later. The run stays `active`, the queue keeps its pending jobs, and
nothing ever happens again.

Three fixes:

1. **`toOpen` is guarded** — `(await withQueue(...)) || []` — so a failed queue
   mutation can no longer crash the slot filler.
2. **A stall supervisor** runs on every watchdog tick: if the run is active, jobs
   are pending, and nothing is actually running, it says so in the log and
   restarts the slot fill. It also clears a `_filling` guard left set by a crashed
   pass, which would otherwise block every future attempt.
3. **`finish()` refuses to end a run that still has pending jobs**, restarting the
   queue instead. (Belt-and-braces: `maybeFinish` already checks this, so this
   guard is an invariant rather than a live code path — the mutation test
   confirms it isn't currently reachable.)

Every end-of-run is now announced with a breakdown, so a run that stops is never
just absent:

```
Queue complete — 3 applied, 0 failed, 3 skipped (12 in the list)
Queue stalled with 6 jobs left and nothing running — restarting
```

### Verified

Mutation-checked: removing the stall supervisor fails 7 assertions, including
"the supervisor restarts a stalled run" and "it said so rather than vanishing".
Suite total: **382 assertions**.

### If it happens again

The queue log now records what the engine believed. Open the Queue Manager and
send me the last lines — that will say whether the run finished legitimately, hit
the supervisor, or died somewhere still unaccounted for.

---

## v15.1 — the step on screen, follow-up questions, and declaration boxes

Three separate reports, one build. All three were platform-independent even
though each was hit on one site, so all three are fixed for every ATS.

### 1. The autofill was reading the step it had just left

`jobs.smartrecruiters.com/.../screening` reported *"6/6 required fields filled ·
100%"* while every question on screen was empty — the values it listed belonged
to the **previous** step.

Two causes, both now removed:

* **The step comparison was blind to shadow DOM.** `getPageHash()` — what the
  multi-page loop uses to decide "did the page advance?" — was a plain
  `document.querySelectorAll`. SmartRecruiters (Spark `spl-*`), Oracle (JET
  `oj-*`) and Workday's newer steps put their fields inside shadow roots, so the
  hash was **identical on every step**. The loop concluded nothing had changed
  and re-filled the step it was already on.
* **Advancing was a flat sleep.** `realClick(next); await sleep(2800)` — too
  short and you read the old step, too long and you waste the job's budget, and
  either way it tells you nothing when the step *refuses* to advance.

Now there is a real fingerprint of **which questions are on screen** —
`stepSignature()`, built on the deep enumerator, so it sees shadow roots and
same-origin frames, and (since the previous build) excludes Jobright's own
sidebar. Deliberately value-free: filling a field must not look like a new step.

`waitForStepChange()` waits until that set genuinely changes **and then stops
moving**, up to 15s, inside `withBusy` so a legitimate page transition can't be
mistaken for a stalled job. If the step never changes, the driver now says so and
goes looking for what is blocking it (validation error, missed required field)
instead of cheerfully re-filling.

Wired into SmartRecruiters, Oracle, ADP and the universal multi-page driver — and
since every driver ends in the multi-page driver, into all of them.

### 2. A question revealed by an answer was never answered

> If applicable, would you consider relocating for a role with ServiceNow?\* **Yes**
> &nbsp;&nbsp;&nbsp;&nbsp;↳ If you selected Yes, would you consider relocating at your own expense?\* ☐ Yes ☐ No

The sub-question only renders **after** the parent is answered. Nothing ever
looked at the form again after answering something, so it was never seen — which
is exactly how a form reads 17/17 · 100% with an unanswered required question
sitting underneath.

`resolveDependentQuestions()` answers what is on screen, waits for the framework
to render whatever that unlocked, then compares the question fingerprint and goes
round again. It stops on the first round that reveals nothing new, is capped at 5
rounds, and aborts immediately if you turn the automation off. The required-field
guarantor now does the same at a higher level: if a pass revealed more questions,
it re-runs the general fill so newly revealed **text boxes and dropdowns** get
answered too, not only the choices.

### 3. "Value is required" under a declaration box

> You declare that you have read and understand the privacy notice of ServiceNow.\*
> *Value is required*

That box is a `<spl-checkbox>` web component, so `input[type=checkbox]` — which is
all the old consent pass matched — never found it. And the wording matched none of
the old `consent|agree|privacy|gdpr|terms|acknowledg` list either.

Now:

* **Found everywhere**: `spl-checkbox`, `oj-checkboxset`, `mat-checkbox`,
  `md-checkbox`, `sl-checkbox`, `ion-checkbox`, `vaadin-checkbox`,
  `role="checkbox"`, `role="switch"` and plain inputs.
* **Read properly**: the sentence is pulled from the component's own shadow root,
  its label, and its question container — wherever the platform keeps it.
* **Recognised**: *declare · certify · confirm · attest · affirm · understand ·
  authorise · disclosure · electronic signature · have read · to the best of my
  knowledge* on top of the original list.
* **Ticked reliably**: a web-component checkbox ignores `.click()`, so it
  escalates — inner native input → click → full pointer sequence → associated
  `<label>` → Space key → native set plus `input`/`change` — checking the
  control's own state after each attempt and stopping the moment it reports
  checked. If none of them work, it says so in the log rather than moving on
  silently.
* **Still never a marketing opt-in.** Job alerts, newsletters, talent community
  and "similar roles" are excluded explicitly, regardless of how the markup
  labels them.

The same escalation now backs **multiple-choice questions** too: `spl-radio`,
`oj-radio`, `mat-radio-button`, `md-radio`, `sl-radio`, `ion-radio`,
`vaadin-radio-button` and `role="radio"` widgets are enumerated, labelled (from
their shadow roots where that's where the text lives) and committed the same way.
Unanswered ones now also count toward "missing required fields", so the loop can
no longer conclude "nothing left to fix" on a form that plainly still has
something to fix.

### Verified

Mutation-checked — each of these fails the suite when reverted:

| Reverted to | Assertions that fail |
| --- | --- |
| flat `sleep(2800)` after Next | *SmartRecruiters waits for the next step instead of sleeping 2.8s* |
| `stepSignature` including field values | *fingerprints WHICH questions, never their values* |
| guarantor as a single pass | *the guarantor re-scans after answering* |
| dependent loop not re-reading the page | *it answers, then looks again* |
| marketing guard removed | *marketing opt-ins are never ticked* |
| the old narrow consent regex | 6 wording assertions, including the ServiceNow declaration |

Suite total: **471 assertions**, all green.

### Honest limits

Cross-origin iframes are still only reachable through the all-frames injection,
not the deep enumerator — a question inside a third-party iframe is answered by
the copy running in that frame, not by the parent's fingerprint. And
`stepSignature` deliberately ignores values, so a step that changes *only* a
value and nothing structural reads as unchanged; that is the right trade for
not treating our own typing as a page transition.

---

## v15.2 — getting off the job description and into the application

A queued URL almost never lands on the form. It lands on the **job description**,
and something has to open the application. On the ServiceNow posting at
`jobs.smartrecruiters.com/ServiceNow/744000142223189-…` that something is a button
labelled **"I'm interested"** — with a curly apostrophe (U+2019).

Three things were wrong, and all of them applied to every ATS:

* **The apostrophe.** The pattern was `/i'?m interested/`, which matches `Im` and
  `I'm` and **not** `I’m`. Labels are now normalised (curly quotes → straight,
  en/em dashes → hyphen, whitespace collapsed) before any match.
* **The vocabulary was thin.** It knew about eight phrasings. It now knows the
  ones the supported platforms actually ship — *Apply for this job* (Greenhouse,
  Lever), *Apply to this job* (ADP), *Apply for this position/role*, *Easy Apply*,
  *1-Click Apply*, *Start your application*, *Continue to application*, *Express
  your interest*, *Register your interest*, *Submit your resume* — plus
  *Postuler*, *Jetzt bewerben*, *Solicitar*, *Solliciteer*, *Candidatar-se*,
  *Ansök*, *Søk* for the European tenants.
* **It was blind and first-match.** `findApplyButton` used plain
  `document.querySelector` — no shadow roots, no same-origin frames, and no
  exclusion of Jobright's own sidebar — and took the first qualifying control in
  the DOM. It is now deep-enumerated and **scored**: a real `<button>` beats a
  footer link, a short canonical label beats a long one, *"Apply with LinkedIn"*
  loses to a plain *Apply*, and anything inside a "similar jobs" / "other jobs at
  this company" list is pushed to the bottom — that list sits right beside the
  real button on the ServiceNow JD page.

Equally important is what must **not** be clicked. Sitting directly under
"I'm interested" on that page is **"Refer a friend"**, and beside it *Share this
job* and *Show all jobs*. The reject list now also covers *already applied*,
*application submitted*, *how to apply*, *apply filters*, *save job*, *job alert*,
*sign in*, *create an account*, *view all jobs*, *back to search* and *withdraw*.

### SmartRecruiters specifically

The JD lives at `/<Company>/<id>-<slug>`; the application is at
`/oneclick-ui/company/<Company>/publication/<uuid>/screening` — a different path
**and** a different page load. The driver's "am I already in the application?"
test was `/\/(apply|publication)/`, so on the JD page it looked for an apply
button (correct) but with the old literal label list (wrong), and on
`/oneclick-ui/…/screening` it had no reliable way to know it had arrived. Both
paths are now recognised, and after clicking the entry point the driver waits for
the question set to actually change rather than sleeping and hoping.

Oracle Recruiting Cloud and ADP now use the same shared vocabulary and the same
post-click wait, so a JD page on either behaves identically.

### Verified

Mutation-checked: restoring the old narrow apply pattern fails **17** assertions
(including every non-English label and *Apply for this position*); removing the
curly-quote normalisation fails 2; making the finder first-match instead of
scored fails 1; reverting SmartRecruiters' path test fails 1.

The vocabulary is tested against 24 real entry-point labels and 15 look-alikes
that must never be clicked. Suite total: **522 assertions**, all green.

---

## v15.3 — the autofill loop, and the CV that wouldn't attach

Both reports came from `jobs.smartrecruiters.com`, and both had the **same root
cause**: every synthetic event we dispatched had `composed: false`.

### `composed` is not optional inside a shadow root

SmartRecruiters builds its form out of Spark web components — `spl-input`,
`spl-file-upload`, `spl-select`. The real `<input>` lives inside a shadow root;
the component listens for its events **on the host, outside that root**. A DOM
event only crosses a shadow boundary when it is `composed`, and every event we
made used the default, which is `false`. So:

* **The infinite re-fill.** We set the value. The input displayed it. The
  component never heard about it, its own model stayed empty, it re-rendered the
  field blank — and the next pass saw an empty field and typed it again. Forever.
* **The CV.** We set `input.files` and dispatched `change`. The uploader, which
  listens on the host, never received it. The file was on the input and nothing
  knew.

All **82** synthetic events in the file are now `composed: true`, built through a
single `fireEvent()` helper so a future edit can't reintroduce a bare one — and
`nativeSet` / `setSelectValue` / the CV attach now re-fire on the shadow **host
chain** as well, for components that listen a level up.

### Three more things kept the loop running

* **The step fingerprint was unstable.** `stepSignature()` fell back to the
  field's label when it had no `name`/`id` — and the label lookup reaches into
  the field's container, which also holds validation messages and helper text. So
  the fingerprint changed *every time we filled something or the site showed an
  error*, and every caller concluded the page had advanced or new questions had
  appeared. It now keys on stable identifiers (`name`, `id`,
  `data-automation-id`, `data-testid`, `aria-labelledby`) and falls back to the
  element's **structural position** — which changes when questions are added or
  removed, and at no other time.
* **The passes nested.** The general fill chases dependent questions, the
  guarantor re-runs the general fill when answering reveals more, and the
  multi-page driver runs all of it once per page. Each is bounded alone; nested
  they multiply. `fallbackFill` and `resolveDependentQuestions` now refuse to
  re-enter, and an unchanged step gets at most **4** full fill passes before the
  budget stops it and says so.
* **A field that won't hold a value was retyped forever.** The write ledger
  allows three attempts at the same value per field, then leaves it and logs it
  once. A SmartRecruiters step that refuses to advance twice is now handed over
  rather than re-filled for the rest of its budget.

### The CV attach itself

* Composed events on the input **and** its host chain.
* If nothing registers, a genuine **drag-and-drop** — `dragenter`, `dragover`,
  `drop` — because uploaders that gate on `dragover` to set `dropEffect` ignore a
  lone `drop`. Drop targets now include the shadow hosts above the input, which
  `closest()` cannot reach, plus any `spl-file-upload` on the page.
* A failed upload is **reported**, not assumed to have worked.
* `resumeAlreadyAttached()` no longer mistakes instructions for an attachment.
  *"PDF, DOC, DOCX up to 5MB"*, *"e.g. resume.pdf"*, *"Drag and drop your file
  here, or browse"* and *"Accepted formats: .pdf, .doc"* all used to read as a
  file already being there — which made us skip the upload entirely and then fail
  the step with "Resume is required".

### Verified

Nine mutations, nine failures: un-composing the events, dropping the host-chain
re-fire, removing the fill budget, removing the re-entrancy guard, ignoring the
write ledger, restoring the label fallback in the fingerprint, removing the
SmartRecruiters stuck-step break, removing the drag-and-drop fallback, and
removing the format-hint filter each fail the suite.

Suite total: **556 assertions**, all green.

---

## v15.4 — the answer has to fit the box it goes into

Everything up to here decided **what** to answer. Nothing checked whether that
answer was the right **shape** for the control receiving it. Four things on one
Greenhouse form (`job-boards.greenhouse.io/heartflowinc`) came from that gap.

### "5-8" typed into a number box

`5-8` is exactly the right thing to click in a dropdown whose options are ranges.
Typed into a free-text *"How many years of Software/Risk Quality Assurance
experience do you have?"* box it is a string the ATS cannot parse — and answers
learned from a dropdown get reused on text fields, which is how it got there.

Ranges are now collapsed to a single integer whenever the target is a free-text
or number input, taking the **top** of the range: an employer screening on a
minimum never prefers the lower number, and "5-8 years" honestly means up to 8.
`5-8`→`8`, `3-5`→`5`, `5 to 8`→`8`, `8+`→`8`, `more than 5`→`5`, `at least 10`→`10`.
A dropdown still receives `5-8` unchanged, because there it is a real option.

### Overlapping bands took whichever came first

Bands share their boundaries: 5 years qualifies for both `3-5` and `5-8`, and
whichever appeared first in the DOM won. Every qualifying band now gets a bonus
for its lower bound, so the **highest** one wins — 5 years picks `5-8`, 9 years
picks `8+`, and `10+` beats `5+` for a 12-year candidate. DOM order no longer
decides it.

### "Yes" as the name of an employee

The saved-answer matcher is fuzzy by design — 40% keyword overlap — which a long
question reaches just by sharing nouns. So *"If answered Yes, please provide the
name of the employee who works at Heartflow"*, *"If yes, please explain. If no,
add N/A"* and *"What state do you reside in?"* all came back **"Yes"**.

A bare Yes/No is now rejected on any question a Yes/No cannot answer — one that
opens with *what / which / where / how many / name of / please explain*. In a
text box the answer becomes `N/A` (which is what those questions ask for when
the parent was No); on a dropdown it is dropped so the option matcher can choose
a real option instead. Genuine Yes/No questions — *"Are you legally authorized to
work…"*, *"Do you have any immediate family that work at Heartflow?"* — keep
their answer. *"What state do you reside in?"* is also answered properly now,
from the profile.

### Nine ways of hearing about the job, all at once

*"How did you hear about this job?"* ships nine checkboxes — Job site, LinkedIn,
Job fair, Indeed, Glassdoor, ZipRecruiter, Employee, Handshake, Other. Because
the question is required, the required-checkbox sweep ticked **every one**.

A group of two or more checkboxes sharing a name or a question container is now
treated as one question and gets exactly one answer: the option matching what we
would have typed in a text box (LinkedIn, here), else the first real option —
never *Other*, *None* or *Prefer not to say* unless nothing else fits. The
consent sweep and the required-field sweep both leave grouped options alone. A
container matching more than 25 checkboxes is not treated as one giant question,
so an over-wide selector can't collapse a whole form into a single pick.

### Verified

The shape logic is lifted out of the shipped file and **executed** by the tests,
not pattern-matched: 11 range conversions, 9 yes/no-answerability judgements, 8
band selections and the full set of look-alike questions all run for real.

Seven mutations, seven failures: not narrowing the range, taking the low end of
it, removing the yes/no guard, dropping the band tie-break, letting the required
sweep tick grouped checkboxes, preferring "Other", and letting dropdown answers
be rewritten each fail the suite.

Suite total: **604 assertions**, all green.

---

## v15.5 — the work-authorisation knockout, fixed properly

> "You applied to our vacancy of Solutions consultant at Predikt. I see that you
> filled in you're not allowed to work in Belgium. Is that correct? I see you're
> willing to move. We do not provide Visa sponsorship."

That answer cost a live application. It came from **two** bugs, one in deciding
the answer and one in choosing the option — and both pointed the same wrong way.

### 1. One rule answered No to anything containing "visa"

```js
if (/sponsor|visa|work\s?permit|immigration|h-?1b/.test(q)) return 'no';
```

That is right for *"Do you now or in the future **require** visa sponsorship?"*
and catastrophically wrong for *"Are you allowed to work in Belgium **without**
visa sponsorship?"* — both sentences contain "sponsorship", and the rule ran
**before** the authorisation rule, so eligibility questions never got a chance.

What separates the two is what the verb does to sponsorship, not whether the word
is present. One decider now handles both families:

| Family | Examples | Answer |
| --- | --- | --- |
| **Eligibility** | allowed / authorised / entitled / eligible / permitted / have the right to work — with or without a "…and will not require sponsorship" clause | **Yes** |
| **Possession** | do you hold a valid visa / work permit / settled status / citizenship / permanent residency | **Yes** |
| **Need** | do you (now or in the future) require / need / seek / depend on sponsorship, a visa, a work permit, a Tier 2 / Skilled Worker visa | **No** |

**British spelling was the other half of it.** `/authoriz/` never matched
*"authorised"*, and European ATS — most of what this queue applies to — spell it
that way, so those questions fell straight through to the sponsorship rule.

The decider also refuses to claim questions that merely borrow its vocabulary.
*"Have you ever been convicted of a crime that would prevent you from being
legally permitted to work in this role?"* contains both the work context and the
words — answering that **Yes** would be far worse than the bug being fixed, so
criminal record, debarment, non-compete, termination, drug test and background
check are excluded outright and fall back to the normal knockout logic.

### 2. The grammar pointed the opposite way to the meaning

Deciding "yes" is only half of it — most ATS word their options instead of
offering a literal Yes/No, and there the grammar is actively misleading:

* **"I require visa sponsorship"** — grammatically affirmative, wrong answer.
* **"Does not require sponsorship"** — grammatically negative, right answer.
* **"Yes, I am authorized to work in the US without sponsorship"** — read as
  NEGATIVE, because it contains the word *without*.

On a two-option question that last one is decisive: with no positive option
found, the answerer fell through to "pick the other one" and selected **"No, I
require sponsorship"**. That is the answer the recruiter read.

Work-authorisation options are now scored on **meaning**, not polarity. There is
only one stance to express — *I can work in this country and do not need
sponsoring* — however the question is phrased, so no decision needs threading
through: each option is scored for how well it says that, and the best wins.
Every caller (radio groups, button-style questions, native selects, custom
dropdowns, `pickChoice`) passes the question through so the family is recognised.

### 3. Mobility

*"I see you're willing to move"* was already right, but only four literal
phrasings were known. It now covers *willing to relocate / willing to move /
open to relocation / prepared to move / happy to relocate / would you consider
relocating / relocate at your own expense / able to commute / willing to travel*
— and it is evaluated **after** the strong-No knockouts, so "have you ever
relocated for a former employer?" can't be hijacked.

### Verified

The decider and the option matcher are lifted out of the shipped file and **run
for real** against the phrasings the supported ATS ship: 23 eligibility
variations, 10 sponsorship-need variations, 12 look-alikes that must be left
alone, 9 mobility phrasings, 11 option polarities and 7 two-option pairs — each
pair checked in both orders, so DOM order can never decide it.

Six mutations, six failures: restoring the old visa rule, reading "without
sponsorship" as a negation again, bypassing the work-auth option matcher,
dropping British spelling, removing the excluded-topic guard, and removing the
negated-sponsorship case each fail the suite.

Suite total: **698 assertions**, all green.

---

## v15.6 — white-labelled ATS: detect the platform, not the company

`apply.deloitte.com/en_US/careers/RegisterEdit?jobId=363384` is **Avature**.
The registry only knew `/avature\.net.*careers/`, which matches almost nothing
real — every tenant white-labels Avature onto their own domain — so that URL fell
through to the generic `Career` catch-all, no driver ran, and the queue sat on an
account wall it did not recognise as one.

That is not a Deloitte problem. JPMorgan runs Oracle Recruiting at
`jpmc.fa.oraclecloud.com` and fronts it from `careers.jpmorgan.com`. A host list
can only ever cover companies someone has already hit.

### Two layers, no domain list

**Route signatures.** Every platform ships fixed route names, and those don't
change when the domain does. `/hcmUI/CandidateExperience` is Oracle wherever it
is served from; `/careersection/` is Taleo; `/careers/JobDetail` is Avature.
Added for Avature, iCIMS (`/jobs/<id>/<slug>/job`), Phenom (`/us/en/job/<id>` —
JPMorgan's shape), SuccessFactors (`/sfcareer/`), Cornerstone (`/ux/candidate`),
Brassring (`/TGnewUI/`), PageUp (`/caw/en/job/`), Dayforce (`/CandidatePortal/`),
UltiPro (`/JobBoard/…/JobDetails`) and Workday (`/wday/cxs/`).

**DOM fingerprints.** When the URL says nothing — a bare `careers.acme.com` —
the page still does. Workday stamps `data-automation-id` on everything;
SmartRecruiters renders `spl-*`; Oracle renders `oj-*`; iCIMS wraps its form in
`#icims_content_iframe`; Greenhouse in `#grnhse_app`; Phenom in `#phApp`.
Checked most-specific first, and **only** when the URL was inconclusive — a
confident route match always wins, because a page can carry a marker for a widget
it merely embeds.

The dispatcher now routes on the resolved platform, so an unknown employer domain
reaches the right driver instead of the generic fallback.

### The Avature driver

Avature is unusual in where it puts the account wall: not at the front, but in
the middle, at `/careers/RegisterEdit?jobId=…` — and that page is not an
email/password box, it is the **whole candidate profile plus the credentials**.
Until the credentials are in, nothing else on it will submit, so filling the form
first (which is what the generic flow did) was wasted work every time.

The driver:

* recognises the route it is on — `JobDetail`, `ApplicationMethods`,
  `RegisterEdit`, `SubmitApplication`, `ApplicationConfirmation`;
* on `ApplicationMethods`, takes the path that stays on Avature and lets us fill
  the form — **never** LinkedIn, Indeed, Xing or any other third party, which
  navigates off-site and strands the job;
* completes the credentials **first** on any register/login route, or on any page
  that has grown a password field, then attaches the CV (Avature parses it to
  prefill), then fills, then advances;
* advances by waiting for the question set to change, and hands over after two
  attempts on a step that will not move rather than re-filling it;
* matches Avature's `<input type="submit" value="Next">` actions, which carry
  their label in `.value` rather than in text.

`.mandatory` — Avature's required-field marker — now counts as required, along
with `.req` and `.is-required`.

### Verified

Detection is run for real against 16 white-labelled URLs, including the exact
Deloitte link that was struggling and JPMorgan's Oracle and Phenom shapes, plus
three ordinary pages that must **not** be mistaken for an ATS.

Five mutations, five failures: restoring the host-only Avature pattern (7
assertions), never consulting the fingerprints, letting a fingerprint override a
confident URL match, removing the white-label routes, and dropping `.mandatory`.

Suite total: **735 assertions**, all green.

### Honest limit

`apply.deloitte.com` is not reachable from the environment this was built in, so
the driver is written against Avature's documented route structure and the
universal, label-driven filling machinery — not against a DOM I was able to open.
The routing and the account-wall ordering are the parts I am confident about. If
a specific field or button on that form still misbehaves, send the label and I
will handle it directly.

---

## v15.7 — rebased onto Jobright 1.20.0

The build now sits on the official **1.20.0** patch (was 1.19.0). Three of the
shipped files actually changed:

| File | 1.19.0 | 1.20.0 |
| --- | --- | --- |
| `helper-app.41ea2652.js` | 6,582,824 | 6,858,995 |
| `global.f36301ce.css` | 261,734 | 269,326 |
| `static/background/index.js` | 555,473 | 594,883 |

`contents.d42e7fcf.js`, `scroll-to-anchor.45fefb1b.js` and `inter.42ee87cb.css`
are byte-identical, and none of the five files this build adds
(`ua-enhancement.js`, `ua-orchestrator.js`, `ua-page-hooks.js`, `ua-queue.html`,
`ua-queue.js`) is touched by the patch — they were designed to be additive for
exactly this reason.

### What the rebase had to re-apply

**The service-worker hook.** The new `static/background/index.js` replaced ours,
and ours carried the single appended line that loads the queue engine:

```js
try { importScripts("/ua-orchestrator.js"); } catch (e) { … }
```

Without it the CSV queue silently does nothing — the panel opens, jobs sit in the
list, and no tab ever opens. **The suite caught this**, not a manual review:
*"service worker does not import ua-orchestrator.js"* failed the moment the file
was copied in. That assertion exists precisely because this is the one thing a
patch drop always clobbers.

**The manifest**, rebuilt on the 1.20.0 base rather than hand-edited: our two
content scripts prepended so `ua-page-hooks.js` (MAIN world, `document_start`)
and `ua-enhancement.js` run *before* Jobright's own; `sidePanel`, `alarms`,
`contextMenus` and `notifications` added to permissions; `side_panel` pointed at
`ua-queue.html`; and the web-accessible-resources list filtered to files that
actually exist in the drop plus our own — the stock list names assets the unpacked
build does not ship, and Chrome refuses to load an extension that lists a missing
resource.

### Checked, not assumed

Every selector this build reaches into Jobright's own sidebar with still exists in
1.20.0 — `auto-fill-button`, `application-dashboard-tailor-resume`,
`continue-button`, `continue-button-disabled`,
`tailor-resume-loading-linear-progress`, `spin-loading`, `jobright-helper-id`,
`jobright-helper-content-container`, `plasmo-csui`. Two optional ones
(`external-job-generate-resume-button`, `resume-loading-container`) are absent —
and were absent in 1.19.0 too, so that is not a regression; both sit behind `||`
fallbacks.

Suite total: **735 assertions**, all green on 1.20.0.

---

## v15.8 — the run stopping, the panel vanishing, and "Leave site?"

### One bug, three symptoms

The run halting on its own, the **Automation In Progress** panel disappearing
mid-run, and a queue reporting `0 applied` while looking busy were all the same
defect.

A content script has exactly one piece of per-tab scratch space: `window.name`.
**Chrome clears it every time a tab navigates between different sites**
(window.name isolation). A CSV run drives *one* tab from `greenhouse.io` to
`lever.co` to `smartrecruiters.com` — so the runner marker was wiped at the
**first cross-site job**, and from that moment:

* `processQ()` returned at `if (!isRunnerTab()) return;` — **the queue stopped
  advancing, permanently**;
* the master gate answered "toggle OFF", so the automation was **forbidden from
  acting at all** on that page;
* `updateCtrl()` took its else branch and removed the panel;
* the watchdog that would have re-mounted the panel was itself gated on
  `isRunnerTab()`, so nothing brought it back.

It looked random because it depends on whether consecutive jobs happen to share a
site. It isn't random — it's the first cross-site hop.

The service worker's view of a tab id is unaffected by navigation, so it now
answers `UA_WHICH_TAB`, and the tab driving the run is recorded in
`ua_runner_tab`. `window.name` stays as the cheap synchronous path for same-site
hops; the tab id is the evidence that outlives them. Both copies of the check
were fixed — the fail-closed master gate has its own, in its own scope, and that
one going false is what silenced the automation entirely. It is **still
fail-closed**: with no evidence either way, the gate stays shut, a different tab
is still refused, and a stale `ua_runner_tab` cannot reopen it once the run ends.

The panel also now hangs off `<html>` rather than `<body>` (single-page apps
replace `<body>` wholesale and took the panel with it), carries `!important` on
display and z-index so a site's CSS cannot hide the only Pause/Skip/Quit controls
the run has, and may only be hidden by a run that has genuinely **finished** —
never merely because identity has not been re-confirmed yet.

### "Leave site? Changes you made may not be saved."

A `beforeunload` dialog is not a `confirm()`. The page cannot dismiss it, nothing
runs while it is up, and it waits for a human to press **Leave** — which is what
it was doing on Deloitte's `/careers/ProfileEdit` between application steps.

There was already a hook here and it could not work: it registered a
capture-phase listener that cleared `returnValue`, but a capture listener runs
**before** the page's own handler, which then sets it again afterwards. And
clearing `returnValue` does nothing about `preventDefault()`, which arms the
dialog on its own and cannot be un-set once called.

So the handler is now never able to arm it. Every `beforeunload` listener is
wrapped, and while automating it receives a **shielded** event whose
`preventDefault()` does nothing and whose `returnValue` cannot be assigned; the
wrapper also returns `undefined`, because returning a string arms the dialog too.
`window.onbeforeunload = fn` bypasses `addEventListener` entirely, so it has its
own shim. Only `beforeunload` is touched — every other event type passes through
untouched.

The site's own handler still **runs** (sites do real bookkeeping in there); it
simply comes out unable to raise a prompt. And the decision is made when the
event **fires**, not when the listener is registered — the page registers its
handler at load, long before a job starts, so while you are browsing manually you
get the warning exactly as the site intended. The shield is also now armed for
the *whole* run rather than only while a dispatch is in flight: the prompt fires
during the navigation **between** steps, which is precisely the gap where the
flag used to be handed back.

### 1000+ jobs

The engine has always supported up to 8 parallel job tabs, but there was no way
to change it and it defaulted to 3. **Parallel jobs** is now a control in the
Queue Manager (1–8). The slot filler re-reads it on every pass, so raising it
takes effect on the next job rather than the next run.

### Verified

A new `beforeunload.test.js` runs the real hook file in a sandbox with a working
`EventTarget` and asks the only question that matters — *after every listener has
run, would Chrome raise the dialog?* — across all three ways a site arms it
(`preventDefault()`, `returnValue = string`, returning a string), via both
`addEventListener` and `window.onbeforeunload`, automating and not.

Sixteen mutations, sixteen failures, including: the queue driver bailing on a
wiped marker again, the panel hidden whenever identity is unconfirmed, the
watchdog gated on the thing it repairs, the panel back on `<body>`, the gate copy
reverted, the worker no longer answering *which tab*, the old capture-listener
`beforeunload` approach, `preventDefault` not neutralised, a returned string still
arming the dialog, and the shield armed while **not** automating.

One of those mutations found a real bug in this change: the new
`chrome.runtime.sendMessage` probe sat in the same `try` block as the storage
listener registration, so a context where it threw would have left the gate
unable to notice the toggle at all. It is isolated in its own `try` now, and the
gate suite covers a context with no `sendMessage`.

Suite total: **806 assertions**, all green.

---

## v15.9 — account walls: email-first, shadow DOM, and one account per employer

### The wall that asks for an email and nothing else

`myjobs.adp.com/…/auth` — *"Welcome! Let's find your dream job! If we don't
recognize your info, we'll prompt you to create a profile."* — one email box, a
**Continue** button, and no password until after you press it. Oracle Recruiting,
iCIMS and Workday's newer flow all work the same way.

The detector for "is this a sign-in screen?" was a single line:

```js
function looksLikeAuthPage() { return $$('input[type=password]').some(isVisible); }
```

Two things wrong with it, and together they stalled every job that hit one:

* **An email-first wall has no password field**, so this returned `false`,
  `handleAccountAuth()` returned immediately, nothing was filled, and the job sat
  on the sign-in screen showing *"Email Address required."* under an empty box
  while the panel reported `0 applied`. That is the ADP screenshot exactly.
* **`$$` is blind to shadow DOM.** Oracle renders its fields as `oj-*` web
  components with the real `<input>` inside a shadow root, so even a wall that
  *did* have a password field was invisible here. This is a large part of why
  oraclecloud.com struggled.

A wall is now recognised by what it **asks for**: an email or username box (found
deeply, and unwrapped from its web component), corroborated by auth wording or an
`/auth`-style path, and only when there is no application form to fill yet. And it
is **walked in steps** — email → Continue → whatever that reveals — rather than
assumed to be a single screen, waiting for the page to actually change between
each.

**Never the social buttons.** *"Or sign in using social media"* sits directly
under ADP's Continue; clicking LinkedIn, Google, Facebook, Indeed or an SSO tile
navigates off-site and strands the job on a page the queue can do nothing with.
Those are excluded explicitly, and the real Continue is not caught by the
exclusion.

### Workday: created the account, then asked to create it again

Two separate causes, both fixed:

* **It was only recorded if a watcher later happened to see the My Information
  page.** The run frequently navigates on before that appears, so the account was
  never written down. It is now recorded the moment there is proof — when Create
  Account is submitted, when Sign In is submitted, and when the site itself says
  *"account already exists"* (the strongest evidence there is, stronger than our
  own bookkeeping). Recording optimistically is safe: the worst case is that Sign
  In is tried first next time, which is the correct order once an account exists,
  and a wrong-credentials error flips it straight back to Create Account.
* **It was filed under the raw hostname.** Workday serves one tenant from
  `acme.wd1.myworkdayjobs.com`, `acme.wd3.…`, `acme.wd5.…` and
  `myworkdaysite.com`, so a record written under one host was invisible from the
  next. Accounts are now keyed per **employer** — the data-centre label and
  `www.` are stripped, `myworkdaysite.com` is folded in — while two different
  employers stay firmly separate. Records written under the old raw-host key are
  still honoured, so nothing you have already created is forgotten.

### Verified

`accountKeyFor` is a pure function and is **run for real**: wd1 and wd5 resolve to
the same employer, `myworkdaysite.com` folds into `myworkdayjobs.com`, case is
normalised, a non-Workday host is untouched, and two different employers do not
collide. The auth-copy and social-button patterns are executed against the real
ADP wording and five social sign-in labels.

Six mutations, six failures: restoring the password-only wall test, making social
buttons clickable again, collapsing the wall back to a single step, keeping the
data-centre label in the account key, not recording the account when Create is
submitted, and finding the email box with a blind query again.

Suite total: **850 assertions**, all green.

### Honest limit

`myjobs.adp.com` and `*.oraclecloud.com` are not reachable from the environment
this was built in. The detection logic and the step walk are written against what
the screenshot shows and against how these products are structured; the parts I
am confident about are the shape of the fix — deep enumeration, email-first
recognition, step-by-step progression, never clicking social. If a specific field
or button on one of those walls still misbehaves, the queue log now records which
step it was on and what it looked for.

---

## v16.0 — the same letter on every application

> "I keep seeing this text on a lot of my applications — is it misplaced?"

It was not misplaced, and that is the problem. It is your saved cover-letter
text, pasted **verbatim** into every box whose label reads like a cover letter, a
motivation, or a message to the hiring team. Identical wording across dozens of
applications is worse than an empty box: it reads as a form letter, and it names
no employer.

Three changes:

* **The text is tailored before it is written.** `{company}` and `{title}`
  placeholders are substituted, and when the saved text names no employer at all,
  the company and role read off the page are woven into an opening sentence —
  *"I am applying for the Principal ML Engineer role at ServiceNow."* Two
  different employers now produce two different letters. Text that already names
  the employer is left in your own words, untouched.
* **An OPTIONAL message box with nothing specific to say is left empty.** Better
  no letter than the same letter.
* **A REQUIRED one is still answered**, because an empty required field blocks the
  application.

The employer is taken from the CSV row when it carried one, then from the page,
and finally from the host itself — on a white-labelled ATS that *is* the company
(`apply.deloitte.com`, `careers-amd.icims.com`).

### Signature and date fields

SmartRecruiters' preliminary questions end with **"Name (Signature Field): \*"**
and **"Today's date \*"** — two required free-text boxes, neither of which was
recognised, so the step could not be submitted however complete the rest was.

Both are answered now. The signature box gets your name typed in (and an
*upload*-a-signature field is deliberately not typed into). The date box matches
whatever format the field advertises — `DD/MM/YYYY`, `MM/DD/YYYY` or ISO — rather
than guessing, because a date in the wrong order is silently wrong rather than
obviously wrong.

### Verified

`tailorCoverText` and `todayForField` are pure and are **run for real**: naming
the employer and role, substituting placeholders, leaving text that already names
the employer alone, producing different letters for different employers, and all
four date formats.

Six mutations, six failures: not tailoring the text, filling an optional box with
boilerplate again, leaving a required box empty, not recognising the signature
field, ignoring the date-format hint, and letting the internal `__TODAY__` token
reach the page.

Suite total: **876 assertions**, all green.

---

## v16.1 — clearing email-verification walls on their own

Several ATS put a hard stop in the middle of an application: create an account,
then go and click a link — or type a code — that has just been emailed to you.
Workday does it per tenant, iCIMS and Taleo on some configurations, ADP when it
does not recognise your details. A queue running 500 jobs unattended died at
every one of them.

Connect a mailbox and the queue clears them itself.

### What it can do — and what it cannot

The limits are in the code, not in a policy document. Each one is what makes this
safe to leave running while you are away from the machine:

| | |
| --- | --- |
| **Read-only** | `gmail.readonly` and nothing else. It cannot send, delete, archive, modify or forward. That is enforced by the scope at Google's end, not just by this code. |
| **Recent only** | Every query is bounded to the last hour, and each message is then checked against a 15-minute cutoff. A verification mail from yesterday is not the one we are waiting for. |
| **This employer only** | The query is built from the employer and ATS host of the job in hand. There is no code path that lists the mailbox generally — a caller that names no employer gets `no-hosts` back. |
| **Links lead back to the job** | A verification link is followed **only** when its host belongs to the ATS or employer already being applied to, and only over HTTPS. Inboxes contain phishing; an unattended agent that opens any link in any recent mail is a liability. This check is the reason the feature is usable unattended at all. |
| **Nothing is kept** | The token lives in `chrome.storage.session`, so it dies with the browser. Message bodies are never returned to the page or stored — the code or link is extracted and the body is dropped. |
| **Revocable** | Disconnect drops Chrome's cached token *and* calls Google's revoke endpoint, so the grant does not outlive the click. |

No client secret exists anywhere in the extension. An extension is a public
OAuth client and cannot keep one, so the flow uses PKCE
(`code_challenge_method=S256`), with Chrome's own `getAuthToken` tried first
where it is available.

### How it behaves

When a page says *"verify your email"*, *"check your inbox"* or *"enter the code
we sent"*, the run pauses on that job — the stall watchdog stands down, so it is
not mistaken for a stuck job — and polls for the message for up to 90 seconds.
A **code** is preferred over a link, because typing it keeps us on the page we
are already on. If no mailbox is connected, the job is **handed to you** with the
reason recorded, rather than failing silently three minutes later.

### Connecting one

1. Create an OAuth client in Google Cloud Console for the Gmail API, scope
   `https://www.googleapis.com/auth/gmail.readonly`.
2. Register the extension's redirect URI (`chrome.identity.getRedirectURL()`
   prints it — `https://<extension-id>.chromiumapp.org/`).
3. Paste the client ID into **Mailbox** in the Queue Manager and press
   **Connect**.

Disconnect is in the same place.

### Verified

The two functions that decide *what gets read* and *what gets clicked* are pure,
and they run for real: the query is checked to be employer-scoped and
time-bounded, and `pickLink` is run against a genuine verification link, a
phishing link in the same message, a lookalike subdomain, an unrelated
newsletter, plain HTTP on the right host, and a non-verification link on the
right host.

Seven mutations, seven failures: widening the scope to `gmail.modify`, removing
the link allow-list, accepting `http:`, dropping the time bound from the query,
not applying the age cutoff, moving the token to local storage, and skipping the
revoke on disconnect.

Suite total: **930 assertions**, all green.

---

## v16.2 — Jobright 1.21.0, the rival patches, and the iCIMS wall

### Rebased onto 1.21.0

The 24-08 drop is patch-only: `contents.d42e7fcf.js` and
`helper-app.41ea2652.js` changed, nothing else — including no service worker, so
the `importScripts` line that loads the queue engine was untouched this time.
Every selector this build reaches into Jobright's sidebar with is still present
in 1.21.0.

### What OptimHire and Simplify actually knew

Both were mined for ATS hosts this registry did not have. OptimHire advertises
"Apply on LinkedIn, Greenhouse, and 50+ job boards in 1 click", so this was the
interesting question.

Neither ships a list in its manifest — both match `<all_urls>` — so the hosts
were extracted from their bundles and diffed against our registry. **The answer
was five**, and none of them a major platform:

`amazon.jobs` · `dice.com` · `welcometothejungle.com` · `polymer.co` ·
`workbright.com`

Everything else they know, this build already had — Greenhouse, Lever, Ashby,
Workday, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Jobvite,
JazzHR, Rippling, Paylocity, Manatal, Pinpoint, Comeet, Freshteam, GoHire,
Recooty, Breezy, Handshake, ZipRecruiter, Indeed, LinkedIn and the rest — plus
Avature, Oracle Recruiting, Taleo, ADP myjobs, Cornerstone, Brassring, PageUp,
Dayforce, UltiPro and Phenom, which they do not.

That is worth recording plainly: **the coverage question is settled**, and the
remaining work on this build is depth on the platforms already supported, not
breadth. The five gaps are closed.

LinkedIn and Indeed already have their own drivers here and are dispatched — and
`handleAccountAuth` deliberately refuses to touch credentials on either, because
those are your personal logins, not an ATS account this extension should be
creating.

### The iCIMS account wall

`careers-amd.icims.com/jobs/91328/login` — email, an "I accept" box gating
**Next**, and no password anywhere. Two changes:

* iCIMS is now matched on its **routes** as well as its host —
  `/jobs/<id>/login`, `/register`, `/candidate` — which matters on a
  white-labelled iCIMS where the host says nothing at all. `careers.acme.com`
  serving an iCIMS wall used to fall through to the generic path.
* The auth-wall detector recognises `/jobs/<id>/login` as an auth path, so the
  email-first machinery from v15.9 engages there.

The "I accept" box is a single consent checkbox, so it is ticked by the
declaration pass rather than treated as one option of a multiple-choice question.

### Verified

Detection is executed against the exact AMD wall URL, a white-labelled iCIMS wall
on a plain company domain, and the five newly-added platforms.

Mutations: removing the new boards, removing Welcome to the Jungle, dropping the
iCIMS route match (which only bites on the white-label case — on `icims.com`
itself the host pattern still catches it, and the test now covers both), and
removing the iCIMS auth-path test each fail the suite.

Suite total: **942 assertions**, all green on Jobright 1.21.0.

---

## v16.3 — 13 failed of 16, and where the time was going

A 544-job run reported **2 applied, 1 skipped, 13 failed**. The screenshot of job
17 explains almost all of it, and none of the causes were speed.

### The page

BMW Group's careers portal: **"Karrierechancen: Anmelden"** — a sign-in wall, in
German, behind an **"Ich bin kein Roboter"** reCAPTCHA.

Three separate problems in one screen:

**1. A CAPTCHA on the *sign-in* wall is unwinnable, and we waited it out anyway.**
A CAPTCHA on the *application* is a human wait — you solve it and the job
continues. A CAPTCHA on the account wall is different: the sign-in has to
complete before anything can be filled, so an unattended run is finished there no
matter how long it sits. Each of those jobs burned the CAPTCHA grace (1 min) and
then the per-job cap (3 min) before being written off as **failed**. Thirteen
jobs at up to four minutes is the better part of an hour spent on nothing.

Those are now triaged in **seconds**, before the waits, and recorded as
**skipped** with the reason — *"Sign-in is behind a reCAPTCHA — an account is
needed before applying"* — rather than a bare "failed" that tells you nothing.
A closed posting (*"no longer accepting applications"*, *"nicht mehr
verfügbar"*, *"cette offre est close"*) is caught the same way, and only when
there is genuinely no form left on the page.

**2. The whole wall was invisible because it was in German.** *Anmelden*,
*Kennwort*, *Haben Sie schon ein Konto?*, *Erstellen Sie ein Konto* — every word
of it missed an English-only pattern, so an entire European tenant failed job
after job even before the CAPTCHA. The account-wall vocabulary, the sign-in and
create-account buttons, and the create-account link now cover **German, French,
Spanish, Italian, Dutch, Swedish, Norwegian and Polish**. The link matcher also
no longer anchors to the start of the string, because *"Erstellen Sie ein Konto"*
begins with the verb.

**3. Recognising these is worth more than raw speed.** Thirteen jobs skipped in
ten seconds each instead of four minutes each is roughly **50 minutes** back on
a run of this size — more than any change to how fast an individual application
is filled.

### And the actual throughput

**Parallel jobs** now goes up to **12** (was 8). A 544-job CSV at 3 at a time is
181 sequential rounds; at 12 it is 46. Different employers do not share a rate
limit, so running them side by side is the cheapest speed there is. It is capped
at 12 rather than removed because past that the tabs compete for the same CPU and
every individual application gets slower, which costs more than the extra
parallelism buys.

### On the speed setting

Worth saying plainly: the run in the screenshot was at **3x**, which multiplies
every wait by 0.3. That is the wrong lever for a bulk run. Raise **Parallel
jobs**, not speed — parallelism costs nothing in accuracy, while 3x gives a
framework less time to register a value before the next action. If failures
persist after this build, try 1.5x with Parallel jobs at 8–12.

### Verified

`CLOSED_POSTING_RE` and `AUTH_COPY_RE` are executed against real wording in six
languages, including the exact strings from that BMW page.

Six mutations, six failures: removing the triage, treating a CAPTCHA anywhere as
unwinnable (it must be the sign-in wall specifically), skipping a "closed" page
that still has a form, dropping German from the wall vocabulary, dropping the
localised sign-in button, and putting the concurrency cap back to 8.

Suite total: **981 assertions**, all green.

---

## v16.4 — the CPU, and a speed selector that never worked

### It was pegging the CPU, and that was my doing

The build got heavy enough to bring a machine down. Almost all of the cost was in
one path introduced two versions ago.

`stepSignature()` walks the DOM deeply. `waitForStepChange` polls it **every
300ms** while a step transition is in flight, and several passes call it two or
three times each on top of that. Two things in there did not belong in a hot
loop:

* **`deepQueryAll` found shadow hosts by asking each node for every element it
  contains** — the whole document — on *every* deep query. A large ATS page was
  being fully enumerated several times a second, in every open job tab. With a
  dozen tabs that is enough to take a machine down.
* **`questionControls` filtered with `isVisible`**, whose `getComputedStyle` call
  forces a style recalculation. Four hundred of those per fingerprint, several
  times a second.

Fixed three ways:

1. Shadow hosts are found by **naming the tags that actually host them** — a
   custom element, or one of the handful of native elements that can — instead of
   asking for everything. CSS cannot express "any tag with a hyphen", so the list
   is explicit; it still reaches `spl-*`, `oj-*`, `mat-*`, `sl-*`, `ion-*`,
   `vaadin-*` and `plasmo-csui`.
2. The fingerprint is **memoised for 250ms**. Nested callers collapse into one
   computation, and 250ms is comfortably under the 300ms poll, so a genuine step
   change is still seen on the very next tick.
3. The fingerprint uses a **bounding-box-only** visibility test. A zero-sized box
   already covers `display:none` anywhere up the ancestor chain, and that is all
   a fingerprint needs. The general `isVisible` keeps the full check.

Two timers were also running far faster than they needed to: the panel watchdog
every 600ms — it re-mounts a panel, it does not animate one — and the sidebar
re-scan every 1.5s. Now 2s and 3s.

### The speed selector did nothing on the run you actually use

1x / 1.5x / 2x / 3x had no effect in **Queue Manager (parallel tabs)** mode, which
is the mode for bulk. The gate was:

```js
ms * (qActive && !qPaused ? qSpeedFactor : 1)
```

`qActive` is the **in-page single-tab runner's** flag. Queue Manager drives its
jobs in parallel background tabs, and those tabs never set it — so the factor was
never applied and the buttons were decorative. The speed *was* being read from
storage correctly in every tab; it simply never reached the arithmetic.

Two further reasons it under-delivered even where it did apply:

* **The floor was 40ms.** At 3x (factor 0.3) every sleep under 133ms was clamped
  back up, so the top speed was barely distinguishable from the one below. Now
  25ms.
* **The settle waits were flat.** `waitForFormStable`'s quiet-period debounce and
  `waitForStepChange`'s settle window were fixed at 300ms and 700ms however fast
  the run was set. Both scale now. The overall *timeouts* deliberately do not —
  those are safety caps, not a pace.

A 3-second pause at 3x is now 900ms, as it always should have been.

### Verified

The speed arithmetic runs for real: all four multipliers, the unknown-multiplier
fallback, and the scaling of a 3s pause at 1x and 3x.

Ten mutations, ten failures: the sleep gate back to runner-only, manager tabs
never marked, the floor back to 40ms, both settle windows unscaled, the shadow
walk back to enumerating everything, the fingerprint memo removed, and the
expensive visibility test restored.

Suite total: **1,016 assertions**, all green.

---

## v16.5 — rebased onto Jobright 1.22.1

Three shipped files changed:

| File | 1.21.0 | 1.22.1 |
| --- | --- | --- |
| `contents.d42e7fcf.js` | 16,493 | 40,016 |
| `helper-app.41ea2652.js` | 6,926,041 | 6,998,628 |
| `static/background/index.js` | 595,410 | 599,065 |

`scroll-to-anchor.45fefb1b.js`, `global.f36301ce.css` and `inter.42ee87cb.css`
are byte-identical, and none of the seven files this build adds is touched by
the patch.

### This drop shipped a service worker, and that matters

Unlike 1.21.0, this patch **replaces `static/background/index.js`** — the file
that carries the two appended lines loading the queue engine and the mailbox
module:

```js
try { importScripts("/ua-orchestrator.js"); } catch (e) { … }
try { importScripts("/ua-mailbox.js");      } catch (e) { … }
```

Without them the CSV queue silently does nothing: the panel opens, jobs sit in
the list, no tab ever opens. **The suite caught it**, as it is designed to —
*"service worker does not import ua-orchestrator.js"* failed the moment the file
was copied in, and I re-confirmed the check has teeth by breaking the line again
afterwards.

### Verified

Every selector this build reaches into Jobright's own sidebar with is still
present in 1.22.1 — `auto-fill-button`,
`application-dashboard-tailor-resume`, `continue-button`,
`continue-button-disabled`, `tailor-resume-loading-linear-progress`,
`spin-loading`, `jobright-helper-id`, `jobright-helper-content-container`,
`plasmo-csui`. Two of them appear fewer times than before (`continue-button`
4 → 3, `jobright-helper-id` 8 → 5) but all are still there, and each is used
behind an `||` fallback.

Every web-accessible resource named in the rebuilt manifest exists on disk —
Chrome refuses to load an extension that lists one that does not — and the
manifest keeps all of this build's customisations: our two content scripts ahead
of Jobright's own, the `sidePanel` / `alarms` / `contextMenus` / `notifications`
/ `identity` permissions, and the side panel pointed at `ua-queue.html`.

Suite total: **1,016 assertions**, all green on Jobright 1.22.1.

---

## v16.6 — measured against four real queues

Four exported CSVs — **985 rows, 943 unique jobs, 79 hosts**. Running the shipped
registry over every one of them turned "imported CSV URLs struggle with a lot of
ATS" into a number:

**92 of 943 jobs (10%) fell through to the generic path.** That is now **45**,
with **zero regressions** — every one of the 47 changes is a job that was
unrecognised and is now routed to a driver.

### What the real URLs showed

Most fall-throughs were platforms this build *already supports*. They were missed
because employers serve them from their own domain, in a shape the vendor's
documentation never mentions.

| Rule added | Jobs recovered | Why it was missed |
| --- | --- | --- |
| `gh_jid=` anywhere in the query → **Greenhouse** | 9 | Greenhouse is embedded on the employer's own site far more often than it is served from greenhouse.io. One parameter covered Toast, Elastic, Waymo, Databricks, HubSpot, Hudson River Trading, Nitro and Squarespace. |
| `grnh.se/…` | 1 | Their short link. |
| `/jobs/<id>-<slug>` → **Teamtailor** | 27 | The single biggest gap. `careers.sumsub.com` alone was 20 jobs, plus Spacelift, Phorest and Geely. |
| Alphanumeric requisition codes → **Phenom** | 4 | Mastercard's `MASRUSR280277EXTERNALENUS` and Snowflake's `SNCOUS…` are not digits, so a digits-only test saw nothing. |
| `personio.com/careers/` | 2 | The pattern required `.de`. |
| `bamboohr.com/careers/` | 1 | The pattern required `/jobs`. |
| `/sites/<site>/job/<id>` → **Oracle** | 1 | Oracle also serves this without the `/hcmUI/` prefix. |
| `aplitrak.com`, `current-vacancies.com`, `contacthr.com` | 3 | Single-tenant ATS, one job each — and one job each is what they cost. |

### An ordering lesson worth recording

`/<locale>/job/<id>/<slug>` is used identically by **amazon.jobs**,
**pageuppeople.com** and **careers.jpmorgan.com**. No pattern can separate them —
only the host can. Matching that shape near the top of the table stole Amazon and
PageUp for Phenom, and the suite caught it immediately.

Phenom therefore now has **two** entries: its unambiguous host and feed signals
near the top, and the ambiguous path shape as the **last rule before the generic
catch-all**, where it picks up an unknown employer domain without taking a known
one. First-match-wins is the registry's contract, and rules earn their position
by how specific they are.

### What is left

The remaining 45 are genuinely bespoke: single-employer portals (Google,
Booking, TikTok, Wolt, Framer, Y Combinator) and aggregator front pages
(tecnoempleo, aijobs, topgenaijobs, haystack, talenthop, micro1). Some will still
be handled at runtime by the **DOM fingerprints** from v15.6, which read the page
rather than the URL — that cannot be measured from a CSV, only observed on a run.
One row was `duckduckgo.com`, which is not a job at all.

Also worth knowing: **43% of the queue (406 jobs) is `linkedin.com`**, which has
its own driver and its own rules about automation.

### Verified

Every rule is asserted against the **real URLs from your CSVs**, verbatim, and 11
already-working platforms are re-checked so a broad new rule cannot quietly
swallow one. Three ordinary non-job pages must still be classified as nothing.

Six mutations, six failures — including moving the Phenom path rule back to the
top, which immediately breaks Amazon and PageUp.

Suite total: **1,051 assertions**, all green.

---

## v16.7 — rebased onto Jobright 1.23.0

Four shipped files changed:

| File | 1.22.1 | 1.23.0 |
| --- | --- | --- |
| `contents.d42e7fcf.js` | 40,016 | 51,112 |
| `helper-app.41ea2652.js` | 6,998,628 | 7,154,639 |
| `global.f36301ce.css` | 269,326 | 274,146 |
| `static/background/index.js` | 599,065 | 617,987 |

`scroll-to-anchor.45fefb1b.js` and `inter.42ee87cb.css` are byte-identical, and
none of the seven files this build adds is touched by the patch.

### The service worker again

Like 1.22.1, this drop ships its own `static/background/index.js`, which replaces
the file carrying the two lines that load the queue engine and the mailbox
module. Re-appended, and the suite's check confirmed it before and after.

That is now three patches in a row where the same two lines were the only thing
standing between a working queue and a panel that opens onto nothing. The check
that guards them has paid for itself several times over.

### Verified

Every selector this build reaches into Jobright's own sidebar with is still
present in 1.23.0 — unchanged counts from 1.22.1 across the board. Every
web-accessible resource named in the manifest exists on disk. The manifest keeps
our two content scripts ahead of Jobright's own, the `sidePanel` / `alarms` /
`contextMenus` / `notifications` / `identity` permissions, and the side panel
pointed at `ua-queue.html`.

Suite total: **1,051 assertions**, all green on Jobright 1.23.0.

Note that `contents.d42e7fcf.js` has now grown from 16KB to 51KB across three
patches — Jobright is changing its own content script substantially. Nothing in
the suite flags a conflict with our layer, but that is where to look first if
their sidebar starts behaving differently.

---

## v16.8 — the refiring, the silent skips, and the batch ramp

### Why the autofill kept re-firing

Four layers of repetition were stacked on top of each other, and each was
reasonable on its own:

```
attempt loop  (×2)
  └ withRetry (×3 on a throw)
      └ dispatchATSAutomation
          ├ the per-ATS driver      (its own step loop)
          └ multiPageLoop           (up to 18 pages, two fills each)
  └ retry pass → fill again, and multiPageLoop AGAIN
```

Worst case that is **six full drives of the same form**. The per-step fill budget
added in v15.3 capped how much damage each drive could do, but it could not stop
the structure — which is why the refiring was still visible.

Now the driver runs **once**. `withRetry` gets no retries of its own (the attempt
loop already *is* the retry), and the second attempt is deliberately cheap: top up
whatever is still empty, fix validation, press the button again. No driver, no
page walk. If the first pass could not find the form, running identical code a
second time will not find it either — it will just cost another minute.

The verify loop also stops early now when the form is sitting on an unfixed
complaint, instead of waiting out twelve seconds that cannot change anything.

### "Skipped" was hiding real failures

Two very different outcomes were reported identically:

* a URL that is **not an application** — no form, no Apply button, no known ATS.
  Skipping is right and there is nothing to act on.
* a job where **Apply was right there and led nowhere**. That job was applicable
  and we failed at it.

Both said *"No application form found"* and both landed in the column people
ignore. They are now told apart, and the second is reported as a **failure with
its reason** — which is very likely a chunk of what looked like "a lot of roles
getting skipped".

### Opening a batch of tabs was itself the bottleneck

The slot filler is serial, so a flat 800ms between tab opens cost **ten seconds
of every refill at a concurrency of 12** — pure dead time. The point of the pause
is not to burst-open against one site, so it now shrinks as the batch grows: 4
tabs get 300ms each, 12 get 100ms each, and the total ramp never exceeds ~1.2s.

### What LazyApply actually does better

Its waits are **100ms, 300ms and 500ms**. Ours are routinely 2–3 seconds.

That gap is not cleverness, it is architecture: LazyApply ships a separate bundle
per site — `linkedin.bundle.js`, `indeed.bundle.js`, `glassdoor.bundle.js`, a
dozen more — and site-specific code can wait for *the exact thing it expects*
rather than sleeping long enough to be safe on anything. This build takes the
opposite bet: one generic engine that has to work on an ATS nobody has seen yet,
including the 45 bespoke employer portals in your own queues that no per-site
bundle would ever cover.

The right thing to borrow is not shorter sleeps — it is **more condition-based
waits**, which is what `waitForStepChange` and `waitForFormStable` already are.
Every flat sleep that sits behind one of those is now redundant fat, and that is
where the next round of speed should come from.

I have deliberately **not** made 2x/3x more aggressive. The wait factors stay at
`{1: 1, 1.5: 0.66, 2: 0.45, 3: 0.3}` because you are already seeing failures, and
a shorter wait is the first thing that turns a slow-but-working step into a
failed one. Raise **Parallel jobs** instead — that buys throughput without
touching the odds on any individual application.

### Verified

Five mutations, five failures: giving `withRetry` its retries back, re-running
the driver on every attempt, re-entering the multi-page driver in the retry,
silently skipping an unopenable job again, and flattening the tab-open pause.
The batch-ramp arithmetic runs for real at 1, 4, 12 and 40 tabs.

Suite total: **1,069 assertions**, all green on Jobright 1.23.0.

---

## v16.9 — every SmartRecruiters job, and a dialog that stopped a 685-job run

Four separate reports, one run: every `jobs.smartrecruiters.com` job failing, a
"Leave site?" prompt freezing the queue on Oracle Cloud, `0` typed into a
years-of-experience box, and knockout questions answered against the candidate.

### Every SmartRecruiters job failed, and it was v16.4's fault

v16.4 cut CPU cost by replacing the shadow-host search in `deepQueryAll` with a
fixed list of tag names. The list held **leaf** components — `spl-input`,
`spl-select`. SmartRecruiters nests those inside its own **wrapper** custom
elements, so the wrapper was never recognised as a shadow host, never descended
into, and every field beneath it was invisible. Zero fields means no form, which
the runner reports as a failed job — for the entire ATS.

Wrapper names are private to each ATS, so a list can never be right here.
`shadowHostsIn` enumerates completely again and pays for it with a 400ms
`WeakMap` cache keyed on the root, which keeps the hot path (`stepSignature`,
polled every 300ms in every open tab) cheap without hiding anything.

The assertion that should have caught this was itself the problem: it checked
that the allow-list was *being used* — the mechanism, not the property — so it
stayed green while the extension found nothing. It now asserts that a field
inside an **unknown** wrapper's shadow root is reachable, built as a real DOM.

### "Leave site?" could stop everything, and nothing would restart it

The shield in `ua-page-hooks.js` is armed by `data-ua-auto`, which is set for the
lifetime of a job. But `beforeunload` fires during the navigation **away** from a
page — after the job ends, after the flag is handed back. The shield was down at
exactly the moment it was needed, and Oracle Cloud's HCM pages froze a 685-job
run behind a prompt no script could answer.

Clearing the flag now opens a 20-second grace window (`data-ua-grace`) instead of
taking effect at once. That outlasts a navigation; after it, the site gets its
own warnings back, which it must.

A shield is a race, so there is now a backstop that does not have to win one. The
Queue Manager supervises its job tabs because it opened them; the single-tab
runner drives the whole queue from inside one page, so when that page stops
running JavaScript there is by definition nothing left in it to notice. The
worker now pings it, and a tab that cannot answer for 45 seconds is **closed and
replaced** — `tabs.remove()` is the one navigation a `beforeunload` handler
cannot veto, where reload and update both re-raise the prompt. A tab that no
longer exists skips the wait entirely: closing the runner tab used to end a
600-job run in silence, with the queue still active and the marker pointing at a
dead tab id.

A manager job tab held by the same dialog no longer gets the full 45s navigation
grace either — a tab that is `complete` **and** silent is not loading anything.

### `0` years of experience

"How many years of hands-on experience do you have with Linux system
administration and troubleshooting?" was submitted as **0** — a number that fails
every minimum-years screen there is. Nothing legitimately resolves to zero there,
so an empty answer, a value that parsed down to nothing, and a saved `0` all fall
back to the real figure. The default is now **7** rather than 5, and the
candidate's own profile figure beats both.

### A fuzzy match could lose a knockout

Saved answers are matched on 40% keyword overlap and were consulted *before* any
of the knockout reasoning ran. That is how a stray "No" reached "Do you have
hands-on experience with Linux patch and package management?" — an automatic
rejection decided by an unrelated saved entry that happened to share some nouns.
It is the same failure mode as the recruiter who was told the candidate could not
work in Belgium.

A saved **Yes/No** that contradicts the reasoning is now dropped on knockout
questions, and only there. A saved salary, notice period or written answer is
untouched; so is an answer the user typed against that exact question, because
their word is final.

### Oracle's required dropdowns stayed empty

A Recruiting Cloud application came back with "This info is required." under
Ethnicity, Gender and the disability question, on a form the pass believed it had
answered. Two causes, both fixed:

- **Substring matching.** "I do not have a disability" picked whichever option
  contained the letters `n-o-t` — "Not applicable". Matching is whole-word now,
  filler words get no vote, and the option sharing the most words wins.
- **A click JET ignores.** Oracle's selects track the highlighted row in
  `aria-activedescendant` and commit on Enter, so a synthetic click on the row
  left the field looking untouched. A commit that does not take is now followed
  by the keyboard — bounded, and it gives up rather than pressing Enter on the
  wrong row. Discovery also covers all three generations Oracle ships side by
  side (`oj-select-single`, `oj-c-select-single`, `oj-select-one`,
  `oj-combobox-one`).

Mutations checked: restoring the tag-name allow-list, removing the grace window,
removing the zero-years fallback, and letting a contradicting saved answer
through. All four fail the suite.

### "15 failed" with no way to see why

Every failure already carried a reason — `No application form found`, `Sign-in
required`, `Tab went silent for 20s` — and there was nowhere to read them all at
once. **⚠ Copy failures** in the Queue Manager puts the lot on the clipboard,
grouped by reason and ordered by how many jobs each one cost, because fifteen
failures are usually three causes and the counts say which to fix first.

### A years dropdown that picked the worst option, and a sponsorship Yes

One Greenhouse form submitted both:

- **"How many years of professional experience…?" → "Less than 1 year".** A years
  dropdown is a list of ranges, and none of the matchers can read one: looking
  for `7` among "Less than 1 year", "1-2 years", "3-5 years", "5-10 years" finds
  nothing, so the required-field fallback took `real[0]` — the first option,
  which on an ordered list is always the worst. The committer now scores the
  ranges the way the radio path already did, and a list it cannot score falls to
  the **top** rather than the bottom.
- **"Will you require visa sponsorship within the next 18 months to work in the
  United Kingdom?" → "Yes".** The right-to-work question sat directly beneath it
  and shares nearly every word, so the 40%-overlap matcher handed that
  question's saved "Yes" across — telling the employer the candidate needs
  sponsorship when they do not. Sponsorship, visas and work permits are knockout
  questions now, so a contradicting saved answer is dropped there too.

### The run now says WHY, not just how many

Four screenshots of a failing run arrived carrying nothing but a count — "37
failed". Every failure had recorded a reason the whole time; they were only
readable in the Queue Manager, which is not what is on screen during a run. The
run panel now carries a line — **Most failures: … (n)** — and clicking it copies
the full grouped report.

### Two SmartRecruiters details, from OptimHire 2.8.9

Both were silent bugs here — the form looks filled either way.

- **`<spl-radio label="Yes">`.** Option text lives in the `label` **attribute**.
  `getLabel()` finds nothing local on a web-component radio and climbs to the
  group, so every option in a group came back as the question text — Yes and No
  were indistinguishable and the matcher took whichever it saw first. A custom
  element is now asked for its own label before anything climbs.
- **The search box inside an open dropdown is not a field.** It looks like one to
  every enumerator — visible, empty, with the dropdown's label above it — so the
  answer was typed into it, the list filtered to nothing, and the real field
  stayed empty. Matched on the role rather than on any one ATS's class name.

### The run recorder

Four screenshots of a failing run arrived carrying nothing but a count. The
reasons existed on every job the whole time; they were scattered across job
objects and a per-tab console buffer that dies with the page, so the only
question that matters after a bulk run — *which* ATS is failing, *how*, and
*how often* — had no answer.

`ua-diagnostics.js` runs in the service worker and is written to by every tab.
It survives navigations, tab closes and worker restarts. **🩺 Diagnostics** in
the Queue Manager copies and downloads the whole thing.

It records **every outcome, not just failures** — "12 failed" means nothing
without the number that got through — and reports five sections:

1. **Outcomes by ATS**, with a success rate. A skip is excluded from the
   denominator; it was never attempted.
2. **Boards with trouble** — the employer's *full* hostname, because
   `careers-amd.icims.com` and `careers-xyz.icims.com` are different walls, and
   a platform that averages fine can still have a board that never works.
3. **What went wrong**, counted, worst platform first.
4. **Required questions left unanswered** — the exact wording of every question
   the filler had no answer for. The most actionable section in the file.
5. **Recent events** — the stage-by-stage trail through one job.

Two layers keep it a fixed size: an aggregate that grows with the number of
*distinct problems*, never with the size of a run (2,000 identical failures are
one row), and a capped ring of recent events. Writes are serialised, because a
dozen job tabs incrementing a shared counter lose increments otherwise — and a
recorder that quietly undercounts is worse than none.

**It never records a field's value.** Question labels yes, answers never: a
report that carries what you typed is a copy of your personal data going
wherever the report goes.

Instrumentation sits on `saveQ`, the one function all eight terminal-status
paths funnel through, rather than on each of them — covering seven of eight is
how you end up trusting a wrong number.

While wiring it up: `fillReport()` read `getMissingRequired()`'s return as
elements, but it returns label **strings**, so every entry collapsed to
`(unlabelled)` — the one line meant to name the blocking question had been
naming nothing.

### A driver that could never have run

A second, older `smartRecruitersAutomation` was sitting in this file. JavaScript
lets a later `function f(){}` silently replace an earlier one in the same scope
— no error, no warning — so one of the two never ran, and an edit made to the
wrong copy would have done nothing with no way to tell why.

It happened to be the dead one that was stale, so it cost nothing this time. Had
the order been reversed, every SmartRecruiters job would have run the naive
driver and no amount of reading the shadow-aware code would have explained it.
Deleted, and `tests/references.test.js` now fails on any such pair — scope-aware,
since the same helper name in two separate IIFEs is fine and deliberate.

### "Cover Letter is required."

Greenhouse reported this in red on a form the pass believed it had finished. A
required cover letter is not a text box — it is an upload widget with Attach /
Google Drive / **Enter manually** beside it, so nothing that fills textareas
touched it and nothing that attaches the CV recognised it either.

Two ways to satisfy one, in order of how much the employer will like the result:
open the **Enter manually** box and write a letter addressed to them, or failing
that synthesise a `.txt` and attach it — every one of these widgets lists txt
among its accepted types. Only ever when it is **required**; an optional cover
letter is still left alone, because a generic one nobody asked for is worse than
none.

### Dropdowns that are not comboboxes

Comeet renders a Bootstrap dropdown — `a.dropdown-toggle` over
`ul.dropdown-menu > li > a` — with no ARIA roles at all. Neither the discovery
selector nor the option reader matched one, so every Comeet dropdown sat on its
placeholder. Both now cover it.

And some "dropdowns" are only a costume: a nice-select-style wrapper over a real
`<select>`. Driving the costume means synthesising clicks on rows that merely
mirror the control; the `<select>` is set directly instead, matched on option
**text** (the answer is "5-10 years", not whatever value the page uses) and
confirmed against the control afterwards — `setSelectValue` reports success
unconditionally, so trusting it would claim a select it never set.

### Workday: never reaching the form, then never getting past the account step

Two reports, both Workday.

**An NXP job description sat with its Apply button unpressed.** Three reasons,
all in the driver's first phase. It used `$`/`$$` — `document.querySelector` —
which stops at a shadow boundary, while every other driver had long since moved
to the deep finders. Its selector list was two automation-ids out of date
(Workday's current job page uses `adventureButton`). And it clicked, slept two
seconds, and carried on regardless, so when the click did not take, everything
after it ran against the job description. It now looks across shadow roots,
knows the current ids, waits for the page to actually change, and retries — and
says so when Apply leads nowhere instead of dying quietly.

**A Ciena sign-in page had email and password filled and Sign In never pressed
— "just keeps re-autofilling".** The Create Account branch deadlocked itself:
the fill pass deliberately skips marketing opt-ins, and the submit gate below it
demanded that *every* visible checkbox be ticked. One marketing box and the form
could never satisfy its own gate — never submitted, pass runs again, refills,
waits again, forever. The gate now asks only about the boxes we are responsible
for: required ones and genuine consent.

The account watcher had a second bug in the same area. It is armed for a manager
job, but its guard only knew about the Fully Automated toggle and the single-tab
runner — so in **Queue Manager mode** it woke every 1.5s, decided it was not
wanted, and did nothing. The account step was never handled in exactly the mode
that runs hundreds of jobs.

### A consent banner is a click blocker

Ciena's page carried a cookie banner across the top of the form. These are
fixed-position with a high z-index, so a real click on anything underneath lands
on the banner instead and every step afterwards appears to do nothing. It is
dismissed before anything else is clicked — Accept rather than Decline, since
Decline opens a preferences dialog on some implementations, which is a second
and larger blocker. The button must sit inside something that reads as a consent
banner, because "OK" and "Continue" are everywhere and pressing the wrong one
submits the application.

### Workable and iCIMS: the form was in a frame nothing could see

Both were reported skipping, and both are named in the orchestrator's own
comment as ATS that put the application in a **cross-origin iframe**. The worker
could already inject this script into those frames — `injectAllFrames` has been
there all along. Only the Queue Manager ever asked it to.

So the same job could be applied to in one mode and skipped in the other. The
single-tab runner and the Fully Automated path now ask too, via a
`UA_INJECT_FRAMES` message the worker answers for the sender's own tab, once per
document.

The iCIMS driver had literally detected the iframe, logged that it could not
reach into one, and carried on against a top document with no form in it. It now
asks for the frames, asks again after Apply navigates (new document, new
frames), and hands its account wall — the `/jobs/<id>/login` route, which is what
"iCIMS requires signup" means — to the shared handler rather than a second copy
of that logic.

Workable was routed by **host only**, so a board white-labelled onto an
employer's domain fell through to the generic path while Workday, Greenhouse and
the rest accepted the DOM fingerprint. Its fields were also read with
`document.querySelector`, which does not cross a boundary.

### "Autofill jitters, scrolls up and down super fast"

`inView` demanded that a control be **entirely** inside the viewport. On a real
form that is almost never true — a tall fieldset, a control at the top edge, a
radio group straddling the fold all failed it — so nearly every click scrolled,
a pass with twenty controls scrolled twenty times, and the passes repeat.

Being visible enough to click is the actual question, so any overlap with the
viewport now counts, plus a 25% margin. On top of that, scrolls are rate-limited
to one per 400ms: a click does not need the element on screen (synthetic events
carry no coordinates and `el.click()` works off-screen), so scrolling is a
courtesy — skipping one costs nothing, doing forty a second costs the page.

Suite total: **1,287 assertions**, all green on Jobright 1.23.0.

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

### Importing

Both import surfaces take a **drag and drop** as well as the file picker:

- **Queue Manager panel** — drop a CSV anywhere on the panel.
- **⚡ Bulk Auto-Apply card** (in Jobright's own sidebar) — drop onto the dashed
  strip under the buttons, or anywhere on the card.

Dropped **text** works too, so a column of links dragged out of a spreadsheet or an
email goes straight in. Multiple files at once are fine, from either the picker or
a drop.

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
