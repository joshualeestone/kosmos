'use strict';
/**
 * kosmos#7405: `kosmos project remove-member <project-id> "<name>" [--yes]` takes a member off a project through the
 * route the screen's Remove sends: GET /api/project/<id>/overview (who is on it), then DELETE
 * /api/project/<id>/agent/<sessionName>. A name not on the project sends nothing (the route answers a non-member as
 * success). A person confirms at a terminal; a script says --yes, and with neither nothing is sent. Run against a stub
 * board in a sandboxed KOSMOS_HOME for install/kosmos, and in process for the Windows CLI, as
 * cli.agent-remove-7362.test.js does. The overview is the board's own (projects.describe and projectview.overviewOf);
 * the DELETE answers are written to the route's shape, and the valve's words are engine/projects.js memberValve's.
 * The tests that check a refusal sends nothing are paired, in the same test or the one after it, with a run against
 * the same stub that does send.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const run = promisify(execFile);

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-pjrm-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
// The board's own engine beside the command, as an install has it, so the Mac cleans names with projectview.one and
// not its fallback (kosmos_engine_module looks in $KOSMOS_HOME/engine).
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(HOME, 'engine'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const CLI = path.join(__dirname, 'install', 'kosmos');

/* kosmos#7405 review 1: the overview is the board's own, never hand-built (fixture-discipline): fleet cards through
   projects.describe and projectview.overviewOf, wrapped as the route wraps it ({ project, agentsUnreadable }). A
   hand-built top-level shape passed every test while both commands failed on a real board. The data roots are a temp
   folder, set before the engine is loaded. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pjrm-data-'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));
process.env.AGENT_WORKFORCE_DATA = path.join(DATA, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(DATA, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(DATA, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const projects = require('./engine/projects');
const view = require('./engine/projectview');
const fleet = require('./test-support/fleet');
const FLEET = fleet.install([
  fleet.agent('sally-sales', { displayName: 'Sally Sales' }), fleet.agent('ada', { displayName: 'Ada' }),
  fleet.agent('twin-1', { displayName: 'Twin' }), fleet.agent('twin-2', { displayName: 'twin' }),
]);
const RAW = { id: 'launch', name: 'Launch', folder: '/p/launch', agents: ['sally-sales', 'ada', 'twin-1', 'twin-2'], tasks: [] };
const SHOWN = view.overviewOf(projects.describe(RAW, FLEET.agents, [RAW]), [], { folderOf: () => null, readBrief: () => ({ goal: null, done: null, found: false }) });
FLEET.restore();
const OVERVIEW = [200, { project: SHOWN, agentsUnreadable: false }];
test('#7405 CONTROL: the fixture is in the shape the route sends, with display names that differ from the sessionNames', () => {
  assert.deepEqual(SHOWN.members.map((m) => [m.name, m.sessionName]),
    [['Sally Sales', 'sally-sales'], ['Ada', 'ada'], ['Twin', 'twin-1'], ['twin', 'twin-2']]);
});
const NO_PROJECT = [404, { error: 'there is no project by that name' }];
const GONE = [200, { project: SHOWN, told: { state: 'told' }, said: null }];
const COULD_NOT = [200, { project: SHOWN, told: { state: 'could_not', because: 'it keeps its instructions somewhere we cannot safely change' }, said: null }];
const UNREAD = [200, { project: null, told: { state: 'told' }, said: null }];
// engine/projects.js memberValve's own sentence, at its limit.
const VALVE = [429, { error: 'agents have changed who is on projects 60 times in the last hour, so Kosmos is pausing agent-made membership changes for 12 minutes; the person can still change them from the screen', retry_after_secs: 700 }];

/* A stub board: the overview and the member route answer from `overview` and `done`; every request is recorded. */
function withStub(overview, done, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/project/')) {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      if (req.method === 'DELETE' && done === 'drop') { req.socket.destroy(); return; }   // the connection breaks after the request left
      if (req.method === 'DELETE' && done === 'html') { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>Bad gateway</html>'); return; }
      const [status, json] = req.method === 'DELETE' ? done : overview;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}
const deletes = (seen) => seen.filter((s) => s.method === 'DELETE');

/* ── install/kosmos (Mac and Linux) ─────────────────────────────────────────── */

async function cli(port, args) {
  // execFile's stdin is a pipe, never a terminal: the no-TTY case is what a run without --yes meets here.
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123' };
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 20000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('#7405 Mac: --yes reads the project, then takes the member off by the sessionName the screen sends', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'Sally Sales', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), ['GET /api/project/launch/overview', 'DELETE /api/project/launch/agent/sally-sales']);
  assert.match(r.out, /Sally Sales comes off this project's list and stops getting its posts\. Nothing else changes/);
  assert.match(r.out, /Sally Sales is off Launch and still on your computer\.$/m);
}));

