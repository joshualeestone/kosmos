'use strict';
/**
 * kosmos#8417, end to end: on a Windows board, an offline agent whose Scheduled Task is switched off carries
 * `jobSwitchedOff: true` and the Task Scheduler sentence on /api/status, and a switched-on one carries neither.
 *
 * In-process, on any host. create's fleet probes are pinned to 'win32' (setProbePlatformForTests), so the switched-off
 * set and the sentence take the Windows arm; win32job answers through its runner seam, never the real schtasks. The
 * roster and survey follow the host as in server.world-offline-rows-1704.test.js: the agent's job is on disk for a Mac
 * or Linux host (jobfixture), and the runner also answers the Windows survey and presence reads for a Windows host.
 *
 *   node --test server.win32-switchedoff-8417.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const jobfix = require('./test-support/jobfixture');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-win32-switchedoff-8417-'));
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
delete process.env.KOSMOS_WORLD;

const store = require('./engine/store');
const create = require('./engine/create');
const status = require('./engine/status');
const win32job = require('./engine/win32job');
const { start, server } = require('./server');

const XML_ENV = { USERNAME: 'kitty', USERDOMAIN: 'BOX', SystemRoot: 'C:\\Windows' };
const TASK = 'Kosmos\\agent-ava';
let switchOff = false;

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(nodePath.join(store.ROOT, 'profiles'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'profiles', 'ava.json'), JSON.stringify({ role: 'Researcher', displayName: 'Ava' }));
  fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'ava'), { recursive: true });
  fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
  fs.writeFileSync(jobfix.jobPath('ava'), '<plist/>');   // the job a Mac or Linux host's survey finds

  create.setProbePlatformForTests('win32');
  // No real launchctl or systemctl for any probe that still asks create's runner.
  create.setRunner(() => ({ ok: true, stdout: '' }));
  win32job.setRunner((args) => {
    if (args[0] !== '/Query') return { ok: true, out: '' };
    if (args.includes('/XML')) {
      const spec = { name: 'ava', cwd: 'C:\\work\\ava', node: 'C:\\n.exe', supervisor: 'C:\\s.js', enabled: !switchOff };
      return { ok: true, out: win32job.taskXml(spec, XML_ENV) };
    }
    if (args.includes('LIST')) return { ok: true, out: 'Status: ' + (switchOff ? 'Disabled' : 'Ready') + '\n' };
    return { ok: true, out: `"\\${TASK}","N/A","${switchOff ? 'Disabled' : 'Ready'}"\r\n` };
  });
});
test.after(() => {
  create.setRunner(null);
  create.setProbePlatformForTests(null);
  win32job.setRunner(null);
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function avaRow() {
  status.setPaneSource(() => '');   // no session anywhere: ava is offline
  const body = await (await fetch(base + '/api/status')).json();
  const row = (body.agents || []).find((a) => a.sessionName === 'ava');
  assert.ok(row, 'the offline ava row is missing: ' + JSON.stringify((body.agents || []).map((a) => a.sessionName)));
  return row;
}

test('#8417 a switched-on task: the offline row is a plain stopped agent', async () => {
  switchOff = false;
  const row = await avaRow();
  assert.equal(row.jobSwitchedOff, false);
  assert.doesNotMatch(String(row.because), /Task Scheduler/);
});

test('#8417 a switched-off task: the offline row says so, with the Task Scheduler sentence', async () => {
  switchOff = true;
  const row = await avaRow();
  assert.equal(row.jobSwitchedOff, true, 'the board read the Windows switched-off set');
  assert.match(String(row.because), /switched off in Task Scheduler/);
  assert.match(String(row.because), /find agent-ava in the Kosmos folder and choose Enable/);
  assert.doesNotMatch(String(row.because), /System Settings/);
});
