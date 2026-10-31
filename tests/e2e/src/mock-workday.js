/* Mock Workday candidate app (React 18, controlled inputs, data-automation-id
 * markup modelled on the real thing) used by run.mjs to drive the autopilot
 * end to end: job → apply → create account → resume → 5 wizard steps → review.
 */
/* global React, ReactDOM */
const h = React.createElement;
const { useState, useEffect } = React;

const LANG = location.pathname.startsWith("/de-DE") ? "de" : "en";
const DE = {
  "My Information": "Meine Informationen", "My Experience": "Meine Erfahrung", "Application Questions": "Bewerbungsfragen",
  "Voluntary Disclosures": "Freiwillige Angaben", "Self Identify": "Selbstidentifizierung", "Review": "Überprüfen",
  "Apply": "Bewerben", "Autofill with Resume": "Mit Lebenslauf automatisch ausfüllen", "Apply Manually": "Manuell bewerben",
  "Sign In": "Anmelden", "Create Account": "Konto erstellen", "Continue": "Weiter", "Save and Continue": "Speichern und fortfahren",
  "Submit": "Absenden", "Add": "Hinzufügen", "Add Another": "Weitere hinzufügen", "Delete": "Löschen",
  "Application Submitted": "Bewerbung erfolgreich eingereicht", "Thank you for applying.": "Vielen Dank für Ihre Bewerbung.",
  "Invalid email address or password.": "Ungültige E-Mail-Adresse oder ungültiges Passwort.",
  "An account already exists for this email address.": "Für diese E-Mail-Adresse existiert bereits ein Konto.",
  "Upload your resume": "Lebenslauf hochladen", "Senior Software Engineer": "Senior Software Engineer (m/w/d)",
  "How Did You Hear About Us?": "Wie haben Sie von uns erfahren?", "Have you previously worked for us?": "Haben Sie bereits für uns gearbeitet?",
  "Yes": "Ja", "No": "Nein", "Country": "Land", "Canada": "Kanada", "United Kingdom": "Vereinigtes Königreich", "United States of America": "Vereinigte Staaten von Amerika",
  "First Name": "Vorname", "Last Name": "Nachname", "Address Line 1": "Adresszeile 1", "City": "Stadt", "County": "Grafschaft", "Postal Code": "Postleitzahl",
  "Phone Device Type": "Telefongerätetyp", "Landline": "Festnetz", "Mobile": "Mobil", "Country Phone Code": "Ländervorwahl",
  "United Kingdom (+44)": "Vereinigtes Königreich (+44)", "United States of America (+1)": "Vereinigte Staaten von Amerika (+1)", "Phone Number": "Telefonnummer",
  "Work Experience": "Berufserfahrung", "Job Title": "Berufsbezeichnung", "Company": "Unternehmen", "Location": "Standort", "I currently work here": "Ich arbeite derzeit hier",
  "From": "Von", "To": "Bis", "Role Description": "Tätigkeitsbeschreibung", "Education": "Ausbildung", "School or University": "Schule oder Universität",
  "Degree": "Abschluss", "Bachelor's Degree": "Bachelor", "Master's Degree": "Master", "Doctorate": "Doktor", "Field of Study": "Studienfach",
  "Computer Science": "Informatik", "Mathematics": "Mathematik", "Physics": "Physik", "To (Actual or Expected)": "Bis (tatsächlich oder voraussichtlich)",
  "Type to Add Skills": "Kenntnisse hinzufügen", "Resume/CV": "Lebenslauf", "LinkedIn Profile": "LinkedIn-Profil",
  "Are you legally authorized to work in the United Kingdom?": "Sind Sie berechtigt, im Vereinigten Königreich zu arbeiten?",
  "Will you now or in the future require sponsorship for employment visa status?": "Benötigen Sie jetzt oder künftig ein Visum oder Sponsoring für eine Arbeitserlaubnis?",
  "What are your salary expectations?": "Wie hoch sind Ihre Gehaltsvorstellungen?",
  "Have you ever been convicted of a criminal offence?": "Wurden Sie jemals wegen einer Straftat verurteilt?",
  "How many years of experience do you have with Python?": "Wie viele Jahre Erfahrung haben Sie mit Python?",
  "0-2 years": "0-2 Jahre", "3-5 years": "3-5 Jahre", "6+ years": "6+ Jahre", "Why do you want to work here?": "Warum möchten Sie bei uns arbeiten?",
  "Gender": "Geschlecht", "Male": "Männlich", "Female": "Weiblich", "I do not wish to answer": "Ich möchte keine Angabe machen",
  "Ethnicity": "Ethnische Herkunft", "Asian": "Asiatisch", "White": "Weiß", "Black or African American": "Schwarz", "I decline to self-identify": "Keine Angabe",
  "Veteran Status": "Veteranenstatus", "I am not a protected veteran": "Ich bin kein geschützter Veteran", "I identify as a protected veteran": "Ich bin ein geschützter Veteran",
  "I don't wish to answer": "Ich möchte das nicht angeben", "I have read and consent to the terms and conditions": "Ich habe die Bedingungen gelesen und stimme zu",
  "Name": "Name", "Date": "Datum", "Please check one of the boxes below": "Bitte kreuzen Sie eines der Kästchen an",
  "Yes, I have a disability (or previously had a disability)": "Ja, ich habe eine Behinderung (oder hatte eine)",
  "No, I do not have a disability and have not had one in the past": "Nein, ich habe keine Behinderung und hatte keine",
  "I do not want to answer": "Ich möchte nicht antworten",
};
const t = (s) => (LANG === "de" ? DE[s] ?? s : s);
const STEPS = ["My Information", "My Experience", "Application Questions", "Voluntary Disclosures", "Self Identify", "Review"].map(t);
const JOB_PATH = LANG === "de" ? "/de-DE/External/job/Berlin/Senior-Software-Engineer_R-777" : "/en-US/External/job/London/Senior-Software-Engineer_R-12345";

