/**
 * Import the user's own CV / cover letter from Google Docs or a Word (.docx)
 * file. Runs in extension pages (options / side panel).
 *
 * - Google Docs: uses the signed-in browser session to call the Docs export
 *   endpoint (`/export?format=txt|pdf|docx`). The doc must be readable by the
 *   Google account signed in to this browser.
 * - .docx: unzipped in the browser (DecompressionStream) and word/document.xml
 *   is flattened to text, keeping paragraphs and list items.
 */
import { bytesToBase64 } from "./store.js";
import type { StoredDoc } from "./types.js";

export function googleDocId(url: string): string | null {
  const m = url.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

async function exportGoogleDoc(id: string, format: "txt" | "pdf" | "docx"): Promise<Response> {
  const res = await fetch(`https://docs.google.com/document/d/${id}/export?format=${format}`, {
    credentials: "include",
    redirect: "follow",
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error(
      "Couldn't export that Google Doc. Open it in this browser while signed in to the Google account that owns it (or set sharing to 'Anyone with the link'), then try again."
    );
  }
  return res;
}

export async function importGoogleDocText(url: string): Promise<string> {
  const id = googleDocId(url);
  if (!id) throw new Error("That doesn't look like a Google Docs link (docs.google.com/document/d/…).");
  const res = await exportGoogleDoc(id, "txt");
  return (await res.text()).replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
}

/** Export a Google Doc as PDF to upload unchanged (your own design). */
export async function importGoogleDocPdf(url: string, fileName: string): Promise<StoredDoc> {
  const id = googleDocId(url);
  if (!id) throw new Error("That doesn't look like a Google Docs link.");
  const res = await exportGoogleDoc(id, "pdf");
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { fileName, mime: "application/pdf", base64: bytesToBase64(bytes) };
}

/* ---------------- .docx ---------------- */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data.slice()]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal ZIP reader: returns one entry's bytes, using the central directory. */
export async function unzipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .docx (zip) file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const fname = dec.decode(zip.subarray(p + 46, p + 46 + nlen));
    if (fname === name) {
      const lnlen = dv.getUint16(local + 26, true);
      const lelen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnlen + lelen;
      const raw = zip.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error(`Unsupported zip compression method ${method}.`);
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

export async function docxToText(file: File | Uint8Array): Promise<string> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  const xmlBytes = await unzipEntry(bytes, "word/document.xml");
  if (!xmlBytes) throw new Error("word/document.xml not found — is this a Word document?");
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lines: string[] = [];
  for (const p of Array.from(xml.getElementsByTagNameNS(W, "p"))) {
    let line = "";
    const walk = (node: Element) => {
      for (const c of Array.from(node.children)) {
        if (c.namespaceURI === W && c.localName === "t") line += c.textContent ?? "";
        else if (c.namespaceURI === W && c.localName === "tab") line += "\t";
        else if (c.namespaceURI === W && (c.localName === "br" || c.localName === "cr")) line += "\n";
        else if (!(c.namespaceURI === W && c.localName === "p")) walk(c);
      }
    };
    walk(p);
    const isList = p.getElementsByTagNameNS(W, "numPr").length > 0;
    lines.push(isList && line.trim() ? `• ${line.trim()}` : line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fileToStoredDoc(file: File): Promise<StoredDoc> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { fileName: file.name, mime: file.type || "application/octet-stream", base64: bytesToBase64(bytes) };
}
