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
/* Skips BY NAME unless this computer has exactly what the reader would run: the pinned Codex and a catalog it wrote.
   Certifying another version's tools would certify a Codex the reader refuses to start. */
const pinned = require('./runners').MANIFEST.openai.version;
const binVersion = () => { try { return (/(\d+\.\d+\.\d+)/.exec(require('node:child_process').execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000 })) || [])[1] || null; } catch { return null; } };
const cacheVersion = () => { try { return JSON.parse(fs.readFileSync(cache, 'utf8')).client_version || null; } catch { return null; } };
const why = !bin ? 'no Kosmos Codex on this computer'
  : !fs.existsSync(cache) ? 'Codex has never fetched a model catalog here (' + cache + ')'
    : binVersion() !== pinned ? 'the Codex here is not the pinned version ' + pinned
      : cacheVersion() !== pinned ? 'the model catalog here was written by a Codex other than ' + pinned
        : null;

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
async function capture(argsFor, plant = {}) {
  // `plant` may be a function of the run's root folder, for files that must name a path inside it.
  const cap = await captureServer();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5346-cap-'));
  const home = path.join(root, 'codex-home');
  const work = path.join(root, 'work');
  fs.mkdirSync(home); fs.mkdirSync(work);
  for (const [f, text] of Object.entries(typeof plant === 'function' ? plant(root) : plant)) { fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); fs.writeFileSync(path.join(home, f), text); }
  fs.copyFileSync(cache, path.join(home, 'models_cache.json'));
  const catalog = path.join(root, 'catalog.json');
  fs.writeFileSync(catalog, JSON.stringify(c.deriveCatalog(home)));
  const schema = path.join(root, 'schema.json');
  fs.writeFileSync(schema, JSON.stringify(require('./orgchartkeys').STRICT_SCHEMA));
  const image = path.join(root, 'chart.png');
  fs.copyFileSync(path.join(__dirname, '..', 'test-support', 'orgchart-4559', 'chart.png'), image);
  const base = 'openai_base_url="http://127.0.0.1:' + cap.port + '/v1"';
  const args = argsFor({ dir: work, catalog, schema, image, base });
  // The reader's own environment (childEnv), plus the fake key this capture signs in with.
  const env = { ...c.childEnv(process.env, home), HOME: root, CODEX_API_KEY: 'sk-capture-5346' };
  await new Promise((resolve) => {
    // Its own process group, killed whole on a timeout, as the reader does: the launcher's native child must not outlive it.
    const child = spawn(bin, args, { cwd: work, env, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
    const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 90000);
    child.on('close', () => { clearTimeout(t); resolve(); });
    child.on('error', () => { clearTimeout(t); resolve(); });
  });
  cap.server.close();
  const out = cap.bodies.filter((b) => b && Array.isArray(b.input));
  out.root = root;
  return out;
}

/* Every model in the catalog, not only the default: a read runs on whichever one Codex picks, and each model carries
   its own tool fields. */
const slugs = why ? [] : (c.deriveCatalog(path.dirname(cache)) || { models: [] }).models.map((m) => m.slug).filter((s) => typeof s === 'string');

test('#5346 (a): with the reader\'s flags, a captured request offers only update_plan and request_user_input, on every model in the catalog', { skip: why || false, timeout: 600000 }, async () => {
  assert.ok(slugs.length >= 1, 'the catalog named no model');
  for (const slug of slugs) {
    const bodies = await capture(({ dir, catalog, schema, image, base }) => c.codexArgs({ dir, catalog, schema, image, prompt: 'Read this org chart.', extra: [base, 'model=' + JSON.stringify(slug)] }));
    assert.ok(bodies.length >= 1, slug + ': Codex sent no model request to the capture server');
    for (const b of bodies) {
      assert.equal(b.model, slug, 'the run used the model asked for');
      const tools = c.offeredTools(b);
      assert.deepEqual([...new Set(tools)].sort(), [...c.ALLOWED_TOOLS].sort(), slug + ': tools offered: ' + JSON.stringify(tools));
      // The picture is in the request itself (base64), not left as a path for a tool to open.
      assert.match(JSON.stringify(b), /data:image\/png;base64,/);
    }
  }
});

