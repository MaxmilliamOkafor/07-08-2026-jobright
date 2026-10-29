/// <reference types="chrome" />
/**
 * Jobright (UA) adapter for your Workday engine — a content script on Workday
 * hosts, built to "AAAA - Jobright Autofill/ua-wd-engine.js".
 *
 * The engine itself (src/workday, src/cv) is copied unchanged from
 * optimhire-updates/workday-engine (branch claude/jolly-fermat-8VrR3); this
 * file is the only part written for this extension. It shares the content-
 * script world with ua-enhancement.js, which talks to it through
 * window.__uaWdEngine:
 *
 *   • A queue job on a Workday tab (CSV runner or Queue Manager):
 *     ua-enhancement calls startJob(key) and waits for result(key). The engine
 *     signs in / creates the account (your shared ATS password), uploads your
 *     CV, fills every step, answers questions (your remembered answers first,
 *     then its profile rules) and presses Submit. Anything it can't finish
 *     ("paused", "error", "review") goes back to ua-enhancement's own Workday
 *     flow, which carries on from where the engine stopped.
 *
 *   • Assist (SpeedyApply-style), when Fully Automated is on outside a run:
 *     ua-enhancement calls allowAssist(); each step is then filled the moment
 *     it appears — once, so going Back never refills over your edits — and
 *     nothing is pressed for you: you check, edit and press Save and Continue.
 *     On Review it submits after a 5-second countdown you can cancel.
 *     Fully Automated off (ua_aa), "ua_wd_assist: false" or
 *     "ua_wd_engine_off: true" turns assist off at once.
 *
 *   • Your work history from your CV when the profile has none: the CV saved in
 *     the extension (PDF or .docx) is read once by ua-wd-cvtext.js (pdf.js,
 *     loaded into the tab only then) and its roles, education, skills and
 *     languages go into My Experience.
 *
 * The engine's own messages (wd:cred:*, wd:progress …) are answered here, in
 * the page, from chrome.storage.local — the service worker never sees them.
 */
import { autoResume, isActive, startRun, stopRun } from "../workday/engine.js";
import { activeStepName, detectPage, hasWorkdayApp, isWorkdayHost, tenantHost } from "../workday/detect.js";
import { getProfile as getEngineProfile, normalizeProfile } from "../workday/store.js";
import { setHooks, type Outcome } from "../workday/ohHooks.js";
import { setDate, type ControlKind } from "../workday/controls.js";
import { SENSITIVE_RX } from "../workday/answers.js";
import { DEFAULT_WD_SETTINGS, type PageKind, type Profile, type RunState, type StoredDoc, type WorkdaySettings } from "../workday/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

const TOP = window.top === window.self;
const ST = chrome.storage.local;
const MODE_KEY = "uaWdRun";              // sessionStorage: this tab's engine job (survives reloads)
const RESULT_KEY = "uaWdResult";         // sessionStorage: the last job's outcome, for ua-enhancement
const MODE_TTL = 20 * 60_000;
const LOG_KEY = "ua_wd_engine_log";      // last runs, for diagnostics
const LOGIN_KEY = "ua_wd_login";         // which Workday sites have an account with the shared password
const CV_KEY = "ua_wd_cv_profile";       // roles / education / skills read from your CV

interface Mode {
  queue: boolean;       // a queue job: ua-enhancement waits for the result
  submit: boolean;      // press Submit on Review
  assist?: boolean;     // fill the step on screen only; you press Next
  startedAt: number;
  jobId: string;
}

const say = (msg: string) => {
  console.info(`[UA][WD-Engine] ${msg}`);
  // Into the job's record too (the Debugger page shows it in the timeline).
  try { (window as unknown as { __uaJrLine?: (k: string, m: string) => void }).__uaJrLine?.("engine", msg); } catch { /* */ }
};
let logShown = 0;                        // engine log lines already printed (per run)
const W = window as Any;

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/* ---------------- this tab's job ---------------- */

function readMode(): Mode | null {
  try {
    const m = JSON.parse(sessionStorage.getItem(MODE_KEY) || "null") as Mode | null;
    return m && Date.now() - m.startedAt < MODE_TTL ? m : null;
  } catch {
    return null;
  }
}
function writeMode(m: Mode) {
  try { sessionStorage.setItem(MODE_KEY, JSON.stringify(m)); } catch { /* storage blocked */ }
}
function clearMode() {
  try { sessionStorage.removeItem(MODE_KEY); } catch { /* storage blocked */ }
}
function readResult(jobId: string): Any | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null");
    return r && r.jobId === jobId ? r : null;
  } catch {
    return null;
  }
}
function writeResult(r: Any) {
  try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(r)); } catch { /* storage blocked */ }
}

/* Assist: only where ua-enhancement would otherwise have run Fully Automated
   on this page (it calls allowAssist), and only while the switches allow it. */
