const https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
// A throwaway self-signed certificate; the browser is told to accept it.
const certDir = path.join(os.tmpdir(), 'ua-e2e-cert');
if (!fs.existsSync(path.join(certDir, 'key.pem'))) {
  fs.mkdirSync(certDir, { recursive: true });
  require('child_process').execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${certDir}/key.pem" -out "${certDir}/cert.pem" -days 30 -subj /CN=localhost`, { stdio: 'ignore' });
}
// Serves any path with the fixture named in FIXTURE (re-read per request).
https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (req, res) => {
  // FIXTURE_ROUTES='[["/applicant/","amazon-apply.html"]]' picks a page by path;
  // FIXTURE is the default for everything else.
  let f = process.env.FIXTURE || path.join(__dirname, 'form.html');
  try {
    for (const [re, file] of JSON.parse(process.env.FIXTURE_ROUTES || '[]')) {
      if (new RegExp(re).test(req.url)) { f = path.isAbsolute(file) ? file : path.join(__dirname, file); break; }
    }
  } catch (_) {}
  if (/\.(ico|png|js|css)$/.test(req.url)) { res.writeHead(204); return res.end(); }
  // A feed (the Gmail stand-in) is served as XML with the current time filled in.
  if (/\.xml$/.test(f)) { res.writeHead(200, { 'content-type': 'application/atom+xml; charset=utf-8' }); return res.end(String(fs.readFileSync(f)).replace(/\{\{NOW\}\}/g, new Date().toISOString())); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(f));
}).listen(8443, '127.0.0.1');
