'use strict';

/**
 * #4039: engine/agysession.js reads an Antigravity conversation read-only. Its fixtures are
 * SYNTHESIZED here, byte by byte, in the field layout measured on real agy conversations
 * (2026-09-26, Agent1s; see the module header), so no real conversation lands in the repo.
 *
 *   node --test engine/agysession.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agysession-'));
process.env.AGENT_WORKFORCE_AGY_HOME = HOME;
process.on('exit', () => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ } });
const agy = require('./agysession');
const { NO_READING } = require('./status');

const { generation, writeConversation } = require('../test-support/agyfixture');

/** A workdir with its conversation db, mapped in last_conversations.json. */
function conversation(gens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-work-'));
  const { id, file } = writeConversation(HOME, dir, gens);
  return { dir, id, file };
}

test('#4039: one generation decodes to its model, usage and window', () => {
  const g = agy.decodeGeneration(generation({ prompt: 12561, reply: 149, thoughts: 3, window: 1048576 }));
  assert.deepEqual(g, { model: 'gemini-3.8-flash', prompt: 12561, reply: 149, window: 1048576 });
});

test('#4039: context used is the LATEST reporting generation (prompt + reply), over the recorded window', () => {
  const { dir } = conversation([
    generation({ prompt: 12561, reply: 149, thoughts: 3 }),
    generation({ prompt: 12657, reply: 783, thoughts: 132 }),
    generation({ prompt: 13896, reply: 175, thoughts: 93, window: 1048576 }),
  ]);
  const r = agy.read(dir);
  assert.equal(r.found, true);
  assert.equal(r.provider, 'antigravity');
  assert.equal(r.contextUsed, 13896 + 175, 'the newest generation, prompt plus its reply (thoughts do not join the next prompt)');
  assert.equal(r.contextWindow, 1048576);
  assert.equal(r.model, 'gemini-3.8-flash');
  assert.equal(r.messages, 3);
});

test('#4039: the window is taken from any generation that records it', () => {
  const { dir } = conversation([
    generation({ prompt: 12000, reply: 10, window: 1048576 }),
    generation({ prompt: 12100, reply: 20 }),
  ]);
  const r = agy.read(dir);
  assert.equal(r.contextWindow, 1048576);
  assert.equal(r.contextUsed, 12120);
});

test('#4039: a conversation with no usage recorded reads as no reading, never as 0', () => {
  const { dir } = conversation([generation({})]);
  const r = agy.read(dir);
  assert.equal(r.found, true);
  assert.equal(r.contextUsed, null);
  assert.equal(r.contextWindow, null);
});

test('#4039: a workdir agy never mapped has no transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-unmapped-'));
  assert.deepEqual(agy.read(dir), { found: false, because: NO_READING.NO_TRANSCRIPT });
});

test('#4039: a db that is not SQLite reads as unreadable, not as a crash', () => {
  const { dir, file } = conversation([generation({ prompt: 1, reply: 1 })]);
  fs.writeFileSync(file, 'this is not a database');
  assert.deepEqual(agy.read(dir), { found: false, because: NO_READING.UNREADABLE });
});

test('#4039: reading never writes to agy\'s file', () => {
  const { dir, file } = conversation([generation({ prompt: 5000, reply: 50 })]);
  const before = fs.readFileSync(file);
  const beforeMtime = fs.statSync(file).mtimeMs;
  agy.read(dir);
  agy.read(dir);
  assert.ok(before.equals(fs.readFileSync(file)), 'the db bytes changed');
  assert.equal(fs.statSync(file).mtimeMs, beforeMtime, 'the db was touched');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.includes('-wal') || n.includes('-journal')), [], 'a read left a journal behind');
});

test('#4039 control: a blob that is not protobuf decodes to nothing rather than to garbage numbers', () => {
  assert.deepEqual(agy.decodeGeneration(Buffer.from([0xff, 0xff, 0xff])), { model: null, prompt: null, reply: null, window: null });
});

test('#4039: the db is opened read-only (a SOURCE pin, and said so)', () => {
  /* A read-write open followed by a SELECT writes nothing, so no behaviour here can tell it from a
     read-only one (measured: removing readOnly leaves every test above green). It still matters: a
     read-write open can contend for the lock agy needs while it runs. So the source is pinned. */
  const src = fs.readFileSync(path.join(__dirname, 'agysession.js'), 'utf8');
  const opens = src.match(/new DatabaseSync\([^)]*\)/g) || [];
  assert.ok(opens.length >= 1, 'no DatabaseSync open found: re-anchor this pin');
  for (const o of opens) assert.match(o, /readOnly:\s*true/, 'an agy db is opened without readOnly: ' + o);
});
