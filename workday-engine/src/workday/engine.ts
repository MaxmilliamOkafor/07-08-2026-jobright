/**
 * The Workday autopilot state machine (content script):
 *
 *   WAIT_STABLE → DETECT_PAGE → HANDLE → (NEXT → WAIT_TRANSITION → FIX_ERRORS)* → … → REVIEW (stop)
 *
 * State is persisted per tenant so a full page reload (sign-in, session
 * timeout) resumes where it left off. The engine never clicks Submit —
 * unless a host sets hooks.autoSubmit for an unattended run ([oh] marks those
 * additions; see ohHooks.ts).
 */
import { Aborted, NeedsHuman, byAid, humanClick, isVisible, labelOf, qa, setAbort, sleep, text, waitFor, waitStable } from "./dom.js";
import { enableTrustedFallback, readValue } from "./controls.js";
import { activeStepName, detectPage, errorMessages, isSubmitButton, jobKeyFor, nextButton, reqIdFromUrl, scrapeJob, tenantHost } from "./detect.js";
import { APPLY_TEXT_RX } from "./i18n.js";
import { handleCreateAccount, handleSignIn } from "./auth.js";
import { addFlag, pickCv, type Ctx } from "./context.js";
import {
  fixFieldFromError,
  genericFill,
  highlightSubmit,
  myExperience,
  myInformation,
  resetHandled,
  resumeUpload,
  reviewDiff,
  selfIdentify,
  voluntaryDisclosures,
} from "./steps.js";
import {
  getDocs,
  getJob,
  getLastJobKey,
  getMasterCv,
  getProfile,
  getRun,
  getWdSettings,
  recordApplication,
  rememberAnswer,
  saveJob,
  saveRun,
} from "./store.js";
import { SENSITIVE_RX } from "./answers.js";
import type { JobPosting, PageKind, RunState } from "./types.js";
import { renderOverlay, setOverlayHandlers } from "./overlay.js";
import { hooks } from "./ohHooks.js";

let active = false;
let submitWatcher: number | undefined;

function newRun(host: string, jobKey: string | null): RunState {
  return {
    tenantHost: host,
    jobKey,
    status: "running",
    page: "unknown",
    attempts: 0,
    done: [],
    flags: [],
    llmFilled: [],
    log: [],
    authAttempts: 0,
    createAttempts: 0,
    updatedAt: Date.now(),
  };
}

function broadcast(run: RunState) {
  chrome.runtime.sendMessage({ type: "wd:progress", state: run }).catch(() => {});
  renderOverlay(run);
}

function notify(title: string, message: string) {
  chrome.runtime.sendMessage({ type: "wd:notify", title, message }).catch(() => {});
}

async function resolveJob(run: RunState): Promise<JobPosting | null> {
  const host = tenantHost();
  const fromPage = scrapeJob();
  if (fromPage) {
    const existing = await getJob(fromPage.key);
    if (!existing) await saveJob(fromPage);
    run.jobKey = fromPage.key;
    return existing ?? fromPage;
  }
  const reqId = reqIdFromUrl();
  const keys = [run.jobKey, reqId ? jobKeyFor(host, reqId) : null, await getLastJobKey(host)].filter(Boolean) as string[];
  for (const k of keys) {
    const j = await getJob(k);
    if (j) {
      run.jobKey = j.key;
      return j;
    }
  }
  return null;
}

async function buildCtx(run: RunState): Promise<Ctx> {
  const [profile, settings, masterCv] = await Promise.all([
    hooks.profile ? hooks.profile() : getProfile(), // [oh]
    hooks.settings ? hooks.settings() : getWdSettings(),
    hooks.masterCv ? hooks.masterCv() : getMasterCv(),
  ]);
  enableTrustedFallback(settings.trustedInputFallback);
  const job = await resolveJob(run);
  const docs = job ? (await getDocs(job.key)) ?? null : null;
  const ctx: Ctx = {
    profile,
    settings,
    job,
    docs,
    masterCv,
    run,
    page: run.page,
    log(msg, level = "info") {
      run.log.push({ at: Date.now(), level, msg });
      broadcast(run);
    },
    flag(label, reason) {
      addFlag(run, { label, reason, page: ctx.page });
      run.log.push({ at: Date.now(), level: "warn", msg: `Needs you: ${label} — ${reason}` });
      broadcast(run);
    },
    async llm(system, prompt) {
      const r = (await chrome.runtime.sendMessage({ type: "wd:llm", system, prompt, json: true, maxTokens: 600 })) as
        | { ok: true; text: string }
        | { ok: false; error: string };
      if (!r?.ok) throw new Error(r ? r.error : "LLM unavailable");
      return r.text;
    },
    async save() {
      await saveRun(run);
      broadcast(run);
    },
  };
  return ctx;
}