test('#7405 Mac: a sessionName works as well as the display name', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.equal(deletes(seen)[0].url, '/api/project/launch/agent/ada');
}));

test('#7405 Mac: a name not on the project sends nothing and says so (control: a member does)', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'Nobody', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /No member of Launch is called Nobody, so nothing was changed\. kosmos project show launch lists who is on it, and a member that is not running shows by its machine name\./);
  assert.equal(deletes(seen).length, 0, 'a non-member was sent to the route, which answers it as success');
  assert.equal((await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes'])).code, 0);
  assert.equal(deletes(seen).length, 1, 'CONTROL: the member was not sent');
}));

test('#7405 Mac: a display name two members share sends nothing and lists their names', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'TWIN', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /More than one member of Launch is called TWIN, so nothing was changed\. Use one of these names instead: "twin-1", "twin-2"\./);
  assert.equal(deletes(seen).length, 0);
}));

test('#7405 Mac: could not update the member is the screen\'s sentence, and still a success', () => withStub(OVERVIEW, COULD_NOT, async (port) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Ada is off Launch\. We could not update them, so this project may still be named in what they were told\. It keeps its instructions somewhere we cannot safely change\.$/m);
}));

test('#7405 Mac: the board\'s refusal (the members valve) is said in its own words and exits 1', () => withStub(OVERVIEW, VALVE, async (port) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Kosmos did not take Ada off Launch: agents have changed who is on projects 60 times in the last hour, so Kosmos is pausing agent-made membership changes for 12 minutes; the person can still change them from the screen\./);
}));

test('#7405 Mac: a project the board does not have is said and nothing is removed', () => withStub(NO_PROJECT, GONE, async (port, seen) => {
  const r = await cli(port, ['project', 'remove-member', 'nope', 'Ada', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Kosmos could not read nope: there is no project by that name\./);
  assert.equal(deletes(seen).length, 0);
}));

test('#7405 Mac: no --yes and no terminal is refused before anything is sent (control: --yes sends)', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const r = await cli(port, ['project', 'remove-member', 'launch', 'Ada']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Nothing was changed: there is no terminal here to confirm on\. To take Ada off without being asked, add --yes\./);
  assert.equal(seen.length, 0, 'a refused run still reached the board');
  assert.equal((await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes'])).code, 0);
  assert.equal(deletes(seen).length, 1, 'CONTROL: --yes did not send');
}));

test('#7405 Mac: an option-shaped word, a missing name, or an extra word is refused before any request', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const opt = await cli(port, ['project', 'remove-member', 'launch', '--foo', '--yes']);
  assert.equal(opt.code, 2, opt.out);
  assert.match(opt.out, /--foo is not an option of kosmos project remove-member, so nothing was done\./);
  assert.equal((await cli(port, ['project', 'remove-member', 'launch', '--yes'])).code, 2);
  assert.equal((await cli(port, ['project', 'remove-member', 'launch', 'Ada', 'extra', '--yes'])).code, 2);
  assert.equal(seen.length, 0, 'a refused usage still reached the board');
}));

/* ── tools/windows/kosmos-cli.js, in process, against the same stub ─────────────── */