let uid = 0;
const nextId = () => `f${++uid}`;

function Field({ aid, label, required, children, fieldset }) {
  const tag = fieldset ? "fieldset" : "div";
  return h(
    tag,
    { "data-automation-id": `formField-${aid}`, style: { margin: "8px 0" } },
    h(fieldset ? "legend" : "label", { htmlFor: fieldset ? undefined : `in-${aid}` }, label, required ? " *" : ""),
    children
  );
}

function Text({ aid, label, required, value, set, area, inputAid }) {
  return h(
    Field,
    { aid, label, required },
    h(area ? "textarea" : "input", {
      id: `in-${aid}`,
      "data-automation-id": inputAid ?? aid,
      value: value ?? "",
      onChange: (e) => set(e.target.value),
    })
  );
}

function Dropdown({ aid, label, required, options, value, set }) {
  const [open, setOpen] = useState(false);
  return h(
    Field,
    { aid, label, required },
    h(
      "button",
      { id: `in-${aid}`, type: "button", "aria-haspopup": "listbox", "data-automation-id": aid, onClick: () => setOpen(!open) },
      value || "Select One"
    ),
    open &&
      h(
        "ul",
        { role: "listbox", style: { border: "1px solid #999", listStyle: "none", padding: 4 } },
        ["Select One", ...options].map((o) =>
          h("li", { key: o, role: "option", onClick: () => (set(o === "Select One" ? "" : o), setOpen(false)) }, o)
        )
      )
  );
}

/** options: string[] of leaves, or { category: string[] } for hierarchical prompts. */
function Multi({ aid, label, required, options, value, set, single }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(null);
  const tree = Array.isArray(options) ? null : options;
  const leaves = tree ? Object.values(tree).flat() : options;
  const search = () => {
    const ql = q.toLowerCase();
    const hits = leaves.filter((l) => l.toLowerCase().includes(ql));
    setShown(hits.length ? hits : tree ? Object.keys(tree) : []);
  };
  const pick = (o) => {
    if (tree && tree[o]) return setShown(tree[o]);
    set(single ? [o] : [...new Set([...(value ?? []), o])]);
    setShown(null);
    setQ("");
  };
  return h(
    Field,
    { aid, label, required },
    h(
      "div",
      { "data-uxi-widget-type": "multiselect" },
      (value ?? []).map((v) => h("div", { key: v, "data-automation-id": "selectedItem" }, v)),
      h("input", {
        id: `in-${aid}`,
        "data-automation-id": "searchBox",
        value: q,
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && (e.preventDefault(), search()),
      }),
      shown && h("div", null, shown.map((o) => h("div", { key: o, "data-automation-id": "promptOption", onClick: () => pick(o) }, o)))
    )
  );
}

