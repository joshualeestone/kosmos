'use strict';
/**
 * #6716 (Josh, 2026-10-20: "I am not sure why it doesnt recognize Renet's model"). A session that has not had a reply
 * yet holds no model line, so the card read "Made before Kosmos recorded this" for an agent whose previous session
 * said claude-opus-5-5. The reader now falls back to the newest earlier session in the agent's own folder, flagged.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-earlier-model-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'config');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');

const create = require('./create');
const status = require('./status');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

function session(name, file, rows, ageSec) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  const proj = path.join(SB, 'config', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true });
  const full = path.join(proj, file);
  fs.writeFileSync(full, rows.map((r) => JSON.stringify({ cwd: real, ...r })).join('\n') + '\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(full, t, t);
  return full;
}

test('#6716: a new session with no reply yet reads the model from the earlier one, flagged', () => {
  session('renet', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-5-5' } }], 600);
  session('renet', 'new.jsonl', [{ type: 'user', message: { content: 'hi' } }], 5);
  assert.deepEqual(status.readModel('renet'), { model: 'claude-opus-5-5', confidence: 'structured', earlierSession: true });
});

test('#6716 CONTROL: a session that has replied is read as itself, with no flag', () => {
  session('mikey', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 600);
  session('mikey', 'new.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-5-5' } }], 5);
  assert.deepEqual(status.readModel('mikey'), { model: 'claude-opus-5-5', confidence: 'structured' });
});

test('#6716: with no earlier session that names a model, nothing is invented', () => {
  session('fresh', 'only.jsonl', [{ type: 'user', message: { content: 'hi' } }], 5);
  assert.deepEqual(status.readModel('fresh'), { model: null, confidence: 'none' });
});

test('#6716: an earlier session recorded in another folder does not lend its model', () => {
  const full = session('april', 'new.jsonl', [{ type: 'user', message: { content: 'hi' } }], 5);
  fs.writeFileSync(path.join(path.dirname(full), 'stray.jsonl'), JSON.stringify({ cwd: '/somewhere/else', message: { model: 'claude-fable-5' } }) + '\n');
  assert.equal(status.readModel('april').model, null);
});

/* Review 1: the board's snapshot calls readModel(name, its tmux session), so the fallback must hold there too. The
   first version returned early when a session was passed and never reached a tile. */
test('#6716: the snapshot\'s call (with a session) also reads the earlier session', () => {
  session('renet2', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-5-5' } }], 600);
  session('renet2', 'new.jsonl', [{ type: 'user', message: { content: 'hi' } }], 5);
  const r = status.readModel('renet2', 'renet2');
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.earlierSession, true);
});

test('#6716 review 5: the snapshot keeps a borrowed model out of model and carries it as earlierModelName', () => {
  assert.deepEqual(status.splitModelReading({ model: 'claude-opus-4-8', earlierSession: true }),
    { model: null, earlierModelName: 'Claude Opus 4.8' }, 'a borrowed model reached `model`');
  // CONTROL: the session's own reading is `model`, with nothing borrowed.
  assert.deepEqual(status.splitModelReading({ model: 'claude-opus-4-8' }), { model: 'claude-opus-4-8', earlierModelName: null });
});

test('#6716 review 5: only an EARLIER session lends; a newer one in the folder never does', () => {
  const older = session('trio', 'a-older.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 900);
  const mid = session('trio', 'b-mid.jsonl', [{ type: 'user', message: { content: 'hi' } }], 600);
  session('trio', 'c-newer.jsonl', [{ type: 'assistant', message: { model: 'claude-fable-5' } }], 5);
  assert.ok(older);
  assert.equal(status.modelInEarlierSession(mid, 'trio'), 'claude-opus-4-8', 'a newer session lent its model');
});

test('#6716 review 6: a session file whose time cannot be read lends nothing (fails closed)', () => {
  session('closed', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 600);
  assert.equal(status.modelInEarlierSession(path.join(SB, 'nowhere', 'gone.jsonl'), 'closed'), null);
});

test('#6716 review 7: a session from more than two days before does not lend its model', () => {
  session('aged', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 3 * 24 * 3600);
  session('aged', 'new.jsonl', [{ type: 'user', message: { content: 'hi' } }], 5);
  assert.equal(status.readModel('aged').model, null, 'a model from days ago reads as today\'s');
});

test('#6716 review 10: a session that replied, with a big paste filling its tail, borrows nothing', () => {
  session('pasty', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 600);
  session('pasty', 'new.jsonl', [
    { type: 'assistant', message: { model: 'claude-sonnet-5', content: 'ok' } },   // a real reply
    { type: 'user', message: { content: 'x'.repeat(200000) } },   // pushes it out of the 64 KB tail
  ], 5);
  assert.deepEqual(status.readModel('pasty'), { model: null, confidence: 'none' }, 'a session that replied took an earlier session\'s model');
});

test('#6716 review 10 CONTROL: a big first message with no reply still borrows', () => {
  session('bigask', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-5-5' } }], 600);
  session('bigask', 'new.jsonl', [{ type: 'user', message: { content: 'y'.repeat(200000) } }], 5);
  assert.equal(status.readModel('bigask').model, 'claude-opus-5-5');
});

/* Review 11: what a failing sign-in actually leaves (measured on this machine: 112 such rows): an assistant row with a
   bracketed model and isApiErrorMessage. That session has not replied, so it still borrows: Renet's case. */
test('#6716 review 11: a new session holding only a failed sign-in still borrows the earlier model', () => {
  session('signfail', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-5-5' } }], 600);
  session('signfail', 'new.jsonl', [
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', isApiErrorMessage: true, error: 'authentication_failed',
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'Login expired · Please run /login' }] } },
  ], 5);
  assert.deepEqual(status.readModel('signfail'), { model: 'claude-opus-5-5', confidence: 'structured', earlierSession: true });
});

test('#6716 review 11: a failed sign-in row past the 64 KB tail does not count as a reply either', () => {
  session('signbig', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-5-5' } }], 600);
  session('signbig', 'new.jsonl', [
    { type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { model: '<synthetic>', content: 'limit' } },
    { type: 'user', message: { content: 'z'.repeat(200000) } },
  ], 5);
  assert.equal(status.readModel('signbig').model, 'claude-opus-5-5');
});