test('#5346 (a) CONTROL: with Codex\'s default tools, the same capture sees the code-mode exec tool', { skip: why || false, timeout: 120000 }, async () => {
  const bodies = await capture(({ dir, schema, image, base }) => ['exec', '--json', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', dir, '-c', base, '--output-schema', schema, '-i', image, '--', 'Read this org chart.']);
  assert.ok(bodies.length >= 1, 'Codex sent no model request to the capture server');
  const tools = c.offeredTools(bodies[0]);
  assert.ok(tools.some((t) => !c.ALLOWED_TOOLS.includes(t)), 'the control saw only the allowed tools: ' + JSON.stringify(tools));
});

/* WHY orgchartcodex refuses an account with its own instructions file: under the reader's flags Codex still sends it
   (AGENTS.override.md if there is one, else AGENTS.md). If a future Codex stops sending them, this fails, and the
   refusal in pickWithWhy can be reconsidered rather than outliving its reason. */
test('#5346 premise: under the reader\'s flags Codex still sends the account\'s AGENTS.md and AGENTS.override.md', { skip: why || false, timeout: 120000 }, async () => {
  const args = ({ dir, catalog, schema, image, base }) => c.codexArgs({ dir, catalog, schema, image, prompt: 'Read this org chart.', extra: [base] });
  let bodies = await capture(args, { 'AGENTS.md': 'MARKER-AGENTS-5346' });
  assert.ok(bodies.length >= 1 && JSON.stringify(bodies).includes('MARKER-AGENTS-5346'), 'AGENTS.md was not sent');
  bodies = await capture(args, { 'AGENTS.override.md': 'MARKER-OVERRIDE-5346' });
  assert.ok(bodies.length >= 1 && JSON.stringify(bodies).includes('MARKER-OVERRIDE-5346'), 'AGENTS.override.md was not sent');
  assert.deepEqual([...c.INSTRUCTION_FILES].sort(), ['AGENTS.md', 'AGENTS.override.md']);
});

/* The rest of the person's own Codex context, planted in the account's folder: none of it may reach the request. */
test('#5346: the account\'s skills, prompts, memories, rules, hooks and config do not reach the request', { skip: why || false, timeout: 120000 }, async () => {
  const plant = {
    'skills/decoy/SKILL.md': '---\nname: decoy\ndescription: MARKER-SKILL-5346\n---\nMARKER-SKILL-BODY-5346',
    'prompts/decoy.md': 'MARKER-PROMPT-5346',
    'memories/decoy.md': 'MARKER-MEMORY-5346',
    'rules/decoy.rules': 'prefix_rule(pattern=["MARKER-RULE-5346"], decision="allow")',
    'hooks.json': '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo MARKER-HOOK-5346"}]}]}}',
    'config.toml': 'developer_instructions = "MARKER-CONFIG-5346"\n[mcp_servers.decoy]\ncommand = "echo"\nargs = ["MARKER-MCP-5346"]\n',
  };
  const bodies = await capture(({ dir, catalog, schema, image, base }) => c.codexArgs({ dir, catalog, schema, image, prompt: 'Read this org chart.', extra: [base] }), plant);
  assert.ok(bodies.length >= 1, 'Codex sent no model request to the capture server');
  const sent = JSON.stringify(bodies);
  const leaked = sent.match(/MARKER-[A-Z-]+-5346/g) || [];
  assert.deepEqual(leaked, [], 'the person\'s own context reached the request');
});

test('#5346 CONTROL: the same planted folder WITHOUT the reader\'s flags does send the person\'s context', { skip: why || false, timeout: 120000 }, async () => {
  const bodies = await capture(({ dir, schema, image, base }) => ['exec', '--json', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', dir, '-c', base, '--output-schema', schema, '-i', image, '--', 'Read this org chart.'],
  { 'skills/decoy/SKILL.md': '---\nname: decoy\ndescription: MARKER-SKILL-5346\n---\nbody', 'config.toml': 'developer_instructions = "MARKER-CONFIG-5346"\n' });
  const sent = JSON.stringify(bodies);
  assert.ok(sent.includes('MARKER-SKILL-5346') || sent.includes('MARKER-CONFIG-5346'), 'the control saw none of the planted context, so the main test proves nothing');
});

/* A command the person's own config would RUN leaves no trace in a request, so it is caught by what it does: each
   planted command writes a marker file in the run's folder. */
const runners = (root) => ({
  'config.toml': '[mcp_servers.decoy]\ncommand = "/bin/sh"\nargs = ["-c", "touch ' + root + '/MCP-RAN"]\n',
  'hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'touch ' + root + '/HOOK-RAN' }] }] } }),
});
const ran = (root) => ['MCP-RAN', 'HOOK-RAN'].filter((f) => fs.existsSync(path.join(root, f)));

test('#5346: under the reader\'s flags, no MCP server or hook from the account folder runs', { skip: why || false, timeout: 120000 }, async () => {
  const bodies = await capture(({ dir, catalog, schema, image, base }) => c.codexArgs({ dir, catalog, schema, image, prompt: 'Read this org chart.', extra: [base] }), runners);
  assert.ok(bodies.length >= 1, 'Codex sent no model request to the capture server');
  assert.deepEqual(ran(bodies.root), []);
});

test('#5346 CONTROL: without the reader\'s flags, the same planted commands do run', { skip: why || false, timeout: 120000 }, async () => {
  const bodies = await capture(({ dir, schema, image, base }) => ['exec', '--json', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', dir, '-c', base, '--output-schema', schema, '-i', image, '--', 'Read this org chart.'], runners);
  assert.ok(ran(bodies.root).length >= 1, 'neither planted command ran without the flags, so the main test proves nothing');
});