const wincli = require('./tools/windows/kosmos-cli');
// The same hook shape cli.agent-remove-7362.test.js stubs: a fixed board token, the agent token only when hex.
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_7405', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function winRun(port, argv, seams) {
  const out = []; const err = []; const asked = [];
  const s = seams || {};
  const code = await wincli.main(argv, { env: { KOSMOS_AGENT_TOKEN: 'abc123' }, hook: hookStub, url: 'http://127.0.0.1:' + port,
    out: (x) => out.push(x), err: (x) => err.push(x),
    canAsk: () => s.tty === true,
    ask: (q) => { asked.push(q); return Promise.resolve(s.answer || ''); } });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

test('#7405 Windows: --yes reads the project, then takes the member off by its sessionName, as this agent', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const r = await winRun(port, ['project', 'remove-member', 'launch', 'Sally Sales', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(seen.map((x) => x.method + ' ' + x.url), ['GET /api/project/launch/overview', 'DELETE /api/project/launch/agent/sally-sales']);
  assert.equal(seen[1].headers['x-kosmos-agent-token'], 'abc123', 'the change did not go as this agent');
  assert.equal(r.asked.length, 0, '--yes still asked');
  assert.match(r.out, /Sally Sales comes off this project's list and stops getting its posts\. Nothing else changes/);
  assert.match(r.out, /Sally Sales is off Launch and still on your computer\.$/m);
}));

test('#7405 Windows: at a terminal, y takes the member off and anything else cancels with nothing sent (control: y sends)', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const no = await winRun(port, ['project', 'remove-member', 'launch', 'Ada'], { tty: true, answer: 'n' });
  assert.equal(no.code, 1, no.err);
  assert.deepEqual(no.asked, ['Remove Ada from Launch? [y/N] ']);
  assert.match(no.err, /Cancelled\. Nothing was changed\./);
  assert.equal(deletes(seen).length, 0, 'a cancelled run still sent the change');
  const yes = await winRun(port, ['project', 'remove-member', 'launch', 'Ada'], { tty: true, answer: 'y' });
  assert.equal(yes.code, 0, yes.err);
  assert.equal(deletes(seen).length, 1, 'CONTROL: y did not send');
}));

test('#7405 Windows: a name not on the project, or shared by two, sends nothing (control: a member does)', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const none = await winRun(port, ['project', 'remove-member', 'launch', 'Nobody', '--yes']);
  assert.equal(none.code, 1);
  assert.match(none.err, /No member of Launch is called Nobody, so nothing was changed\./);
  const many = await winRun(port, ['project', 'remove-member', 'launch', 'twin', '--yes']);
  assert.equal(many.code, 1);
  assert.match(many.err, /Use one of these names instead: "twin-1", "twin-2"\./);
  assert.equal(deletes(seen).length, 0);
  assert.equal((await winRun(port, ['project', 'remove-member', 'launch', 'ada', '--yes'])).code, 0);
  assert.equal(deletes(seen).length, 1, 'CONTROL: the member was not sent');
}));

test('#7405 Windows: could-not and the valve read as on the Mac', () => withStub(OVERVIEW, COULD_NOT, async (port) => {
  const r = await winRun(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Ada is off Launch\. We could not update them, so this project may still be named in what they were told\. It keeps its instructions somewhere we cannot safely change\.$/m);
}).then(() => withStub(OVERVIEW, VALVE, async (port) => {
  const r = await winRun(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Kosmos did not take Ada off Launch: agents have changed who is on projects 60 times in the last hour, so Kosmos is pausing agent-made membership changes for 12 minutes; the person can still change them from the screen\./);
})));

test('#7405 Windows: no --yes and no terminal, an option-shaped word, or an extra word is refused before any request', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const notty = await winRun(port, ['project', 'remove-member', 'launch', 'Ada']);
  assert.equal(notty.code, 2);
  assert.match(notty.err, /Nothing was changed: there is no terminal here to confirm on\. To take Ada off without being asked, add --yes\./);
  assert.equal((await winRun(port, ['project', 'remove-member', 'launch', '--foo', '--yes'])).code, 2);
  assert.equal((await winRun(port, ['project', 'remove-member', 'launch', 'Ada', 'extra', '--yes'])).code, 2);
  assert.equal(seen.length, 0, 'a refused run still reached the board');
}));

