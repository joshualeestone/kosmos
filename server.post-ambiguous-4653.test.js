'use strict';
/**
 * #4653 at the route: a real `/api/post` room post whose @-word names two members answers with the
 * sentence, and `kosmos post`'s own read (the sed expression, lifted from install/kosmos and run by the
 * real sed) finds it in the raw answer. The CLI reads it anchored on the end of the answer, so this is
 * what fails if a later change puts another key after the note or around `delivery`.
 *
 *   node --test server.post-ambiguous-4653.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-ambig-4653-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-ambig-4653-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const TMPS = [];
const tmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-ambig-4653-' + tag + '-')); TMPS.push(d); return d; };
process.env.AGENT_WORKFORCE_WORKERS = tmp('work');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('proj');
process.env.AGENT_WORKFORCE_LAUNCH = tmp('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const messagesEngine = require('./engine/messages');
const chatEngine = require('./engine/chat');
const projects = require('./engine/projects');

/* The CLI's read, exactly as install/kosmos has it, so this cannot drift from what the CLI does. */
const CLI_SRC = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
const SED = (/_ambig=\$\(printf '%s' "\$body" \| sed -n '([^']+)'\)/.exec(CLI_SRC) || [])[1];

let board;
test.before(async () => {
  await start(0);
  board = fleet.install([
    fleet.agent('leo', { state: 'idle' }),
    fleet.agent('subzero', { state: 'idle', displayName: 'Sub-Zero' }),
    fleet.agent('frost', { state: 'idle', displayName: 'Sub Zero' }),
  ]);
  chatEngine.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chatEngine.setDryRun(false);
});
test.after(() => {
  messagesEngine.resetForTests(); chatEngine.setRunner(null); chatEngine.setDryRun(true);
  if (board) board.restore();
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, ...TMPS]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

async function post(text) {
  const p = projects.create({ name: 'Ambig ' + Math.random().toString(36).slice(2, 8) });
  for (const a of ['leo', 'subzero', 'frost']) projects.addAgent(p.id, a);
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': sendertoken.mint('leo').token },
    body: JSON.stringify({ project: p.id, text, from_pane: '' }),
  });
  return res.text();
}
const cliRead = (raw) => execFileSync('sed', ['-n', SED], { input: raw, encoding: 'utf8' }).trim();

test('#4653: the CLI read was found in install/kosmos (the lift is not vacuous)', () => {
  assert.ok(SED && SED.includes('ambiguousNote'), 'could not lift the sed read from install/kosmos');
});

test('#4653: a real /api/post answer carries the note where kosmos post reads it', async () => {
  const raw = await post('@Sub-Zero please look');
  const d = JSON.parse(raw).delivery;
  assert.ok(['placed', 'unconfirmed'].includes(d.state), raw.slice(0, 300));
  assert.match(d.ambiguousNote, /^@Sub-Zero could mean Sub Zero \(@frost\) or Sub-Zero \(@subzero\), so it reached neither/);
  assert.equal(cliRead(raw), d.ambiguousNote, 'kosmos post would not find the note in the real answer');
});

test('#4653 control: a unique mention gives no note, and the CLI read finds nothing', async () => {
  const raw = await post('@subzero please look');
  assert.equal(JSON.parse(raw).delivery.ambiguousNote, undefined);
  assert.equal(cliRead(raw), '');
});
