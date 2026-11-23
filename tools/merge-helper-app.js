/* Re-applies our two helper-app edits to a fresh Jobright build. Matches by shape,
   so minifier renames (D/L/F → L/j/_ between 1.26.3 and 1.27.0) do not matter;
   throws if either anchor is not found exactly once.
   Usage: node tools/merge-helper-app.js <their helper-app.js> <output path> */
const fs=require('fs');const [,,src,dst]=process.argv;let s=fs.readFileSync(src,'utf8');
const once=(re,fn,label)=>{const m=s.match(new RegExp(re.source,'g'))||[];if(m.length!==1)throw new Error(label+': '+m.length+' matches');s=s.replace(re,fn);};
// 1. "Add this job first" popup → answered Not Now
once(/let (\w)=\(\{open:e,onConfirm:t,onCancel:r\}\)=>\{let n=\(0,(\w)\.useContainerStore\)\(e=>e\.containerDom\);return(\(0,\w\.jsxs\)\(\w\.Modal,\{open:e,title:null,footer:null,centered:!0,wrapClassName:"popup-modal-wrap add-job-first-popup-wrap)/,
 (_m,d,st,rest)=>`let ${d}=({open:e,onConfirm:t,onCancel:r})=>{let n=(0,${st}.useContainerStore)(e=>e.containerDom);/*[ua] "Add this job first" is never shown: it is answered "Not Now" (nothing is added to your Jobright account)*/if(e){setTimeout(()=>{try{r&&r()}catch(_){}},0);return null}return${rest}`,'add-job-first');
// 2. their standard autofill stands down on a tab our run owns
once(/function (\w)\(e\)\{return (\w)\(e\.targetName\)\?\.canStartStandardAutofill\?\.\(e\)\?\?!1\}function (\w)\(e\)\{return \2\(e\.targetName\)\?\.hasStandardAutofillSignal\?\.\(e\)\?\?\1\(e\)\}/,
 (_m,c,g,h)=>`function ${c}(e){/*[ua] our run owns this tab: Jobright does not start a second filler*/try{if(globalThis.__uaOwnsAutofill?.(e&&e.targetName))return!1}catch(_){}return ${g}(e.targetName)?.canStartStandardAutofill?.(e)??!1}function ${h}(e){try{if(globalThis.__uaOwnsAutofill?.(e&&e.targetName))return!1}catch(_){}return ${g}(e.targetName)?.hasStandardAutofillSignal?.(e)??${c}(e)}`,'standard-autofill');
fs.writeFileSync(dst,s);console.log('helper-app merged');
