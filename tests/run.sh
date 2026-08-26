#!/usr/bin/env bash
# Runs every check that can be run without a browser:
#   • JS syntax of everything we ship
#   • manifest.json validity + the automation hooks it must declare
#   • CSV/URL parsing in all three places it happens (they must agree)
#   • the service-worker queue engine, driven against a fake chrome.*
#
# Usage: tests/run.sh          (from the repo root)
set -u

cd "$(dirname "$0")/.."
EXT="AAAA - Jobright Autofill"
fails=0

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

step "JavaScript syntax"
for f in "$EXT"/ua-enhancement.js "$EXT"/ua-queue.js "$EXT"/ua-orchestrator.js "$EXT"/ua-page-hooks.js "$EXT"/ua-mailbox.js "$EXT"/static/background/index.js "$EXT"/contents.d42e7fcf.js; do
  if node --check "$f" 2>/dev/null; then ok "$(basename "$f")"; else bad "$(basename "$f")"; fi
done

step "manifest.json"
node - "$EXT/manifest.json" <<'NODE'
const fs = require('fs'), path = require('path');
const p = process.argv[2], dir = path.dirname(p);
let m;
try { m = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.log('  FAIL parse: ' + e.message); process.exit(1); }
let bad = 0;
const ok = (n) => console.log('  ok   ' + n);
const no = (n) => { console.log('  FAIL ' + n); bad++; };

m.manifest_version === 3 ? ok('manifest v3') : no('manifest v3');
m.version ? ok('version ' + m.version) : no('version present');

// Every file the manifest points at must actually exist.
const refs = [];
for (const cs of m.content_scripts || []) refs.push(...(cs.js || []), ...(cs.css || []));
for (const w of m.web_accessible_resources || []) refs.push(...(w.resources || []));
if (m.background && m.background.service_worker) refs.push(m.background.service_worker);
if (m.side_panel && m.side_panel.default_path) refs.push(m.side_panel.default_path);
for (const i of Object.values(m.icons || {})) refs.push(i);
const missing = [...new Set(refs)].filter((r) => !fs.existsSync(path.join(dir, r)));
missing.length ? no('missing files: ' + missing.join(', ')) : ok('every referenced file exists');

// The automation layer's hooks.
const csJs = (m.content_scripts || []).flatMap((c) => c.js || []);
// MAIN-world hooks must be installed before any page script can call confirm().
const hooks = (m.content_scripts || []).find((c) => (c.js || []).includes('ua-page-hooks.js'));
hooks ? ok('ua-page-hooks declared') : no('ua-page-hooks.js content script missing');
hooks && hooks.world === 'MAIN' ? ok('ua-page-hooks runs in the MAIN world') : no('ua-page-hooks must set "world": "MAIN" or it cannot override the page\'s confirm()');
hooks && hooks.run_at === 'document_start' ? ok('ua-page-hooks runs at document_start') : no('ua-page-hooks must run at document_start');
csJs.indexOf('ua-enhancement.js') <= 1 ? ok('ua-enhancement runs early') : no('ua-enhancement must be an early content script');
(m.side_panel || {}).default_path === 'ua-queue.html' ? ok('side panel wired to the queue manager') : no('side_panel.default_path');
for (const perm of ['storage', 'tabs', 'scripting', 'sidePanel', 'alarms', 'contextMenus'])
  (m.permissions || []).includes(perm) ? ok('permission: ' + perm) : no('permission missing: ' + perm);

// The orchestrator is loaded by an appended importScripts, not by the manifest.
const sw = fs.readFileSync(path.join(dir, m.background.service_worker), 'utf8');
/importScripts\(["']\/ua-orchestrator\.js["']\)/.test(sw) ? ok('service worker imports the orchestrator') : no('service worker does not import ua-orchestrator.js');
fs.existsSync(path.join(dir, 'ua-orchestrator.js')) ? ok('ua-orchestrator.js present') : no('ua-orchestrator.js missing');

process.exit(bad ? 1 : 0);
NODE
[ $? -eq 0 ] || fails=$((fails + 1))

step "Undeclared-function references"
node tests/references.test.js "$EXT/ua-enhancement.js" "$EXT/ua-queue.js" "$EXT/ua-orchestrator.js" "$EXT/ua-page-hooks.js" || fails=$((fails + 1))

step "Automation gate (Fully Automated toggle)"
node tests/gate.test.js "$EXT/ua-enhancement.js" || fails=$((fails + 1))

step "Autofill field coverage (shadow DOM + frames)"
node tests/fill.test.js "$EXT/ua-enhancement.js" "$EXT/ua-orchestrator.js" "$EXT/manifest.json" || fails=$((fails + 1))

step "Submit detection + submission evidence"
node tests/submit.test.js "$EXT/ua-enhancement.js" || fails=$((fails + 1))

step "ATS detection + dialog policy"
node tests/ats.test.js "$EXT/ua-enhancement.js" "$EXT/ua-page-hooks.js" || fails=$((fails + 1))
node tests/beforeunload.test.js "$EXT/ua-page-hooks.js" || fails=$((fails + 1))
node tests/mailbox.test.js "$EXT/ua-mailbox.js" "$EXT/ua-enhancement.js" || fails=$((fails + 1))

step "CSV + URL parsing (content script)"
node tests/csv-parsers.test.js "$EXT/ua-enhancement.js" || fails=$((fails + 1))

step "CSV import (queue manager panel)"
node tests/queue-panel.test.js "$EXT/ua-queue.js" || fails=$((fails + 1))

step "Queue engine (service worker)"
node tests/orchestrator.test.js "$EXT/ua-orchestrator.js" || fails=$((fails + 1))

printf '\n'
if [ "$fails" -eq 0 ]; then printf '\033[32mAll checks passed.\033[0m\n'; else printf '\033[31m%s check group(s) failed.\033[0m\n' "$fails"; fi
exit $fails