type StepResult = "next" | "continue" | "stop";

async function clickNext(ctx: Ctx): Promise<StepResult> {
  const btn = nextButton();
  if (!btn) throw new NeedsHuman("Couldn't find the Next / Save and Continue button.");
  if (isSubmitButton(btn)) return "stop";
  const before = `${activeStepName()}|${detectPage()}`;
  await humanClick(btn);
  await sleep(500);
  const outcome = await waitFor(
    () => {
      if (errorMessages().length) return "error";
      const now = `${activeStepName()}|${detectPage()}`;
      return now !== before ? "moved" : null;
    },
    20000,
    200
  ).catch(() => "timeout" as const);

  if (outcome === "moved") return "next";
  ctx.run.attempts++;
  if (outcome === "error") {
    const errs = errorMessages();
    ctx.log(`Workday reported ${errs.length} error(s): ${errs.map((e) => e.text).join(" | ").slice(0, 300)}`, "warn");
    if (ctx.run.attempts > 2) throw new NeedsHuman(`Fix these and click Resume: ${errs.map((e) => e.text).join("; ").slice(0, 400)}`);
    resetHandled();
    for (const e of errs) if (e.el.matches("button, a, [role='button'], li")) await fixFieldFromError(ctx, e.el).catch(() => false);
    return "continue";
  }
  if (ctx.run.attempts > 3) throw new NeedsHuman("The page didn't advance after Next. Check for unanswered fields, then click Resume.");
  return "continue";
}

function requiredFlagsHere(ctx: Ctx) {
  return ctx.run.flags.filter((f) => f.page === ctx.page);
}

/** [oh] Assist mode: the page on screen is filled; Next is yours. */
function pageFilled(ctx: Ctx): StepResult {
  ctx.run.status = "filled";
  ctx.run.pauseReason = undefined;
  ctx.log("Page filled — check it, then continue");
  void ctx.save();
  return "stop";
}

async function fillAndNext(ctx: Ctx, handler?: (c: Ctx) => Promise<void>): Promise<StepResult> {
  if (handler) await handler(ctx);
  await genericFill(ctx);
  await ctx.save();
  const flags = requiredFlagsHere(ctx);
  if (hooks.advance && !hooks.advance() && !flags.length) return pageFilled(ctx); // [oh]
  if (flags.length) {
    throw new NeedsHuman(`Answer ${flags.length} field(s) on this page, then click Resume: ${flags.map((f) => f.label).join(", ").slice(0, 300)}`);
  }
  return clickNext(ctx);
}

async function waitForExternalDocs(ctx: Ctx) {
  if (!ctx.job || ctx.docs || !ctx.settings.externalAutoRequest || !ctx.settings.externalTailorUrl) return;
  ctx.log("Waiting for your tailoring tool to return documents…");
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const d = await getDocs(ctx.job.key);
    if (d) {
      ctx.docs = d;
      ctx.log(`Documents received (${d.cv.fileName})`);
      return;
    }
    await sleep(1500);
  }
  ctx.log("Tailoring tool didn't respond in 90 s — continuing with the fallback CV", "warn");
}

/** [oh] Pages assist mode fills; on the rest (posting, sign-in, Review…) it does nothing. */
const ASSIST_PAGES: PageKind[] = ["resumeUpload", "myInformation", "myExperience", "questions", "voluntaryDisclosures", "selfIdentify"];