function Radios({ aid, label, required, options, value, set }) {
  const name = `r-${aid}`;
  return h(
    Field,
    { aid, label, required, fieldset: true },
    h(
      "div",
      { "data-automation-id": aid, id: `in-${aid}`, tabIndex: -1 },
      options.map((o, i) =>
        h(
          "span",
          { key: o },
          h("input", { type: "radio", id: `${name}-${i}`, name, checked: value === o, onChange: () => set(o) }),
          h("label", { htmlFor: `${name}-${i}` }, o)
        )
      )
    )
  );
}

function Check({ aid, label, required, checked, set, inputAid }) {
  return h(
    Field,
    { aid, label, required },
    h("input", { type: "checkbox", id: `in-${aid}`, "data-automation-id": inputAid ?? aid, checked: !!checked, onChange: (e) => set(e.target.checked) })
  );
}

/** Workday-style spinbutton segments: digits arrive as keystrokes. */
function Segment({ aid, max, value, set }) {
  return h("input", {
    "data-automation-id": aid,
    role: "spinbutton",
    value: value ?? "",
    style: { width: max * 14 },
    onKeyDown: (e) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        const cur = value ?? "";
        set(cur.length >= max ? e.key : cur + e.key);
      }
    },
    onChange: (e) => set(e.target.value.replace(/\D/g, "").slice(-max)),
  });
}

function DateF({ aid, label, required, value, set, parts }) {
  const v = value ?? {};
  return h(
    Field,
    { aid, label, required },
    h(
      "div",
      { id: `in-${aid}`, tabIndex: -1 },
      parts.includes("m") && h(Segment, { aid: "dateSectionMonth-input", max: 2, value: v.m, set: (m) => set({ ...v, m }) }),
      parts.includes("d") && h(Segment, { aid: "dateSectionDay-input", max: 2, value: v.d, set: (d) => set({ ...v, d }) }),
      parts.includes("y") && h(Segment, { aid: "dateSectionYear-input", max: 4, value: v.y, set: (y) => set({ ...v, y }) })
    )
  );
}

function Upload({ aid, label, files, set }) {
  return h(
    Field,
    { aid, label },
    h("input", {
      type: "file",
      multiple: true,
      "data-automation-id": "file-upload-input-ref",
      onChange: (e) => set([...(files ?? []), ...[...e.target.files].map((f) => f.name)]),
    }),
    (files ?? []).map((n) =>
      h(
        "div",
        { key: n },
        h("span", { "data-automation-id": "file-upload-successful" }, n),
        h("button", { type: "button", "data-automation-id": "delete-file", onClick: () => set(files.filter((x) => x !== n)) }, t("Delete"))
      )
    )
  );
}

/* ---------------- pages ---------------- */

function JobPage({ onApply }) {
  const [modal, setModal] = useState(false);
  return h(
    "main",
    null,
    h("h2", { "data-automation-id": "jobPostingHeader" }, t("Senior Software Engineer")),
    h("div", { "data-automation-id": "locations" }, LANG === "de" ? "Standorte Berlin, Deutschland" : "locations London, United Kingdom"),
    h("div", { "data-automation-id": "requisitionId" }, LANG === "de" ? "Stellen-ID R-777" : "job requisition id R-12345"),
    h(
      "div",
      { "data-automation-id": "jobPostingDescription" },
      LANG === "de"
        ? "Wir suchen eine:n Senior Software Engineer für unser Team in Berlin. Sie entwickeln Python- und TypeScript-Services auf AWS, " +
          "gestalten REST APIs und betreuen CI/CD-Pipelines. Anforderungen: mehrjährige Erfahrung mit Python, TypeScript, AWS und PostgreSQL. " +
          "Wir bieten ein starkes Team und flexible Arbeitszeiten. Kenntnisse in Kubernetes und Terraform sind von Vorteil."
        : "We are hiring a Senior Software Engineer to build Python and TypeScript services on AWS. You will design REST APIs, " +
        "own CI/CD pipelines, mentor engineers and work with Kubernetes. Requirements: 5+ years Python, TypeScript, AWS, PostgreSQL, " +
        "REST APIs, CI/CD. Nice to have: Kubernetes, Terraform. Python and AWS experience is essential."
    ),
    h("a", { "data-automation-id": "adventureButton", role: "button", href: "#", onClick: (e) => (e.preventDefault(), setModal(true)) }, t("Apply")),
    modal &&
      h(
        "div",
        { role: "dialog" },
        h("a", { "data-automation-id": "autofillWithResume", href: "#", onClick: (e) => (e.preventDefault(), onApply("autofill")) }, t("Autofill with Resume")),
        h("a", { "data-automation-id": "applyManually", href: "#", onClick: (e) => (e.preventDefault(), onApply("manual")) }, t("Apply Manually")),
        h("a", { "data-automation-id": "useMyLastApplication", href: "#", onClick: (e) => (e.preventDefault(), onApply("last")) }, t("Use My Last Application"))
      )
  );
}

