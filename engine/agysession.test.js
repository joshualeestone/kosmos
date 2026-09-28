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

/* Every root sandboxed before any require (repo convention): agysession requires status.js. */
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'agysession-'));
const HOME = path.join(SB, 'antigravity-cli');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_WORKFORCE_AGY_HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const agy = require('./agysession');
const { NO_READING } = require('./status');

const { generation, writeConversation } = require('../test-support/agyfixture');

/** A workdir with its conversation db, mapped in last_conversations.json. */
function conversation(gens, opts) {
  const dir = fs.mkdtempSync(path.join(SB, 'agy-work-'));
  const { id, file } = writeConversation(HOME, dir, gens, opts);
  return { dir, id, file };
}

test('#4039: one generation decodes to its model and usage', () => {
  const g = agy.decodeGeneration(generation({ prompt: 12561, reply: 149, thoughts: 3 }));
  assert.deepEqual(g, { model: 'gemini-3.8-flash', prompt: 12561, reply: 149 });
});

test('#4039: an int64 -1 (a 10-byte varint) beside the fields does not blank the reading', () => {
  const g = agy.decodeGeneration(generation({ prompt: 5000, reply: 50, negative: true }));
  assert.deepEqual(g, { model: 'gemini-3.8-flash', prompt: 5000, reply: 50 }, 'one negative field hid the whole usage');
});

test('#4039: context used is the LATEST reporting generation\'s PROMPT (as Codex and Gemini CLI read it); agy records no window', () => {
  const { dir } = conversation([
    generation({ prompt: 12561, reply: 149, thoughts: 3 }),
    generation({ prompt: 12657, reply: 783, thoughts: 132 }),
    generation({ prompt: 13896, reply: 175, thoughts: 93 }),
  ]);
  const r = agy.read(dir);
  assert.equal(r.found, true);
  assert.equal(r.provider, 'antigravity');
  assert.equal(r.contextUsed, 13896, 'the newest generation\'s prompt: the whole conversation as last sent');
  assert.equal(r.contextWindow, null, 'the window is status.js\'s assumption, never read from the blob');
  assert.equal(r.model, 'gemini-3.8-flash');
  assert.equal(r.messages, 3);
});

test('#4039: the newest generation that names a model wins, and a newer one without usage does not blank it', () => {
  const { dir } = conversation([
    generation({ model: 'gemini-2.5-flash', prompt: 12000, reply: 10 }),
    generation({ model: 'gemini-3.8-flash', prompt: 12100, reply: 20 }),
    generation({ model: 'gemini-3.9-flash' }), // newest: names a model, reports no usage yet
  ]);
  const r = agy.read(dir);
  assert.equal(r.model, 'gemini-3.9-flash', 'an older model overwrote the newest');
  assert.equal(r.contextUsed, 12100, 'the newest REPORTING generation, not the newest row');
});

test('#4039: only the newest generations are decoded, so a long conversation costs the same per poll', () => {
  const gens = [];
  /* Only the OLDEST generation names a model, so it is found only if the read goes past the
     newest NEWEST_GENS: it must not. */
  for (let i = 0; i < agy.NEWEST_GENS + 30; i += 1) gens.push(generation({ model: null, prompt: 1000 + i, reply: 1 }));
  gens[0] = generation({ model: 'only-in-the-oldest', prompt: 1, reply: 1 });
  const { dir } = conversation(gens);
  const r = agy.read(dir);
  assert.equal(r.contextUsed, 1000 + gens.length - 1, 'the newest');
  assert.equal(r.messages, gens.length, 'messages counts every generation');
  assert.equal(r.model, null, 'a generation older than the newest NEWEST_GENS was decoded');
});

test('#4039: a conversation with no usage recorded reads as no reading, never as 0', () => {
  const { dir } = conversation([generation({})]);
  const r = agy.read(dir);
  assert.equal(r.found, true);
  assert.equal(r.contextUsed, null);
  assert.equal(r.contextWindow, null);
});

test('#4039: a workdir agy never mapped has no transcript', () => {
  const dir = fs.mkdtempSync(path.join(SB, 'agy-unmapped-'));
  assert.deepEqual(agy.read(dir), { found: false, because: NO_READING.NO_TRANSCRIPT });
});

test('#4039: a db that is not SQLite reads as unreadable, not as a crash', () => {
  const { dir, file } = conversation([generation({ prompt: 1, reply: 1 })]);
  fs.writeFileSync(file, 'this is not a database');
  assert.deepEqual(agy.read(dir), { found: false, because: NO_READING.UNREADABLE });
});

