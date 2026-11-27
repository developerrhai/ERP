// Runs on the OLD server after the move, on the port the ERP used to use.
// It passes requests for the old address on to the new server, so the old
// server's Nginx stays unchanged and old links keep working.
// Usage: node forwarder.js <port> <new-domain> <path-prefix>
const http = require('http');
const https = require('https');

const [port, host, prefix] = process.argv.slice(2);
if (!port || !host || !prefix) {
  console.error('usage: node forwarder.js <port> <new-domain> <path-prefix>');
  process.exit(1);
}

function forward(req, res) {
    // Only Host changes. Neither server's Nginx adds to X-Forwarded-For, so it
    // passes through and the API still sees the real client address.
    const headers = { ...req.headers, host };

    const upstream = https.request(
      { host, servername: host, path: prefix + req.url, method: req.method, headers },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      console.error('forward failed:', error.message);
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'The new server did not respond.' }));
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
}

http
  .createServer((req, res) => {
    try {
      forward(req, res);
    } catch (error) {
      console.error('bad request:', error.message);
      res.writeHead(400);
      res.end();
    }
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`forwarding :${port} -> https://${host}${prefix}`));
