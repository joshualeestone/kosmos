'use strict';

/**
 * #5318: `kosmos report blocked --owner <a person>` is recorded as sent, and the answer carries a note pointing at
 * needs_you, the only state Kosmos follows up (recommender.js). blocked is never chased (heartbeat.js), so a person
 * put in --owner left person-blocked work inert (0.7.22, a real install: --owner "Josh").
 *
 * Pure rows on selfreport.blockedOwnerNote, then the real route on a sandboxed board (the same posture as
 * server.report-refusal-4606.test.js), then both CLIs' sources print the note.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5318-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const selfreport = require('./engine/selfreport');
const you = require('./engine/you');
const sendertoken = require('./engine/sendertoken');
const WHO = 'leo';

const NOTE = selfreport.BLOCKED_PERSON_NOTE;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('#5318: who counts as a person in --owner (pure)', () => {
  const opts = { personName: 'Josh Stone', agentNames: ['angel', 'Mona Lisa', 'leo-discord'] };
  const rows = [
    ['blocked', 'Josh', true, 'the About-you first name'],
    ['blocked', 'josh  STONE', true, 'the whole About-you name, any case and spacing'],
    ['blocked', 'the person', true, 'a word that names a person'],
    ['blocked', 'my operator', true, 'a person word after my'],
    ['blocked', 'me', true, 'me'],
    ['blocked', 'josh@example.com', true, 'an email address'],
    ['blocked', 'Angel', false, 'an agent on this board is that agent, never a person'],
    ['blocked', 'mona lisa', false, 'an agent by its display name'],
    ['blocked', 'deploy', false, 'a deploy'],
    ['blocked', 'provider', false, 'the report hook\'s own provider owner'],
    ['blocked', 'Ingram', false, 'an outside party that is not the About-you name'],
    ['blocked', 'J', false, 'a one-letter first word never matches'],
    ['blocked', '', false, 'no owner'],
    ['needs_you', 'Josh', false, 'needs_you is already the right state'],
    ['working', 'the person', false, 'only blocked is advised'],
  ];
  for (const [state, owner, want, why] of rows) {
    assert.equal(selfreport.blockedOwnerNote(state, owner, opts) === NOTE, want, `${state} --owner ${JSON.stringify(owner)}: ${why}`);
  }
  assert.equal(selfreport.blockedOwnerNote('blocked', 'Josh', {}), '', 'with no About-you name saved, a first name alone is not judged a person');
});

test('#5318: the note can be lifted by the macOS CLI and is one plain line', () => {
  assert.doesNotMatch(NOTE, /["\\\n]/, 'no quote, backslash or newline: install/kosmos lifts it with sed');
  assert.match(NOTE, /kosmos report needs_you <your question>/);
  assert.match(NOTE, /never followed up or escalated/);
});

let TOKEN = '';
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': TOKEN }, body: JSON.stringify(body) });
  return res.json();
}

test('#5318: the route records a blocked report naming a person, and answers with the note', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  try {
    you.save({ name: 'Josh Stone', does: 'runs this computer' });
    TOKEN = sendertoken.mint(WHO).token;
    const toPerson = await report({ state: 'blocked', on: 'the founder meeting', owner: 'Josh' });
    assert.equal(toPerson.recorded, true, 'still recorded as sent: ' + JSON.stringify(toPerson));
    assert.equal(toPerson.note, NOTE, 'the answer points at needs_you');
    const stored = selfreport.read(WHO);
    assert.equal(stored && stored.state, 'blocked', 'recorded as blocked, as sent: ' + JSON.stringify(stored));

    const toWord = await report({ state: 'blocked', on: 'sign-off', owner: 'the person' });
    assert.equal(toWord.note, NOTE, 'a person word is advised too');

    const toDeploy = await report({ state: 'blocked', on: 'the release', owner: 'deploy' });
    assert.equal(toDeploy.recorded, true);
    assert.equal(toDeploy.note, undefined, 'a deploy owner gets no note (CONTROL: the note is not on every blocked)');

    const asked = await report({ state: 'needs_you', text: 'Can we meet the founder this week?' });
    assert.equal(asked.recorded, true);
    assert.equal(asked.note, undefined, 'needs_you gets no note');
  } finally { board.restore(); }
});

test('#5318: both CLIs print the note under Recorded', () => {
  const mac = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  const i = mac.indexOf('say "Recorded. The board reads it from here."');
  assert.ok(i > 0, 'the macOS CLI still says Recorded');
  const after = mac.slice(i, i + 600);
  assert.match(after, /note=\$\(printf '%s' "\$body" \| sed -n 's\/\.\*"note":"\\\(\[\^"\]\*\\\)"\.\*\/\\1\/p'\)/, 'the macOS CLI lifts the note');
  assert.match(after, /if \[ -n "\$note" \]; then say "\$note"; fi/, 'and prints it only when there is one (an if, so no note never fails the command)');
  const win = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  assert.match(win, /ctx\.out\('Recorded\. The board reads it from here\.'\);\n\s+if \(typeof r\.json\.note === 'string' && r\.json\.note\) ctx\.out\(r\.json\.note\);/,
    'the Windows CLI prints the note after Recorded');
});
