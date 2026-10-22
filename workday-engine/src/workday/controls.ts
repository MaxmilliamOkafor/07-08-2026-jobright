/**
 * Control-level recipes for Workday's React widgets. Every setter verifies its
 * write and throws (or returns false) when the value didn't stick, because
 * Workday silently discards input that React never saw.
 */
import {
  DECLINE_RX,
  NeedsHuman,
  bestMatch,
  humanClick,
  isVisible,
  labelOf,
  q,
  qa,
  similarity,
  sleep,
  text,
  waitFor,
  waitStable,
} from "./dom.js";
import { sel } from "./selectors.js";

export type ControlKind =
  | "text"
  | "textarea"
  | "dropdown"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "checkboxGroup"
  | "date"
  | "file"
  | "none";

let trustedFallback = false;
export function enableTrustedFallback(v: boolean) {
  trustedFallback = v;
}

export function kindOf(el: HTMLElement): ControlKind {
  if (el.matches('input[type="file"]') || q('input[type="file"]', el)) return "file";
  if (el.matches(sel("dateMonth") + "," + sel("dateYear")) || q(sel("dateYear"), el) || q(sel("dateMonth"), el)) return "date";
  if (q(sel("searchBox"), el) || q('[data-uxi-widget-type="multiselect"]', el) || q(sel("selectedItem"), el)) return "multiselect";
  if (el.matches('button[aria-haspopup="listbox"]') || q('button[aria-haspopup="listbox"]', el)) return "dropdown";
  if (el.matches('input[type="radio"], [role="radio"]') || q('input[type="radio"], [role="radio"]', el)) return "radio";
  const boxes = el.matches('input[type="checkbox"]') ? [el] : qa('input[type="checkbox"], [role="checkbox"]', el);
  if (boxes.length > 1) return "checkboxGroup";
  if (boxes.length === 1) return "checkbox";
  if (el.matches("textarea") || q("textarea", el)) return "textarea";
  if (el.matches("input") || q('input:not([type="hidden"])', el)) return "text";
  return "none";
}

function inputIn(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  if (el.matches("input, textarea")) return el as HTMLInputElement;
  return q<HTMLInputElement | HTMLTextAreaElement>('textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])', el);
}

/** Native value setter + the events React's onChange listens for. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function blur(el: HTMLElement) {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur"));
  el.blur();
}

/** Ask the service worker to type with trusted (chrome.debugger) input into the focused element. */
async function trustedType(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
  if (!trustedFallback) return false;
  el.focus();
  el.select?.();
  const res = (await chrome.runtime.sendMessage({ type: "wd:trustedType", text: value })) as { ok: boolean } | undefined;
  return !!res?.ok;
}

export async function setText(target: HTMLElement, value: string): Promise<boolean> {
  const el = inputIn(target);
  if (!el || el.disabled || el.readOnly) return false;
  const max = Number(el.getAttribute("maxlength")) || 0;
  const v = max > 0 ? value.slice(0, max) : value;
  if (el.value === v) return true;
  setNativeValue(el, v);
  blur(el);
  await sleep(40);
  if (el.value === v) return true;
  if (await trustedType(el, v)) {
    blur(el);
    await sleep(60);
    return el.value === v;
  }
  return false;
}

/** The listbox belonging to `btn` (aria-controls, same field, or the only one open). */
function openListbox(btn?: HTMLElement | null): HTMLElement | null {
  const ctl = btn?.getAttribute("aria-controls");
  if (ctl) {
    const byId = document.getElementById(ctl);
    if (isVisible(byId) && byId.matches('[role="listbox"]')) return byId;
  }
  const field = btn?.closest('[data-automation-id^="formField-"]');
  const local = field ? qa('[role="listbox"]', field).find(isVisible) : null;
  if (local) return local;
  const open = qa('[role="listbox"]').filter(isVisible);
  // A listbox inside some other field belongs to that field's dropdown.
  return open.find((l) => !l.closest('[data-automation-id^="formField-"]') || l.closest('[data-automation-id^="formField-"]') === field) ?? null;
}

