/**
 * Shared types for the Workday autopilot. Everything here is plain data so it
 * can cross chrome.runtime messaging and live in chrome.storage.
 */

export type YearMonth = string; // "YYYY-MM"

export interface WorkEntry {
  id: string;
  title: string;
  company: string;
  location: string;
  start: YearMonth;
  end?: YearMonth;
  current: boolean;
  bullets: string[];
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  field: string;
  gpa?: string;
  start: YearMonth;
  end?: YearMonth;
}

export interface CertificationEntry {
  name: string;
  issuer: string;
  issued?: YearMonth;
  expires?: YearMonth;
}

export interface LanguageEntry {
  language: string;
  proficiency: string;
  native: boolean;
}

/** "decline" always maps to the form's "I do not wish to answer" option. */
export interface EeoPrefs {
  gender: string;
  hispanicOrLatino: "yes" | "no" | "decline";
  ethnicity: string;
  veteran: string;
  disability: "yes" | "no" | "decline";
}

export interface ScreeningAnswers {
  /** Countries where the candidate is authorised to work without sponsorship. */
  authorizedCountries: string[];
  needsSponsorship: boolean;
  salaryExpectation: string;
  noticePeriod: string;
  earliestStartDate: string;
  willingToRelocate: boolean;
  openToHybrid: boolean;
  openToOnsite: boolean;
  /** How-did-you-hear default, e.g. "LinkedIn". */
  source: string;
  previouslyWorkedHere: boolean;
}

export interface Profile {
  personal: {
    firstName: string;
    lastName: string;
    preferredName: string;
    email: string;
    phone: {
      countryName: string; // "United Kingdom"
      countryCode: string; // "+44"
      number: string; // national number, no country code
      deviceType: string; // "Mobile"
    };
    address: {
      line1: string;
      line2: string;
      city: string;
      region: string;
      postalCode: string;
      country: string;
    };
    linkedin: string;
    website: string;
    github: string;
  };
  summary: string;
  skills: string[];
  work: WorkEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  languages: LanguageEntry[];
  answers: ScreeningAnswers;
  eeo: EeoPrefs;
}

export interface WorkdaySettings {
  /** User agreed once to tick the account-creation terms box on every tenant. */
  consentCreateAccountTerms: boolean;
  /** User agreed once to tick the Voluntary Disclosures terms box. */
  consentDisclosureTerms: boolean;
  /** Use one password for every tenant instead of generating one per tenant. */
  useMasterPassword: boolean;
  /** Tailored docs must be approved in the side panel before the engine uploads them. */
  requireDocApproval: boolean;
  /** Let the LLM answer unknown screening questions (flagged on Review). */
  llmAnswers: boolean;
  /** Use chrome.debugger trusted typing when synthetic input is rejected. */
  trustedInputFallback: boolean;
  /** Max skills to add to the Skills multiselect. */
  maxSkills: number;
  /** Delay between field writes, ms. */
  fieldDelayMs: number;
  /** Your own tailoring service: POST {job, candidate} → {cv, coverLetter, coverLetterText}. */
  externalTailorUrl: string;
  /** Sent as `Authorization: Bearer <token>` to the external tailoring service. */
  externalTailorToken: string;
  /** Call the external service automatically when a JD is captured. */
  externalAutoRequest: boolean;
  /** Prefer the user's own master CV upload over generated PDFs when nothing job-specific exists. */
  fallbackToMasterCv: boolean;
  /** Language for tailored docs: "auto" = the job description's language, or an ISO code like "en". */
  docLanguage: string;
}

export const DEFAULT_WD_SETTINGS: WorkdaySettings = {
  consentCreateAccountTerms: false,
  consentDisclosureTerms: false,
  useMasterPassword: false,
  requireDocApproval: true,
  llmAnswers: true,
  trustedInputFallback: false,
  maxSkills: 15,
  fieldDelayMs: 120,
  externalTailorUrl: "",
  externalTailorToken: "",
  externalAutoRequest: false,
  fallbackToMasterCv: true,
  docLanguage: "auto",
};

export interface JobPosting {
  key: string; // tenantHost + "|" + reqId
  tenantHost: string;
  site: string;
  reqId: string;
  title: string;
  location: string;
  description: string;
  /** ISO 639-1 code of the job description, e.g. "de". Tailored docs are written in it by default. */
  language: string;
  url: string;
  capturedAt: number;
}

export interface TailoredContent {
  summary: string;
  skills: string[];
  /** Bullets per work entry id, in the order to show them. */
  roles: Record<string, string[]>;
  coverLetter: string;
  keywords: string[];
  /** Notes from the no-fabrication check (dropped bullets etc). */
  warnings: string[];
  method: "llm" | "keyword" | "external" | "manual";
}

export interface StoredDoc {
  fileName: string;
  mime: string;
  base64: string;
}

export interface JobDocs {
  jobKey: string;
  tailored: TailoredContent | null;
  cv: StoredDoc;
  coverLetter?: StoredDoc;
  coverLetterText: string;
  /** Where the docs came from: built-in tailoring, your own tool, or a manual attach. */
  source: "builtin" | "external" | "manual";
  approved: boolean;
  createdAt: number;
}

export type PageKind =
  | "jobPosting"
  | "applyMethod"
  | "signIn"
  | "createAccount"
  | "verifyEmail"
  | "resumeUpload"
  | "myInformation"
  | "myExperience"
  | "questions"
  | "voluntaryDisclosures"
  | "selfIdentify"
  | "review"
  | "submitted"
  | "candidateHome"
  | "unknown";

export type RunStatus = "idle" | "running" | "paused" | "review" | "done" | "error" | "filled"; // [oh] filled: assist mode

export interface Flag {
  label: string;
  reason: string;
  page: PageKind;
}

export interface LogLine {
  at: number;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface RunState {
  tenantHost: string;
  jobKey: string | null;
  status: RunStatus;
  page: PageKind;
  /** Attempts on the current page (reset on transition). */
  attempts: number;
  /** Pages already completed this run, in order. */
  done: PageKind[];
  flags: Flag[];
  /** Fields filled by the LLM, shown for checking on Review. */
  llmFilled: { label: string; answer: string }[];
  log: LogLine[];
  pauseReason?: string;
  /** Sign-in attempts this run — capped to avoid tenant account lockout. */
  authAttempts: number;
  /** Account-creation attempts this run. */
  createAttempts: number;
  updatedAt: number;
}

export interface Application {
  jobKey: string;
  tenantHost: string;
  reqId: string;
  title: string;
  submittedAt: number;
  cvFile?: string;
  coverLetterFile?: string;
  url: string;
}

export interface AnswerBankEntry {
  label: string;
  answer: string;
  at: number;
}

/* ---------------- runtime messages ---------------- */

export type WdMessage =
  | { type: "wd:status" }
  | { type: "wd:captureJD" }
  | { type: "wd:start"; jobKey?: string | null }
  | { type: "wd:resume" }
  | { type: "wd:stop" }
  | { type: "wd:llm"; system: string; prompt: string; json?: boolean; maxTokens?: number }
  | { type: "wd:cred:get"; tenantHost: string }
  | { type: "wd:cred:set"; tenantHost: string; email: string; password: string }
  | { type: "wd:cred:generate"; tenantHost: string; email: string }
  | { type: "wd:trustedType"; text: string }
  | { type: "wd:progress"; state: RunState }
  | { type: "wd:notify"; title: string; message: string }
  | { type: "wd:jobCaptured"; job: JobPosting };

export interface WdStatusReply {
  isWorkday: boolean;
  tenantHost: string;
  page: PageKind;
  job: JobPosting | null;
  run: RunState | null;
}