async function handlePage(ctx: Ctx, page: PageKind): Promise<StepResult> {
  if (hooks.advance && !hooks.advance() && !ASSIST_PAGES.includes(page)) return "stop"; // [oh]
  switch (page) {
    case "jobPosting": {
      if (ctx.job) chrome.runtime.sendMessage({ type: "wd:jobCaptured", job: ctx.job }).catch(() => {});
      await waitForExternalDocs(ctx);
      const apply = byAid("applyButton") ?? qa("a, button").find((b) => isVisible(b) && APPLY_TEXT_RX.test(text(b))) ?? null;
      if (!apply) throw new NeedsHuman("No Apply button on this posting (it may be closed).");
      ctx.log(`Applying: ${ctx.job?.title ?? "job"}`);
      await humanClick(apply);
      await waitStable(600);
      return "next";
    }
    case "applyMethod": {
      await waitForExternalDocs(ctx);
      const hasCv = !!pickCv(ctx);
      const btn = (hasCv && byAid("autofillWithResume")) || byAid("applyManually") || byAid("autofillWithResume");
      if (!btn) throw new NeedsHuman("Choose how to apply, then click Resume.");
      ctx.log(hasCv ? "Apply method: Autofill with Resume (tailored CV)" : "Apply method: Apply Manually");
      await humanClick(btn);
      await waitStable(600);
      return "next";
    }
    case "signIn":
      await handleSignIn(ctx);
      return "continue";
    case "createAccount":
      await handleCreateAccount(ctx);
      return "continue";
    case "verifyEmail":
      throw new NeedsHuman("Verify your email using the link Workday sent, sign in if asked, then click Resume.");
    case "resumeUpload":
      await resumeUpload(ctx);
      if (hooks.advance && !hooks.advance()) return pageFilled(ctx); // [oh]
      return clickNext(ctx);
    case "myInformation":
      return fillAndNext(ctx, myInformation);
    case "myExperience":
      return fillAndNext(ctx, myExperience);
    case "questions":
      return fillAndNext(ctx);
    case "voluntaryDisclosures":
      return fillAndNext(ctx, voluntaryDisclosures);
    case "selfIdentify":
      return fillAndNext(ctx, selfIdentify);
    case "review": {
      const missing = reviewDiff(ctx);
      if (missing.length) ctx.log(`Not visible on Review (check): ${missing.join(", ")}`, "warn");
      if (ctx.run.llmFilled.length) ctx.log(`AI-answered (please check): ${ctx.run.llmFilled.map((x) => x.label).join("; ")}`, "warn");
      const btn = nextButton();
      if (hooks.autoSubmit?.() && btn && isSubmitButton(btn)) return submitApplication(ctx, btn); // [oh]
      if (btn) highlightSubmit(btn);
      ctx.run.status = "review";
      ctx.run.pauseReason = "Review everything, then click Submit yourself.";
      await ctx.save();
      notify("Workday application ready", `${ctx.job?.title ?? "Application"} is filled — review and click Submit.`);
      watchForSubmission();
      hooks.onFinish?.(ctx.run, "review"); // [oh]
      return "stop";
    }
    case "submitted":
      await markSubmitted(ctx.run);
      return "stop";
    case "candidateHome":
      throw new NeedsHuman("You're on your candidate home page. Open the job (or the draft under My Applications), then click Resume.");
    default:
      ctx.run.attempts++;
      if (ctx.run.attempts > 5) throw new NeedsHuman("Unrecognised page. Move to the next step yourself, then click Resume.");
      await sleep(1500);
      return "continue";
  }
}

async function loop(run: RunState) {
  if (active) return;
  active = true;
  setAbort(false);
  const ctx = await buildCtx(run);
  try {
    for (let iter = 0; iter < 120; iter++) {
      await waitStable();
      const page = detectPage();
      if (page !== run.page) {
        if (run.page !== "unknown" && !run.done.includes(run.page)) run.done.push(run.page);
        run.page = page;
        run.attempts = 0;
        resetHandled();
        run.flags = run.flags.filter((f) => f.page !== page);
        ctx.log(`Page: ${page}${activeStepName() ? ` (${activeStepName()})` : ""}`);
        hooks.onPage?.(run); // [oh]
      }
      ctx.page = page;
      await ctx.save();
      const r = await handlePage(ctx, page);
      if (r === "stop") return;
    }
    throw new NeedsHuman("Stopped after too many steps — check the page, then click Resume.");
  } catch (err) {
    if (err instanceof Aborted) {
      run.status = "idle";
      run.pauseReason = undefined;
      ctx.log("Stopped");
    } else if (err instanceof NeedsHuman) {
      run.status = "paused";
      run.pauseReason = err.reason;
      ctx.log(`Paused: ${err.reason}`, "warn");
      notify("Workday autopilot needs you", err.reason);
    } else {
      run.status = "error";
      run.pauseReason = (err as Error).message;
      ctx.log(`Error: ${(err as Error).message}`, "error");
    }
    await saveRun(run);
    broadcast(run);
    hooks.onFinish?.(run, run.status === "paused" ? "paused" : run.status === "error" ? "error" : "stopped"); // [oh]
  } finally {
    active = false;
  }
}