async function closeListbox(btn: HTMLElement) {
  btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  await sleep(80);
  // Some builds only close on a second click of the button.
  if (openListbox(btn)) {
    await humanClick(btn);
    await sleep(80);
  }
}

function dropdownButton(target: HTMLElement): HTMLButtonElement | null {
  return target.matches('button[aria-haspopup="listbox"]')
    ? (target as HTMLButtonElement)
    : q<HTMLButtonElement>('button[aria-haspopup="listbox"]', target);
}

export function dropdownValue(target: HTMLElement): string {
  const b = dropdownButton(target);
  const t = text(b);
  return /^select one$|^select$/i.test(t) ? "" : t;
}

/**
 * Single-select dropdown (a button + listbox). `wanted` may be "decline"
 * to pick the decline-to-answer option.
 */
export async function selectDropdown(target: HTMLElement, wanted: string, min = 0.6): Promise<boolean> {
  const btn = dropdownButton(target);
  if (!btn) return false;
  const current = dropdownValue(target);
  if (current && (wanted === "decline" ? DECLINE_RX.test(current) : similarity(wanted, current) >= 0.92)) return true;
  if (!openListbox(btn)) await humanClick(btn);
  const list = await waitFor(() => openListbox(btn), 4000).catch(() => null);
  if (!list) return false;
  const opts = qa('[role="option"]', list).filter((o) => text(o) && !/^select one$/i.test(text(o)));
  const match = wanted === "decline" ? opts.find((o) => DECLINE_RX.test(text(o))) ?? null : bestMatch(opts, wanted, min);
  if (!match) {
    await closeListbox(btn);
    return false;
  }
  await humanClick(match);
  await sleep(120);
  await waitStable(250, 4000);
  return !!dropdownValue(target);
}

export function dropdownOptions(btn?: HTMLElement | null): string[] {
  const list = openListbox(btn);
  return list ? qa('[role="option"]', list).map(text).filter(Boolean) : [];
}

/** Read a dropdown's options by opening and closing it. */
export async function readDropdownOptions(target: HTMLElement): Promise<string[]> {
  const btn = dropdownButton(target);
  if (!btn) return [];
  if (!openListbox(btn)) await humanClick(btn);
  await waitFor(() => openListbox(btn), 3000).catch(() => null);
  const out = dropdownOptions(btn).filter((o) => !/^select one$/i.test(o));
  await closeListbox(btn);
  return out;
}

export function multiselectSelected(target: HTMLElement): string[] {
  return qa(sel("selectedItem"), target).map(text).filter(Boolean);
}

function visibleOptions(): HTMLElement[] {
  return qa(sel("promptOption")).filter(isVisible);
}

/**
 * Multiselect with search (source, skills, phone code, school, field of
 * study, ethnicity). Hierarchical prompts are walked one level at a time.
 */
export async function multiselectPick(target: HTMLElement, wanted: string, opts: { min?: number; fallbackFirst?: boolean } = {}): Promise<boolean> {
  const min = opts.min ?? 0.6;
  if (multiselectSelected(target).some((s) => similarity(wanted, s) >= 0.85)) return true;
  const input = q<HTMLInputElement>(sel("searchBox"), target) ?? q<HTMLInputElement>("input", target);
  if (!input) return false;
  await humanClick(input);
  setNativeValue(input, wanted);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  await sleep(250);
  for (let depth = 0; depth < 3; depth++) {
    const options = await waitFor(() => {
      const o = visibleOptions();
      return o.length ? o : null;
    }, 4000).catch(() => [] as HTMLElement[]);
    if (!options.length) break;
    let match = bestMatch(options, wanted, min);
    if (!match && opts.fallbackFirst) match = options[0];
    if (!match) break;
    await humanClick(match);
    await sleep(250);
    if (multiselectSelected(target).length) {
      blur(input);
      return true;
    }
    // Non-leaf: Workday drilled into a sub-list; loop picks again.
  }
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  blur(input);
  await sleep(80);
  return multiselectSelected(target).some((s) => similarity(wanted, s) >= 0.6);
}

