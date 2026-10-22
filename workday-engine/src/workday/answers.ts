/**
 * Answer resolution for any Workday question: deterministic profile rules
 * first, then the user's own saved answers, then (optionally) the LLM. Legal,
 * attestation and history questions are never guessed.
 */
import { DECLINE_RX, norm, similarity } from "./dom.js";
import { getAnswerBank, normalizeLabel } from "./store.js";
import type { ControlKind } from "./controls.js";
import type { JobDocs, JobPosting, Profile, WorkdaySettings } from "./types.js";
import { Q, SENSITIVE_RX as SENSITIVE_I18N } from "./i18n.js";
import { hooks } from "./ohHooks.js";

export interface AnswerCtx {
  profile: Profile;
  settings: WorkdaySettings;
  job: JobPosting | null;
  docs: JobDocs | null;
}

export interface Answer {
  answer: string;
  source: "rule" | "bank" | "llm" | "host";
}

/** Questions only the user may answer (unless they saved an answer themselves). Multilingual. */
export const SENSITIVE_RX = SENSITIVE_I18N;

const yesNo = (b: boolean) => (b ? "Yes" : "No");

function fullName(p: Profile) {
  return `${p.personal.firstName} ${p.personal.lastName}`.trim();
}

function monthsBetween(a: string, b?: string): number {
  const [ay, am] = a.split("-").map(Number);
  const now = new Date();
  const [by, bm] = b ? b.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  return Math.max(0, (by - ay) * 12 + ((bm || 1) - (am || 1)));
}

/** Years of experience overall, or with a named skill when the question mentions one. */
export function yearsOfExperience(p: Profile, label: string): number {
  const l = label.toLowerCase();
  const skill = p.skills.find((s) => s.length > 1 && l.includes(s.toLowerCase()));
  const roles = skill
    ? p.work.filter((w) => `${w.title} ${w.bullets.join(" ")}`.toLowerCase().includes(skill.toLowerCase()))
    : p.work;
  const months = roles.reduce((m, w) => m + (w.start ? monthsBetween(w.start, w.current ? undefined : w.end) : 0), 0);
  return Math.floor(months / 12);
}

/** Pick the option bucket ("0-2 years", "5+") that contains n. */
export function bucketFor(n: number, options: string[]): string | null {
  for (const o of options) {
    const range = o.match(/(\d+)\s*(?:-|–|to|bis|à|a|até|tot|do|〜|~|至)\s*(\d+)/iu);
    if (range && n >= +range[1] && n <= +range[2]) return o;
    const plus = o.match(/(\d+)\s*\+|(\d+)\s*\p{L}*\s*(?:or more|and above|oder mehr|und mehr|ou plus|o más|ou mais|o più|of meer|lub więcej|以上)/iu);
    if (plus && n >= +(plus[1] ?? plus[2])) return o;
    const more = o.match(/(?:more than|over|mehr als|über|plus de|más de|mais de|più di|meer dan|ponad|powyżej)\s*(\d+)/iu);
    if (more && n > +more[1]) return o;
    const less = o.match(/(?:less than|under|<|weniger als|unter|moins de|menos de|meno di|minder dan|mniej niż|未満)\s*(\d+)/iu);
    if (less && n < +less[1]) return o;
  }
  return null;
}

function countryInText(text: string, p: Profile): string | null {
  const t = norm(text);
  const candidates = [...p.answers.authorizedCountries, p.personal.address.country, "united states", "united kingdom", "canada", "ireland", "germany", "france", "india", "australia", "netherlands", "spain", "singapore"];
  return candidates.find((c) => c && t.includes(norm(c))) ?? null;
}

function authorizedFor(label: string, ctx: AnswerCtx): boolean {
  const p = ctx.profile;
  const c = countryInText(label, p) ?? countryInText(ctx.job?.location ?? "", p) ?? p.personal.address.country;
  return p.answers.authorizedCountries.some((a) => similarity(a, c) >= 0.85);
}

