/* Real-browser check that the page hooks never raise "Leave site? Changes you made
   may not be saved." — neither on their own nor when a page asks for it. A node fake
   cannot model this: what arms the prompt is Chrome's handling of returnValue, and
   assigning it ANY value (even undefined, which becomes "undefined") arms it.
   Usage: node tests/e2e/leave-site.js */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const fs = require('fs'), path = require('path'), os = require('os');
const hooks = fs.readFileSync(path.resolve(__dirname, '../../AAAA - Jobright Autofill/ua-page-hooks.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-leave-'));
fs.writeFileSync(path.join(dir, 'next.html'), '<p>next</p>');
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log('  ok   ' + name); } else { fail++; console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`); } };
async function dialogOnLeave(b, pageCode, withHooks) {
  const f = path.join(dir, 'p' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(f, `<button id=b>x</button>${withHooks ? `<script>${hooks}</script>` : ''}<script>${pageCode}</script>`);
  const p = await b.newPage();
  let dialog = 'none';
  p.on('dialog', async (d) => { dialog = d.type(); await d.accept(); });
  await p.goto('file://' + f);
  await p.click('#b');                                  // user activation, as on a real page
  await p.goto('file://' + path.join(dir, 'next.html')).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await p.close();
  return dialog;
}
(async () => {
  const b = await chromium.launch();
  console.log('the harness can see the prompt');
  eq('a page that asks for it, without our hooks, gets it', await dialogOnLeave(b, "addEventListener('beforeunload', e => e.preventDefault());", false), 'beforeunload');
  console.log('with the page hooks installed');
  for (const [name, code] of [
    ['a page that asks for nothing', ''],
    ['addEventListener + preventDefault()', "addEventListener('beforeunload', e => e.preventDefault());"],
    ['returnValue = string', "addEventListener('beforeunload', e => { e.returnValue = 'x'; });"],
    ['window.onbeforeunload returning a string', "window.onbeforeunload = () => 'unsaved';"],
    ['its own capture-phase listener', "addEventListener('beforeunload', e => e.preventDefault(), true);"],
  ]) eq(`${name} → no prompt`, await dialogOnLeave(b, code, true), 'none');
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