/* ── kosmos#7405 review 1: the change landed but its answer did not, on both ───────────── */

test('#7405 Mac and Windows: a 200 with no project read back says the member is most likely off, exit 3', () => withStub(OVERVIEW, UNREAD, async (port) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(m.code, 3, m.out);
  assert.match(m.out, /Kosmos made the change but could not read the project back\. Ada is most likely off Launch/);
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(w.code, 3, w.err);
  assert.match(w.err, /Kosmos made the change but could not read the project back\. Ada is most likely off Launch/);
}));

test('#7405 Mac and Windows: the connection breaking after the DELETE left says "may be off", exit 3', () => withStub(OVERVIEW, 'drop', async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(m.code, 3, m.out);
  assert.match(m.out, /Ada may be off Launch; look at the project on the board before trying again/);
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(w.code, 3, w.err);
  assert.match(w.err, /Ada may be off Launch; look at the project on the board before trying again/);
  assert.equal(deletes(seen).length, 2, 'CONTROL: the DELETE was not sent, so nothing broke after it');
}));

test('#7405 review 2: an answer that is not JSON after the DELETE left says "may be off", exit 3, on both', () => withStub(OVERVIEW, 'html', async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(m.code, 3, m.out);
  assert.match(m.out, /Kosmos gave an answer we could not read after it was asked\. Ada may be off Launch; look at the project on the board before trying again/);
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'Ada', '--yes']);
  assert.equal(w.code, 3, w.err);
  assert.match(w.err, /Kosmos gave an answer we could not read after it was asked\. Ada may be off Launch; look at the project on the board before trying again/);
  assert.equal(deletes(seen).length, 2, 'CONTROL: the DELETE was not sent');
}));

/* The Mac's y/N prompt at a real terminal: macOS script(1) gives the command a pty. The answer is typed only once the
   prompt has been printed, so no fixed sleep decides it. */
function cliAtTerminal(port, args, answer) {
  // script(1) cannot read a terminal's settings from node's stdio (sockets), so /bin/sh feeds it through a real pipe and
  // types the answer once the prompt is in the output file.
  const out = path.join(HOME, 'tty-' + process.pid + '-' + Date.now() + '.out');
  const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
  const sh = '{ i=0; while ! grep -q "\\[y/N\\]" ' + q(out) + ' 2>/dev/null && [ $i -lt 150 ]; do sleep 0.1; i=$((i+1)); done; printf ' + q(answer + '\n')
    + '; sleep 1; } | /usr/bin/script -q /dev/null ' + [CLI, ...args].map(q).join(' ') + ' > ' + q(out) + ' 2>&1';
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123' };
  return run('/bin/sh', ['-c', sh], { env, timeout: 30000 }).then(() => false, (e) => Boolean(e && e.killed))
    .then((timedOut) => { let t = ''; try { t = fs.readFileSync(out, 'utf8'); } catch { /* none */ } return { out: t.replace(/\r/g, ''), timedOut }; });
}
test('#7405 review 2 Mac: at a terminal, y takes the member off and n cancels with nothing sent (control: y sends)', { skip: process.platform !== 'darwin' }, () => withStub(OVERVIEW, GONE, async (port, seen) => {
  const no = await cliAtTerminal(port, ['project', 'remove-member', 'launch', 'Ada'], 'n');
  assert.equal(no.timedOut, false, 'the terminal run timed out: ' + no.out);
  assert.match(no.out, /Remove Ada from Launch\? \[y\/N\]/, 'the prompt was not shown: ' + no.out);
  assert.match(no.out, /Cancelled\. Nothing was changed\./);
  assert.equal(deletes(seen).length, 0, 'a cancelled run still sent the change');
  const yes = await cliAtTerminal(port, ['project', 'remove-member', 'launch', 'Ada'], 'y');
  assert.equal(yes.timedOut, false, 'the terminal run timed out: ' + yes.out);
  assert.match(yes.out, /Ada is off Launch and still on your computer\./, yes.out);
  assert.equal(deletes(seen).length, 1, 'CONTROL: y did not send');
}));