let assistAllowed = false;
let assistSwitch = false;
const ASSIST_KEYS = ["ua_aa", "ua_wd_assist", "ua_wd_engine_off"];
function readAssist() {
  ST.get(ASSIST_KEYS).then((d) => {
    assistSwitch = d.ua_aa === true && d.ua_wd_assist !== false && d.ua_wd_engine_off !== true;
    if (!assistSwitch && isActive() && !readMode()) void stopRun();      // switched off mid-step
  }, () => {});
}
readAssist();
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && ASSIST_KEYS.some((k) => k in c)) readAssist();
});
const assistOn = () => assistAllowed && assistSwitch;

/* ---------------- the engine's own messages, answered here ---------------- */

function makePassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(12));
  return "Ua" + Array.from(r, (n) => abc[n % abc.length]).join("") + "!7q";
}

/** One e-mail + password for every Workday site: the extension's shared ATS
 *  password (ua_app_password), else Jobright's Workday password, else a new one (kept). */
/* The site key ua-enhancement uses (acme.wd3.myworkdayjobs.com → acme.myworkdayjobs.com). */
function siteKey(host = location.hostname): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.wd\d+\./, ".").replace(/\.myworkdaysite\.com$/, ".myworkdayjobs.com");
}

async function workdayLogin(): Promise<{ email: string; password: string; login: Any }> {
  const d = await ST.get([LOGIN_KEY, "ua_app_password", "ua_app_email", "WORKDAY_SIGNUP_INFORMATION", "ua_ats_logins", "ua_wd_site_pw"]);
  const login: Any = Object.assign({ sites: {} }, d[LOGIN_KEY] || {});
  const k = siteKey();
  // Your 🔐 site login for this employer, then the password that worked here before.
  const site = (d.ua_ats_logins || {})[k];
  if (site && site.email && site.password) return { email: site.email, password: site.password, login: { ...login, sites: { ...login.sites, [tenantHost()]: { state: "account" } } } };
  const known = (d.ua_wd_site_pw || {})[k];
  let password = known || d.ua_app_password || "";
  if (!password) {
    try {
      const jr = typeof d.WORKDAY_SIGNUP_INFORMATION === "string" ? JSON.parse(d.WORKDAY_SIGNUP_INFORMATION) : d.WORKDAY_SIGNUP_INFORMATION;
      password = (jr && jr.password) || "";
    } catch { /* not JSON */ }
  }
  if (!password) {
    password = makePassword();
    await ST.set({ ua_app_password: password });
  }
  const email = d.ua_app_email || (await uaProfile()).email || "";
  return { email, password, login };
}

async function noteSite(state: string) {
  try {
    const d = await ST.get(LOGIN_KEY);
    const login: Any = Object.assign({ sites: {} }, d[LOGIN_KEY] || {});
    login.sites = Object.assign({}, login.sites, { [tenantHost()]: { state, ts: Date.now() } });
    await ST.set({ [LOGIN_KEY]: login });
  } catch { /* storage unavailable */ }
}

function createTried(host: string, add = false): boolean {
  try {
    const set = new Set<string>(JSON.parse(sessionStorage.getItem("uaWdCreateTried") || "[]"));
    if (add && !set.has(host)) sessionStorage.setItem("uaWdCreateTried", JSON.stringify([...set, host]));
    return set.has(host);
  } catch {
    return add;
  }
}

async function answerWd(msg: Any): Promise<unknown> {
  switch (msg.type) {
    case "wd:cred:get": {
      const { email, password, login } = await workdayLogin();
      const host = String(msg.tenantHost || tenantHost());
      const site = (login.sites || {})[host] || {};
      const master = email && password ? { email, password } : null;
      if (site.state === "account" || site.state === "verify") return { cred: master, master };
      const page = detectPage();
      if (page === "createAccount") createTried(host, true);
      // A new site: go to Create Account first; once that found an existing account, sign in.
      if (page === "signIn" && !createTried(host)) return { cred: null, master: null };
      return { cred: null, master };
    }
    case "wd:cred:set":
      await noteSite("account");
      return { ok: true };
    case "wd:cred:generate":
      return { password: (await workdayLogin()).password };
    case "wd:trustedType":
      return { ok: false };
    case "wd:llm":
      return llmStandIn(String(msg.prompt || ""));
    case "wd:progress":
      try { W.__uaWdProgress?.(msg.state?.page || ""); } catch { /* */ }
      // The engine's own log, line by line, in the console (and so in diagnostics).
      try {
        const log: Any[] = (msg.state && msg.state.log) || [];
        for (const l of log.slice(Math.max(0, Math.min(logShown, log.length)))) say(`${l.level && l.level !== "info" ? l.level + ": " : ""}${l.msg}`);
        logShown = log.length;
      } catch { /* */ }
      return undefined;
    default:                 // wd:notify, wd:jobCaptured
      return undefined;
  }
}

/* Where the engine would ask an AI (it has no key here), this extension's own
   deciders answer instead: the same knockout logic, option matchers and
   profile rules every other ATS gets. They come after your saved answers and
   the engine's own rules, so they only fill what was left — a question the
   engine used to pause on ("Have you ever been convicted…?") is answered. */
