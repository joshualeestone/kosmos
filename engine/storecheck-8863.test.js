'use strict';
/**
 * kosmos#8863: the start check also covers the held-send queue (limitqueue/), chats (chats/) and the data root's
 * append-only records (*.jsonl), and Kosmos keeps its own last good copy of each good .json store (last-good/), which
 * the existing Put back offers. Measured before this change on 0.8.13: a zeroed limitqueue, chats or messages.jsonl
 * file was not reported, and a zeroed settings.json had "No good copy of it was found".
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const NO_POSIX_MODES = require('../test-support/skip-on-win32').skipOnWin32('it checks POSIX file modes, which Windows does not keep');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-storecheck-8863-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const store = require('./store');

/* A fresh data root and a fresh storecheck for each test: the module remembers this run's damaged stores. */
function fresh() {
  const root = store.ROOT;
  fs.rmSync(root, { recursive: true, force: true });
  for (const d of ['profiles', 'limitqueue', 'chats']) fs.mkdirSync(path.join(root, d), { recursive: true });
  delete require.cache[require.resolve('./storecheck')];
  return { root, sc: require('./storecheck') };
}
const put = (root, rel, bytes) => fs.writeFileSync(path.join(root, rel), bytes);
const nul = (n) => Buffer.alloc(n);
const quiet = () => {};

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('kosmos#8863: a clean start names nothing (control)', () => {
  const { root, sc } = fresh();
  put(root, 'settings.json', '{"timezone":"America/Chicago"}');
  put(root, 'limitqueue/alice.json', '{"kept":[]}');
  put(root, 'chats/direct..alice.json', '{"messages":[]}');
  put(root, 'messages.jsonl', '{"a":1}\n{"a":2}\n');
  assert.deepEqual(sc.atStart({ base: root }, quiet), []);
  assert.deepEqual(sc.lastScan(), { checked: true, damaged: 0, unread: 0 });
});

test('kosmos#8863: a zeroed held-send queue, chat and message record are named; an empty or torn record is not', () => {
  const { root, sc } = fresh();
  put(root, 'limitqueue/alice.json', nul(40));
  put(root, 'chats/direct..alice.json', nul(40));
  put(root, 'messages.jsonl', Buffer.concat([Buffer.from('{"a":1}\n'), nul(30), Buffer.from('{"a":3}\n')]));
  put(root, 'messages.ids.jsonl', nul(20));
  put(root, 'created.jsonl', '');                       // a normal state
  put(root, 'ended-agents.jsonl', '{"a":1}\n{"a":');     // what an ordinary append crash leaves: readers skip it
  const lines = [];
  const found = sc.atStart({ base: root }, (l) => lines.push(l));
  const got = Object.fromEntries(found.map((d) => [d.file, d.problem]));
  assert.deepEqual(got, {
    [path.join('limitqueue', 'alice.json')]: 'nul',
    [path.join('chats', 'direct..alice.json')]: 'nul',
    'messages.jsonl': 'nulpart',
    'messages.ids.jsonl': 'nul',
  });
  const msg = lines.find((l) => l.includes('messages.jsonl'));
  assert.match(msg, /has a blank stretch, as a crash can leave a file, and what was written there is lost \(it holds the messages your agents sent each other\)/);
  assert.match(msg, /nothing to put back/);
  assert.match(lines.find((l) => l.includes('limitqueue')), /it holds messages kept for an agent until its usage resets/);
  assert.equal(found.find((d) => d.file === 'messages.jsonl').backup, null, 'an append-only record is offered an older copy');
  // What the page reads: the record is marked as one the board adds to, the JSON stores are not.
  const cur = Object.fromEntries(sc.current().map((d) => [d.file, d.log]));
  assert.equal(cur['messages.jsonl'], true, 'the page is not told messages.jsonl is an append-only record');
  assert.equal(cur[path.join('limitqueue', 'alice.json')], false, 'a JSON store is marked as an append-only record');
});