/* kosmos#7405 review 3: a name that is one member's sessionName and another's display name means either, so nothing is
   sent. The board's own overview again, with b7 shown as "ada". */
const FLEET2 = fleet.install([fleet.agent('ada', { displayName: 'Ada Lovelace' }), fleet.agent('b7', { displayName: 'ada' })]);
const RAW2 = { id: 'lab', name: 'Lab', folder: '/p/lab', agents: ['ada', 'b7'], tasks: [] };
const SHOWN2 = view.overviewOf(projects.describe(RAW2, FLEET2.agents, [RAW2]), [], { folderOf: () => null, readBrief: () => ({ goal: null, done: null, found: false }) });
FLEET2.restore();
const OVERVIEW2 = [200, { project: SHOWN2, agentsUnreadable: false }];

test('#7405 review 3: a sessionName that is another member\'s display name sends nothing, on both (control: an unambiguous name does)', () => withStub(OVERVIEW2, GONE, async (port, seen) => {
  assert.deepEqual(SHOWN2.members.map((m) => [m.name, m.sessionName]), [['Ada Lovelace', 'ada'], ['ada', 'b7']], 'CONTROL: the fixture does not collide');
  const m = await cli(port, ['project', 'remove-member', 'lab', 'ada', '--yes']);
  assert.equal(m.code, 1, m.out);
  assert.match(m.out, /More than one member of Lab is called ada, so nothing was changed\. Use one of these names instead: "Ada Lovelace", "b7"\./);
  const w = await winRun(port, ['project', 'remove-member', 'lab', 'ADA', '--yes']);
  assert.equal(w.code, 1, w.err);
  assert.match(w.err, /Use one of these names instead: "Ada Lovelace", "b7"\./);
  assert.equal(deletes(seen).length, 0, 'an ambiguous name was sent');
  assert.equal((await cli(port, ['project', 'remove-member', 'lab', 'b7', '--yes'])).code, 0);
  assert.equal(deletes(seen)[0].url, '/api/project/lab/agent/b7', 'CONTROL: the unambiguous name was not sent');
}));

test('#7405 review 3: a sessionName typed in another case finds its member, on both', () => withStub(OVERVIEW, GONE, async (port, seen) => {
  assert.equal((await cli(port, ['project', 'remove-member', 'launch', 'SALLY-SALES', '--yes'])).code, 0);
  assert.equal((await winRun(port, ['project', 'remove-member', 'launch', 'Sally-Sales', '--yes'])).code, 0);
  assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/project/launch/agent/sally-sales', '/api/project/launch/agent/sally-sales']);
}));

/* ── kosmos#7405 review 4 ─────────────────────────────────────────────────────── */

test('#7405 review 4 Windows: a project the board does not have is said in its words, and nothing is removed', () => withStub(NO_PROJECT, GONE, async (port, seen) => {
  const w = await winRun(port, ['project', 'remove-member', 'nope', 'Ada', '--yes']);
  assert.equal(w.code, 1, w.err);
  assert.match(w.err, /Kosmos could not read nope: there is no project by that name\./);
  assert.equal(deletes(seen).length, 0);
}));

// The real overview, with one member's stored values changed by assignment (never a hand-built member).
function overviewWith(change) {
  const p = JSON.parse(JSON.stringify(SHOWN));
  change(p.members);
  return [200, { project: p, agentsUnreadable: false }];
}

test('#7405 review 4: a member stored as "." is refused with nothing sent, on both (control: a real member is sent)', () => withStub(overviewWith((ms) => { ms[1].sessionName = '.'; ms[1].name = 'Dot'; }), GONE, async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'Dot', '--yes']);
  assert.equal(m.code, 1, m.out);
  assert.match(m.out, /Kosmos cannot take a member stored as "\." off from here, so nothing was changed\. Take it off on the board instead/);
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'Dot', '--yes']);
  assert.equal(w.code, 1, w.err);
  assert.equal(deletes(seen).length, 0, 'a "." member reached the route');
  assert.equal((await cli(port, ['project', 'remove-member', 'launch', 'Sally Sales', '--yes'])).code, 0);
  assert.equal(deletes(seen).length, 1, 'CONTROL: a real member was not sent');
}));