function listIn(prompt: string): string[] {
  const m = prompt.match(/OPTIONS: (\[[\s\S]*?\])\s*(\n[A-Z]+:|$)/);
  try { return m ? (JSON.parse(m[1]) as string[]) : []; } catch { return []; }
}
async function llmStandIn(prompt: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const q = prompt.match(/^QUESTION: (.*)$/m);
    if (q && typeof W.__uaWdGuess === "function") {
      const kind = (prompt.match(/^CONTROL: (.*)$/m) || [])[1] || "text";
      const a = await W.__uaWdGuess(q[1].trim(), kind.trim(), listIn(prompt));
      if (a) return { ok: true, text: JSON.stringify({ answer: String(a), confidence: 0.8 }) };
    }
    const v = prompt.match(/^VALUE: (.*)$/m);
    if (v && typeof W.__uaWdPick === "function") {
      const field = (prompt.match(/^FIELD: (.*)$/m) || [])[1] || "";
      const o = await W.__uaWdPick(v[1].trim(), field.trim(), listIn(prompt));
      return { ok: true, text: JSON.stringify({ option: o || null }) };
    }
  } catch { /* fall through */ }
  return { ok: false, error: "no answer" };
}

/* Only the engine's own "wd:" messages are answered here; every other message
   (ua-enhancement's, Jobright's) goes to the service worker untouched. */
(function routeEngineMessages() {
  if (!TOP || !isWorkdayHost()) return;
  const rt = chrome.runtime as Any;
  const orig = rt.sendMessage.bind(rt);
  rt.sendMessage = function (msg: Any, ...rest: unknown[]) {
    if (msg && typeof msg.type === "string" && msg.type.startsWith("wd:")) return answerWd(msg);
    return orig(msg, ...rest);
  };
})();

/* ---------------- your profile ---------------- */

function parse(v: unknown): Any {
  if (typeof v === "string") {
    try { return JSON.parse(v) as Any; } catch { return {}; }
  }
  return v && typeof v === "object" ? (v as Any) : {};
}

/** Jobright's own profile (what its Autofill fills from), flattened to this
 *  extension's keys. ua-enhancement's profileFromJobright does the same; the
 *  engine runs in the same page, so it uses that when it is there. */
function jobrightProfile(raw: unknown): Any {
  const f = W.__uaJrProfile;
  if (typeof f === "function") { try { return f(raw) || {}; } catch { /* below */ } }
  const e = parse(raw);
  const pi = e.personalInfo || {}, loc = e.location || {};
  const str = (v: unknown) => (v == null || typeof v === "object" ? "" : String(v).trim());
  const cc = (str(e.phoneCountryCode).match(/\+?\s?(\d{1,4})\b/) || [])[1];
  const out: Any = {
    first_name: str(pi.firstName), last_name: str(pi.lastName), preferred_name: str(pi.preferredFirstName),
    email: str(pi.email), phone: str(pi.phone_number), phoneCountryCode: cc ? `+${cc}` : "",
    city: str(loc.city), state: str(loc.state || e.state), country: str(loc.country), postal_code: str(loc.postCode),
    address: str(e.addressLine).split(/\s*[\r\n]+\s*/)[0],
    address_line_2: str(e.addressLine).split(/\s*[\r\n]+\s*/).slice(1).filter(Boolean).join(", "),
    linkedin: str(pi.linkedin_link || pi.linkedin),
    github: str(pi.github_link || pi.github_url), website: str(pi.personal_site_link || pi.personal_site),
  };
  // Every role, not just the first: the engine adds one Work Experience per role.
  const work = (Array.isArray(e.workExperience) ? e.workExperience : []).map((w: Any) => ({
    title: str(w.job_title), company: str(w.organization), location: str(w.location),
    start_date: str(w.dates?.start_date), end_date: str(w.dates?.completion_date), is_current: !!w.dates?.is_current,
    description: Array.isArray(w.job_descriptions) ? w.job_descriptions.join("\n") : str(w.summary),
  })).filter((w: Any) => w.title && w.company);
  if (work.length) out.work_experience = work;
  const edu = (Array.isArray(e.education) ? e.education : []).map((x: Any) => ({
    school: str(x.organization), degree: str(x.accreditation), gpa: str(x.gpa),
    start_date: str(x.dates?.start_date), end_date: str(x.dates?.completion_date),
  })).filter((x: Any) => x.school);
  if (edu.length) out.education = edu;
  for (const k of Object.keys(out)) if (out[k] === "") delete out[k];
  return out;
}

/** Later layers win, but only where they say something (an empty "" in your
 *  profile no longer blanks a name Jobright or OptimHire holds). */
function mergeLayers(...layers: Any[]): Any {
  const out: Any = {};
  for (const l of layers) {
    for (const [k, v] of Object.entries(l || {})) {
      const empty = v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
      if (!empty || !(k in out)) out[k] = v;
    }
  }
  return out;
}

/** The extension's profile, merged the way ua-enhancement's getProfile merges it. */
async function uaProfile(): Promise<Any> {
  const d = await ST.get(["ua_profile", "candidateDetails", "userDetails", "AUTOFILL_INFO_SNAPSHOT"]);
  return mergeLayers(jobrightProfile(d.AUTOFILL_INFO_SNAPSHOT), parse(d.userDetails), parse(d.candidateDetails), parse(d.ua_profile));
}

function pick(o: Any, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim() && typeof v !== "object") return String(v).trim();
  }
  return "";
}