function AuthPage({ onDone }) {
  const [mode, setMode] = useState("signIn");
  const [f, setF] = useState({});
  const [err, setErr] = useState("");
  const accounts = JSON.parse(localStorage.getItem("accounts") || "{}");
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const submitSignIn = () => {
    if (accounts[f.email] && accounts[f.email] === f.password) onDone();
    else setErr(t("Invalid email address or password."));
  };
  const submitCreate = () => {
    if (accounts[f.email]) return setErr(t("An account already exists for this email address."));
    if (!f.agree) return setErr("You must accept the terms.");
    if (f.password !== f.verify) return setErr("Passwords do not match.");
    if (!/[A-Z]/.test(f.password) || !/[a-z]/.test(f.password) || !/\d/.test(f.password) || !/[^\w]/.test(f.password) || f.password.length < 8)
      return setErr("Password does not meet requirements.");
    localStorage.setItem("accounts", JSON.stringify({ ...accounts, [f.email]: f.password }));
    onDone();
  };
  // The submit "button" is a div covered by a click_filter overlay, as on real Workday.
  const filtered = (aid, text, fn) =>
    h(
      "div",
      { style: { position: "relative", display: "inline-block" } },
      h("div", { "data-automation-id": aid, role: "button", style: { padding: 6, border: "1px solid" } }, text),
      h("div", { "data-automation-id": "click_filter", onClick: fn, style: { position: "absolute", inset: 0 } })
    );
  return h(
    "main",
    null,
    h("h2", null, t(mode === "signIn" ? "Sign In" : "Create Account")),
    err && h("div", { "data-automation-id": "errorMessage" }, err),
    h("input", { "data-automation-id": "email", value: f.email ?? "", onChange: (e) => set("email")(e.target.value) }),
    h("input", { "data-automation-id": "password", type: "password", value: f.password ?? "", onChange: (e) => set("password")(e.target.value) }),
    mode === "create" && h("input", { "data-automation-id": "verifyPassword", type: "password", value: f.verify ?? "", onChange: (e) => set("verify")(e.target.value) }),
    mode === "create" && h("input", { "data-automation-id": "createAccountCheckbox", type: "checkbox", checked: !!f.agree, onChange: (e) => set("agree")(e.target.checked) }),
    mode === "signIn" ? filtered("signInSubmitButton", t("Sign In"), submitSignIn) : filtered("createAccountSubmitButton", t("Create Account"), submitCreate),
    mode === "signIn"
      ? h("button", { "data-automation-id": "createAccountLink", onClick: () => (setErr(""), setMode("create")) }, t("Create Account"))
      : h("button", { "data-automation-id": "signInLink", onClick: () => (setErr(""), setMode("signIn")) }, t("Sign In"))
  );
}

function ResumePage({ files, setFiles, onContinue }) {
  return h(
    "main",
    null,
    h("h2", null, t("Autofill with Resume")),
    h(Upload, { aid: "resume", label: t("Upload your resume"), files, set: setFiles }),
    h("button", { "data-automation-id": "pageFooterNextButton", onClick: onContinue }, t("Continue"))
  );
}