test('#7405 review 4: an escape sequence in a display name never reaches the terminal, on both', () => withStub(overviewWith((ms) => { ms[1].name = 'Ada\u001b[2J‮'; }), GONE, async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.equal(m.code, 0, m.out);
  assert.ok(!/[\u001b‮]/.test(m.out), 'the Mac printed a raw escape: ' + JSON.stringify(m.out));
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.equal(w.code, 0, w.err);
  assert.ok(!/[\u001b‮]/.test(w.out + w.err), 'Windows printed a raw escape');
  assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/project/launch/agent/ada', '/api/project/launch/agent/ada'], 'the raw sessionName was not what was sent');
}));

/* ── kosmos#7405 review 5 ─────────────────────────────────────────────────────── */

test('#7405 review 5: when no name tells two members apart, the answer sends the person to the board, not in a circle, on both', () => withStub(overviewWith((ms) => {
  ms[0].sessionName = 'ADA'; ms[0].name = 'ada'; ms[1].sessionName = 'ada'; ms[1].name = 'Ada';
}), GONE, async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.equal(m.code, 1, m.out);
  assert.match(m.out, /and no name here tells them apart, so nothing was changed\. Take the member off on the board instead/);
  assert.doesNotMatch(m.out, /Use one of these names/, 'it offered names that are themselves ambiguous');
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.match(w.err, /no name here tells them apart/);
  assert.equal(deletes(seen).length, 0);
}));

test('#7405 review 5: when the board could not read its agents, a missed name says members may show by machine name, on both', () => withStub([200, { project: SHOWN, agentsUnreadable: true }], GONE, async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'Nobody', '--yes']);
  assert.equal(m.code, 1, m.out);
  assert.match(m.out, /Kosmos could not read its agents just now, so members may show by their machine names: kosmos project show launch lists who is on it\./);
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'Nobody', '--yes']);
  assert.match(w.err, /Kosmos could not read its agents just now/);
  assert.equal(deletes(seen).length, 0);
}));

/* ── kosmos#7405 review 6: a joiner in a display name is kept, as project show keeps it ─────────────── */
test('#7405 review 6: a ZWJ family emoji in a display name is printed whole, on both', () => withStub(overviewWith((ms) => { ms[1].name = 'Ada \u{1F468}‍\u{1F469}‍\u{1F467}'; }), GONE, async (port) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.equal(m.code, 0, m.out);
  assert.match(m.out, /Ada \u{1F468}‍\u{1F469}‍\u{1F467} is off Launch/u, 'the Mac split the joined emoji: ' + JSON.stringify(m.out));
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.match(w.out, /Ada \u{1F468}‍\u{1F469}‍\u{1F467} is off Launch/u, 'Windows split the joined emoji');
}));

/* ── kosmos#7405 review 7: some candidates with a name of their own and some without ─────────────── */
test('#7405 review 7: when one candidate has no name of its own, no names are offered, on both (a list would read as all of them)', () => withStub(overviewWith((ms) => {
  ms[0].sessionName = 'ada'; ms[0].name = 'ada'; ms[1].sessionName = 'b7'; ms[1].name = 'ada';
}), GONE, async (port, seen) => {
  const m = await cli(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.equal(m.code, 1, m.out);
  assert.match(m.out, /and no name here tells them apart, so nothing was changed\. Take the member off on the board instead/);
  assert.doesNotMatch(m.out, /b7/, 'it offered one candidate as if it were all of them');
  const w = await winRun(port, ['project', 'remove-member', 'launch', 'ada', '--yes']);
  assert.match(w.err, /no name here tells them apart/);
  assert.doesNotMatch(w.err, /b7/);
  assert.equal(deletes(seen).length, 0);
}));