/** "2021-03-15", "03/2021", "March 2021", "2021" → "2021-03" ("" when there is no date). */
function ym(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || /present|current|now/i.test(s)) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /[a-z]/i.test(s)) {
    const dt = new Date(t);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }
  m = s.match(/\b(19|20)\d{2}\b/);
  return m ? `${m[0]}-01` : "";
}

function listOf(s: Any, keys: string[]): Any[] {
  for (const k of keys) {
    const v = typeof s[k] === "string" ? parse(s[k]) : s[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
  }
  return [];
}

function historyFrom(s: Any): Pick<Profile, "work" | "education"> {
  const work = listOf(s, ["work_experience", "work_experiences", "experiences", "experience", "employment_history", "work_history", "employments"])
    .map((w, i) => {
      const endRaw = w.end_date ?? w.endDate ?? w.to ?? w.end ?? "";
      const end = ym(endRaw);
      return {
        id: `w${i + 1}`,
        title: pick(w, "title", "job_title", "designation", "position", "role"),
        company: pick(w, "company", "company_name", "employer", "organization", "organisation"),
        location: pick(w, "location", "city"),
        start: ym(w.start_date ?? w.startDate ?? w.from ?? w.start),
        end: end || undefined,
        current: !!(w.is_current ?? w.current ?? w.currently_working ?? w.currently_work_here) || (!end && /present|current|now/i.test(String(endRaw))),
        bullets: String(w.description ?? w.summary ?? w.responsibilities ?? "")
          .split(/\n+|•/)
          .map((x) => x.replace(/^[\s\-*]+/, "").trim())
          .filter(Boolean)
          .slice(0, 6),
      };
    })
    .filter((w) => w.title && w.company && w.start);
  const education = listOf(s, ["education", "educations", "education_history", "academics", "qualifications"])
    .map((e, i) => ({
      id: `e${i + 1}`,
      school: pick(e, "school", "school_name", "institution", "institute", "university", "college"),
      degree: pick(e, "degree", "degree_name", "qualification", "level"),
      field: pick(e, "field_of_study", "field", "major", "specialization", "course"),
      start: ym(e.start_date ?? e.startDate ?? e.from ?? e.start),
      end: ym(e.end_date ?? e.endDate ?? e.to ?? e.end ?? e.graduation_date) || undefined,
    }))
    .filter((e) => e.school);
  return { work, education };
}

const DIAL: Record<string, string> = {
  "1": "United States of America", "44": "United Kingdom", "353": "Ireland", "234": "Nigeria", "91": "India", "49": "Germany",
  "33": "France", "61": "Australia", "27": "South Africa", "254": "Kenya", "233": "Ghana", "31": "Netherlands", "34": "Spain",
  "39": "Italy", "351": "Portugal", "48": "Poland", "46": "Sweden", "47": "Norway", "45": "Denmark", "41": "Switzerland",
  "43": "Austria", "32": "Belgium", "971": "United Arab Emirates", "966": "Saudi Arabia", "65": "Singapore", "64": "New Zealand",
  "86": "China", "81": "Japan", "55": "Brazil", "52": "Mexico", "20": "Egypt", "63": "Philippines", "92": "Pakistan", "90": "Turkey",
};
const DIAL_CODES = Object.keys(DIAL).sort((a, b) => b.length - a.length);
const ISO2: Record<string, string> = {
  US: "United States of America", USA: "United States of America", GB: "United Kingdom", UK: "United Kingdom", IE: "Ireland",
  NG: "Nigeria", IN: "India", DE: "Germany", FR: "France", AU: "Australia", CA: "Canada", ZA: "South Africa",
  NL: "Netherlands", ES: "Spain", IT: "Italy", PT: "Portugal", PL: "Poland", AE: "United Arab Emirates", SG: "Singapore",
};

/** "+44 7700 900123" → { code: "44", national: "7700900123" }. */
function splitPhone(raw: string, defCode: string): { code: string; national: string } {
  const s = String(raw || "").trim();
  const digits = s.replace(/[^\d]/g, "");
  if (/^(\+|00)/.test(s)) {
    const d = s.startsWith("00") ? digits.slice(2) : digits;
    const sep = s.match(/^\(?(?:\+|00)(\d{1,3})\)?[\s.\-)]/);
    const code = sep ? sep[1] : DIAL_CODES.find((c) => d.startsWith(c)) || "";
    return { code, national: d.slice(code.length).replace(/^0+/, "") };
  }
  return { code: defCode, national: digits.replace(/^0+/, "") };
}

