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

test('#1939 REFUSED WHOLE: a document that is not an agent is refused with a redirecting reason', async () => {
  const bad = await post('/api/agent-import', { file: '# Just a document\n\nno frontmatter here\n' });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.because, /does not introduce an agent/);
  assert.doesNotMatch(bad.json.because, /has no header/, 'the old retry-inviting message is gone (#1939)');
  // CONTROL: a valid file the same way IS accepted, so the refusal means something.
  const ok = await post('/api/agent-import', { file: exportedFile('ctrlimp', '# You are Ctrl\n\nsome body.\n') });
  assert.equal(ok.json.ok, true, ok.json.because);
});

test('#1939 over HTTP: a raw CLAUDE.md that names an agent is recognized and pre-fills the form', async () => {
  // Josh's dead end (2026-09-03): picking an existing agent's CLAUDE.md refused with
  // "it has no header". It now comes back as create-form material with the flag that
  // says it was instructions, not an export.
  const claudeMd = '# You are Lil Nacho, project manager.\n\nYou keep the team on track.\n';
  const { status, json } = await post('/api/agent-import', { file: claudeMd });
  assert.equal(status, 200);
  assert.equal(json.ok, true, json.because);
  assert.equal(json.displayName, 'Lil Nacho');
  assert.equal(json.name, 'lil-nacho', 'a usable machine name is suggested for the form');
  assert.equal(json.recognizedFromContent, true, 'the form is told this was instructions, not an export');
  assert.ok(json.instructions.includes('You keep the team on track'), 'the whole file is returned as instructions');
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

/* #1652 PR2: POST /api/agent-import-file reads a DISCOVERED file by path and returns the
 * same shape as /api/agent-import. The path is validated against discover.scan()'s
 * importable set (never trusted from the request), then read lstat-guarded + size-capped.
 * The scan is pointed at a controlled root via AGENT_WORKFORCE_SCAN_ROOTS so these tests
 * do not depend on the operator's real home. */
const SCANROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-scan-'));
process.env.AGENT_WORKFORCE_SCAN_ROOTS = SCANROOT;

/* Plant every fixture BEFORE the first import-file POST. The scan is cached for
   SCAN_CACHE_MS, so a file written after the first scan would be invisible to the
   cached importable set (correct production behaviour). Planting up front means one
   fresh scan on the first call sees them all: two agent files (importable) and one
   plain note (not importable). */
const SHARED = path.join(SCANROOT, 'shared.agent.md');
const SWAPME = path.join(SCANROOT, 'swapme.agent.md');
const FIFOME = path.join(SCANROOT, 'fifome.agent.md');
const NOTE = path.join(SCANROOT, 'notes.md');
fs.writeFileSync(SHARED, exportedFile('sharedagent', '# You are Shared Agent\n\nYou answer one question well.\n', 'claude'));
fs.writeFileSync(SWAPME, exportedFile('swapme', '# You are Swap Me\n\nOne job, done well.\n', 'claude'));
fs.writeFileSync(FIFOME, exportedFile('fifome', '# You are Fifo Me\n\nOne job, done well.\n', 'claude'));
fs.writeFileSync(NOTE, '# Notes\n\nnothing about an agent here\n');

test('#1652 PR2 POSITIVE: a discovered agent file is read by path and parses into create material', async () => {
  const { status, json } = await post('/api/agent-import-file', { file: SHARED });
  assert.equal(status, 200);
  assert.equal(json.ok, true, json.because);
  assert.equal(json.name, 'sharedagent');
  assert.match(String(json.instructions || ''), /You answer one question well/);
});

test('#1652 PR2 SECURITY: an arbitrary path the scan never returned is REFUSED, not read', async () => {
  // The canonical attack: name a real file outside the discovered set. It must be
  // refused on membership BEFORE any read, so a request cannot exfiltrate /etc/passwd.
  const { status, json } = await post('/api/agent-import-file', { file: '/etc/passwd' });
  assert.equal(status, 200);
  assert.equal(json.ok, false);
  assert.match(json.because, /not one we found/);
});

test('#1652 PR2 SECURITY: a non-agent .md in the scan root is NOT importable, so its path is refused', async () => {
  // NOTE sits in the scanned root but fails the content gate, so it is not in the
  // importable set and its path is refused too -- membership is the importable set, not
  // "any .md under a scanned root".
  const { json } = await post('/api/agent-import-file', { file: NOTE });
  assert.equal(json.ok, false);
  assert.match(json.because, /not one we found/);
});

test('#1652 PR2 SECURITY: a path swapped to a symlink after discovery is refused by the lstat guard', async () => {
  // TOCTOU: SWAPME was a real agent file at scan time (so it is a KNOWN member and
  // membership passes from the cache), then is replaced by a symlink pointing outside
  // the tree. The lstat-regular-file guard at read time refuses it rather than following.
  const ok = await post('/api/agent-import-file', { file: SWAPME });
  assert.equal(ok.json.ok, true, 'PRECONDITION: the file should import before the swap');
  fs.rmSync(SWAPME);
  fs.symlinkSync('/etc/passwd', SWAPME);
  const { json } = await post('/api/agent-import-file', { file: SWAPME });
  assert.equal(json.ok, false, 'a symlink swapped in after discovery must be refused');
  assert.match(json.because, /no longer a readable file/);
});

test('#1652 PR2 SECURITY: a path swapped to a FIFO after discovery is refused WITHOUT hanging the board', async () => {
  // TOCTOU DoS: FIFOME was a real agent file at scan time (known member), then is replaced
  // by a named pipe with no writer. A plain synchronous open of a FIFO BLOCKS forever and
  // would hang the single-threaded board; O_NONBLOCK keeps the open from blocking and the
  // fstat isFile check then refuses it. If O_NONBLOCK regressed, this test would hang (the
  // fetch never returns) rather than pass -- which is the guard.
  const { execFileSync } = require('node:child_process');
  const ok = await post('/api/agent-import-file', { file: FIFOME });
  assert.equal(ok.json.ok, true, 'PRECONDITION: the file should import before the swap');
  fs.rmSync(FIFOME);
  try {
    execFileSync('mkfifo', [FIFOME]);
  } catch {
    // mkfifo unavailable (non-POSIX host): nothing to test here.
    return;
  }
  const { json } = await post('/api/agent-import-file', { file: FIFOME });
  assert.equal(json.ok, false, 'a fifo swapped in after discovery must be refused');
  assert.match(json.because, /no longer a readable file/);
});

test('#1652 PR2: no file named is a plain refusal, not a crash', async () => {
  const { status, json } = await post('/api/agent-import-file', {});
  assert.equal(status, 200);
  assert.equal(json.ok, false);
  assert.match(json.because, /no file was named/);
});

test('#1652 PR2: GET /api/scan-import returns the importable files, and its membership matches /api/agent-import-file', async () => {
  // The on-demand import scan surfaces the loose agent files; a plain note is excluded.
  const res = await fetch(`${base}/api/scan-import`, { cache: 'no-store' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(Array.isArray(j.importable), 'scan-import did not return an importable array');
  const files = j.importable.map((c) => c.file);
  assert.ok(files.includes(SHARED), 'the shared agent file was not offered by /api/scan-import');
  assert.ok(!files.includes(NOTE), 'a plain note was wrongly offered by /api/scan-import');
  // The same file the scan offered is a valid member for the by-path import.
  const imp = await post('/api/agent-import-file', { file: SHARED });
  assert.equal(imp.json.ok, true, imp.json.because);
});

test('#1652 PR2 SEAM: the import routes call discover.scan({importScan:true}), not the auto scan', () => {
  // #2125/#2148 reconcile: the TCC folders (Downloads/Desktop/Documents) are reached ONLY
  // under importScan. A route that called bare discover.scan() would never find a file the
  // person keeps in Downloads. Source-pin the flag so a regression to the auto scan reds here.
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /discover\.scan\(\{\s*importScan:\s*true\s*\}\)/, 'the import scan does not pass importScan:true (it would use the TCC-free auto roots)');
});

test.after(() => { try { server.close(); } catch { /* best effort */ } });
