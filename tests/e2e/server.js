const https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
// A throwaway self-signed certificate; the browser is told to accept it.
const certDir = path.join(os.tmpdir(), 'ua-e2e-cert');
if (!fs.existsSync(path.join(certDir, 'key.pem'))) {
  fs.mkdirSync(certDir, { recursive: true });
  require('child_process').execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${certDir}/key.pem" -out "${certDir}/cert.pem" -days 30 -subj /CN=localhost`, { stdio: 'ignore' });
}
// Serves any path with the fixture named in FIXTURE (re-read per request).
https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (req, res) => {
  const f = process.env.FIXTURE || path.join(__dirname, 'form.html');
  if (/\.(ico|png|js|css)$/.test(req.url)) { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(f));
}).listen(8443, '127.0.0.1');
