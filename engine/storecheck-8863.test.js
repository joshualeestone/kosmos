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
  assert.match(msg, /Kosmos keeps adding new records to it, so there is nothing to put back\./);
  assert.match(lines.find((l) => l.includes('limitqueue')), /it holds messages kept for an agent until its usage resets/);
  assert.equal(found.find((d) => d.file === 'messages.jsonl').backup, null, 'an append-only record is offered an older copy');
  // What the page reads: the record is marked as one the board adds to, the JSON stores are not.
  const cur = Object.fromEntries(sc.current().map((d) => [d.file, d.log]));
  assert.equal(cur['messages.jsonl'], true, 'the page is not told messages.jsonl is an append-only record');
  assert.equal(cur[path.join('limitqueue', 'alice.json')], false, 'a JSON store is marked as an append-only record');
});

test('kosmos#8863: a good store gets a last good copy, and a later crash can put it back from there', () => {
  const { root, sc } = fresh();
  const good = '{"timezone":"America/Chicago"}';
  put(root, 'settings.json', good);
  const t = new Date('2026-11-20T10:00:00Z');
  fs.utimesSync(path.join(root, 'settings.json'), t, t);
  sc.atStart({ base: root }, quiet);
  sc.keepLastGood();
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
  sc.keepLastGood();
  assert.equal(fs.readFileSync(path.join(root, sc.LAST_GOOD, 'settings.json'), 'utf8'), kept, 'a damaged store replaced its copy');
  put(root, 'settings.json', '{}');                     // a reader treated it as empty and saved
  sc.keepLastGood();
  assert.equal(fs.readFileSync(path.join(root, sc.LAST_GOOD, 'settings.json'), 'utf8'), kept, 'the saved-over empty value replaced the good copy');
});

test('kosmos#8863: only allowed stores get a last good copy; secrets, the send queue, take-backs and big stores do not', () => {
  const { root, sc } = fresh();
  put(root, 'remote.json', '{"token":"x"}');
  put(root, 'service-keys.json', '{"k":"x"}');
  put(root, 'devkey-join-codes.json', '{"codes":["x"]}');   // not named anywhere: an unknown store is never copied
  put(root, 'removed.json', '{"removed":["bob"]}');          // an older copy would bring a removed agent back
  put(root, 'policy.json', '{"p":1}');
  put(root, 'federation.json', '{"joined":["x"]}');         // an older copy would bring back an unjoined computer
  put(root, 'community.json', '{"optedOut":true}');
  put(root, 'messages.jsonl', '{"a":1}\n');
  put(root, 'settings.json', '{"theme":"dark"}');
  put(root, 'profiles/alice.json', '{"name":"alice"}');
  put(root, 'chats/direct..alice.json', '{"messages":[]}');
  put(root, 'limitqueue/alice.json', '{"kept":[]}');         // a copy put back would type delivered messages again
  fs.mkdirSync(path.join(root, 'commitments'), { recursive: true });
  put(root, 'commitments/big.json', '[' + '0,'.repeat(4.5 * 1024 * 1024) + '0]');   // over 8 MB
  sc.atStart({ base: root }, quiet);
  sc.keepLastGood();
  const lg = (r) => fs.existsSync(path.join(root, sc.LAST_GOOD, r));
  for (const r of ['remote.json', 'service-keys.json', 'devkey-join-codes.json', 'removed.json', 'policy.json', 'messages.jsonl',
    'federation.json', 'community.json', path.join('limitqueue', 'alice.json'), path.join('commitments', 'big.json'),
    path.join('chats', 'direct..alice.json')]) {
    assert.equal(lg(r), false, r + ' got a last good copy');
  }
  for (const r of ['settings.json', path.join('profiles', 'alice.json')]) {
    assert.equal(lg(r), true, r + ' got no last good copy');
  }
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD, sc.LAST_GOOD)), false, 'the copies were copied');
});

test('kosmos#8863: an unchanged store is not copied again, and a removed store loses its copy', () => {
  const { root, sc } = fresh();
  put(root, 'settings.json', '{"theme":"dark"}');           // an ordinary write: its time has a fraction of a millisecond
  put(root, 'profiles/alice.json', '{"name":"alice"}');
  put(root, path.join('profiles', 'bob.json'), '{"name":"bob"}');
  sc.atStart({ base: root }, quiet);
  sc.keepLastGood();
  assert.equal(sc.keepLastGood(), 0, 'an unchanged store was copied again');
  put(root, 'settings.json', '{"theme":"light"}');
  assert.equal(sc.keepLastGood(), 1, 'a changed store was not copied');
  fs.unlinkSync(path.join(root, 'profiles', 'bob.json'));
  sc.keepLastGood();
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD, 'profiles', 'bob.json')), false, 'a removed store kept its copy');
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD, 'profiles', 'alice.json')), true, 'CONTROL: a store still there lost its copy');
  // A copy left from a store that is no longer allowed is removed too.
  fs.mkdirSync(path.join(root, sc.LAST_GOOD, 'limitqueue'), { recursive: true });
  put(root, path.join(sc.LAST_GOOD, 'limitqueue', 'alice.json'), '{"kept":[1]}');
  put(root, 'limitqueue/alice.json', '{"kept":[]}');
  sc.keepLastGood();
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD, 'limitqueue', 'alice.json')), false, 'a copy of a store that gets none was kept');
});

