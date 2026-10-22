// Bundles your Workday engine + the Jobright adapter into the extension:
//   cd workday-engine && npm install && npm run build
//   → "AAAA - Jobright Autofill/ua-wd-engine.js"  (content script on Workday hosts)
//   → "AAAA - Jobright Autofill/ua-wd-cvtext.js"  (CV reader with pdf.js, injected only when a CV is read)
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(dirname(here), "AAAA - Jobright Autofill");

await build({
  entryPoints: [join(here, "src/cv/entry.ts")],
  outfile: join(ext, "ua-wd-cvtext.js"),
  bundle: true,
  format: "iife",
  target: "chrome110",
  charset: "utf8",
  minify: true,
  legalComments: "none",
  banner: { js: "/* ua-wd-cvtext.js — built from workday-engine/src/cv (npm run build). Includes pdf.js (Apache-2.0, Mozilla). Do not edit here. */" },
  logLevel: "info",
});

await build({
  entryPoints: [join(here, "src/ua/entry.ts")],
  outfile: join(ext, "ua-wd-engine.js"),
  bundle: true,
  format: "iife",
  target: "chrome110",
  charset: "utf8",
  legalComments: "none",
  banner: { js: "/* ua-wd-engine.js — your Workday engine, built from workday-engine/ (npm run build). Do not edit here. */" },
  logLevel: "info",
});
