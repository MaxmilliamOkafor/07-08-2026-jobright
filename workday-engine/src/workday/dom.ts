/**
 * DOM helpers for Workday's React SPA: waiting for the page to settle,
 * visibility, label resolution, robust clicking and fuzzy option matching.
 */
import { AID, LABELS, sel, type AidKey } from "./selectors.js";
import { COUNTRY_ALIASES, DECLINE_RX as DECLINE_I18N, OPTION_SYNONYMS } from "./i18n.js";

export class Aborted extends Error {
  constructor() {
    super("Stopped by user");
  }
}

/** Thrown when the engine must hand control to the human. */
export class NeedsHuman extends Error {
  constructor(public reason: string, public label = "") {
    super(reason);
  }
}

let abortFlag = false;
export function setAbort(v: boolean) {
  abortFlag = v;
}
export function checkAbort() {
  if (abortFlag) throw new Aborted();
}

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms)).then(checkAbort);

export function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

export function qa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function q<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

/** First visible element for a logical automation id. */
export function byAid(key: AidKey, root: ParentNode = document): HTMLElement | null {
  for (const id of AID[key]) {
    const hit = qa(`[data-automation-id="${id}"]`, root).find(isVisible);
    if (hit) return hit;
  }
  return null;
}

export function anyAid(key: AidKey, root: ParentNode = document): boolean {
  return qa(sel(key), root).some(isVisible);
}

export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  timeoutMs = 8000,
  everyMs = 100
): Promise<T> {
  const start = Date.now();
  for (;;) {
    checkAbort();
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the page");
    await sleep(everyMs);
  }
}

/** Resolve when no spinner is visible and the DOM has been quiet for `quietMs`. */
export async function waitStable(quietMs = 600, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  let last = Date.now();
  const obs = new MutationObserver(() => {
    last = Date.now();
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  try {
    for (;;) {
      checkAbort();
      const busy =
        anyAid("spinner") || qa('[role="progressbar"]').some((e) => isVisible(e) && !e.closest(sel("progressBar")));
      if (!busy && Date.now() - last >= quietMs) return;
      if (Date.now() - start > timeoutMs) return; // proceed; detection decides what to do
      await sleep(100);
    }
  } finally {
    obs.disconnect();
  }
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The label text of a form field container or control. */
export function labelOf(el: HTMLElement): string {
  const container = el.closest<HTMLElement>('[data-automation-id^="formField-"]') ?? el;
  const legend = container.querySelector("legend, label");
  let t = text(legend);
  if (!t) {
    const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
    t = ids.map((id) => text(document.getElementById(id))).join(" ");
  }
  if (!t) t = el.getAttribute("aria-label") ?? "";
  if (!t && el.id) t = text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
  return t.replace(/\*/g, "").trim();
}

export function isRequired(container: HTMLElement): boolean {
  if (/\*/.test(text(container.querySelector("legend, label")))) return true;
  return !!container.querySelector('[aria-required="true"], [required]');
}

/** Find a field by automation id, then by label regex, inside `root`. */
export function field(key: AidKey, root: ParentNode = document): HTMLElement | null {
  const hit = byAid(key, root);
  if (hit) return hit;
  const rx = LABELS[key];
  if (!rx) return null;
  for (const c of qa('[data-automation-id^="formField-"]', root)) {
    if (!isVisible(c)) continue;
    if (rx.test(labelOf(c))) return c;
  }
  return null;
}

/**
 * Click like a person: scroll into view, then dispatch the full pointer
 * sequence on whatever is actually on top at the element's centre. Workday
 * puts a transparent `click_filter` div over many buttons.
 */
export async function humanClick(el: HTMLElement): Promise<void> {
  checkAbort();
  el.scrollIntoView({ block: "center", inline: "nearest" });
  await sleep(60);
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  let target = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el;
  // Only redirect to the top element if it is the button itself, a child, or Workday's click filter.
  const filter = el.parentElement?.querySelector<HTMLElement>(sel("clickFilter"));
  if (!(el.contains(target) || target === filter)) target = filter && isVisible(filter) ? filter : el;
  const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new PointerEvent("pointerover", opts));
  target.dispatchEvent(new PointerEvent("pointerdown", opts));
  target.dispatchEvent(new MouseEvent("mousedown", opts));
  target.focus?.();
  target.dispatchEvent(new PointerEvent("pointerup", opts));
  target.dispatchEvent(new MouseEvent("mouseup", opts));
  target.dispatchEvent(new MouseEvent("click", opts));
}

/** Find a visible button/link by its text. */
export function buttonByText(rx: RegExp, root: ParentNode = document): HTMLElement | null {
  return (
    qa('button, [role="button"], a', root).find((b) => isVisible(b) && rx.test(text(b) || b.getAttribute("aria-label") || "")) ??
    null
  );
}

/* ---------------- fuzzy matching ---------------- */

const SYNONYMS: [RegExp, string][] = [
  [/\b(usa|u\.s\.a?\.?|united states of america)\b/g, "united states"],
  [/\b(uk|u\.k\.|great britain|britain)\b/g, "united kingdom"],
  [/\bcell( phone)?\b/g, "mobile"],
  [/\b(bachelor'?s?|bsc|b\.sc\.?|ba|b\.a\.?|beng|licence|licenciatura|grado|laurea triennale|licencjat|bacharelado)\b/g, "bachelor"],
  [/\b(master'?s?|msc|m\.sc\.?|ma|m\.a\.?|meng|mba|máster|maîtrise|mestrado|laurea magistrale|magister)\b/g, "master"],
  [/\b(phd|ph\.d\.?|doctorate|doktor|doctorat|doctorado|doutorado|dottorato)\b/g, "doctor"],
];

// "Vereinigtes Königreich" / "Royaume-Uni" / … → "united kingdom" so profile values match localised options.
const COUNTRY_RX: [RegExp, string][] = Object.entries(COUNTRY_ALIASES).flatMap(([canon, aliases]) =>
  aliases.map((a) => [new RegExp(`(^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\p{L}]|$)`, "giu"), `$1${canon}`] as [RegExp, string])
);

export function norm(s: string): string {
  let t = s.toLowerCase().normalize("NFKC").replace(/[’']/g, "'").trim();
  for (const [rx, rep] of COUNTRY_RX) t = t.replace(rx, rep);
  for (const [rx, rep] of OPTION_SYNONYMS) t = t.replace(rx, rep);
  for (const [rx, rep] of SYNONYMS) t = t.replace(rx, rep);
  t = t.normalize("NFD").replace(/\p{M}+/gu, "");
  return t.replace(/[^\p{L}\p{N}+ ]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.startsWith(x) || x.startsWith(y)) return 0.92;
  if (y.includes(x) || x.includes(y)) return 0.85;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  let inter = 0;
  tx.forEach((t) => ty.has(t) && inter++);
  return inter / Math.max(tx.size, ty.size);
}

export function bestMatch<T extends HTMLElement>(els: T[], wanted: string, min = 0.6): T | null {
  let best: T | null = null;
  let score = 0;
  for (const el of els) {
    const s = similarity(wanted, text(el));
    if (s > score) {
      score = s;
      best = el;
    }
  }
  return score >= min ? best : null;
}

/** Matches "decline to answer" style options for EEO questions, in every supported language. */
export const DECLINE_RX = DECLINE_I18N;