test('#4039: reading never changes agy\'s db, in WAL mode as the real ones are', () => {
  /* ⚠️ A WAL db gains -wal/-shm companion files from ANY SQLite reader (SQLite's own shared memory,
     which agy makes too while it runs); those are allowed. The db's own bytes and mtime are not. */
  const { dir, file } = conversation([generation({ prompt: 5000, reply: 50 })], { wal: true });
  const before = fs.readFileSync(file);
  const beforeMtime = fs.statSync(file).mtimeMs;
  agy.read(dir);
  agy.read(dir);
  assert.ok(before.equals(fs.readFileSync(file)), 'the db bytes changed');
  assert.equal(fs.statSync(file).mtimeMs, beforeMtime, 'the db was touched');
  assert.equal(agy.read(dir).contextUsed, 5000, 'control: the WAL db reads');
});

test('#4039 control: a blob that is not protobuf decodes to nothing rather than to garbage numbers', () => {
  assert.deepEqual(agy.decodeGeneration(Buffer.from([0xff, 0xff, 0xff])), { model: null, prompt: null, reply: null });
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

test('#4039: the ring follows the NEWEST prompt down after agy compacts, not the largest ever seen', () => {
  const { dir } = conversation([
    generation({ prompt: 90000, reply: 10 }),
    generation({ prompt: 91000, reply: 10 }),
    generation({ prompt: 14000, reply: 10 }), // after a compaction
  ]);
  assert.equal(agy.read(dir).contextUsed, 14000, 'an older, larger prompt was kept');
});

test('#4039: an empty -wal (made by any reader, this one included) is not activity', () => {
  const { dir, file } = conversation([generation({ prompt: 5000, reply: 50 })]);
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(file, past, past);
  fs.writeFileSync(file + '-wal', '');
  const r = agy.read(dir);
  assert.equal(r.lastAt, past.toISOString(), 'our own read was reported as the agent\'s last activity');
  fs.writeFileSync(file + '-wal', 'x');
  assert.notEqual(agy.read(dir).lastAt, past.toISOString(), 'control: a -wal with content IS the newest write');
});

test('#4039: once agy caches the prompt, the ring counts the cached part too, so it grows and never falls on a longer turn', () => {
  // The real two-turn conversation from prod 0.7.05 (field values as measured, not invented).
  const gens = [
    generation({ prompt: 18372, reply: 18643, thoughts: 101 }),
    generation({ prompt: 20875, cached: 16339, reply: 55, thoughts: 1 }),
    generation({ prompt: 4756, cached: 32668, reply: 1271, thoughts: 246 }),
    generation({ prompt: 2292, cached: 36747, reply: 175, thoughts: 118 }),
  ];
  const seen = [];
  for (let n = 1; n <= gens.length; n += 1) {
    const { dir } = conversation(gens.slice(0, n));
    seen.push(agy.read(dir).contextUsed);
  }
  assert.deepEqual(seen, [18372, 37214, 37424, 39039], 'the prompt as sent is 1.4.2 + 1.4.5');
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] >= seen[i - 1], 'the ring fell between turns: ' + seen.join(', '));
  // CONTROL: a generation with no cache field reads 1.4.2 alone, as before.
  assert.equal(agy.decodeGeneration(generation({ prompt: 12561, reply: 149 })).prompt, 12561);
});

test('#4393: a turn served wholly from cache (1.4.2 left off the wire as a proto3 zero) reads as the cached prompt, not as no reading', () => {
  const g = agy.decodeGeneration(generation({ prompt: null, cached: 39100, reply: 20, thoughts: 5 }));
  assert.equal(g.prompt, 39100, 'an absent 1.4.2 beside a present 1.4.5 is 0 uncached, not a missing reading');
  // And in a conversation, that newest generation is the ring, not an older, smaller one.
  const { dir } = conversation([
    generation({ prompt: 18372, reply: 18643, thoughts: 101 }),
    generation({ prompt: 20875, cached: 16339, reply: 55, thoughts: 1 }),
    generation({ prompt: null, cached: 39100, reply: 20, thoughts: 5 }),
  ]);
  assert.equal(agy.read(dir).contextUsed, 39100, 'the ring fell back to an older generation');
  // CONTROL: a usage message with neither field is still no reading, never 0.
  assert.equal(agy.decodeGeneration(generation({ prompt: null, reply: 3 })).prompt, null);
});