type Rule = [RegExp, (label: string, ctx: AnswerCtx, options: string[], kind: ControlKind) => string | null];

const EEO_RX = new RegExp([Q.gender, Q.hispanic, Q.ethnicity, Q.veteran, Q.disability].map((r) => r.source).join("|"), "iu");

/** [oh] Contact details: the profile knows these best, so the host isn't asked. */
const CONTACT_RX = new RegExp(
  [Q.firstName, Q.lastName, Q.fullName, Q.email, Q.phone, Q.address1, Q.city, Q.postal, Q.country, Q.region, Q.linkedin, Q.github, Q.website]
    .map((r) => r.source)
    .join("|"),
  "iu"
);

/** [oh] The listed option a free-form answer means ("Yes" → "Yes, I am authorised"), or null. */
function optionFor(answer: string, options: string[]): string | null {
  if (!options.length) return answer;
  const num = answer.match(/^\s*(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)?\s*$/i);
  const bucket = num ? bucketFor(Math.floor(+num[1]), options) : null;
  if (bucket) return bucket;
  let best: string | null = null;
  let score = 0;
  for (const o of options) {
    const s = similarity(o, answer);
    if (s > score) {
      score = s;
      best = o;
    }
  }
  return score >= 0.6 ? best : null;
}

const RULES: Rule[] = [
  [Q.sponsorship, (_l, c) => yesNo(c.profile.answers.needsSponsorship)],
  [Q.authorized, (l, c) => yesNo(authorizedFor(l, c))],
  [Q.adult, () => "Yes"],
  [Q.salary, (_l, c) => c.profile.answers.salaryExpectation || null],
  [Q.notice, (_l, c) => c.profile.answers.noticePeriod || null],
  [Q.startDate, (_l, c) => c.profile.answers.earliestStartDate || null],
  [Q.relocate, (_l, c) => yesNo(c.profile.answers.willingToRelocate)],
  [Q.hybrid, (_l, c) => yesNo(c.profile.answers.openToHybrid)],
  [Q.onsite, (_l, c) => yesNo(c.profile.answers.openToOnsite)],
  [Q.previouslyWorked, (_l, c) => yesNo(c.profile.answers.previouslyWorkedHere)],
  [Q.source, (_l, c) => c.profile.answers.source || null],
  [Q.linkedin, (_l, c) => c.profile.personal.linkedin || null],
  [Q.github, (_l, c) => c.profile.personal.github || null],
  [Q.website, (_l, c) => c.profile.personal.website || c.profile.personal.linkedin || null],
  [Q.coverLetter, (_l, c, _o, kind) => (kind === "textarea" || kind === "text" ? c.docs?.coverLetterText || null : null)],
  [Q.years, (l, c, opts) => {
    const n = yearsOfExperience(c.profile, l);
    return opts.length ? bucketFor(n, opts) : String(n);
  }],
  [Q.firstName, (_l, c) => c.profile.personal.firstName || null],
  [Q.lastName, (_l, c) => c.profile.personal.lastName || null],
  [Q.fullName, (_l, c) => fullName(c.profile) || null],
  [Q.email, (_l, c) => c.profile.personal.email || null],
  [Q.phone, (_l, c) => c.profile.personal.phone.number || null],
  [Q.address1, (_l, c) => c.profile.personal.address.line1 || null],
  [Q.city, (_l, c) => c.profile.personal.address.city || null],
  [Q.postal, (_l, c) => c.profile.personal.address.postalCode || null],
  [Q.country, (_l, c) => c.profile.personal.address.country || null],
  [Q.region, (_l, c) => c.profile.personal.address.region || null],
  [Q.gender, (_l, c) => c.profile.eeo.gender],
  [Q.hispanic, (_l, c) => c.profile.eeo.hispanicOrLatino],
  [Q.ethnicity, (_l, c) => c.profile.eeo.ethnicity],
  [Q.veteran, (_l, c) => c.profile.eeo.veteran],
  [Q.disability, (_l, c) => c.profile.eeo.disability],
];

