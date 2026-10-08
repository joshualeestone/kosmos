/**
 * kosmos#5536 (E0.7) step 3, pure part: engine/backuprestore.js restores a snapshot byte for byte, and refuses
 * every way a restore could be fooled. Each refusal has a working control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');
const br = require('./backuprestore');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* A sink that records everything: committed files, aborted paths, and every call in order. */
function memorySink({ failWriteOn } = {}) {
  const committed = new Map(), aborted = [], calls = [];
  return {
    committed, aborted, calls,
    begin(path) {
      const parts = [];
      calls.push(`begin ${path}`);
      return {
        async write(buf) { if (path === failWriteOn) throw new Error('disk full'); parts.push(Buffer.from(buf)); },
        async commit() { calls.push(`commit ${path}`); committed.set(path, Buffer.concat(parts)); },
        async abort() { calls.push(`abort ${path}`); aborted.push(path); },
      };
    },
  };
}

function backup(files) {
  const member = hpkeKeyPair(), other = hpkeKeyPair(), nk = crypto.randomBytes(32);
  const dev = crypto.generateKeyPairSync('ed25519'), dev2 = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e1', period: 'p1', snapshot: 's1' };
  const store = new Map();
  const entries = files.map(({ path, data }) => {
    const names = bf.chunkBuffer(data, { min: 512, avg: 2048, max: 8192 }).map((c) => { const { name, object } = bf.sealNamedChunk(member.pk, nk, c); store.set(name, object); return name; });
    return { path, size: data.length, sha256: sha(data), chunks: names };
  });
  const manifestObject = bf.sealManifest(member.pk, dev.privateKey, ctx, { files: entries, skipped: [{ path: '.env', why: 'environment file' }] });
  return { member, other, nk, dev, dev2, ctx, store, entries, manifestObject };
}
const rand = (n) => crypto.randomBytes(n);

/* One sealed chunk, and a manifest over hand-written entries, for the entry-level refusals. */
function handMade(entries) {
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  const data = Buffer.from('x'.repeat(100));
  const { name, object } = bf.sealNamedChunk(member.pk, nk, data);
  const entry = (path, over = {}) => ({ path, chunks: [name], sha256: sha(data), size: data.length, ...over });
  const m = bf.sealManifest(member.pk, dev.privateKey, ctx, { files: entries(entry, name) });
  const fetched = [];
  const run = (sink = memorySink()) => br.restoreSnapshot({ memberSk: member.sk, namingKey: nk, devicePubAtSnapshot: dev.publicKey, ctx, manifestObject: m,
    fetchChunk: (n) => { fetched.push(n); return n === name ? object : null; }, sink }).then((r) => ({ r, sink }));
  return { run, fetched, data };
}

test('#5536 a snapshot restores byte for byte through the sink, with what the backup skipped reported', async () => {
  const a = rand(30000), b = Buffer.from('notes\n');
  const k = backup([{ path: 'agents/a/memory.md', data: a }, { path: 'agents/a/notes.md', data: b }]);
  const sink = memorySink();
  const r = await br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: async (n) => k.store.get(n), sink });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.restored, ['agents/a/memory.md', 'agents/a/notes.md']);
  assert.ok(sink.committed.get('agents/a/memory.md').equals(a), 'an async fetch works and the bytes match');
  assert.ok(sink.committed.get('agents/a/notes.md').equals(b));
  assert.deepEqual(r.skippedAtBackup, [{ path: '.env', why: 'environment file' }]);
});

test('#5536 restore refuses: another device key, another context, another member key (control: the right ones open)', async () => {
  const k = backup([{ path: 'a.md', data: rand(5000) }]);
  const go = (o) => br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: (n) => k.store.get(n), sink: memorySink(), ...o });
  assert.ok(await go({}), 'CONTROL');
  assert.equal(await go({ devicePubAtSnapshot: k.dev2.publicKey }), null, 'a device key not enrolled at the snapshot time');
  assert.equal(await go({ ctx: { ...k.ctx, member: 'someone-else' } }), null, 'replayed into another member');
  assert.equal(await go({ memberSk: k.other.sk }), null, 'another member\'s key reads nothing');
});

