/**
 * Hooks a host extension sets to run the engine unattended (OptimHire runs:
 * nobody at the PC, so it submits instead of stopping on Review and asks the
 * host for answers). With no hooks set the engine behaves exactly as in the
 * standalone extension.
 */
import type { ControlKind } from "./controls.js";
import type { Profile, RunState, StoredDoc, WorkdaySettings } from "./types.js";

export type Outcome = "submitted" | "review" | "paused" | "error" | "stopped";

export interface OpenQuestion {
  label: string;
  kind: ControlKind;
  options: string[];
  required: boolean;
}

export interface EngineHooks {
  /** This run's profile / settings / master CV instead of the stored ones. */
  profile?: () => Promise<Profile>;
  settings?: () => Promise<WorkdaySettings>;
  masterCv?: () => Promise<StoredDoc | undefined>;
  /** Click Submit on Review instead of stopping there. */
  autoSubmit?: () => boolean;
  /** false = fill the page on screen and stop: never press Next, Apply or sign in (you drive). */
  advance?: () => boolean;
  /** true = leave fields that already hold a value (what you typed, or Workday read from the CV). */
  keepExisting?: () => boolean;
  /** Fetch answers for a page's open questions in one request, before they are resolved one by one. */
  prefetch?: (questions: OpenQuestion[]) => Promise<void>;
  /** The host's answer to one question (the user's own saved answers / answer service), or null. */
  answer?: (label: string, kind: ControlKind, options: string[]) => Promise<string | null>;
  /** The run ended: submitted, stopped on Review, paused for the user, failed, or stopped. */
  onFinish?: (run: RunState, outcome: Outcome) => void;
  /** Every page the run reaches. */
  onPage?: (run: RunState) => void;
  /** Awaited before My Experience is filled (e.g. your work history is still being read from your CV). */
  beforeExperience?: () => Promise<void>;
}

export const hooks: EngineHooks = {};

export function setHooks(h: EngineHooks): void {
  clearHooks();
  Object.assign(hooks, h);
}

export function clearHooks(): void {
  for (const k of Object.keys(hooks)) delete (hooks as Record<string, unknown>)[k];
}
