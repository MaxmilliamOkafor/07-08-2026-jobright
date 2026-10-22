/**
 * assets/wd-cvtext.js — injected into a job tab on demand (oh-bg.js,
 * OH_CV_LOAD) when your CV has to be read; shares the content-script world,
 * so the Workday engine calls window.__ohCv.
 */
import { cvText } from "./cvtext.js";
import { parseCv } from "./cvparse.js";

(window as unknown as { __ohCv: unknown }).__ohCv = {
  text: cvText,
  parse: parseCv,
  async read(base64: string, mime: string) {
    const text = await cvText(base64, mime);
    return { text, profile: parseCv(text) };
  },
};