test('#5536 per file, fail closed: a missing, foreign, swapped or unfetchable chunk fails that file only, aborted never committed', async () => {
  const k = backup([{ path: 'good.md', data: rand(3000) }, { path: 'bad.md', data: rand(3000) }]);
  const badNames = k.entries.find((e) => e.path === 'bad.md').chunks;
  const run = async (fetch) => {
    const sink = memorySink();
    const r = await br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: fetch, sink });
    assert.deepEqual([...sink.committed.keys()], ['good.md'], 'the good file still restores; the bad one is never committed');
    assert.deepEqual(sink.aborted, ['bad.md'], 'the bad file is aborted');
    return r;
  };
  assert.deepEqual((await run((n) => (badNames.includes(n) ? null : k.store.get(n)))).failed, [{ path: 'bad.md', why: 'a chunk is missing' }]);
  // A chunk sealed under another naming key carries another name, so it fails the name binding. A chunk forged
  // UNDER the real name is refused by openVerifiedChunk's content check, tested in engine/backupformat.test.js.
  const foreign = await run((n) => (badNames.includes(n) ? bf.sealNamedChunk(k.member.pk, crypto.randomBytes(32), Buffer.from('evil')).object : k.store.get(n)));
  assert.equal(foreign.failed[0].why, 'a chunk did not verify (forged, swapped or damaged)');
  const goodName = k.entries.find((e) => e.path === 'good.md').chunks[0];
  const swapped = await run((n) => (badNames.includes(n) ? k.store.get(goodName) : k.store.get(n)));
  assert.equal(swapped.failed[0].why, 'a chunk did not verify (forged, swapped or damaged)', 'a real chunk stored under another name');
  const throws = await run((n) => { if (badNames.includes(n)) throw new Error('network'); return k.store.get(n); });
  assert.equal(throws.failed[0].why, 'a chunk could not be fetched', 'a fetch that throws is told apart from a missing chunk');
  const rejects = await run(async (n) => { if (badNames.includes(n)) throw new Error('network'); return k.store.get(n); });
  assert.equal(rejects.failed[0].why, 'a chunk could not be fetched', 'an async fetch that rejects fails that file only');
});

test('#5536 a sink that fails to write aborts the file and does not commit it', async () => {
  const k = backup([{ path: 'a.md', data: rand(2000) }, { path: 'b.md', data: rand(2000) }]);
  const sink = memorySink({ failWriteOn: 'b.md' });
  const r = await br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: (n) => k.store.get(n), sink });
  assert.deepEqual(r.failed, [{ path: 'b.md', why: 'the file could not be written' }]);
  assert.deepEqual([...sink.committed.keys()], ['a.md'], 'CONTROL: the other file commits');
  assert.deepEqual(sink.aborted, ['b.md']);
});

test('#5536 unsafe paths are refused before anything is fetched (control: a plain path restores)', async () => {
  const bad = ['../escape.md', '..\\escape.md', 'a/../../b', '/etc/x', '\\\\server\\share', 'C:/x', 'a/C:/x', 'file.txt:ads', 'a//b', '.', 'a/./b',
    'nul\0.md', 'tab\there', 'CON', 'nul.txt', 'a/com1.log', 'trailing.', 'trailing ', ' ..', ''];
  const { run, fetched } = handMade((entry) => [...bad.map((p) => entry(p)), entry('ok.md'), entry('.hidden/fine.md')]);
  const { r, sink } = await run();
  assert.deepEqual(r.restored, ['ok.md', '.hidden/fine.md'], 'CONTROL: plain relative paths restore');
  assert.deepEqual(r.failed.map((f) => f.path), bad);
  assert.ok(r.failed.every((f) => f.why === 'malformed entry or unsafe path'));
  assert.deepEqual(sink.calls.filter((c) => c.startsWith('begin')), ['begin ok.md', 'begin .hidden/fine.md'], 'no sink is opened for a refused path');
  assert.equal(fetched.length, 2, 'nothing is fetched for a refused path');
});

