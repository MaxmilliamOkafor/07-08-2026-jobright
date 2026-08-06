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
├── csv-parsers.test.js         content-script CSV/URL parsing
├── queue-panel.test.js         panel CSV import behaviour
└── orchestrator.test.js        queue engine against a simulated chrome.*
```

## Tests

```bash
./tests/run.sh
```

114 assertions, no browser required: JS syntax for everything shipped, manifest
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
