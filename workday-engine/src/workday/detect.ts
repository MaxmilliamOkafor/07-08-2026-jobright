/**
 * Tenant, job and page detection. Pages are identified by what is on screen,
 * never by step number, because each tenant configures its own steps.
 */
import { anyAid, byAid, isVisible, q, qa, text } from "./dom.js";
import { sel, type AidKey } from "./selectors.js";
import type { JobPosting, PageKind } from "./types.js";
import { NEXT_TEXT_RX, STEP_PATTERNS, SUBMIT_RX, SUBMITTED_RX, VERIFY_EMAIL_RX, detectLanguage, urlLanguage } from "./i18n.js";

const WORKDAY_HOST_RX = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday|workdayjobs)\.com$/i;

export function isWorkdayHost(host = location.hostname): boolean {
  return WORKDAY_HOST_RX.test(host);
}

/** True when the Workday candidate app has rendered in this frame. */
export function hasWorkdayApp(): boolean {
  return !!document.querySelector("[data-automation-id]");
}

export function tenantHost(): string {
  return location.hostname.toLowerCase();
}

/** Career site name from the path, e.g. /en-US/External/job/... → External. */
export function siteName(path = location.pathname): string {
  const parts = path.split("/").filter(Boolean);
  const i = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0] ?? "") ? 1 : 0;
  return parts[i] ?? "";
}

/** Requisition id from a Workday URL (…/Software-Engineer_R-12345/apply). */
export function reqIdFromUrl(path = location.pathname): string {
  const m = path.match(/_([A-Za-z]{0,6}-?\d[\w-]*)(?=\/|$)/);
  return m ? m[1] : "";
}

export function jobKeyFor(host: string, reqId: string): string {
  return `${host}|${reqId}`;
}

export function nextButton(): HTMLElement | null {
  return (
    byAid("next") ??
    qa("footer button, [data-automation-id*='footer'] button").find(
      (b) => isVisible(b) && (NEXT_TEXT_RX.test(text(b)) || SUBMIT_RX.test(text(b)))
    ) ??
    null
  );
}

export function activeStepName(): string {
  const s = byAid("progressActive");
  if (s) return text(s);
  const cur = qa('[aria-current="step"]').find(isVisible);
  return text(cur);
}

function heading(): string {
  const h = byAid("pageHeader") ?? qa("main h2, main h1, h2, h1").find(isVisible) ?? null;
  return text(h);
}

const STEP_RX = STEP_PATTERNS as [RegExp, PageKind][];

/** True when this button is the final Submit (any supported language). */
export function isSubmitButton(btn: HTMLElement | null): boolean {
  return !!btn && SUBMIT_RX.test(text(btn) || btn.getAttribute("aria-label") || "");
}

function classifyStep(name: string): PageKind | null {
  for (const [rx, kind] of STEP_RX) if (rx.test(name)) return kind;
  return null;
}

export function detectPage(): PageKind {
  const body = text(document.body).slice(0, 5000);
  const next = nextButton();

  if (SUBMITTED_RX.test(body) && !next)
    return "submitted";

  if (anyAid("verifyPassword") || anyAid("createAccountSubmit")) return "createAccount";
  if (anyAid("signInSubmit") || (anyAid("password") && anyAid("email"))) return "signIn";
  if (anyAid("signInWithEmail") && !anyAid("progressActive")) return "signIn";
  if (VERIFY_EMAIL_RX.test(body) && !anyAid("password") && !next)
    return "verifyEmail";
  if (anyAid("autofillWithResume") || anyAid("applyManually")) return "applyMethod";

  // [oh] Workday's own page containers name the step whatever the tenant calls it.
  const PAGES: [AidKey, PageKind][] = [
    ["pageReview", "review"], ["pageSelfId", "selfIdentify"], ["pageVoluntary", "voluntaryDisclosures"],
    ["pageQuestions", "questions"], ["pageMyExp", "myExperience"], ["pageMyInfo", "myInformation"], ["pageAutofill", "resumeUpload"],
  ];
  for (const [key, kind] of PAGES) if (anyAid(key)) return kind;

  const step = activeStepName();
  if (step) {
    if (isSubmitButton(next)) return "review";
    const kind = classifyStep(step);
    if (kind) return kind;
  }

  // Autofill-with-resume upload screen precedes the wizard and has no progress bar.
  if (!step && anyAid("fileInput") && (/autofill|upload (your )?(resume|cv)|quick apply|resume\/cv|lebenslauf|curriculum|currículo|cv/i.test(body) || !qa('[data-automation-id^="formField-"]').some(isVisible)))
    return "resumeUpload";

  const h = heading();
  const byHeading = h ? classifyStep(h) : null;
  if (byHeading && (next || byHeading === "review")) return byHeading;

  // Fingerprints for renamed steps.
  if (anyAid("firstName") || anyAid("address1") || anyAid("phoneNumber")) return "myInformation";
  if (anyAid("workSection") || anyAid("eduSection") || anyAid("skills")) return "myExperience";
  if (anyAid("gender") || anyAid("ethnicity") || anyAid("veteran") || anyAid("agreement")) return "voluntaryDisclosures";
  if (anyAid("disability") || anyAid("selfIdDate")) return "selfIdentify";
  if (anyAid("questionnaire")) return "questions";
  if (isSubmitButton(next)) return "review";
  if (next && qa('[data-automation-id^="formField-"]').some(isVisible)) return "questions";

  if (anyAid("applyButton") || anyAid("jobDescription")) return "jobPosting";
  if (anyAid("candidateHome")) return "candidateHome";
  return "unknown";
}

/** Scrape the job posting on the current page. */
export function scrapeJob(): JobPosting | null {
  const descEl = byAid("jobDescription");
  if (!descEl) return null;
  const host = tenantHost();
  let reqId = reqIdFromUrl();
  const reqText = text(byAid("jobReqId"));
  if (!reqId && reqText) reqId = (reqText.match(/[A-Za-z]{0,6}-?\d[\w-]*\s*$/)?.[0] ?? reqText).trim();
  if (!reqId) reqId = location.pathname.split("/").filter(Boolean).pop() ?? "unknown";
  const title = text(byAid("jobTitle")) || text(q("h2")) || document.title;
  const locEl = byAid("jobLocation");
  const description = (descEl.innerText || text(descEl)).slice(0, 20000);
  return {
    key: jobKeyFor(host, reqId),
    tenantHost: host,
    site: siteName(),
    reqId,
    title,
    location: text(locEl).replace(/^(locations?|standorte?|lieux?|ubicaci[oó]n(es)?|localiza[cç][aã]o|sede|sedi|locaties?|lokalizacj[ae])\s*/iu, ""),
    description,
    language: detectLanguage(description) || urlLanguage(location.pathname) || "en",
    url: location.href.replace(/\/apply.*$/, ""),
    capturedAt: Date.now(),
  };
}

export function errorMessages(): { text: string; el: HTMLElement }[] {
  const out: { text: string; el: HTMLElement }[] = [];
  const banner = byAid("errorBanner");
  if (banner) {
    for (const b of qa("button, a, li", banner)) {
      const t = text(b);
      if (t && !out.some((o) => o.text === t)) out.push({ text: t, el: b });
    }
    if (!out.length && text(banner)) out.push({ text: text(banner), el: banner });
  }
  for (const e of qa(sel("errorMessage")).filter(isVisible)) {
    const t = text(e);
    if (t && !out.some((o) => o.text === t)) out.push({ text: t, el: e });
  }
  return out;
}
