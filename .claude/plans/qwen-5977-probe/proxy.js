// Logs each request body and response body between Codex and Ollama. Usage: node proxy.js <port> <logdir>
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const port = Number(process.argv[2]); const dir = process.argv[3]; let n = 0;
http.createServer((req, res) => {
  const id = ++n; const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    fs.writeFileSync(path.join(dir, `req-${id}.txt`), `${req.method} ${req.url}\n${body}`);
    const up = http.request({ host: '127.0.0.1', port: 11434, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:11434' } }, (u) => {
      res.writeHead(u.statusCode, u.headers); const out = [];
      u.on('data', (c) => { out.push(c); res.write(c); });
      u.on('end', () => { fs.writeFileSync(path.join(dir, `res-${id}.txt`), Buffer.concat(out)); res.end(); });
    });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    up.end(body);
  });
}).listen(port, '127.0.0.1');