/** "MAXMILLIAM" / "o'NEILL-SMITH" → "Maxmilliam" / "O'Neill-Smith"; a name already in mixed case is left alone. */
function properCase(name: string): string {
  const s = String(name || "").trim();
  if (!s || s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'’\-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function declineOr(v: string): string {
  const s = String(v || "").trim();
  return !s || /prefer not|decline|do not wish|don'?t wish|not to say/i.test(s) ? "decline" : s;
}
function yesNoDecline(v: string): "yes" | "no" | "decline" {
  const s = String(v || "").trim().toLowerCase();
  if (!s || /prefer not|decline|wish/i.test(s)) return "decline";
  if (/^(no|i do not|i don'?t|not a|none)/.test(s)) return "no";
  if (/^(yes|i have|i am)/.test(s)) return "yes";
  return "decline";
}

interface CvProfile { work: Profile["work"]; education: Profile["education"]; skills: string[]; languages: Profile["languages"]; summary: string }

async function buildProfile(): Promise<Profile> {
  const s = await uaProfile();
  const rawCountry = pick(s, "country", "location_country", "country_name");
  const country = ISO2[rawCountry.toUpperCase()] || rawCountry;
  const ph = splitPhone(pick(s, "phone", "mobile", "phone_number"), pick(s, "phoneCountryCode", "phone_country_code", "mobile_code").replace(/\D/g, ""));
  const hist = historyFrom(s);
  // No work history in the profile: at least your current role.
  if (!hist.work.length && pick(s, "current_title", "title") && pick(s, "current_company", "company")) {
    const y = pick(s, "work_start_year");
    hist.work.push({
      id: "w1", title: pick(s, "current_title", "title"), company: pick(s, "current_company", "company"),
      location: pick(s, "city"), start: y ? `${y}-01` : "", end: undefined, current: true, bullets: [],
    });
    if (!hist.work[0].start) hist.work.length = 0;     // the engine needs a start date
  }
  if (!hist.education.length && pick(s, "school", "university")) {
    const g = pick(s, "graduation_year", "grad_year");
    hist.education.push({ id: "e1", school: pick(s, "school", "university"), degree: pick(s, "degree"), field: pick(s, "major"), start: "", end: g ? `${g}-06` : undefined });
  }
  const visa = pick(s, "visa_status", "sponsorship").toLowerCase();
  const base = normalizeProfile({
    personal: {
      firstName: pick(s, "first_name", "firstName", "given_name"),
      lastName: pick(s, "last_name", "lastName", "family_name", "surname"),
      preferredName: pick(s, "preferred_name"),
      email: pick(s, "email", "email_address"),
      phone: { countryName: DIAL[ph.code] || country, countryCode: ph.code ? `+${ph.code}` : "", number: ph.national, deviceType: "Mobile" },
      address: {
        // One line each: a line break in a saved address made Workday's box refuse it.
        line1: pick(s, "address", "address_line_1", "address1", "street").split(/\s*[\r\n]+\s*/)[0],
        line2: pick(s, "address_line_2", "address2") || pick(s, "address", "address_line_1", "address1", "street").split(/\s*[\r\n]+\s*/).slice(1).join(", "),
        city: pick(s, "city"),
        region: pick(s, "state", "region", "province", "county"),
        postalCode: pick(s, "postal_code", "zip", "postcode"),
        country,
      },
      linkedin: pick(s, "linkedin", "linkedin_profile_url", "linkedin_url"),
      website: pick(s, "website", "website_url", "portfolio"),
      github: pick(s, "github", "github_url"),
    },
    summary: pick(s, "summary", "bio"),
    skills: (Array.isArray(s.skills) ? s.skills : String(s.skills || "").split(","))
      .map((x: any) => String(typeof x === "object" ? x?.name ?? "" : x).trim())
      .filter(Boolean)
      .slice(0, 30),
    languages: String(s.languages || "").split(/[,;]/).map((l) => l.trim()).filter(Boolean)
      .map((language, i) => ({ language, proficiency: i === 0 ? "Native" : "Fluent", native: i === 0 })),
    ...hist,
    answers: {
      authorizedCountries: country ? [country] : [],
      needsSponsorship: /require|need|yes/.test(visa) && !/not require|no sponsorship|does not/.test(visa),
      salaryExpectation: pick(s, "expected_salary", "salary"),
      noticePeriod: pick(s, "notice_period", "notice"),
      earliestStartDate: pick(s, "availability", "start_date"),
      willingToRelocate: true,
      openToHybrid: true,
      openToOnsite: true,
      source: "LinkedIn",
      previouslyWorkedHere: false,
    },
    eeo: {
      gender: declineOr(pick(s, "gender")),
      hispanicOrLatino: "decline",
      ethnicity: declineOr(pick(s, "ethnicity", "race")),
      veteran: declineOr(pick(s, "veteran")),
      disability: yesNoDecline(pick(s, "disability")),
    },
  } as any);
  // A full profile imported into the engine's own store (the standalone
  // extension's export) wins where it says something; yours fills the rest.
  const imported = await getEngineProfile().catch(() => null);
  const p = imported && (imported.work.length || imported.personal.firstName) ? imported : base;
  if (p !== base) {
    const fillIn = (a: Any, b: Any) => {
      for (const k of Object.keys(b)) {
        if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) fillIn((a[k] ??= {}), b[k]);
        else if (a[k] === "" || a[k] == null || (Array.isArray(a[k]) && !a[k].length)) a[k] = b[k];
      }
    };
    fillIn(p, base);
  }
  // Your roles from your CV when the profile has none (My Experience waits: cvReady).
  cvReady = Promise.resolve();
  if (p.work.length <= 1) {
    cvReady = readCvProfile().then((cv) => {
      if (!cv || cv.work.length <= p.work.length) return;
      p.work = cv.work;
      if (!p.education.length) p.education = cv.education;
      if (!p.skills.length) p.skills = cv.skills;
      if (!p.languages.length) p.languages = cv.languages;
      if (!p.summary) p.summary = cv.summary;
    }, () => undefined);
  }
  // A parsed CV or an old import can hold the name in capitals ("MAXMILLIAM"): forms want "Maxmilliam".
  for (const k of ["firstName", "lastName", "preferredName"] as const) p.personal[k] = properCase(p.personal[k] || "");
  return p;
}

/* ---------------- your CV ---------------- */

/** The CV saved in the extension: the active one of ua_resumes, else ua_resume_data. */
async function savedCv(): Promise<StoredDoc | undefined> {
  const d = await ST.get(["ua_resumes", "ua_active_resume", "ua_resume_data"]);
  const list: Any[] = Array.isArray(d.ua_resumes) ? d.ua_resumes : [];
  const r = list[d.ua_active_resume || 0] || list[0] || d.ua_resume_data;
  if (!r || !r.base64) return undefined;
  const base64 = String(r.base64).split(",").pop() || "";
  return { fileName: r.fileName || r.name || "Resume.pdf", mime: r.mimeType || "application/pdf", base64 };
}

let cvReady: Promise<void> = Promise.resolve();
let cvReading: Promise<CvProfile | null> | null = null;

async function readCvProfile(): Promise<CvProfile | null> {
  return (cvReading ??= (async () => {
    const doc = await savedCv();
    if (!doc) return null;
    const sig = `${doc.fileName}|${doc.base64.length}|${doc.base64.slice(-32)}`;
    const { [CV_KEY]: cached } = await ST.get(CV_KEY);
    if (cached && cached.sig === sig && cached.profile) return cached.profile as CvProfile;
    if (!W.__ohCv) {
      await within(chrome.runtime.sendMessage({ type: "UA_WD_CV_LOAD" }), 15_000).catch(() => null);
      for (let i = 0; i < 40 && !W.__ohCv; i++) await new Promise((r) => setTimeout(r, 100));
    }
    if (!W.__ohCv) return null;
    const r = (await within(W.__ohCv.read(doc.base64, doc.mime), 30_000).catch(() => null)) as Any;
    if (!r || !r.profile) return null;
    const prof = r.profile as CvProfile;
    await ST.set({ [CV_KEY]: { sig, at: Date.now(), roles: prof.work.length, profile: prof } });
    say(`read your CV: ${prof.work.length} role(s), ${prof.education.length} education, ${prof.skills.length} skill(s)`);
    return prof;
  })().finally(() => setTimeout(() => { cvReading = null; }, 5000)));
}

/* ---------------- settings ---------------- */

const SETTINGS: WorkdaySettings = {
  ...DEFAULT_WD_SETTINGS,
  consentCreateAccountTerms: true,  // queue runs: nobody at the PC to tick them
  consentDisclosureTerms: true,
  useMasterPassword: true,          // one password for every Workday site
  requireDocApproval: false,
  llmAnswers: true,                 // answered by this extension's deciders (llmStandIn), not an AI
  trustedInputFallback: false,
  fieldDelayMs: 40,
  fallbackToMasterCv: true,
  externalAutoRequest: false,
};
const ASSIST_SETTINGS = (): WorkdaySettings => ({ ...SETTINGS, fieldDelayMs: 10 });

/* ---------------- answers: yours first ---------------- */

/** ua-enhancement's remembered answers (what you answered before, saved responses).
 *  In a queue run — nobody at the PC — a "sensitive" question the engine leaves
 *  for you (conviction, non-compete, relatives, attestations, signature) gets the
 *  answer the built-in flow would give it after a hand-back anyway, so the engine
 *  carries on instead of pausing. In assist (you are there) it stays yours. */
async function hostAnswer(label: string, kind: ControlKind, options: string[], mode: Mode): Promise<string | null> {
  try {
    const f = W.__uaWdAnswer;
    const a = typeof f === "function" ? await f(label, kind, options) : null;
    if (a) return String(a);
    if (mode.queue && SENSITIVE_RX.test(label) && typeof W.__uaWdGuess === "function") {
      const g = await W.__uaWdGuess(label, kind, options);
      return g ? String(g) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/* ---------------- run lifecycle ---------------- */

async function installHooks(mode: Mode): Promise<void> {
  logShown = 0;
  const profile = await buildProfile();
  let cv: Promise<StoredDoc | undefined> | null = null;
  accountNoted = false;
  setHooks({
    profile: async () => profile,
    settings: async () => (mode.assist ? ASSIST_SETTINGS() : SETTINGS),
    masterCv: () => (cv ??= savedCv().catch(() => undefined)),
    autoSubmit: () => mode.submit,
    ...(mode.assist ? { advance: () => false, keepExisting: () => true } : {}),
    answer: (label, kind, options) => hostAnswer(label, kind, options, mode),
    onPage: (run) => onPage(run),
    beforeExperience: () => within(cvReady, 30_000).then(() => undefined),
    onFinish: (run, outcome) => void finish(mode, run, outcome),
  });
}

const AUTH_PAGES: PageKind[] = ["signIn", "createAccount", "verifyEmail"];
let accountNoted = false;
let lastPage = "";
let lastActive = 0;                      // last moment the engine's loop was seen running
let bootUntil = 0;                       // a reload is resuming a job: give it time to start

function onPage(run: RunState) {
  lastPage = run.page;
  if (!accountNoted && !AUTH_PAGES.includes(run.page) && run.done.some((p) => p === "signIn" || p === "createAccount")) {
    accountNoted = true;
    void noteSite("account");
  }
  try { W.__uaWdProgress?.(run.page); } catch { /* */ }
}

function plainReason(run: RunState, outcome: Outcome): string {
  if (run.flags.length) {
    const labels = run.flags.map((f) => f.label).join("; ");
    return `${run.flags.length} question${run.flags.length === 1 ? "" : "s"} it could not answer: ${labels}`.slice(0, 240);
  }
  if (outcome === "review") return "filled, but no Submit button on Review";
  return (run.pauseReason || "").replace(/,?\s*then click Resume\.?/gi, "").replace(/\s+:/, ":").trim();
}

async function remember(run: RunState, outcome: Outcome, mode: Mode) {
  try {
    const d = await ST.get(LOG_KEY);
    const list: Any[] = Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : [];
    list.unshift({
      at: Date.now(), host: run.tenantHost, url: location.href, queue: mode.queue, outcome, page: run.page,
      reason: run.pauseReason || "", flags: run.flags.map((f) => `${f.label}: ${f.reason}`),
      log: run.log.slice(-40).map((l) => `${l.level === "info" ? "" : l.level + ": "}${l.msg}`),
    });
    await ST.set({ [LOG_KEY]: list.slice(0, 30) });
  } catch { /* storage unavailable */ }
}

async function finish(mode: Mode, run: RunState, outcome: Outcome) {
  if (mode.assist) return;                 // the overlay says what it needs; nothing to report
  clearMode();
  writeResult({ jobId: mode.jobId, outcome, page: run.page, at: Date.now(), reason: plainReason(run, outcome) });
  say(`${outcome}${run.pauseReason ? ": " + run.pauseReason : ""}`);
  await remember(run, outcome, mode);
  const reason = run.pauseReason || "";
  if (run.page === "verifyEmail") await noteSite("verify");
  else if (outcome !== "submitted" && /sign-in was rejected|already have an account|failed twice/i.test(reason)) await noteSite("other-password");
}

/** A queue job on this Workday tab: applied unattended; the result is kept for ua-enhancement. */
async function startJob(jobId: string): Promise<void> {
  const id = String(jobId || "");
  if (!id) return;
  const m = readMode();
  if ((m && m.jobId === id && !m.assist) || readResult(id)) return;      // already going / finished (after a reload)
  if (isActive()) {                        // an assist fill (or an old job) on screen: that one ends here
    await stopRun();
    for (let i = 0; i < 50 && isActive(); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const mode: Mode = { queue: true, submit: true, startedAt: Date.now(), jobId: id };
  writeMode(mode);
  bootUntil = Date.now() + 30_000;          // the app may still be rendering; the loop starts after it
  say(`applying (queue job ${id.slice(0, 40)})`);
  try {
    for (let i = 0; i < 40 && !hasWorkdayApp(); i++) await new Promise((r) => setTimeout(r, 500));   // the app may still be rendering
    await installHooks(mode);
    await startRun(null);
  } catch (e) {
    clearMode();
    writeResult({ jobId: id, outcome: "error", reason: (e as Error)?.message || String(e), at: Date.now() });
  }
}

/** Hand the job back to the engine on the page now showing. The engine paused
 *  on an earlier step (a question it could not answer); the built-in flow
 *  answered it and moved on, and from here the engine is the better filler. */
async function resumeJob(jobId: string): Promise<void> {
  const id = String(jobId || "");
  const r = readResult(id);
  if (!id || !r || r.outcome === "submitted" || isActive()) return;
  try { sessionStorage.removeItem(RESULT_KEY); } catch { /* storage blocked */ }
  const mode: Mode = { queue: true, submit: true, startedAt: Date.now(), jobId: id };
  writeMode(mode);
  bootUntil = Date.now() + 30_000;
  say(`resuming on ${detectPage()} (queue job ${id.slice(0, 40)})`);
  try {
    await installHooks(mode);
    await startRun(null);
  } catch (e) {
    clearMode();
    writeResult({ jobId: id, outcome: "error", reason: (e as Error)?.message || String(e), at: Date.now() });
  }
}

/* ---------------- the bridge ua-enhancement uses ---------------- */

W.__uaWdEngine = {
  version: 1,
  isWorkday: () => TOP && isWorkdayHost(),
  startJob: (jobId: string) => void startJob(jobId),
  resume: (jobId: string) => void resumeJob(jobId),
  result: (jobId: string) => readResult(String(jobId || "")),
  /** Still working on this job (or about to resume it after a reload). A run
   *  that ended without reporting (the engine stops quietly on, e.g., a Submit
   *  button outside Review) is recorded here as "stopped" on its page, so the
   *  host carries on instead of waiting for an outcome that never comes. */
  running: (jobId: string) => {
    const id = String(jobId || "");
    if (isActive()) { lastActive = Date.now(); return true; }
    const m = readMode();
    if (!m || m.jobId !== id || m.assist) return false;
    // The loop ran for this job and has ended → stopped after a moment; not started yet → give it time.
    const ran = lastActive >= m.startedAt;
    if (ran ? Date.now() - lastActive < 2500 : (Date.now() < bootUntil || Date.now() - m.startedAt < 8000)) return true;
    clearMode();
    if (!readResult(id)) writeResult({ jobId: id, outcome: "stopped", page: lastPage || detectPage(), at: Date.now(), reason: "the engine stopped on this page without finishing" });
    return false;
  },
  page: () => lastPage || detectPage(),
  stop: () => { clearMode(); void stopRun(); },
  /** Fully Automated is on outside a run here: assist takes the Workday steps. */
  allowAssist: () => { assistAllowed = true; return assistOn(); },
  assistOn,
  readCv: () => readCvProfile(),
  /** Workday's month/year date boxes take keystrokes, not a value: the built-in
   *  flow uses this to put a month next to a year-only date ("MM/2021"). */
  setDate: (field: HTMLElement, ym: string) => setDate(field, ym).catch(() => false),
};

/* ---------------- wiring ---------------- */

if (TOP && isWorkdayHost()) {
  /* Assist, on Review: "Submitting your application in 5…" with Cancel, then Submit. */
  const submitCountdown = (seconds = 5) => {
    if (!document.body) return;
    const host = document.createElement("div");
    host.id = "ua-wd-submit-countdown";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .b{font:13px/1.4 Inter,system-ui,sans-serif;display:flex;align-items:center;gap:12px;padding:12px 14px;background:#12141c;color:#e6e8ef;
         border:1px solid #262a36;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
      b{font-weight:600} button{font:600 12.5px/1 inherit;font-family:inherit;height:30px;padding:0 12px;border-radius:8px;cursor:pointer;
         background:#1a1d27;color:#e6e8ef;border:1px solid #333849} button:hover{background:#20242f}
      .now{background:#6d5efc;border-color:#6d5efc;color:#fff}</style>
      <div class="b" role="status"><span>Submitting your application in <b id="n">${seconds}</b>…</span>
      <button class="now" id="go">Submit now</button><button id="x">Cancel</button></div>`;
    document.body.appendChild(host);
    let left = seconds;
    let done = false;
    const end = (submit: boolean) => {
      if (done) return;
      done = true;
      clearInterval(t);
      host.remove();
      if (!submit || !assistOn()) { say("assist: submit cancelled — Review is yours"); return; }
      say("assist: submitting from Review");
      const mode: Mode = { queue: false, submit: true, startedAt: Date.now(), jobId: "" };
      void installHooks(mode).then(() => startRun(null));
    };
    const t = window.setInterval(() => {
      left--;
      const n = root.getElementById("n");
      if (n) n.textContent = String(left);
      if (left <= 0) end(true);
    }, 1000);
    root.getElementById("go")?.addEventListener("click", () => end(true));
    root.getElementById("x")?.addEventListener("click", () => end(false));
  };

  /* Assist: a new step on screen (no job running here) is filled once. */
  const ASSIST_PAGES: PageKind[] = ["resumeUpload", "myInformation", "myExperience", "questions", "voluntaryDisclosures", "selfIdentify"];
  const assisted = new Set<string>();
  setInterval(() => {
    if (!assistOn() || readMode() || isActive() || !hasWorkdayApp()) return;
    const page = detectPage();
    if (page === "review") {
      const rk = `review|${location.pathname}`;
      if (!assisted.has(rk) && !document.getElementById("ua-wd-submit-countdown")) { assisted.add(rk); submitCountdown(); }
      return;
    }
    if (!ASSIST_PAGES.includes(page)) return;
    const key = `${page}|${activeStepName()}|${location.pathname}`;
    if (assisted.has(key)) return;
    assisted.add(key);
    say(`assist: filling ${page}`);
    const mode: Mode = { queue: false, submit: false, assist: true, startedAt: Date.now(), jobId: "" };
    void installHooks(mode).then(() => startRun(null));
  }, 900);

  /* Read your CV early (once per CV; kept), so your roles are ready by My Experience. */
  const warmCv = (tries = 0) => {
    if (!hasWorkdayApp()) { if (tries < 40) setTimeout(() => warmCv(tries + 1), 500); return; }
    if (!assistOn() && !readMode()) { if (tries < 40) setTimeout(() => warmCv(tries + 1), 1500); return; }
    void readCvProfile().catch(() => undefined);
  };
  setTimeout(() => warmCv(), 1500);

  // A job interrupted by a reload (sign-in, session refresh) carries on.
  const boot = (tries = 0) => {
    const mode = readMode();
    if (!mode || mode.assist) return;
    if (!tries) bootUntil = Date.now() + 35_000;
    if (!hasWorkdayApp()) {
      if (tries < 60) setTimeout(() => boot(tries + 1), 500);
      return;
    }
    void installHooks(mode).then(() => autoResume());
  };
  boot();
}
