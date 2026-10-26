'use strict';
/**
 * kosmos#7149, over HTTP: a recorded `started` report takes the copy of what the agent last read, and nothing else
 * does. node --test server.instructionreread-start-7149.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7149-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const ir = require('./engine/instructionreread');

const WHO = 'lia';
let base;
let TOKEN = '';
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* best effort */ } });
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': TOKEN }, body: JSON.stringify(body) });
  return res.json();
}

test('a recorded started report takes the copy; CONTROL: an idle report takes none', async () => {
  const board = fleet.install([fleet.agent(WHO, { state: 'idle' })]);
  try {
    const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, WHO);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# You are Lia\n\n## The Kosmos+ community\nPost once a day.\n');
    TOKEN = sendertoken.mint(WHO).token;
    assert.equal(ir.readSeen(WHO), null);
    const idle = await report({ state: 'idle', text: 'between tasks' });
    assert.equal(idle.recorded, true, JSON.stringify(idle));
    assert.equal(ir.readSeen(WHO), null, 'an idle report took a copy');
    const started = await report({ state: 'started', text: 'session start' });
    assert.equal(started.recorded, true, JSON.stringify(started));
    assert.equal(ir.readSeen(WHO), '# You are Lia\n\n## The Kosmos+ community\nPost once a day.\n', 'a recorded start took no copy');
  } finally { board.restore(); }
});

test('review 11: a started report that is NOT recorded takes no copy (the row startedSince reads does not exist)', async () => {
  const board = fleet.install([fleet.agent('mia', { state: 'idle' })]);
  const selfreport = require('./engine/selfreport');
  const real = selfreport.record;
  try {
    const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mia');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# You are Mia\n');
    TOKEN = sendertoken.mint('mia').token;
    selfreport.record = () => ({ recorded: false, because: 'we could not save that report' });
    const refused = await report({ state: 'started', text: 'session start' });
    assert.notEqual(refused.recorded, true, JSON.stringify(refused));
    assert.equal(ir.readSeen('mia'), null, 'a refused start moved the copy');
    // CONTROL: the same start, recorded, takes it.
    selfreport.record = real;
    const kept = await report({ state: 'started', text: 'session start' });
    assert.equal(kept.recorded, true, JSON.stringify(kept));
    assert.equal(ir.readSeen('mia'), '# You are Mia\n');
  } finally { selfreport.record = real; board.restore(); }
});