const PARSED_WORK = [
  { jobTitle: "Engneer", company: "Acme Corp Ltd 2019", location: "", current: false, start: { m: "1", y: "2019" }, end: {}, description: "garbled" },
  { jobTitle: "Intern", company: "Parser Ghost Inc", location: "", current: false, start: {}, end: {}, description: "" },
  { jobTitle: "Another ghost", company: "Nope", location: "", current: false, start: {}, end: {}, description: "" },
];

function Wizard({ data, setData, step, setStep, files, setFiles, onSubmit }) {
  const [errors, setErrors] = useState([]);
  const d = data;
  const set = (k) => (v) => setData((prev) => ({ ...prev, [k]: v }));
  const work = d.work;
  const setWork = (i, k) => (v) => setData((prev) => ({ ...prev, work: prev.work.map((w, j) => (j === i ? { ...w, [k]: v } : w)) }));
  const edu = d.edu;
  const setEdu = (i, k) => (v) => setData((prev) => ({ ...prev, edu: prev.edu.map((w, j) => (j === i ? { ...w, [k]: v } : w)) }));

  const required = {
    0: [["sourceDropdown", "How Did You Hear About Us?", () => d.source?.length], ["previousWorker", "Previous worker", () => d.prev], ["countryDropdown", "Country", () => d.country], ["legalNameSection_firstName", "First Name", () => d.first], ["legalNameSection_lastName", "Last Name", () => d.last], ["addressSection_city", "City", () => d.city], ["phone-device-type", "Phone Device Type", () => d.phoneType], ["countryPhoneCode", "Country Phone Code", () => d.phoneCode?.length], ["phone-number", "Phone Number", () => d.phone]],
    1: [["workExperienceSection", "Work Experience", () => work.every((w) => w.jobTitle && w.company && w.start?.m && w.start?.y && (w.current || w.end?.y))]],
    2: [["q-auth", "Authorized", () => d.qAuth], ["q-sponsor", "Sponsorship", () => d.qSponsor], ["q-salary", "Salary", () => d.qSalary], ["q-crim", "Conviction", () => d.qCrim], ["q-years", "Years", () => d.qYears]],
    3: [["gender", "Gender", () => d.gender], ["ethnicityDropdown", "Ethnicity", () => d.eth], ["veteranStatus", "Veteran", () => d.vet], ["agreementCheckbox", "Terms", () => d.agree]],
    4: [["name", "Name", () => d.siName], ["dateSignedOn", "Date", () => d.siDate?.y], ["disability", "Disability", () => d.dis]],
  };

  const next = () => {
    const errs = (required[step] ?? []).filter(([, , ok]) => !ok());
    setErrors(errs);
    if (errs.length) return;
    if (step === 5) {
      // For the harness: what went in, one role per line of the review.
      console.log("SUBMITTED " + JSON.stringify({ work: work.map((w) => `${w.jobTitle} at ${w.company} (${w.start?.m || "?"}/${w.start?.y || "?"}-${w.current ? "now" : (w.end?.m || "?") + "/" + (w.end?.y || "?")})`) }));
      return onSubmit();
    }
    setStep(step + 1);
  };

  const pages = [
    () => [
      h(Multi, { key: "src", aid: "sourceDropdown", label: t("How Did You Hear About Us?"), required: true, options: { [LANG === "de" ? "Jobbörse" : "Job Board"]: ["LinkedIn", "Indeed"], [LANG === "de" ? "Empfehlung" : "Referral"]: ["Employee Referral"] }, value: d.source, set: set("source") }),
      h(Radios, { key: "prev", aid: "previousWorker", label: t("Have you previously worked for us?"), required: true, options: ["Yes", "No"].map(t), value: d.prev, set: set("prev") }),
      h(Dropdown, { key: "country", aid: "countryDropdown", label: t("Country"), required: true, options: ["Canada", "United Kingdom", "United States of America"].map(t), value: d.country, set: set("country") }),
      d.country &&
        h(
          "div",
          { key: `addr-${d.country}` },
          h(Text, { aid: "legalNameSection_firstName", label: t("First Name"), required: true, value: d.first, set: set("first") }),
          h(Text, { aid: "legalNameSection_lastName", label: t("Last Name"), required: true, value: d.last, set: set("last") }),
          h(Text, { aid: "addressSection_addressLine1", label: t("Address Line 1"), value: d.addr1, set: set("addr1") }),
          h(Text, { aid: "addressSection_city", label: t("City"), required: true, value: d.city, set: set("city") }),
          h(Dropdown, { aid: "addressSection_countryRegion", label: t("County"), options: ["England", "Scotland", "Wales"].map(t), value: d.region, set: set("region") }),
          h(Text, { aid: "addressSection_postalCode", label: t("Postal Code"), value: d.postal, set: set("postal") }),
          h(Dropdown, { aid: "phone-device-type", label: t("Phone Device Type"), required: true, options: ["Landline", "Mobile"].map(t), value: d.phoneType, set: set("phoneType") }),
          h(Multi, { aid: "countryPhoneCode", label: t("Country Phone Code"), required: true, options: ["United Kingdom (+44)", "United States of America (+1)"].map(t), value: d.phoneCode, set: set("phoneCode"), single: true }),
          h(Text, { aid: "phone-number", label: t("Phone Number"), required: true, value: d.phone, set: set("phone") })
        ),
    ],
    () => [
      h(
        "section",
        { key: "work", "data-automation-id": "workExperienceSection" },
        h("h3", null, "Work Experience"),
        work.map((w, i) =>
          h(
            "div",
            { key: w.k, "data-automation-id": `workExperience-${i + 1}`, role: "group" },
            h("h4", null, `Work Experience ${i + 1}`),
            h("button", { type: "button", "data-automation-id": "panel-set-delete-button", onClick: () => setData((p) => ({ ...p, work: p.work.filter((_, j) => j !== i) })) }, t("Delete")),
            h(Text, { aid: "jobTitle", inputAid: "jobTitle", label: t("Job Title"), required: true, value: w.jobTitle, set: setWork(i, "jobTitle") }),
            h(Text, { aid: "companyName", inputAid: "company", label: t("Company"), required: true, value: w.company, set: setWork(i, "company") }),
            h(Text, { aid: "location", inputAid: "location", label: t("Location"), value: w.location, set: setWork(i, "location") }),
            h(Check, { aid: "currentlyWorkHere", label: t("I currently work here"), checked: w.current, set: setWork(i, "current") }),
            h(DateF, { aid: "startDate", label: t("From"), required: true, value: w.start, set: setWork(i, "start"), parts: ["m", "y"] }),
            !w.current && h(DateF, { aid: "endDate", label: t("To"), required: true, value: w.end, set: setWork(i, "end"), parts: ["m", "y"] }),
            h(Text, { aid: "roleDescription", inputAid: "description", label: t("Role Description"), area: true, value: w.description, set: setWork(i, "description") })
          )
        ),
        h("button", { type: "button", "data-automation-id": "add-button", onClick: () => setData((p) => ({ ...p, work: [...p.work, { k: nextId(), start: {}, end: {} }] })) }, t(work.length ? "Add Another" : "Add"))
      ),
      h(
        "section",
        { key: "edu", "data-automation-id": "educationSection" },
        h("h3", null, "Education"),
        edu.map((e, i) =>
          h(
            "div",
            { key: e.k, "data-automation-id": `education-${i + 1}`, role: "group" },
            h(Text, { aid: "schoolName", inputAid: "school", label: t("School or University"), required: true, value: e.school, set: setEdu(i, "school") }),
            h(Dropdown, { aid: "degree", label: t("Degree"), options: ["Bachelor's Degree", "Master's Degree", "Doctorate"].map(t), value: e.degree, set: setEdu(i, "degree") }),
            h(Multi, { aid: "fieldOfStudy", label: t("Field of Study"), options: ["Computer Science", "Mathematics", "Physics"].map(t), value: e.field, set: setEdu(i, "field"), single: true }),
            h(DateF, { aid: "firstYearAttended", label: t("From"), value: e.start, set: setEdu(i, "start"), parts: ["y"] }),
            h(DateF, { aid: "lastYearAttended", label: t("To (Actual or Expected)"), value: e.end, set: setEdu(i, "end"), parts: ["y"] })
          )
        ),
        h("button", { type: "button", "data-automation-id": "add-button", onClick: () => setData((p) => ({ ...p, edu: [...p.edu, { k: nextId() }] })) }, t(edu.length ? "Add Another" : "Add"))
      ),
      h(Multi, { key: "skills", aid: "skills", label: t("Type to Add Skills"), options: ["Python", "TypeScript", "Amazon Web Services (AWS)", "PostgreSQL", "REST APIs", "Kubernetes", "Java"].map(t), value: d.skills, set: set("skills") }),
      h(Upload, { key: "res", aid: "resumeAttachments", label: t("Resume/CV"), files, set: setFiles }),
      h(Text, { key: "li", aid: "linkedInAccount", inputAid: "linkedinQuestion", label: t("LinkedIn Profile"), value: d.linkedin, set: set("linkedin") }),
    ],
    () => [
      h(Radios, { key: "a", aid: "q-auth", label: t("Are you legally authorized to work in the United Kingdom?"), required: true, options: ["Yes", "No"].map(t), value: d.qAuth, set: set("qAuth") }),
      h(Dropdown, { key: "s", aid: "q-sponsor", label: t("Will you now or in the future require sponsorship for employment visa status?"), required: true, options: ["Yes", "No"].map(t), value: d.qSponsor, set: set("qSponsor") }),
      h(Text, { key: "sal", aid: "q-salary", label: t("What are your salary expectations?"), required: true, value: d.qSalary, set: set("qSalary") }),
      h(Radios, { key: "c", aid: "q-crim", label: t("Have you ever been convicted of a criminal offence?"), required: true, options: ["Yes", "No"].map(t), value: d.qCrim, set: set("qCrim") }),
      h(Dropdown, { key: "y", aid: "q-years", label: t("How many years of experience do you have with Python?"), required: true, options: ["0-2 years", "3-5 years", "6+ years"].map(t), value: d.qYears, set: set("qYears") }),
      h(Text, { key: "why", aid: "q-why", label: t("Why do you want to work here?"), area: true, value: d.qWhy, set: set("qWhy") }),
    ],
    () => [
      h(Dropdown, { key: "g", aid: "gender", label: t("Gender"), required: true, options: ["Male", "Female", "I do not wish to answer"].map(t), value: d.gender, set: set("gender") }),
      h(Dropdown, { key: "e", aid: "ethnicityDropdown", label: t("Ethnicity"), required: true, options: ["Asian", "White", "Black or African American", "I decline to self-identify"].map(t), value: d.eth, set: set("eth") }),
      h(Dropdown, { key: "v", aid: "veteranStatus", label: t("Veteran Status"), required: true, options: ["I am not a protected veteran", "I identify as a protected veteran", "I don't wish to answer"].map(t), value: d.vet, set: set("vet") }),
      h(Check, { key: "t", aid: "acceptTermsAndAgreements", inputAid: "agreementCheckbox", label: t("I have read and consent to the terms and conditions"), required: true, checked: d.agree, set: set("agree") }),
    ],
    () => [
      h(Text, { key: "n", aid: "name", inputAid: "name", label: t("Name"), required: true, value: d.siName, set: set("siName") }),
      h(DateF, { key: "dt", aid: "dateSignedOn", label: t("Date"), required: true, value: d.siDate, set: set("siDate"), parts: ["m", "d", "y"] }),
      h(
        Field,
        { key: "dis", aid: "disabilityStatus", label: t("Please check one of the boxes below"), required: true, fieldset: true },
        h(
          "div",
          { "data-automation-id": "selfIdentifiedDisabilityData", id: "in-disability", tabIndex: -1 },
          ["Yes, I have a disability (or previously had a disability)", "No, I do not have a disability and have not had one in the past", "I do not want to answer"].map(t).map((o, i) =>
            h("span", { key: o }, h("input", { type: "checkbox", id: `dis-${i}`, checked: d.dis === o, onChange: (e) => set("dis")(e.target.checked ? o : "") }), h("label", { htmlFor: `dis-${i}` }, o))
          )
        )
      ),
    ],
    () => [
      h(
        "div",
        { key: "rev", id: "review" },
        `${d.first} ${d.last} · ${d.phone} · ${(d.skills ?? []).join(", ")} · ` +
          work.map((w) => `${w.jobTitle} at ${w.company}`).join("; ") +
          " · " +
          edu.map((e) => e.school).join("; ") +
          " · jane.doe@example.com"
      ),
    ],
  ];

  return h(
    "main",
    { "data-automation-id": "ApplyFlowPage" },
    h("ol", { "data-automation-id": "progressBar" }, STEPS.map((s, i) => h("li", { key: s, "data-automation-id": i === step ? "progressBarActiveStep" : "progressBarStep" }, i === step ? s : s))),
    h("h2", { "data-automation-id": "pageHeader" }, STEPS[step]),
    errors.length > 0 &&
      h(
        "div",
        { "data-automation-id": "errorBanner" },
        errors.map(([id, label]) =>
          h("button", { key: id, type: "button", onClick: () => document.getElementById(`in-${id}`)?.focus() }, `Error: ${label} is required`)
        )
      ),
    // Real Workday wraps each step in a page container with its own automation
    // id; SpeedyApply recognises the step by it (applyFlowMyInfoPage, …).
    h("div", { key: step, "data-automation-id": ["applyFlowMyInfoPage", "applyFlowMyExpPage", "applyFlowPrimaryQuestionsPage", "applyFlowVoluntaryDisclosuresPage", "applyFlowSelfIdentifyPage", "applyFlowReviewPage"][step] }, ...pages[step]()),
    h("footer", null, h("button", { "data-automation-id": "pageFooterNextButton", onClick: next }, t(step === 5 ? "Submit" : "Save and Continue")))
  );
}

