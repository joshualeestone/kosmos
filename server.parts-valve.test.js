'use strict';

/**
 * The connect routes, driven against the real server.
 *
 * A separate file from `server.test.js` for the same reason as
 * `server.projects.test.js`: that file's blocks are a standing merge hazard,
 * and this feature can add a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE, plus one this feature adds: the
 * Claude config. `subscription` fixes its path at load and the real file is
 * the operator's live account -- and `connect.start()` DECIDES things by
 * reading it, so an unsandboxed run would decide from the operator's reality.
 * DRY_RUN is armed so nothing here can run a real program.
 *
 *   node --test server.parts-valve.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-parts-valve-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects'); // sandboxed whole (#634)
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
/* Both sandbox knobs travel together (#527): the scoped check resolves
   the DEFAULT account's record through accounts, whose HOME is its own
   seam; without this, a future default-dir scoped check in this file
   would read the operator's real ~/.claude.json while believing itself
   sandboxed. */
process.env.AGENT_WORKFORCE_HOME = HOME;
// The two sandbox seams travel together (launchSignin warns loudly otherwise,
// and a warning that fires on every green run trains people to ignore it).
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
// `/bin/echo` exists and is executable, which is all "Claude is installed"
// means to `start` -- so no test here ever reaches the download path.
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
/* ⚠️ A FAKE TMUX, NOT /bin/echo (#332). echo stubbed the writes and printed
   its arguments to the reads, which the parser refused, so every read fell
   through to the real tmux on the PATH and these tests measured the
   operator's live fleet. The fake answers reads from fixtures (none set here:
   an empty board) and echoes everything else, so write-side receipts hold. */
process.env.AGENT_WORKFORCE_TMUX_BIN = require('node:path').join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
async function req(p, options) { const res = await fetch(base + p, options); return { status: res.status, headers: res.headers, body: await res.text() }; }
const asProcess = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const asScreen = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });

/* The parts valve (#803): the write itself is refused for a process past
   twelve part changes an hour, counted from the records (so a restart does
   not open it); the screen is never valved; the refusal says the number. */
test('the thirteenth process part change in an hour is refused with the count and the minutes; the screen still writes; moves count too', async () => {
  const p = projects.create({ name: 'Valve Route' });
  projects.addAgent(p.id, 'april');
  const t = tasks.create(p.id, { sentence: 'Ship it' });
  const path = '/api/project/' + encodeURIComponent(p.id) + '/task/' + t.number;
  let refused = null; let made = 0;
  for (let i = 0; i < 14 && !refused; i += 1) {
    const r = await req(path + '/parts', asProcess({ sentence: 'Loop ' + i }));
    if (r.status === 429) refused = r; else { assert.equal(r.status, 200, r.body); made += 1; }
  }
  assert.ok(refused, 'fourteen process-made parts never hit the valve');
  assert.equal(made, 12, 'the valve closed at the wrong count');
  const err = JSON.parse(refused.body);
  assert.match(err.error, /agents have made 12 part changes in the last hour/);
  assert.match(err.error, /pausing agent-made parts for \d+ minutes?/);
  assert.match(err.error, /from the screen/);
  assert.ok(err.retry_after_secs > 0, 'no retry_after_secs');
  assert.equal(refused.headers.get('retry-after'), String(err.retry_after_secs), 'the header and the field disagree');
  // A move by a process is refused the same way while the valve is shut.
  const parts = tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), t.number));
  const mv = await req(path + '/part/' + parts[0].id + '/who', asProcess({ who: 'april' }));
  assert.equal(mv.status, 429, mv.body);
  // Close and reopen are not valved: a state, not a command.
  const cl = await req(path + '/part/' + parts[0].id + '/close', asProcess({}));
  assert.equal(cl.status, 200, cl.body);
  // The screen is never valved.
  const sc = await req(path + '/parts', asScreen({ sentence: 'From the person' }));
  assert.equal(sc.status, 200, sc.body);
  const scParts = tasks.partsOf(JSON.parse(sc.body).task);
  assert.equal(scParts[scParts.length - 1].addedVia, 'screen');
  // Persisted: the count is read from the records, so a fresh read of the
  // engine sees the same closed valve without any process memory.
  assert.equal(tasks.partValve().refused, true);
  // Aged through the seam, the valve opens and a process may write again.
  tasks.agePartWritesForTests(p.id, 3601);
  const ok = await req(path + '/parts', asProcess({ sentence: 'After the hour' }));
  assert.equal(ok.status, 200, ok.body);
});

/* The membership valve (#803, extended by Splinter's ruling): a membership
   change rewrites an instruction file; a process is bounded at sixty an
   hour across projects with a refusal that says the number; the screen is
   never valved, so a person stacking agents on a new project meets none. */
test('a process past sixty membership changes an hour is refused with the count and the minutes; the screen still adds; a repeat is not counted', async () => {
  const p = projects.create({ name: 'Member Valve Route' });
  for (const pj of projects.readAll()) projects.ageMemberChangesForTests(pj.id, 3601);
  const path = '/api/project/' + encodeURIComponent(p.id) + '/agent/';
  let refused = null; let landed = 0;
  for (let i = 0; i < projects.MEMBERS_PER_HOUR + 2 && !refused; i += 1) {
    const r = await req(path + 'agent-' + i, asProcess({}));
    if (r.status === 429) refused = r; else { assert.equal(r.status, 200, r.body); landed += 1; }
  }
  assert.ok(refused, 'the valve never closed');
  assert.equal(landed, projects.MEMBERS_PER_HOUR, 'the valve closed at the wrong count');
  const err = JSON.parse(refused.body);
  assert.match(err.error, new RegExp('changed who is on projects ' + projects.MEMBERS_PER_HOUR + ' times'));
  assert.match(err.error, /pausing agent-made membership changes for \d+ minutes?/);
  assert.match(err.error, /from the screen/);
  assert.equal(refused.headers.get('retry-after'), String(err.retry_after_secs));
  // A repeat of a member already on the project is not a change and is not refused.
  const again = await req(path + 'agent-0', asProcess({}));
  assert.equal(again.status, 200, again.body);
  // A remove by a process is a change and is refused while shut.
  const rm = await req(path + 'agent-0', { method: 'DELETE' });
  assert.equal(rm.status, 429, rm.body);
  // The screen is never valved: the person adds one now.
  const sc = await req(path + 'from-the-person', asScreen({}));
  assert.equal(sc.status, 200, sc.body);
  assert.ok(projects.readAll().find((x) => x.id === p.id).agents.includes('from-the-person'));
  // Aged, a process may write again.
  projects.ageMemberChangesForTests(p.id, 3601);
  const ok = await req(path + 'after-the-hour', asProcess({}));
  assert.equal(ok.status, 200, ok.body);
});
