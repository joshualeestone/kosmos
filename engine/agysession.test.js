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

/* ---- a minimal protobuf writer: varints and length-delimited fields ---- */
function varint(n) {
  const out = [];
  let v = n;
  do { let b = v % 128; v = Math.floor(v / 128); if (v > 0) b |= 0x80; out.push(b); } while (v > 0);
  return Buffer.from(out);
}
const num = (field, n) => Buffer.concat([varint(field * 8), varint(n)]);
const msg = (field, ...parts) => {
  const body = Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p)));
  return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
};

/** One generation as agy writes it: model at 1.19, usage at 1.4, window at 3.13.2.22. */
function generation({ model = 'gemini-3.8-flash', prompt, reply, thoughts = 0, window } = {}) {
  const usage = prompt === undefined ? [] : [msg(4, num(1, 1318), num(2, prompt), num(3, reply + thoughts), num(9, reply), num(10, thoughts))];
  const parts = [msg(1, msg(19, model), ...usage)];
  if (window) parts.push(msg(3, msg(13, msg(2, num(22, window)))));
  return Buffer.concat(parts);
}

let seq = 0;
/** A workdir with its conversation db, mapped in last_conversations.json. */
function conversation(gens) {
  seq += 1;
  const id = '0000000' + seq + '-aaaa-bbbb-cccc-dddddddddddd';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-work-'));
  fs.mkdirSync(path.join(HOME, 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(HOME, 'cache'), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(HOME, 'conversations', id + '.db'));
  db.exec('CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob, size integer NOT NULL DEFAULT 0)');
  const put = db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)');
  gens.forEach((g, i) => put.run(i, g, g.length));
  db.close();
  const mapFile = path.join(HOME, 'cache', 'last_conversations.json');
  let map = {};
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { /* first one */ }
  map[fs.realpathSync(dir)] = id;
  fs.writeFileSync(mapFile, JSON.stringify(map));
  return { dir, id, file: path.join(HOME, 'conversations', id + '.db') };
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