test('kosmos#8863: a private store\'s copy is private too', { skip: NO_POSIX_MODES }, () => {
  const { root, sc } = fresh();
  put(root, 'settings.json', '{"a":1}');
  fs.chmodSync(path.join(root, 'settings.json'), 0o600);
  put(root, 'projects.json', '{"projects":[]}');
  fs.chmodSync(path.join(root, 'projects.json'), 0o644);
  sc.atStart({ base: root }, quiet);
  sc.keepLastGood();
  assert.equal(fs.statSync(path.join(root, sc.LAST_GOOD, 'settings.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(root, sc.LAST_GOOD, 'projects.json')).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(root, sc.LAST_GOOD)).mode & 0o777, 0o700);
});

test('kosmos#8863: the start check itself writes no copy; copying is its own pass, which the stepped run does the same', async () => {
  const { root, sc } = fresh();
  put(root, 'settings.json', '{"theme":"dark"}');
  put(root, 'profiles/alice.json', '{"name":"alice"}');
  sc.atStart({ base: root }, quiet);
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD)), false, 'the start check wrote a copy, so it holds up the board coming back');
  // A copy whose store is gone, left from an earlier pass: the stepped pass (the one the timers run) removes it too.
  fs.mkdirSync(path.join(root, sc.LAST_GOOD, 'profiles'), { recursive: true });
  put(root, path.join(sc.LAST_GOOD, 'profiles', 'bob.json'), '{"name":"bob"}');
  const copied = await new Promise((resolve) => { assert.equal(sc.keepLastGoodInSteps(resolve), true); });
  assert.equal(copied, 2);
  assert.equal(fs.readFileSync(path.join(root, sc.LAST_GOOD, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  assert.equal(fs.readFileSync(path.join(root, sc.LAST_GOOD, 'profiles', 'alice.json'), 'utf8'), '{"name":"alice"}');
  assert.equal(fs.existsSync(path.join(root, sc.LAST_GOOD, 'profiles', 'bob.json')), false, 'the stepped pass kept a removed store\'s copy');
  assert.equal(sc.keepLastGood(), 0, 'the stepped pass left something for the next one to copy');
});

test('kosmos#8863: nothing "Delete your history" deletes is ever copied, so no copy survives a forget', () => {
  const { root, sc } = fresh();
  const { KINDS } = require('./forget');
  assert.ok(KINDS.length > 0, 'CONTROL: forget names no kinds, so this test checks nothing');
  for (const k of KINDS) {
    const rel = path.relative(root, k.dir());
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    put(root, path.join(rel, 'one.json'), '{"text":"private"}');
    for (const d of (k.derived || [])) {
      const drel = path.relative(root, d.dir());
      fs.mkdirSync(path.join(root, drel), { recursive: true });
      put(root, path.join(drel, 'one.json'), '{"text":"private"}');
    }
  }
  sc.keepLastGood();
  const copied = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else copied.push(path.relative(root, q)); } };
  if (fs.existsSync(path.join(root, sc.LAST_GOOD))) walk(path.join(root, sc.LAST_GOOD));
  assert.deepEqual(copied, [], 'a store "Delete your history" deletes has a last good copy: ' + JSON.stringify(copied));
});

test('kosmos#8863: a long log is checked by its tail: never "too large", and a blank stretch at its end is named', () => {
  const { root, sc } = fresh();
  const big = path.join(root, 'messages.jsonl');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, 65 * 1024 * 1024);                 // longer than a store is ever read whole
  fs.appendFileSync(big, Buffer.from('{"a":1}\n'.repeat(1200000)));   // a good tail longer than the part read
  assert.deepEqual(sc.atStart({ base: root }, quiet), [], 'a long log with a good tail was reported');
  fs.appendFileSync(big, Buffer.alloc(64));                // a crash's blank stretch at the end
  delete require.cache[require.resolve('./storecheck')];
  const sc2 = require('./storecheck');
  const found = sc2.atStart({ base: root }, quiet);
  assert.deepEqual(found.map((d) => [d.file, d.problem]), [['messages.jsonl', 'nulpart']]);
});

test('kosmos#8863: of a .bak and the last good copy, the newer is the one offered', () => {
  const { root, sc } = fresh();
  fs.mkdirSync(path.join(root, sc.LAST_GOOD), { recursive: true });
  put(root, path.join(sc.LAST_GOOD, 'settings.json'), '{"from":"last-good"}');
  put(root, 'settings.json.bak', '{"from":"bak"}');
  const older = new Date('2026-11-01T00:00:00Z');
  const newer = new Date('2026-11-10T00:00:00Z');
  fs.utimesSync(path.join(root, 'settings.json.bak'), older, older);
  fs.utimesSync(path.join(root, sc.LAST_GOOD, 'settings.json'), newer, newer);
  put(root, 'settings.json', nul(20));
  assert.equal(sc.atStart({ base: root }, quiet)[0].backup.file, path.join(sc.LAST_GOOD, 'settings.json'));
  fs.utimesSync(path.join(root, 'settings.json.bak'), newer, newer);
  fs.utimesSync(path.join(root, sc.LAST_GOOD, 'settings.json'), older, older);
  delete require.cache[require.resolve('./storecheck')];
  assert.equal(require('./storecheck').atStart({ base: root }, quiet)[0].backup.file, 'settings.json.bak');
});