function radios(target: HTMLElement): HTMLElement[] {
  return qa('input[type="radio"], [role="radio"]', target);
}

function optionLabel(input: HTMLElement): string {
  if (input.id) {
    const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (l) return text(l);
  }
  return text(input.closest("label")) || input.getAttribute("aria-label") || text(input.parentElement);
}

export function radioOptions(target: HTMLElement): string[] {
  return radios(target).map(optionLabel);
}

export function radioValue(target: HTMLElement): string {
  const r = radios(target).find((x) => (x as HTMLInputElement).checked || x.getAttribute("aria-checked") === "true");
  return r ? optionLabel(r) : "";
}

export async function selectRadio(target: HTMLElement, wanted: string): Promise<boolean> {
  const rs = radios(target);
  let best: HTMLElement | null = null;
  let score = 0;
  for (const r of rs) {
    const l = optionLabel(r);
    const s = wanted === "decline" ? (DECLINE_RX.test(l) ? 1 : 0) : similarity(wanted, l);
    if (s > score) {
      score = s;
      best = r;
    }
  }
  if (!best || score < 0.6) return false;
  if ((best as HTMLInputElement).checked) return true;
  await humanClick(best);
  await sleep(80);
  return radioValue(target) === optionLabel(best);
}

export async function setCheckbox(target: HTMLElement, checked: boolean): Promise<boolean> {
  const box = target.matches('input[type="checkbox"], [role="checkbox"]') ? target : q('input[type="checkbox"], [role="checkbox"]', target);
  if (!box) return false;
  const isOn = () => (box as HTMLInputElement).checked || box.getAttribute("aria-checked") === "true";
  if (isOn() === checked) return true;
  await humanClick(box);
  await sleep(80);
  return isOn() === checked;
}

/** Pick one checkbox in a group by label (e.g. disability status). */
export async function checkInGroup(target: HTMLElement, wanted: string): Promise<boolean> {
  const boxes = qa('input[type="checkbox"], [role="checkbox"]', target);
  const scored = boxes
    .map((b) => {
      const l = optionLabel(b);
      return { b, s: wanted === "decline" ? (DECLINE_RX.test(l) ? 1 : 0) : similarity(wanted, l) };
    })
    .sort((a, b) => b.s - a.s);
  if (!scored[0] || scored[0].s < 0.5) return false;
  return setCheckbox(scored[0].b, true);
}

export function checkboxGroupOptions(target: HTMLElement): string[] {
  return qa('input[type="checkbox"], [role="checkbox"]', target).map(optionLabel);
}

/* ---------------- dates ---------------- */

async function setSegment(seg: HTMLInputElement, value: string): Promise<boolean> {
  const clean = () => (seg.value || seg.getAttribute("aria-valuenow") || "").replace(/^0+/, "");
  const want = value.replace(/^0+/, "");
  if (clean() === want) return true;
  await humanClick(seg);
  // Workday's spinbuttons react to keystrokes; send each digit as keydown + input.
  for (const ch of value) {
    seg.dispatchEvent(new KeyboardEvent("keydown", { key: ch, code: `Digit${ch}`, bubbles: true }));
    seg.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true }));
    seg.dispatchEvent(new KeyboardEvent("keyup", { key: ch, code: `Digit${ch}`, bubbles: true }));
    await sleep(30);
  }
  if (clean() !== want) setNativeValue(seg, value);
  await sleep(60);
  if (clean() !== want && trustedFallback) {
    seg.focus();
    await chrome.runtime.sendMessage({ type: "wd:trustedType", text: value });
    await sleep(80);
  }
  return clean() === want;
}

