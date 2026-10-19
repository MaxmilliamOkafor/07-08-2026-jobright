/* Source of greenhouse-remix.html — the new job-boards.greenhouse.io form, with the
   REAL react-select (classNamePrefix "select", as Greenhouse ships it), shaped like
   the Anthropic application from the screenshot. Errors work like Greenhouse's: they
   are computed on Submit and stay on screen until the next Submit.

   Rebuild: tests/e2e/src/build.sh  (needs npm; writes ../greenhouse-remix.html) */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Select from 'react-select';

const YN = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
const TEXT = [
  ['first_name', 'First Name', true], ['last_name', 'Last Name', true], ['email', 'Email', true],
  ['phone', 'Phone', true], ['website', 'Website', false],
  ['start', 'When is the earliest you would want to start working with us?', false],
  ['deadlines', 'Do you have any deadlines or timeline considerations we should be aware of?', false],
  ['why', 'Why Anthropic?', true, true],
  ['linkedin', 'LinkedIn Profile', false],
  ['address', 'What is the address from which you plan on working? If you would need to relocate, please type "relocating".', false],
];
const SELECTS = [
  ['in_person', 'Are you open to working in-person in one of our offices 25% of the time?'],
  ['ai_policy', 'AI Policy for Application'],
  ['visa_now', 'Do you require visa sponsorship?'],
  ['visa_future', 'Will you now or will you in the future require employment visa sponsorship to work in the country in which the job you\'re applying for is located?'],
  ['relocation', 'Are you open to relocation for this role?'],
  ['interviewed', 'Have you ever interviewed at Anthropic before?'],
  ['lab_robots', 'Have you personally written software that connects to lab robots or instruments (for example liquid handlers, plate readers, scheduling software, or a LIMS) - code you wrote yourself, not instrument operation or vendor-software configuration?'],
  ['llm_app', 'Have you personally built an LLM-powered application that uses tool calling or agents, and taken it from prototype into production where real users depended on it?'],
  ['evals', 'Have you written evals (test sets, metrics, or regression suites) to measure the performance or failure modes of an AI system you built?'],
];

function App() {
  const [text, setText] = useState({});
  const [sel, setSel] = useState({});
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  if (done) return <div><h1>Thank you for applying!</h1><p>Your application has been submitted.</p></div>;
  const submit = (e) => {
    e.preventDefault();
    const err = {};
    for (const [k, , req] of TEXT) if (req && !String(text[k] || '').trim()) err[k] = 'This field is required.';
    for (const [k] of SELECTS) if (!sel[k]) err[k] = 'This field is required.';
    setErrors(err);
    if (Object.keys(err).length) { console.log('BLOCKED ' + JSON.stringify(Object.keys(err))); return; }
    const out = { ...text };
    for (const [k] of SELECTS) out[k] = sel[k].label;
    console.log('SUBMITTED ' + JSON.stringify(out));
    setDone(true);
  };
  return (
    <form id="application-form" className="application--form" noValidate onSubmit={submit}>
      <h2>Apply for this job</h2>
      {TEXT.map(([k, label, req, area]) => (
        <div className="input-wrapper" key={k}>
          <label id={k + '-label'} htmlFor={k} className="label">{label}{req && <span className="required">*</span>}</label>
          {area
            ? <textarea id={k} className="input" aria-required={req} value={text[k] || ''} onChange={(e) => setText({ ...text, [k]: e.target.value })} />
            : <input id={k} type="text" className="input" aria-required={req} value={text[k] || ''} onChange={(e) => setText({ ...text, [k]: e.target.value })} />}
          {errors[k] && <p id={k + '-error'} className="helper-text helper-text--error">{errors[k]}</p>}
        </div>
      ))}
      {SELECTS.map(([k, label]) => (
        <div className="select__container" key={k}>
          <label id={k + '-label'} htmlFor={k} className="label select__label">{label}<span className="required">*</span></label>
          <Select inputId={k} classNamePrefix="select" options={YN} isClearable placeholder="Select..."
            value={sel[k] || null} onChange={(v) => setSel({ ...sel, [k]: v })}
            aria-labelledby={k + '-label'} aria-required="true" aria-invalid={!!errors[k]}
            aria-errormessage={errors[k] ? k + '-error' : undefined} />
          {errors[k] && <p id={k + '-error'} className="helper-text helper-text--error">{errors[k]}</p>}
        </div>
      ))}
      <button type="submit" className="btn btn--pill">Submit application</button>
    </form>
  );
}

createRoot(document.getElementById('app')).render(<App />);

// Jobright's out-of-credits box, as its helper app renders it: an antd modal inside
// the helper's plasmo-csui shadow root.
setTimeout(() => {
  const host = document.createElement('plasmo-csui');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const w = document.createElement('div');
  w.className = 'popup-modal-wrap jobright-helper-centered-popup-wrap';
  w.innerHTML = '<div class="popup-modal" style="position:fixed;right:20px;top:200px;width:300px;background:#111;color:#fff;padding:16px;z-index:9999">' +
    '<div>You have <strong>0</strong> remaining Autofill credits. Your credits will be refilled up to 10 tomorrow. Upgrade to Turbo for unlimited use.</div>' +
    '<div class="popup-modal-actions"><button type="button" id="jr-cancel">Cancel</button><button type="button" id="jr-upgrade">Upgrade</button></div></div>';
  root.appendChild(w);
  w.querySelector('#jr-cancel').onclick = () => { console.log('CREDITS_POPUP_CANCELLED'); w.remove(); };
  w.querySelector('#jr-upgrade').onclick = () => console.log('UPGRADE_CLICKED');
}, 1500);
