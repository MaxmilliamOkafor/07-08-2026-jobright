/**
 * chrome.storage.local persistence for the Workday autopilot. Usable from the
 * content script, the side panel, the options page and the service worker.
 */
import {
  DEFAULT_WD_SETTINGS,
  type AnswerBankEntry,
  type Application,
  type JobDocs,
  type JobPosting,
  type Profile,
  type RunState,
  type StoredDoc,
  type WorkdaySettings,
} from "./types.js";

const K = {
  profile: "wd:profile",
  settings: "wd:settings",
  masterCv: "wd:masterCv",
  masterCvText: "wd:masterCvText",
  masterCoverLetter: "wd:masterCoverLetter",
  answers: "wd:answerBank",
  apps: "wd:applications",
  job: (key: string) => `wd:job:${key}`,
  lastJob: (host: string) => `wd:lastJob:${host}`,
  docs: (key: string) => `wd:docs:${key}`,
  run: (host: string) => `wd:run:${host}`,
};

async function get<T>(key: string): Promise<T | undefined> {
  const out = await chrome.storage.local.get(key);
  return out?.[key] as T | undefined;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export function emptyProfile(): Profile {
  return {
    personal: {
      firstName: "",
      lastName: "",
      preferredName: "",
      email: "",
      phone: { countryName: "", countryCode: "", number: "", deviceType: "Mobile" },
      address: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "" },
      linkedin: "",
      website: "",
      github: "",
    },
    summary: "",
    skills: [],
    work: [],
    education: [],
    certifications: [],
    languages: [],
    answers: {
      authorizedCountries: [],
      needsSponsorship: false,
      salaryExpectation: "",
      noticePeriod: "",
      earliestStartDate: "",
      willingToRelocate: false,
      openToHybrid: true,
      openToOnsite: true,
      source: "LinkedIn",
      previouslyWorkedHere: false,
    },
    eeo: {
      gender: "decline",
      hispanicOrLatino: "decline",
      ethnicity: "decline",
      veteran: "decline",
      disability: "decline",
    },
  };
}

/** Deep-merge a stored or imported profile over the empty template. */
export function normalizeProfile(p: Partial<Profile> | undefined): Profile {
  const base = emptyProfile();
  if (!p) return base;
  return {
    ...base,
    ...p,
    personal: {
      ...base.personal,
      ...p.personal,
      phone: { ...base.personal.phone, ...p.personal?.phone },
      address: { ...base.personal.address, ...p.personal?.address },
    },
    answers: { ...base.answers, ...p.answers },
    eeo: { ...base.eeo, ...p.eeo },
    work: (p.work ?? []).map((w, i) => ({ ...w, id: w.id || `w${i + 1}`, bullets: w.bullets ?? [] })),
    education: (p.education ?? []).map((e, i) => ({ ...e, id: e.id || `e${i + 1}` })),
    skills: p.skills ?? [],
    certifications: p.certifications ?? [],
    languages: p.languages ?? [],
  };
}

export async function getProfile(): Promise<Profile> {
  return normalizeProfile(await get<Profile>(K.profile));
}
export async function setProfile(p: Profile): Promise<void> {
  await set(K.profile, normalizeProfile(p));
}

export async function getWdSettings(): Promise<WorkdaySettings> {
  return { ...DEFAULT_WD_SETTINGS, ...((await get<WorkdaySettings>(K.settings)) ?? {}) };
}
export async function setWdSettings(s: Partial<WorkdaySettings>): Promise<WorkdaySettings> {
  const next = { ...(await getWdSettings()), ...s };
  await set(K.settings, next);
  return next;
}

export async function getMasterCv(): Promise<StoredDoc | undefined> {
  return get<StoredDoc>(K.masterCv);
}
export async function setMasterCv(doc: StoredDoc | null): Promise<void> {
  if (doc) await set(K.masterCv, doc);
  else await chrome.storage.local.remove(K.masterCv);
}

/** Plain text of the user's own CV (from Google Docs / .docx), used for tailoring and parsing. */
export async function getMasterCvText(): Promise<string> {
  return (await get<string>(K.masterCvText)) ?? "";
}
export async function setMasterCvText(t: string): Promise<void> {
  await set(K.masterCvText, t);
}

/** The user's own cover letter, used as the base voice for each tailored letter. */
export async function getMasterCoverLetter(): Promise<string> {
  return (await get<string>(K.masterCoverLetter)) ?? "";
}
export async function setMasterCoverLetter(t: string): Promise<void> {
  await set(K.masterCoverLetter, t);
}

export async function saveJob(job: JobPosting): Promise<void> {
  await set(K.job(job.key), job);
  await set(K.lastJob(job.tenantHost), job.key);
}
export async function getJob(key: string): Promise<JobPosting | undefined> {
  return get<JobPosting>(K.job(key));
}
export async function getLastJobKey(host: string): Promise<string | undefined> {
  return get<string>(K.lastJob(host));
}

export async function saveDocs(docs: JobDocs): Promise<void> {
  await set(K.docs(docs.jobKey), docs);
}
export async function getDocs(jobKey: string): Promise<JobDocs | undefined> {
  return get<JobDocs>(K.docs(jobKey));
}

export async function getRun(host: string): Promise<RunState | undefined> {
  return get<RunState>(K.run(host));
}
export async function saveRun(run: RunState): Promise<void> {
  run.updatedAt = Date.now();
  if (run.log.length > 300) run.log = run.log.slice(-300);
  await set(K.run(run.tenantHost), run);
}

export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getAnswerBank(): Promise<Record<string, AnswerBankEntry>> {
  return (await get<Record<string, AnswerBankEntry>>(K.answers)) ?? {};
}
export async function rememberAnswer(label: string, answer: string): Promise<void> {
  const bank = await getAnswerBank();
  bank[normalizeLabel(label)] = { label, answer, at: Date.now() };
  await set(K.answers, bank);
}
export async function forgetAnswer(normLabel: string): Promise<void> {
  const bank = await getAnswerBank();
  delete bank[normLabel];
  await set(K.answers, bank);
}

export async function getApplications(): Promise<Application[]> {
  return (await get<Application[]>(K.apps)) ?? [];
}
export async function recordApplication(app: Application): Promise<void> {
  const list = await getApplications();
  if (list.some((a) => a.jobKey === app.jobKey)) return;
  list.unshift(app);
  await set(K.apps, list.slice(0, 1000));
}

/* ---------------- base64 helpers ---------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function docToFile(doc: StoredDoc): File {
  return new File([base64ToBytes(doc.base64)], doc.fileName, { type: doc.mime });
}
