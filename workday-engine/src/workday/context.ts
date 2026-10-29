/**
 * Per-run context handed to every page handler in the content script.
 */
import { NeedsHuman, sleep } from "./dom.js";
import type { AnswerCtx } from "./answers.js";
import { docToFile } from "./store.js";
import type { Flag, JobDocs, JobPosting, PageKind, Profile, RunState, StoredDoc, WorkdaySettings } from "./types.js";

export interface Ctx extends AnswerCtx {
  profile: Profile;
  settings: WorkdaySettings;
  job: JobPosting | null;
  docs: JobDocs | null;
  masterCv: StoredDoc | undefined;
  run: RunState;
  page: PageKind;
  log(msg: string, level?: "info" | "warn" | "error"): void;
  flag(label: string, reason: string): void;
  llm(system: string, prompt: string): Promise<string>;
  save(): Promise<void>;
}

export async function pace(ctx: Ctx): Promise<void> {
  await sleep(ctx.settings.fieldDelayMs + Math.floor(Math.random() * 15));
}

export function addFlag(run: RunState, f: Flag) {
  if (!run.flags.some((x) => x.label === f.label && x.page === f.page)) run.flags.push(f);
}

/** The CV to upload for this job, in priority order: job docs → master CV. */
export function pickCv(ctx: Ctx): File | null {
  if (ctx.docs) {
    if (ctx.docs.approved || !ctx.settings.requireDocApproval) return docToFile(ctx.docs.cv);
    throw new NeedsHuman("Approve this job's CV and cover letter in the side panel (Workday tab), then click Resume.");
  }
  if (ctx.masterCv && ctx.settings.fallbackToMasterCv) return docToFile(ctx.masterCv);
  return null;
}

export function pickCoverLetter(ctx: Ctx): File | null {
  if (ctx.docs?.coverLetter && (ctx.docs.approved || !ctx.settings.requireDocApproval)) return docToFile(ctx.docs.coverLetter);
  return null;
}