/** Fill a Workday date widget. `ym` is "YYYY-MM" or "YYYY-MM-DD" or "YYYY". */
export async function setDate(target: HTMLElement, ym: string): Promise<boolean> {
  const [y, m, d] = ym.split("-");
  const month = q<HTMLInputElement>(sel("dateMonth"), target);
  const day = q<HTMLInputElement>(sel("dateDay"), target);
  const year = q<HTMLInputElement>(sel("dateYear"), target);
  let ok = true;
  if (month && m) ok = (await setSegment(month, m)) && ok;
  if (day && d) ok = (await setSegment(day, d)) && ok;
  if (year && y) ok = (await setSegment(year, y)) && ok;
  if (!month && !year) {
    // Plain text date field fallback (MM/YYYY or MM/DD/YYYY).
    return setText(target, [m, d, y].filter(Boolean).join("/"));
  }
  if (year) blur(year);
  return ok;
}

export function dateValue(target: HTMLElement): string {
  const y = q<HTMLInputElement>(sel("dateYear"), target)?.value ?? "";
  const m = q<HTMLInputElement>(sel("dateMonth"), target)?.value ?? "";
  return [y, m].filter(Boolean).join("-");
}

/* ---------------- files ---------------- */

export function uploadedFileNames(root: ParentNode = document): string[] {
  return qa(sel("fileUploaded"), root).filter(isVisible).map(text);
}

export async function uploadFile(target: HTMLElement, file: File): Promise<boolean> {
  const input = target.matches('input[type="file"]') ? (target as HTMLInputElement) : q<HTMLInputElement>('input[type="file"]', target);
  if (!input) return false;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const root = input.closest('[data-automation-id^="formField-"]')?.parentElement ?? document;
  const stem = file.name.replace(/\.[a-z]+$/i, "").slice(0, 12).toLowerCase();
  return !!(await waitFor(
    () => uploadedFileNames(root).some((n) => n.toLowerCase().includes(stem)) || uploadedFileNames().some((n) => n.toLowerCase().includes(stem)),
    20000,
    250
  ).catch(() => false));
}

/* ---------------- generic read ---------------- */

export function readValue(container: HTMLElement): string {
  switch (kindOf(container)) {
    case "text":
    case "textarea":
      return inputIn(container)?.value ?? "";
    case "dropdown":
      return dropdownValue(container);
    case "multiselect":
      return multiselectSelected(container).join(", ");
    case "radio":
      return radioValue(container);
    case "checkbox": {
      const b = q('input[type="checkbox"], [role="checkbox"]', container) ?? container;
      return (b as HTMLInputElement).checked || b.getAttribute("aria-checked") === "true" ? "true" : "";
    }
    case "checkboxGroup":
      return qa('input[type="checkbox"], [role="checkbox"]', container)
        .filter((b) => (b as HTMLInputElement).checked || b.getAttribute("aria-checked") === "true")
        .map(optionLabel)
        .join(", ");
    case "date":
      return dateValue(container);
    case "file":
      return uploadedFileNames(container.parentElement ?? container).join(", ");
    default:
      return "";
  }
}

/** Options a choice control offers (dropdown is opened briefly). */
export async function optionsOf(container: HTMLElement): Promise<string[]> {
  switch (kindOf(container)) {
    case "dropdown":
      return readDropdownOptions(container);
    case "radio":
      return radioOptions(container);
    case "checkboxGroup":
      return checkboxGroupOptions(container);
    case "checkbox":
      return ["true", "false"];
    default:
      return [];
  }
}

/** Write any control from a string answer. */
export async function writeValue(container: HTMLElement, answer: string): Promise<boolean> {
  switch (kindOf(container)) {
    case "text":
    case "textarea":
      return setText(container, answer);
    case "dropdown":
      return selectDropdown(container, answer);
    case "multiselect":
      return multiselectPick(container, answer);
    case "radio":
      return selectRadio(container, answer);
    case "checkbox":
      return setCheckbox(container, /^(true|yes|y|1|checked)$/i.test(answer.trim()));
    case "checkboxGroup":
      return checkInGroup(container, answer);
    case "date":
      return setDate(container, answer);
    default:
      throw new NeedsHuman(`Can't fill "${labelOf(container)}"`, labelOf(container));
  }
}