function App() {
  const [route, setRoute] = useState(new URLSearchParams(location.search).get("start") || "job");
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState([]);
  const [data, setData] = useState({ work: PARSED_WORK.map((w) => ({ ...w, k: nextId() })), edu: [] });
  window.__mock = { route, step, data, files };
  /* ?sa=1 — a stand-in for SpeedyApply: its <speedyapply-autofill> element on the
     page, and each step filled ~1s after it shows with recognisably different
     values ("SA Role at SA Co"), never pressing Next itself (its "Auto click next
     page" off). The account page is left alone (no account in its settings). */
  const SA = (() => { try { if (new URLSearchParams(location.search).has("sa")) sessionStorage.setItem("mockSA", "1"); return sessionStorage.getItem("mockSA") === "1"; } catch (_) { return false; } })();
  useEffect(() => {
    if (!SA) return;
    if (!document.querySelector("speedyapply-autofill")) document.documentElement.appendChild(document.createElement("speedyapply-autofill"));
    const fills = {
      0: { source: ["LinkedIn"], prev: "No", country: "United Kingdom", first: "Sa", last: "Filled", city: "London", phoneType: "Mobile", phoneCode: ["United Kingdom (+44)"], phone: "7700900123" },
      1: { work: [{ k: nextId(), jobTitle: "SA Role", company: "SA Co", location: "London", current: true, start: { m: "1", y: "2020" }, end: {}, description: "" }] },
      2: { qAuth: "Yes", qSponsor: "No", qSalary: "60000", qCrim: "No", qYears: "9" },
      3: { gender: "Prefer not to say", eth: "Prefer not to say", vet: "I am not a protected veteran", agree: true },
      4: { siName: "Sa Filled", siDate: { m: "1", d: "1", y: "2026" }, dis: "I do not want to answer" },
    };
    const id = setTimeout(() => {
      if (route === "resume") { setFiles(["SA_CV.pdf"]); console.log("FX_SA resume"); }
      if (route === "wizard" && fills[step]) { setData((p) => ({ ...p, ...fills[step] })); console.log("FX_SA step " + step); }
    }, 1000);
    return () => clearTimeout(id);
  }, [route, step]);
  useEffect(() => {
    if (route !== "job") history.replaceState(null, "", `${JOB_PATH}/apply/autofillWithResume`);
  }, [route]);
  // Which "Start Your Application" choice was pressed (only "manual" is right).
  if (route === "job") return h(JobPage, { onApply: (how) => { console.log("APPLY_CHOICE " + how); window.__applyChoice = how; setRoute("auth"); } });
  if (route === "auth") return h(AuthPage, { onDone: () => setRoute("resume") });
  if (route === "resume") return h(ResumePage, { files, setFiles, onContinue: () => setRoute("wizard") });
  if (route === "submitted") return h("main", null, h("h2", null, t("Application Submitted")), h("p", null, t("Thank you for applying.")));
  return h(Wizard, { data, setData, step, setStep, files, setFiles, onSubmit: () => setRoute("submitted") });
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
