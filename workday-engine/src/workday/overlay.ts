/**
 * Small in-page status pill (shadow DOM, so Workday's CSS can't touch it):
 * current page, pause reason, Resume / Stop.
 */
import type { RunState } from "./types.js";

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let handlers: { resume: () => void; stop: () => void } = { resume: () => {}, stop: () => {} };
let hideTimer: number | undefined; // [oh] one pending auto-hide at a time

export function setOverlayHandlers(h: typeof handlers) {
  handlers = h;
}

function removeOverlay() {
  host?.remove();
  host = null;
  root = null;
}

const LABELS: Record<string, string> = {
  running: "Filling…",
  paused: "Needs you",
  review: "Ready to submit",
  done: "Submitted",
  error: "Error",
  idle: "Stopped",
  filled: "Page filled — check it, then continue", // [oh]
};

export function renderOverlay(run: RunState) {
  if (!document.body) return;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = undefined; } // [oh] a newer state replaces the old one's hide
  if (!host) {
    host = document.createElement("div");
    host.id = "wd-autopilot-overlay";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
    root = host.attachShadow({ mode: "closed" });
    document.body.appendChild(host);
  }
  if (!root) return;
  const color = { running: "#5bc08b", paused: "#e0a86a", review: "#c79a6a", done: "#5bc08b", error: "#e06a6a", idle: "#8892a8", filled: "#5bc08b" }[run.status];
  const last = run.log[run.log.length - 1]?.msg ?? "";
  root.innerHTML = `
    <style>
      .box{font:13px/1.4 system-ui,sans-serif;background:#171a24;color:#e6e9f2;border:1px solid #2a2f40;border-radius:10px;padding:10px 12px;width:300px;box-shadow:0 6px 24px rgba(0,0,0,.35)}
      .top{display:flex;align-items:center;gap:8px;font-weight:600}
      .dot{width:8px;height:8px;border-radius:50%;background:${color}}
      .msg{margin-top:6px;color:#c9cfdd;max-height:72px;overflow:auto}
      .row{display:flex;gap:6px;margin-top:8px}
      button{font:inherit;flex:1;background:#0f1115;color:#e6e9f2;border:1px solid #2a2f40;border-radius:6px;padding:4px 8px;cursor:pointer}
      button.primary{background:#c79a6a;color:#1a1204;border-color:#c79a6a}
      .x{flex:0;padding:0 6px;background:none;border:0;color:#8892a8}
    </style>
    <div class="box" role="status" aria-live="polite">
      <div class="top"><span class="dot"></span>Workday autopilot · ${LABELS[run.status] ?? run.status}<span style="flex:1"></span><button class="x" data-a="hide" aria-label="Hide">✕</button></div>
      <div class="msg"></div>
      <div class="row">
        ${run.status === "paused" || run.status === "error" ? '<button class="primary" data-a="resume">Resume</button>' : ""}
        ${run.status === "running" ? '<button data-a="stop">Stop</button>' : ""}
      </div>
    </div>`;
  const msg = root.querySelector(".msg") as HTMLElement;
  msg.textContent = run.pauseReason || last;
  root.querySelectorAll("button[data-a]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = (b as HTMLElement).dataset.a;
      if (a === "hide") removeOverlay();
      if (a === "resume") handlers.resume();
      if (a === "stop") handlers.stop();
    })
  );
  if (run.status === "idle" || run.status === "filled") hideTimer = window.setTimeout(removeOverlay, 4000);
}
