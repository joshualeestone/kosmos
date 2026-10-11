'use strict';
/**
 * kosmos#5208: bound ended-agents.jsonl. The prune may drop a line only when no answer of the token-only removal check
 * (endedSince against the newest agent-made birth's `at`, strict, and `askedAt`, inclusive) can depend on it. This test
 * process's store is a throwaway.
 *
 *   node --test engine/sendertoken.prune-ended-5208.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-ended-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const sendertoken = require('./sendertoken');
const create = require('./create');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-11T09:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const ENDED = () => sendertoken.endedLogFile();
const BIRTHS = () => create.createdLogFile();
function write(file, lines) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'); }
const end = (name, ms) => ({ name, at: iso(ms) });
// An agent-made birth: the only kind the removal check compares.
const made = (name, by, askedMs, atMs) => ({ name, slug: name, outcome: 'created', createdBy: 'agent', createdByName: by, askedAt: iso(askedMs), at: iso(atMs) });

test('kosmos#5208 cutoff: the earlier of 30 days ago and the oldest askedAt/at of the newest agent-made births', () => {
  const births = [made('kid', 'mom', NOW - 90 * DAY, NOW - 90 * DAY + 1000), made('kid', 'mom', NOW - 10 * DAY, NOW - 10 * DAY + 1000)].map((b) => JSON.stringify(b)).join('\n');
  // The newer birth of kid replaces the older one, so the floor (30 days) is the cutoff.
  assert.equal(sendertoken.endedPruneCutoff(births, NOW), iso(NOW - 30 * DAY));
  const old = [made('elder', 'mom', NOW - 60 * DAY, NOW - 60 * DAY + 1000)].map((b) => JSON.stringify(b)).join('\n');
  assert.equal(sendertoken.endedPruneCutoff(old, NOW), iso(NOW - 60 * DAY), 'an older agent-made birth did not pull the cutoff back');
  // A person-made birth (no createdByName) is never compared, so it does not hold the cutoff.
  const person = JSON.stringify({ name: 'p', slug: 'p', outcome: 'created', createdBy: 'operator', at: iso(NOW - 200 * DAY) });
  assert.equal(sendertoken.endedPruneCutoff(person, NOW), iso(NOW - 30 * DAY));
  // A newer `partial` birth of the same name supersedes an agent-made one (as agentBirthOf reads it).
  const superseded = [made('x', 'mom', NOW - 90 * DAY, NOW - 90 * DAY + 1), { name: 'x', slug: 'x', outcome: 'partial', at: iso(NOW - DAY) }].map((b) => JSON.stringify(b)).join('\n');
  assert.equal(sendertoken.endedPruneCutoff(superseded, NOW), iso(NOW - 30 * DAY));
  assert.equal(sendertoken.endedPruneCutoff('', NOW), iso(NOW - 30 * DAY), 'no birth log: the floor alone');
  const badTime = JSON.stringify({ ...made('y', 'mom', NOW - 90 * DAY, NOW), askedAt: '2026-01-01' });
  assert.equal(sendertoken.endedPruneCutoff(badTime, NOW), null, 'a birth time it cannot order must stop the prune');
});

test('kosmos#5208 prune text: keeps lines at or after the cutoff, drops older, and refuses on any line it cannot read', () => {
  const cut = iso(NOW - 40 * DAY);
  const raw = '\n' + [end('a', NOW - 50 * DAY), end('b', NOW - 40 * DAY), end('c', NOW - 5 * DAY)].map((l) => JSON.stringify(l)).join('\n') + '\n';
  const out = sendertoken.pruneEndedText(raw, cut);
  assert.deepEqual(out.split('\n').filter(Boolean).map((l) => JSON.parse(l).name), ['b', 'c'], 'the line exactly at the cutoff was dropped, or an older one kept');
  for (const bad of ['{"name":"t","at":"2026-01-01"}', '{"name":"t"', '{"at":"' + iso(NOW) + '"}']) {
    assert.equal(sendertoken.pruneEndedText(raw + bad + '\n', cut), null, 'pruned past an unreadable line: ' + bad);
  }
});

// The answers the removal check can give, for every agent-made birth in `births`.
function answers(births) {
  return births.filter((b) => b.createdByName).map((b) => [
    sendertoken.endedSince([b.name], b.at),
    sendertoken.endedSince([b.createdByName], b.askedAt, { inclusive: true }),
  ]);
}

test('kosmos#5208: a prune never changes an answer of the removal check (an end AT askedAt included), and swaps the file whole', () => {
  const asked = NOW - 50 * DAY;
  const births = [
    made('kid', 'mom', asked, asked + 1000),          // the oldest agent-made birth: holds the cutoff at `asked`
    made('fresh', 'dad', NOW - DAY, NOW - DAY + 1000),
  ];
  write(BIRTHS(), births);
  const lines = [];
  for (let i = 0; i < 400; i++) lines.push(end('noise' + i, NOW - 300 * DAY + i));   // long gone, droppable
  lines.push(end('mom', asked));                                                     // AT askedAt: the creator check counts it
  lines.push(end('kid', asked + 500));                                               // before the birth's at: not the target's end
  lines.push(end('dad', NOW - 2 * DAY));
  write(ENDED(), [''].concat(lines.map((l) => JSON.stringify(l))));
  const before = answers(births);
  assert.deepEqual(before, [[false, true], [false, false]], 'fixture: mom ended AT askedAt must read as ended');
  const ino = fs.statSync(ENDED()).ino;
  const dropped = sendertoken.pruneEnded({ atBytes: 0, now: NOW });
  assert.ok(dropped > 0, 'nothing was pruned, so the arm below proves nothing');
  assert.deepEqual(answers(births), before, 'a prune changed what the removal check answers');
  const kept = fs.readFileSync(ENDED(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name);
  assert.deepEqual(kept, ['mom', 'kid', 'dad']);
  assert.notEqual(fs.statSync(ENDED()).ino, ino, 'the file was rewritten in place, not replaced whole by a rename');
  assert.deepEqual(fs.readdirSync(path.dirname(ENDED())).filter((f) => f.endsWith('.tmp')), [], 'a temp file was left behind');
});

test('kosmos#5208: a removed agent\'s birth still holds the cutoff, so its removal line survives (no ownership on restore)', () => {
  const asked = NOW - 80 * DAY;
  write(BIRTHS(), [made('gone', 'mom', asked, asked + 1000)]);   // removed long ago; its newest birth is still this one
  write(ENDED(), ['', JSON.stringify(end('gone', asked + 5000)), ...Array.from({ length: 50 }, (_, i) => JSON.stringify(end('old' + i, NOW - 400 * DAY)))]);
  assert.equal(sendertoken.endedSince(['gone'], iso(asked + 1000)), true, 'fixture: the removal line ends ownership');
  sendertoken.pruneEnded({ atBytes: 0, now: NOW });
  assert.equal(sendertoken.endedSince(['gone'], iso(asked + 1000)), true, 'the removal line was pruned: a restored agent would be removable again');
  assert.equal(fs.readFileSync(ENDED(), 'utf8').includes('old0'), false, 'CONTROL: the older noise was pruned');
});

test('kosmos#5208: it prunes nothing under the size bound, on an unreadable line, or on a birth log it cannot read', () => {
  write(BIRTHS(), []);
  const lines = ['', ...Array.from({ length: 20 }, (_, i) => JSON.stringify(end('o' + i, NOW - 400 * DAY)))];
  write(ENDED(), lines);
  assert.equal(sendertoken.pruneEnded({ now: NOW }), 0, 'pruned a small file (under ENDED_PRUNE_AT_BYTES)');
  write(ENDED(), lines.concat(['{"name":"torn"']));
  assert.equal(sendertoken.pruneEnded({ atBytes: 0, now: NOW }), 0, 'pruned past a torn line');
  write(ENDED(), lines);
  fs.rmSync(BIRTHS(), { force: true }); fs.mkdirSync(BIRTHS(), { recursive: true });   // a directory: unreadable, not missing
  try {
    assert.equal(sendertoken.pruneEnded({ atBytes: 0, now: NOW }), 0, 'pruned without being able to read the births');
  } finally { fs.rmSync(BIRTHS(), { recursive: true, force: true }); }
  assert.ok(sendertoken.pruneEnded({ atBytes: 0, now: NOW }) > 0, 'CONTROL: with no birth log (missing), the 30-day floor prunes');
});

test('kosmos#5208: an end is appended even when the lock cannot be had', () => {
  write(ENDED(), ['']);
  const lock = ENDED() + '.lock';
  fs.mkdirSync(lock);   // a live holder
  const prev = process.env.AGENT_WORKFORCE_LOCK_MS;
  process.env.AGENT_WORKFORCE_LOCK_MS = '30';
  try {
    sendertoken.revoke('locked-out-agent');
    assert.match(fs.readFileSync(ENDED(), 'utf8'), /"name":"locked-out-agent"/, 'an end was lost while the lock was held');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_LOCK_MS; else process.env.AGENT_WORKFORCE_LOCK_MS = prev;
    fs.rmSync(lock, { recursive: true, force: true });
  }
  // CONTROL: with the lock free, the end goes in too (under the lock), and the lock is released.
  sendertoken.revoke('free-agent');
  assert.match(fs.readFileSync(ENDED(), 'utf8'), /"name":"free-agent"/);
  assert.equal(fs.existsSync(lock), false, 'the lock was left held');
});