test('#5536 entries that land on the same file or folder are all refused (control: distinct paths restore)', async () => {
  const nfc = 'caf\u00e9.md', nfd = 'cafe\u0301.md';
  const { run } = handMade((entry) => [entry('dup.md'), entry('dup.md'), entry('Readme.md'), entry('README.md'), entry(nfc), entry(nfd),
    entry('x'), entry('X/y.md'), entry('a\\b.md'), entry('a/b.md'), entry('keep/one.md'), entry('keep/two.md')]);
  const { r } = await run();
  assert.deepEqual(r.restored, ['keep/one.md', 'keep/two.md'], 'CONTROL');
  assert.deepEqual(r.failed.map((f) => f.path).sort(), ['dup.md', 'dup.md', 'Readme.md', 'README.md', nfc, nfd, 'x', 'X/y.md', 'a\\b.md', 'a/b.md'].sort());
  assert.ok(r.failed.every((f) => f.why === 'another entry lands on the same file or folder'));
});

test('#5536 a malformed chunk name is never handed to fetchChunk', async () => {
  const { run, fetched } = handMade((entry, name) => [entry('probe.md', { chunks: ['../../../etc/passwd'] }), entry('upper.md', { chunks: [name.toUpperCase()] }), entry('ok.md')]);
  const { r } = await run();
  assert.deepEqual(r.restored, ['ok.md'], 'CONTROL');
  assert.deepEqual(r.failed, [{ path: 'probe.md', why: 'a chunk name is malformed' }, { path: 'upper.md', why: 'a chunk name is malformed' }]);
  assert.ok(fetched.every((n) => /^[0-9a-f]{64}$/.test(n)), 'only well-formed names reach the fetch');
});

test('#5536 a recorded size or hash that does not match the content is refused, and a repeated chunk cannot inflate a file', async () => {
  const { run, data, fetched } = handMade((entry, name) => [entry('wrong-hash.md', { sha256: '0'.repeat(64) }), entry('too-big.md', { size: 10 ** 12 }),
    entry('too-small.md', { size: 1 }), entry('negative.md', { size: -1 }), entry('repeated.md', { chunks: Array(1000).fill(name) }), entry('ok.md')]);
  const { r, sink } = await run();
  assert.deepEqual(r.restored, ['ok.md'], 'CONTROL');
  const why = Object.fromEntries(r.failed.map((f) => [f.path, f.why]));
  assert.equal(why['wrong-hash.md'], 'the file does not match the hash recorded at upload');
  assert.equal(why['too-big.md'], 'the file does not match the size recorded at upload');
  assert.equal(why['too-small.md'], 'the file does not match the size recorded at upload');
  assert.equal(why['negative.md'], 'malformed entry or unsafe path');
  assert.equal(why['repeated.md'], 'the file does not match the size recorded at upload', 'stops at the recorded size, not after 1000 chunks');
  assert.equal(sink.calls.filter((c) => c === 'abort repeated.md').length, 1);
  assert.equal(fetched.length, 6, 'one fetch each for four files, none for the negative size, two for the repeated chunk');
  assert.ok(sink.committed.get('ok.md').equals(data));
});

test('#5536 shrinkWarning flags a sudden shrink and stays quiet otherwise', () => {
  const m = (n, size) => ({ files: Array.from({ length: n }, () => ({ size })) });
  assert.match(br.shrinkWarning(m(100, 10), m(10, 10)), /files fell from 100 to 10/);
  assert.match(br.shrinkWarning(m(10, 1000), m(10, 10)), /size fell/);
  assert.equal(br.shrinkWarning(m(100, 10), m(95, 10)), null, 'CONTROL: a small change is not a warning');
  assert.equal(br.shrinkWarning(m(0, 0), m(5, 5)), null, 'growth from nothing is not a warning');
  assert.match(br.shrinkWarning(m(10, 1000), { files: [...m(9, 1).files, { size: -(10 ** 15) }] }) || '', /size fell from 10000 to 9 bytes/, 'a negative size is not counted');
});