/** [oh] Unattended runs: press Submit and wait for Workday's confirmation. */
async function submitApplication(ctx: Ctx, btn: HTMLElement): Promise<StepResult> {
  ctx.log("Submitting the application");
  await humanClick(btn);
  await sleep(500);
  const outcome = await waitFor(() => (detectPage() === "submitted" ? "done" : errorMessages().length ? "error" : null), 30000, 250).catch(
    () => "timeout" as const
  );
  // Gone from Review with no error shown: Workday took it, whatever page it shows next.
  if (outcome === "done" || (outcome === "timeout" && detectPage() !== "review" && !errorMessages().length)) {
    await markSubmitted(ctx.run);
    return "stop";
  }
  ctx.run.attempts++;
  const errs = errorMessages().map((e) => e.text);
  ctx.log(`Submit didn't go through${errs.length ? `: ${errs.join(" | ").slice(0, 300)}` : " (no confirmation yet)"}`, "warn");
  if (ctx.run.attempts > 2) throw new NeedsHuman(`Submit didn't go through: ${errs.join("; ").slice(0, 400) || "no confirmation from Workday"}`);
  return "continue";
}

async function markSubmitted(run: RunState) {
  if (run.status === "done") return;
  const job = run.jobKey ? await getJob(run.jobKey) : null;
  const docs = run.jobKey ? await getDocs(run.jobKey) : null;
  await recordApplication({
    jobKey: run.jobKey ?? `${run.tenantHost}|unknown`,
    tenantHost: run.tenantHost,
    reqId: job?.reqId ?? "",
    title: job?.title ?? document.title,
    submittedAt: Date.now(),
    cvFile: docs?.cv.fileName,
    coverLetterFile: docs?.coverLetter?.fileName,
    url: job?.url ?? location.href,
  });
  run.status = "done";
  run.pauseReason = undefined;
  run.log.push({ at: Date.now(), level: "info", msg: "Application submitted — logged to your tracker" });
  await saveRun(run);
  broadcast(run);
  notify("Application submitted", job?.title ?? "Workday application");
  hooks.onFinish?.(run, "submitted"); // [oh]
}

function watchForSubmission() {
  if (submitWatcher) return;
  submitWatcher = window.setInterval(async () => {
    if (detectPage() !== "submitted") return;
    window.clearInterval(submitWatcher);
    submitWatcher = undefined;
    const run = await getRun(tenantHost());
    if (run) await markSubmitted(run);
  }, 1500);
}

/* ---------------- public API (content-script messages) ---------------- */

export async function startRun(jobKey?: string | null) {
  const host = tenantHost();
  const run = newRun(host, jobKey ?? null);
  await saveRun(run);
  void loop(run);
  return run;
}

/** Continue after the user fixed things; saves their answers to flagged fields. */
export async function resumeRun() {
  const host = tenantHost();
  const run = (await getRun(host)) ?? newRun(host, null);
  for (const f of run.flags) {
    const c = qa('[data-automation-id^="formField-"]').find((x) => isVisible(x) && labelOf(x) === f.label);
    const v = c ? readValue(c) : "";
    if (v && !/date|resume|cv|file/i.test(f.label)) {
      await rememberAnswer(f.label, v);
      run.log.push({ at: Date.now(), level: "info", msg: `Saved your answer for "${f.label}"${SENSITIVE_RX.test(f.label) ? " (sensitive — reused only for this exact question)" : ""}` });
    }
  }
  run.flags = [];
  run.status = "running";
  run.pauseReason = undefined;
  run.attempts = 0;
  if (detectPage() === "signIn" || detectPage() === "createAccount") {
    run.authAttempts = 0;
    run.createAttempts = 0;
  }
  resetHandled();
  await saveRun(run);
  void loop(run);
  return run;
}

export async function stopRun() {
  setAbort(true);
  const run = await getRun(tenantHost());
  if (run && !active) {
    run.status = "idle";
    await saveRun(run);
    broadcast(run);
  }
}

/** On page load: continue a run interrupted by a reload; watch for submission. */
export async function autoResume() {
  const run = await getRun(tenantHost());
  if (!run) return;
  renderOverlay(run);
  if (run.status === "review") watchForSubmission();
  if (run.status === "running" && Date.now() - run.updatedAt < 30 * 60_000) {
    await waitStable(800);
    void loop(run);
  }
}

setOverlayHandlers({ resume: () => void resumeRun(), stop: () => void stopRun() });

export function isActive() {
  return active;
}
