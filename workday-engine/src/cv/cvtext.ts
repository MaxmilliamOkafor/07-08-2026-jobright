/**
 * The text of your CV (PDF or .docx), line by line, for cvparse.ts. Runs in
 * the job tab, injected only when a CV has to be read (assets/wd-cvtext.js);
 * pdf.js runs on the page's thread (no worker), and only the first pages are
 * read.
 */
// @ts-ignore — pdf.js ships no types for the legacy build's entry points we use
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
// @ts-ignore
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.js";
import { docxToText } from "../workday/import.js";

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfWorker;

interface Item { str: string; x: number; y: number; w: number; h: number }

export async function pdfText(bytes: Uint8Array, maxPages = 6): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height || it.transform[3] || 10) });
    }
    // Rows: items whose baselines are within a third of a line of each other.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Item[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, it.h * 0.35));
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    let lastY: number | null = null;
    for (const r of rows) {
      r.sort((a, b) => a.x - b.x);
      let line = "";
      let end = -1;
      for (const it of r) {
        const charW = it.w / Math.max(1, it.str.length);
        const gap = end < 0 ? 0 : it.x - end;
        line += end < 0 ? "" : gap > charW * 3 ? "   " : gap > charW * 0.25 ? " " : "";
        line += it.str;
        end = it.x + it.w;
      }
      // A blank line where the vertical gap is large (a new block).
      if (lastY !== null && lastY - r[0].y > r[0].h * 2.2) out.push("");
      out.push(line);
      lastY = r[0].y;
    }
    out.push("");
  }
  return out.join("\n");
}

export async function cvText(base64: string, mime: string): Promise<string> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (/pdf/i.test(mime) || (bytes[0] === 0x25 && bytes[1] === 0x50)) return pdfText(bytes);
  if (/word|docx|officedocument/i.test(mime) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return docxToText(bytes);
  return new TextDecoder().decode(bytes);
}
