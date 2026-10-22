/**
 * Your CV's text → work history, education, skills and summary, so the
 * Workday engine can add every role ("Add Another"), tick the current one
 * and give each its full description — without a profile being imported.
 *
 * Pure text heuristics, no network. Built for the layouts CVs actually use:
 *   Senior Software Engineer                 Title / company / dates on
 *   Meta — Dublin, Ireland                   separate lines, in any order,
 *   Jan 2023 – Present                       or together on one line with
 *   • Built …                                | — – , · "at" between them.
 * An entry is only kept when it has a title, a company and a start date.
 */
import type { EducationEntry, WorkEntry } from "../workday/types.js";

export interface CvProfile {
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  languages: { language: string; proficiency: string; native: boolean }[];
  summary: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MON = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE = `(?:${MON}\\.?\\s*,?\\s*\\d{4}|\\d{1,2}\\s*[/.-]\\s*\\d{4}|\\d{4}\\s*[/.-]\\s*\\d{1,2}|(?:19|20)\\d{2})`;
const END = `(?:present|current(?:ly)?|now|today|ongoing|date|${DATE})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:–|—|-|to|until|till|→|>)\\s*(${END})`, "i");

const HEADINGS: [RegExp, string][] = [
  [/^(professional |work |relevant |employment |career )?(experience|history)$|^employment$|^work history$|^career history$|^experience & projects$/i, "work"],
  [/^(education|academic (background|history|qualifications)|qualifications|education & training|education and training)$/i, "education"],
  [/^((technical|core|key|professional) )?(skills|competencies|technologies|tech stack|toolkit|expertise)( & tools| and tools)?$/i, "skills"],
  [/^(professional |personal |career )?(summary|profile|objective|about( me)?|overview)$/i, "summary"],
  [/^languages?$/i, "languages"],
  [/^(certifications?|licen[cs]es?( & certifications)?|certificates|projects|selected projects|publications|awards|honou?rs|interests|hobbies|references|volunteer(ing)?( experience)?|achievements|courses|training|activities|leadership)$/i, "other"],
];

const TITLE_RE = /\b(engineer|developer|programmer|architect|scientist|analyst|manager|lead|leader|director|head|consultant|specialist|designer|administrator|officer|associate|intern|trainee|assistant|coordinator|executive|president|vp|cto|ceo|cfo|founder|co-founder|owner|researcher|lecturer|teacher|tutor|technician|advisor|adviser|representative|strategist|product owner|scrum master|sre|devops|accountant|auditor|nurse|editor|writer|recruiter|partner|principal|fellow|apprentice)\b/i;
const COMPANY_RE = /\b(inc|ltd|llc|llp|plc|gmbh|ag|sa|bv|corp|corporation|company|co|limited|group|holdings|technologies|technology|tech|labs|solutions|systems|software|consulting|partners|bank|capital|ventures|studio|studios|agency|services|university|college|institute|hospital|council|foundation|network|media|digital|global|international)\b\.?/i;
const LOCATION_RE = /\b(remote|hybrid|on-?site|ireland|dublin|cork|galway|london|uk|united kingdom|england|scotland|usa|united states|new york|san francisco|seattle|berlin|germany|paris|france|amsterdam|netherlands|lagos|nigeria|india|bangalore|toronto|canada|sydney|australia|singapore|madrid|spain|lisbon|portugal|manchester|edinburgh|belfast)\b/i;
const DEGREE_RE = /\b(b\.?\s?sc|m\.?\s?sc|b\.?\s?eng|m\.?\s?eng|b\.?\s?a|m\.?\s?a|ph\.?\s?d|mba|bachelor'?s?|master'?s?|doctorate|diploma|associate'?s? degree|hnd|a-?levels?|leaving cert(ificate)?|certificate|postgraduate|higher diploma|b\.?tech|m\.?tech|llb|llm|md)\b/i;
const SCHOOL_RE = /\b(university|college|institute|school|academy|polytechnic|universit[éäa]t|ucd|tcd|dcu|mit|ucl|lse)\b/i;
const BULLET_RE = /^\s*([•●▪■◦○∙·*–\-‣⁃➢➤✓✔]|\d+[.)])\s+/;
const SEPARATORS = /\s+[|•·]\s+|\s+[—–]\s+|\s+-\s+|\s{3,}|\s+@\s+|,\s+(?=[A-Z])|\s+at\s+/;