/** Map an EEO preference to the wording a form uses. */
export function eeoWanted(v: string): string {
  if (!v || v === "decline") return "decline";
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return v;
}

export async function resolveAnswer(
  label: string,
  kind: ControlKind,
  options: string[],
  ctx: AnswerCtx,
  llm: (system: string, prompt: string) => Promise<string>
): Promise<Answer | null> {
  const norm = normalizeLabel(label);
  const bank = await getAnswerBank();
  const saved =
    bank[norm] ??
    Object.values(bank).find((e) => similarity(normalizeLabel(e.label), norm) >= 0.92);
  if (saved && (!options.length || options.some((o) => similarity(o, saved.answer) >= 0.85))) {
    return { answer: saved.answer, source: "bank" };
  }

  // [oh] Unattended runs: the host's answer (the user's own saved answers / answer service) comes
  // before the profile's defaults, which only know what the profile was told.
  if (hooks.answer && !CONTACT_RX.test(label)) {
    const a = await hooks.answer(label, kind, options).catch(() => null);
    const pick = a ? optionFor(a, options) : null;
    if (pick) return { answer: pick, source: "host" };
  }

  if (SENSITIVE_RX.test(label)) return null;

  for (const [rx, fn] of RULES) {
    if (!rx.test(label)) continue;
    const a = fn(label, ctx, options, kind);
    if (a == null || a === "") break;
    const wanted = EEO_RX.test(label) ? eeoWanted(a) : a;
    if (options.length && wanted !== "decline" && !options.some((o) => similarity(o, wanted) >= 0.6)) break;
    if (options.length && wanted === "decline" && !options.some((o) => DECLINE_RX.test(o))) return null;
    return { answer: wanted, source: "rule" };
  }

  if (!ctx.settings.llmAnswers) return null;
  if (EEO_RX.test(label) || /religio|sexual orientation|orientation sexuelle|orientación sexual|sexuelle orientierung/iu.test(label)) return null;

  const system = `You answer job-application questions for a candidate, honestly, using ONLY the candidate profile and job below.
If the profile doesn't support an answer, return confidence 0. Never invent facts.
If OPTIONS are listed, "answer" must be exactly one of them (copy it verbatim, in the form's language).
Write free-text answers in the SAME LANGUAGE as the question. Keep them concise (under 120 words unless the question asks for more).
Return ONLY JSON: {"answer": string, "confidence": number between 0 and 1}`;
  const prompt = `QUESTION: ${label}
CONTROL: ${kind}
${options.length ? `OPTIONS: ${JSON.stringify(options.slice(0, 80))}` : ""}
JOB: ${ctx.job ? `${ctx.job.title} — ${ctx.job.location}\n${ctx.job.description.slice(0, 3000)}` : "unknown"}
PROFILE: ${JSON.stringify({
    name: fullName(ctx.profile),
    location: ctx.profile.personal.address,
    summary: ctx.profile.summary,
    skills: ctx.profile.skills,
    work: ctx.profile.work.map((w) => ({ title: w.title, company: w.company, start: w.start, end: w.current ? "present" : w.end, bullets: w.bullets.slice(0, 4) })),
    education: ctx.profile.education,
    answers: ctx.profile.answers,
  })}`;
  try {
    const reply = await llm(system, prompt);
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { answer?: string; confidence?: number };
    if (!j.answer || (j.confidence ?? 0) < 0.6) return null;
    if (options.length) {
      const exact = options.find((o) => similarity(o, j.answer!) >= 0.9);
      if (!exact) return null;
      return { answer: exact, source: "llm" };
    }
    return { answer: j.answer, source: "llm" };
  } catch {
    return null;
  }
}
