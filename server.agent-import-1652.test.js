'use strict';
/* #1652: the parse endpoint the fourth create-an-agent option calls. POST
 * /api/agent-import {file} -> agentfile.importAgent's validated material
 * (name, displayName, provider, instructions) or a whole refusal. It parses,
 * it does NOT create -- the fourth option hands the material to POST /api/agents.
 * In-process harness on a loopback bind, same shape as server.heartbeat-1722.test.js.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-ep-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-ep-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-ep-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-ep-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-ep-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FAKE_HOME, 'claude.json');

const { start, server } = require('./server');
const agentfile = require('./engine/agentfile');
const store = require('./engine/store');
const instructions = require('./engine/instructions');

let base;
test('boot the board on the loopback bind', async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

const post = async (p, body) => {
  const res = await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

/** A valid exported .agent.md, produced by the REAL export half, so the round
 *  trip export -> import is exercised end to end over HTTP. */
function exportedFile(name, body, provider) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  if (provider) store.writeProfile(name, { provider });
  const out = agentfile.exportAgent(name, { store, instructions });
  assert.equal(out.ok, true, 'PRECONDITION: export failed: ' + out.because);
  return out.text;
}

test('#1652 ROUND TRIP over HTTP: a valid exported file parses into create-form material', async () => {
  const file = exportedFile('caseyimp', '# You are Casey Jones\n\nYou answer one question well.\n', 'claude');
  const { status, json } = await post('/api/agent-import', { file });
  assert.equal(status, 200);
  assert.equal(json.ok, true, json.because);
  assert.equal(json.name, 'caseyimp');
  assert.equal(json.displayName, 'Casey Jones', 'the display name comes back for the form heading');
  assert.equal(json.provider, 'claude', 'the provider hint is returned for the form');
  assert.ok(json.instructions.includes('You answer one question well'),
    'the body is returned as `instructions`, the field POST /api/agents uses');
});

test('#1652 REFUSED WHOLE: a non-Kosmos file is refused with a reason', async () => {
  const bad = await post('/api/agent-import', { file: '# Just a document\n\nno frontmatter here\n' });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.because, /no header/);
  // CONTROL: a valid file the same way IS accepted, so the refusal means something.
  const ok = await post('/api/agent-import', { file: exportedFile('ctrlimp', '# You are Ctrl\n\nsome body.\n') });
  assert.equal(ok.json.ok, true, ok.json.because);
});

test('#1652 REFUSED WHOLE: a path-unsafe name in the file is refused (importAgent enforces it at the boundary)', async () => {
  const evil = await post('/api/agent-import', { file: '---\nkosmos: agent\nname: ../../etc/passwd\n---\n\n# You are Evil\n' });
  assert.equal(evil.json.ok, false);
  assert.match(evil.json.because, /not a usable agent name/);
});

test('#1652 REFUSED WHOLE: a body that names nobody is refused', async () => {
  const noname = await post('/api/agent-import', { file: '---\nkosmos: agent\nname: quiet\n---\n\njust notes, no name\n' });
  assert.equal(noname.json.ok, false);
  assert.match(noname.json.because, /do not name an agent/);
});

test('#1652: malformed JSON is a 400 with a reason (not just a bare status)', async () => {
  const res = await fetch(`${base}/api/agent-import`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
  });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.match(j.error, /not something we can read/, 'a malformed request 400 should carry the reason, so the 400 is the JSON-parse path and not some other 400');
});

test.after(() => { try { server.close(); } catch { /* best effort */ } });