function ym(raw: string, yearOnlyMonth = "01"): string {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  let m = s.match(new RegExp(`^(${MON})\\s*,?\\s*(\\d{4})$`, "i"));
  if (m) return `${m[2]}-${String(MONTHS[m[1].slice(0, m[1].startsWith("sept") ? 4 : 3)] || MONTHS[m[1].slice(0, 3)]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s*[/-]\s*(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})\s*[/-]\s*(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^((?:19|20)\d{2})$/);
  if (m) return `${m[1]}-${yearOnlyMonth}`;
  return "";
}

function clean(s: string): string {
  return s.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s,|•·—–-]+|[\s,|•·—–-]+$/g, "").trim();
}

/** The CV's lines, grouped by section heading. */
function sections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = { top: [] };
  let cur = "top";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const bare = clean(line).replace(/:$/, "");
    if (bare && bare.split(/\s+/).length <= 5) {
      const hit = HEADINGS.find(([re]) => re.test(bare));
      if (hit) {
        cur = hit[1] === "other" ? `other:${bare.toLowerCase()}` : hit[1];
        out[cur] ??= [];
        continue;
      }
    }
    (out[cur] ??= []).push(line);
  }
  return out;
}

function splitParts(line: string): string[] {
  const parts = line.split(SEPARATORS).map(clean).filter(Boolean);
  // "London", "UK" → one location.
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && LOCATION_RE.test(prev) && LOCATION_RE.test(p) && !TITLE_RE.test(p) && p.split(/\s+/).length <= 3) out[out.length - 1] = `${prev}, ${p}`;
    else out.push(p);
  }
  return out;
}

function looksLikeSentence(s: string): boolean {
  const n = s.split(/\s+/).length;
  return n > 10 || (/[.!?]$/.test(s) && n > 3);
}

/** Could this line be part of an entry's heading (title / company / location)? */
function headingLike(raw: string): boolean {
  const t = clean(raw);
  return !!t && !BULLET_RE.test(raw) && !looksLikeSentence(t) && t.split(/\s+/).length <= 9;
}

/** Title / company / location out of an entry's header lines. */
function headerFields(lines: string[]): { title: string; company: string; location: string } {
  const parts: string[] = [];
  for (const l of lines) parts.push(...splitParts(l));
  let title = "", company = "", location = "";
  const rest: string[] = [];
  for (const p of parts) {
    if (!p || RANGE_RE.test(p)) continue;
    if (!location && LOCATION_RE.test(p) && !TITLE_RE.test(p) && p.split(/\s+/).length <= 5) { location = p; continue; }
    if (!title && TITLE_RE.test(p) && !COMPANY_RE.test(p.replace(TITLE_RE, ""))) { title = p; continue; }
    if (!company && COMPANY_RE.test(p) && !TITLE_RE.test(p)) { company = p; continue; }
    rest.push(p);
  }
  for (const p of rest) {
    if (!title && TITLE_RE.test(p)) title = p;
    else if (!company && p.split(/\s+/).length <= 6 && !looksLikeSentence(p)) company = p;
  }
  return { title, company: company.replace(/[,(]\s*$/, ""), location };
}

function parseWork(lines: string[]): WorkEntry[] {
  const L = lines.map((l) => l.replace(/\t/g, "   "));
  const anchors: number[] = [];
  L.forEach((l, i) => { if (RANGE_RE.test(l)) anchors.push(i); });
  // Where each entry's heading starts: the date line, plus the heading lines just above it — one
  // when the date line already names the title or company, up to two when it is only dates.
  const headStart = anchors.map((i, k) => {
    const floor = k ? anchors[k - 1] + 1 : 0;
    const own = headerFields([L[i].replace(RANGE_RE, "   ").replace(/[([]\s*[)\]]/g, " ")]);
    const max = own.title || own.company ? 1 : 2;
    let s = i;
    for (let j = i - 1, n = 0; j >= floor && n < max; j--) {
      if (!clean(L[j])) { if (n) break; continue; }
      if (!headingLike(L[j])) break;
      if (max === 1 && !(TITLE_RE.test(L[j]) || COMPANY_RE.test(L[j]))) break;
      s = j;
      n++;
    }
    return s;
  });
  const out: WorkEntry[] = [];
  for (let k = 0; k < anchors.length; k++) {
    const i = anchors[k];
    const m = L[i].match(RANGE_RE)!;
    const start = ym(m[1]);
    const endRaw = m[2];
    const current = /present|current|now|today|ongoing|date/i.test(endRaw);
    const end = current ? "" : ym(endRaw, "12");
    const header: string[] = [];
    for (let j = headStart[k]; j < i; j++) if (clean(L[j])) header.push(L[j]);
    header.push(L[i].replace(RANGE_RE, "   ").replace(/[([]\s*[)\]]/g, " "));
    let bodyFrom = i + 1;
    const nextStart = k + 1 < anchors.length ? headStart[k + 1] : L.length;
    // A heading line just below the dates (company + dates on one line, title under it).
    if (bodyFrom < nextStart && headingLike(L[bodyFrom])) {
      const f0 = headerFields(header);
      if (!f0.title || !f0.company) { header.push(L[bodyFrom]); bodyFrom++; }
    }
    const f = headerFields(header);
    const bullets: string[] = [];
    for (let j = bodyFrom; j < nextStart; j++) {
      const raw = L[j];
      const t = clean(raw.replace(BULLET_RE, ""));
      if (!t) continue;
      if (BULLET_RE.test(raw) || !bullets.length) bullets.push(t);
      else {
        const last = bullets[bullets.length - 1];
        if (/[.;:!?]$/.test(last) && /^[A-Z]/.test(t)) bullets.push(t);
        else bullets[bullets.length - 1] = `${last} ${t}`;
      }
    }
    if (!f.title || !f.company || !start) continue;
    out.push({
      id: `w${out.length + 1}`,
      title: f.title.slice(0, 100),
      company: f.company.slice(0, 100),
      location: f.location.slice(0, 80),
      start,
      end: end || undefined,
      current,
      bullets: bullets.slice(0, 12).map((b) => b.slice(0, 400)),
    });
  }
  return out;
}

const DEGREE_HEAD_RE = /^(.*?\b(?:b\.?\s?sc|m\.?\s?sc|b\.?\s?eng|m\.?\s?eng|b\.?\s?a|m\.?\s?a|ph\.?\s?d|mba|bachelor'?s?(?: degree)?(?: of (?:science|arts|engineering))?|master'?s?(?: degree)?(?: of (?:science|arts|engineering))?|doctorate|higher diploma|diploma|b\.?tech|m\.?tech|llb|llm|postgraduate(?: diploma| certificate)?))\s*(?:\(hons\.?\)|honou?rs)?\s*(?:in|of|,|-|–|—)?\s*(.*)$/i;

function parseEducation(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  const L = lines.map(clean).filter(Boolean);
  for (let i = 0; i < L.length; i++) {
    const own = L[i];
    if (!SCHOOL_RE.test(own)) continue;
    // The school's line, and the line next to it when the degree sits there.
    const ownParts = splitParts(own.replace(RANGE_RE, "   ").replace(/\b(19|20)\d{2}\b/g, "   ")).flatMap((p) => p.split(/,\s*/)).map(clean).filter(Boolean);
    const school = ownParts.find((p) => SCHOOL_RE.test(p) && !DEGREE_RE.test(p)) || ownParts.find((p) => SCHOOL_RE.test(p)) || "";
    if (!school || out.some((e) => e.school === school)) continue;
    const pool = [own, L[i + 1] || "", L[i - 1] || ""];
    const degLine = pool.find((l) => DEGREE_RE.test(l) && !RANGE_RE.test(l.replace(DEGREE_RE, "")) || DEGREE_RE.test(l)) || "";
    let degree = "", field = "";
    const degPart = splitParts(degLine.replace(RANGE_RE, "   ")).find((p) => DEGREE_RE.test(p)) || "";
    const dm = degPart.match(DEGREE_HEAD_RE);
    if (dm) {
      degree = clean(dm[1]);
      field = clean(dm[2]).replace(/\b(19|20)\d{2}\b.*$/, "").replace(SCHOOL_RE, "").split(/,\s*/)[0].trim();
      if (SCHOOL_RE.test(field)) field = "";
    }
    const dateText = [own, L[i + 1] || ""].find((l) => RANGE_RE.test(l) || /\b(19|20)\d{2}\b/.test(l)) || "";
    const range = dateText.match(RANGE_RE);
    const years = dateText.match(/\b(19|20)\d{2}\b/g) || [];
    out.push({
      id: `e${out.length + 1}`,
      school: school.slice(0, 120),
      degree: degree.slice(0, 80),
      field: field.slice(0, 80),
      start: range ? ym(range[1], "09") : years.length > 1 ? `${years[0]}-09` : "",
      end: range ? (ym(range[2], "06") || undefined) : years.length ? `${years[years.length - 1]}-06` : undefined,
    });
  }
  return out;
}

function parseSkills(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const body = raw.replace(/^[^:]{1,30}:\s*/, "").replace(BULLET_RE, "");
    for (const t of body.split(/\s*[,;|•·●▪/]\s*|\s{2,}/)) {
      const s = clean(t).replace(/\.$/, "");
      if (s.length < 2 || s.length > 40 || s.split(/\s+/).length > 4 || /^(and|or|etc)$/i.test(s)) continue;
      const k = s.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
  }
  return out.slice(0, 40);
}

function parseLanguages(lines: string[]): CvProfile["languages"] {
  const out: CvProfile["languages"] = [];
  for (const raw of lines) {
    for (const part of raw.split(/\s*[,;|•·]\s*/)) {
      const m = clean(part).match(/^([A-Z][a-zA-Zéèäöüñ ]{1,20}?)\s*(?:[-–:(]\s*([A-Za-z0-9 ]{2,30})\)?)?$/);
      if (!m) continue;
      const level = (m[2] || "").trim();
      out.push({ language: m[1].trim(), proficiency: level || "Fluent", native: /native|mother/i.test(level) });
    }
  }
  return out.slice(0, 8);
}

export function parseCv(text: string): CvProfile {
  const sec = sections(text.replace(/ /g, " "));
  let work = parseWork(sec.work || []);
  // Some CVs have no "Experience" heading: look for roles anywhere before Education.
  if (!work.length) work = parseWork([...(sec.top || []), ...Object.entries(sec).filter(([k]) => k.startsWith("other:")).flatMap(([, v]) => v)]);
  return {
    work,
    education: parseEducation(sec.education || []),
    skills: parseSkills(sec.skills || []),
    languages: parseLanguages(sec.languages || []),
    summary: clean((sec.summary || []).join(" ")).slice(0, 1200),
  };
}