test('kosmos#8863: a good store gets a last good copy at start, and a later crash can put it back from there', () => {
  const { root, sc } = fresh();
  const good = '{"timezone":"America/Chicago"}';
  put(root, 'settings.json', good);
  const t = new Date('2026-11-20T10:00:00Z');
  fs.utimesSync(path.join(root, 'settings.json'), t, t);
  sc.atStart({ base: root }, quiet);
  const lg = path.join(root, sc.LAST_GOOD, 'settings.json');
  assert.equal(fs.readFileSync(lg, 'utf8'), good, 'no last good copy was kept');
  assert.equal(fs.statSync(lg).mtimeMs, t.getTime(), 'the copy does not carry the time its contents were written');

  // The next start, after a crash blanked it: named, the copy offered, and put back on request.
  put(root, 'settings.json', nul(30));
  delete require.cache[require.resolve('./storecheck')];
  const sc2 = require('./storecheck');
  const lines = [];
  const found = sc2.atStart({ base: root }, (l) => lines.push(l));
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].backup, { file: path.join(sc2.LAST_GOOD, 'settings.json'), at: t.toISOString() });
  assert.match(lines[0], /A good copy saved 2026-11-20T10:00:00\.000Z is at last-good.settings\.json/);
  assert.deepEqual(sc2.restore('settings.json', quiet), { ok: true });
  assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), good);
});

test('kosmos#8863: a store found damaged this run never refreshes its copy, even once a reader saves over it', () => {
  const { root, sc } = fresh();
  fs.mkdirSync(path.join(root, sc.LAST_GOOD), { recursive: true });
  const kept = '{"timezone":"Europe/Paris"}';
  put(root, path.join(sc.LAST_GOOD, 'settings.json'), kept);
  put(root, 'settings.json', nul(30));
  sc.atStart({ base: root }, quiet);
  assert.equal(fs.readFileSync(path.join(root, sc.LAST_GOOD, 'settings.json'), 'utf8'), kept, 'a damaged store replaced its copy');
  put(root, 'settings.json', '{}');                     // a reader treated it as empty and saved
  sc.keepLastGood();
  assert.equal(fs.readFileSync(path.join(root, sc.LAST_GOOD, 'settings.json'), 'utf8'), kept, 'the saved-over empty value replaced the good copy');
});

test('kosmos#8863: no last good copy of a secret, an append-only record or a large store; profiles and queues get one', () => {
  const { root, sc } = fresh();
  put(root, 'remote.json', '{"token":"x"}');
  put(root, 'service-keys.json', '{"k":"x"}');
  put(root, 'messages.jsonl', '{"a":1}\n');
  put(root, 'profiles/alice.json', '{"name":"alice"}');
  put(root, 'limitqueue/alice.json', '{"kept":[]}');
  put(root, 'big.json', '[' + '0,'.repeat(4.5 * 1024 * 1024) + '0]');   // over 8 MB
  sc.atStart({ base: root }, quiet);
  const lg = (r) => fs.existsSync(path.join(root, sc.LAST_GOOD, r));
  assert.equal(lg('remote.json'), false, 'a secret got a copy');
  assert.equal(lg('service-keys.json'), false, 'a secret got a copy');
  assert.equal(lg('messages.jsonl'), false, 'an append-only record got a copy');
  assert.equal(lg('big.json'), false, 'a store over 8 MB got a copy');
  assert.equal(lg(path.join('profiles', 'alice.json')), true);
  assert.equal(lg(path.join('limitqueue', 'alice.json')), true);
  // The copies are never themselves checked or copied again.
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD, sc.LAST_GOOD)), false);
});

test('kosmos#8863: a private store\'s copy is private too', { skip: NO_POSIX_MODES }, () => {
  const { root, sc } = fresh();
  put(root, 'assigner-asked.json', '{"a":1}');
  fs.chmodSync(path.join(root, 'assigner-asked.json'), 0o600);
  put(root, 'projects.json', '{"projects":[]}');
  fs.chmodSync(path.join(root, 'projects.json'), 0o644);
  sc.atStart({ base: root }, quiet);
  assert.equal(fs.statSync(path.join(root, sc.LAST_GOOD, 'assigner-asked.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(root, sc.LAST_GOOD, 'projects.json')).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(root, sc.LAST_GOOD)).mode & 0o777, 0o700);
});
