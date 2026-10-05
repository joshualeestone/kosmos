'use strict';
// First, for its side effect: every temp dir this file makes lands in its own, removed at exit (#4273).
require('../test-support/tmpscope');
/**
 * #5346 condition (a), Splinter's ruling: a CAPTURED request proves that a Codex run with orgchartcodex's flags offers
 * the model only `update_plan` and `request_user_input`, neither of which can act. The real Codex is run with the
 * reader's own argv against a local server that saves the request and answers 400, so no subscription and no real
 * key is used (a throwaway Codex home with a fake key). Every tool is found by walking the WHOLE request: Codex puts
 * its tools in a developer message, not a top-level `tools`.
 *
 * CONTROL: the same run with Codex's default tools must show the code-mode `exec` tool, so a capture that saw
 * nothing cannot pass the main test.
 *
 * Needs Kosmos's Codex and a model catalog Codex has fetched on this computer (the source each read derives its
 * catalog from). Without either it SKIPS BY NAME; it runs on any Mac where an OpenAI agent has run once. Re-run on
 * every Codex pin bump (engine/runners.js): that is when a new tool could arrive.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const c = require('./orgchartcodex');

let bin = null;
try { const r = require('./runners').resolveBin('openai'); bin = r && r.present ? r.bin : null; } catch { bin = null; }
const realHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const cache = path.join(realHome, 'models_cache.json');
const why = !bin ? 'no Kosmos Codex on this computer' : !fs.existsSync(cache) ? 'Codex has never fetched a model catalog here (' + cache + ')' : null;

/* A server that saves each POST body and refuses it, so Codex gives up at once. */
function captureServer() {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      if (req.method === 'POST') { try { bodies.push(JSON.parse(b)); } catch { bodies.push(null); } }
      res.writeHead(req.method === 'POST' ? 400 : 404, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"capture only","type":"invalid_request_error"}}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, bodies, port: server.address().port })));
}

/* One Codex run against the capture server; resolves the captured bodies. `args` is the full argv. */
async function capture(argsFor) {
  const cap = await captureServer();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5346-cap-'));
  const home = path.join(root, 'codex-home');
  const work = path.join(root, 'work');
  fs.mkdirSync(home); fs.mkdirSync(work);
  fs.copyFileSync(cache, path.join(home, 'models_cache.json'));
  const catalog = path.join(root, 'catalog.json');
  fs.writeFileSync(catalog, JSON.stringify(c.deriveCatalog(home)));
  const schema = path.join(root, 'schema.json');
  fs.writeFileSync(schema, JSON.stringify(require('./orgchartkeys').STRICT_SCHEMA));
  const image = path.join(root, 'chart.png');
  fs.copyFileSync(path.join(__dirname, '..', 'test-support', 'orgchart-4559', 'chart.png'), image);
  const base = 'openai_base_url="http://127.0.0.1:' + cap.port + '/v1"';
  const args = argsFor({ dir: work, catalog, schema, image, base });
  const env = { PATH: process.env.PATH, HOME: root, CODEX_HOME: home, CODEX_API_KEY: 'sk-capture-5346', OPENAI_API_KEY: 'sk-capture-5346' };
  await new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: work, env, stdio: ['ignore', 'ignore', 'ignore'] });
    const t = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('close', () => { clearTimeout(t); resolve(); });
    child.on('error', () => { clearTimeout(t); resolve(); });
  });
  cap.server.close();
  return cap.bodies.filter((b) => b && Array.isArray(b.input));
}

test('#5346 (a): with the reader\'s flags, a captured request offers only update_plan and request_user_input', { skip: why || false, timeout: 120000 }, async () => {
  const bodies = await capture(({ dir, catalog, schema, image, base }) => c.codexArgs({ dir, catalog, schema, image, prompt: 'Read this org chart.', extra: [base] }));
  assert.ok(bodies.length >= 1, 'Codex sent no model request to the capture server');
  for (const b of bodies) {
    const tools = c.offeredTools(b);
    assert.deepEqual([...new Set(tools)].sort(), [...c.ALLOWED_TOOLS].sort(), 'tools offered: ' + JSON.stringify(tools));
    // The picture is in the request itself (base64), not left as a path for a tool to open.
    assert.match(JSON.stringify(b), /data:image\/png;base64,/);
  }
});

test('#5346 (a) CONTROL: with Codex\'s default tools, the same capture sees the code-mode exec tool', { skip: why || false, timeout: 120000 }, async () => {
  const bodies = await capture(({ dir, schema, image, base }) => ['exec', '--json', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', dir, '-c', base, '--output-schema', schema, '-i', image, '--', 'Read this org chart.']);
  assert.ok(bodies.length >= 1, 'Codex sent no model request to the capture server');
  const tools = c.offeredTools(bodies[0]);
  assert.ok(tools.some((t) => !c.ALLOWED_TOOLS.includes(t)), 'the control saw only the allowed tools: ' + JSON.stringify(tools));
});
