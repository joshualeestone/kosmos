'use strict';
/**
 * #4632: the catalogue is downloaded when someone opens the role picker or the Team screen, kept
 * only when its signature verifies, and never replaced by an older one.
 *
 *   node --test engine/catalogue.download-4632.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-download-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// These tests hand refresh() their own fetcher; one asserts the default address, so the harness's
// dead-port pin (tools/run-tests.sh) is taken off here.
delete process.env.KOSMOS_CATALOGUE_BASE;
const catalogue = require('./catalogue');
const roles = require('./roles');
const { FIXTURE } = require('../test-support/catalogue-fixture');

const TEXT = fs.readFileSync(FIXTURE, 'utf8');
// fresh() deletes the stored catalogue's folder, so the data root must be this test's sandbox.
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);
const BUILT_IN = roles.BUILT_IN.length;

/** A fresh key pair the module trusts, a clean store, and a signer for payloads. */
function fresh() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  catalogue.useKeyForTest(pem);
  fs.rmSync(path.dirname(catalogue.cacheFile()), { recursive: true, force: true });
  roles.remerge();
  // Serials in these tests count up from the floor this version accepts; signed(0) is the floor itself.
  const signed = (n, text = TEXT) => {
    const serial = n === null ? 0 : catalogue.MIN_SERIAL + n;
    const body = text.replace(/"serial": \d+/, `"serial": ${serial}`);
    return { body, sig: crypto.sign(null, Buffer.from(body), privateKey).toString('base64') };
  };
  return { signed, privateKey, pem };
}

/** A fetch that serves one payload and counts what it was asked for. */
function server(payload, opts = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (opts.fail) throw new Error('network down');
    if (opts.status) return new Response('nope', { status: opts.status });
    const body = url.endsWith('.sig') ? payload.sig : payload.body;
    return new Response(body, { status: 200 });
  };
  return { fetcher, calls };
}

test('with nothing downloaded yet there is no catalogue: the built-in roles only, and no teams', () => {
  fresh();
  assert.deepEqual(catalogue.status(), { loaded: false, serial: null, roles: 0, teams: 0, error: null });
  assert.equal(roles.ROLES.length, BUILT_IN);
  assert.deepEqual(catalogue.teams(), []);
  assert.match(catalogue.memberProblem('marketing', 'lead'), /no prebuilt team/);
});

test('a download that verifies is stored and merged: the picker gains its roles, the Team screen its teams', async () => {
  const { signed } = fresh();
  const { fetcher, calls } = server(signed(10));
  const st = await catalogue.refresh({ fetcher });
  assert.equal(st.loaded, true, st.error);
  assert.equal(st.serial, catalogue.MIN_SERIAL + 10);
  assert.deepEqual(calls.map((u) => u.replace(/^.*\//, '')).sort(), ['catalogue.json', 'catalogue.json.sig']);
  assert.ok(calls.every((u) => u.startsWith('https://installkosmos.com/catalogue/')), calls.join(' '));
  assert.equal(roles.ROLES.length, BUILT_IN + st.roles);
  assert.ok(roles.byKey('cmo'), 'a catalogue role reached ROLES');
  assert.equal(catalogue.teams().length, st.teams);
  assert.ok(fs.existsSync(catalogue.cacheFile()));
  // Within the gap, a second open does not download again.
  await catalogue.refresh({ fetcher });
  assert.equal(calls.length, 2);
});

test('a changed byte, another key, or a catalogue this version cannot read is refused, and nothing is stored', async () => {
  const { signed } = fresh();
  const good = signed(10);
  const cases = {
    tampered: { body: good.body.replace('Chief of Staff', 'Chief 0f Staff'), sig: good.sig },
    otherKey: { body: good.body, sig: crypto.sign(null, Buffer.from(good.body), crypto.generateKeyPairSync('ed25519').privateKey).toString('base64') },
    newFormat: signed(10, TEXT.replace('"version": 2', '"version": 3')),
    zeroSerial: signed(null),
    belowFloor: signed(-1),
  };
  for (const [name, payload] of Object.entries(cases)) {
    const st = await catalogue.refresh({ fetcher: server(payload).fetcher, force: true });
    assert.equal(st.loaded, false, name);
    assert.match(st.error, /was refused/, name);
    assert.equal(fs.existsSync(catalogue.cacheFile()), false, `${name}: stored`);
  }
  assert.equal(roles.ROLES.length, BUILT_IN);
  // CONTROL: the untouched payload is accepted by the same path.
  assert.equal((await catalogue.refresh({ fetcher: server(good).fetcher, force: true })).loaded, true);
});

test('an older catalogue never replaces the one held; a newer one does', async () => {
  const { signed } = fresh();
  await catalogue.refresh({ fetcher: server(signed(20)).fetcher, force: true });
  const older = await catalogue.refresh({ fetcher: server(signed(19)).fetcher, force: true });
  assert.equal(older.serial, catalogue.MIN_SERIAL + 20);
  assert.match(older.error, /older than the one held/);
  const newer = await catalogue.refresh({ fetcher: server(signed(21)).fetcher, force: true });
  assert.equal(newer.serial, catalogue.MIN_SERIAL + 21);
  assert.equal(newer.error, null);
});

test('offline, a missing file or an oversized one keeps what is held and says why', async () => {
  const { signed } = fresh();
  await catalogue.refresh({ fetcher: server(signed(30)).fetcher, force: true });
  for (const opts of [{ fail: true }, { status: 404 }]) {
    const st = await catalogue.refresh({ fetcher: server(signed(31), opts).fetcher, force: true });
    assert.equal(st.serial, catalogue.MIN_SERIAL + 30);
    assert.ok(st.error, JSON.stringify(opts));
  }
  const huge = { body: 'x'.repeat(8 * 1024 * 1024 + 1), sig: 'AA==' };
  const st = await catalogue.refresh({ fetcher: server(huge).fetcher, force: true });
  assert.equal(st.serial, catalogue.MIN_SERIAL + 30);
  assert.match(st.error, /larger than/);
  assert.ok(roles.byKey('cmo'), 'the held catalogue was dropped');
});

test('a file and signature from different publishes (caches out of step) are asked for once more, past the caches', async () => {
  const { signed } = fresh();
  const now = signed(60);
  const stale = signed(59);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const fresh2 = url.includes('?fresh=');
    if (url.includes('.sig')) return new Response(fresh2 ? now.sig : stale.sig);
    return new Response(now.body);
  };
  const st = await catalogue.refresh({ fetcher, force: true });
  assert.equal(st.serial, catalogue.MIN_SERIAL + 60, st.error);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((u) => u.includes('?fresh=')).length, 2);
  // CONTROL: a signature that is still wrong after the second ask is refused.
  const bad = await catalogue.refresh({ fetcher: server({ body: signed(61).body, sig: stale.sig }).fetcher, force: true });
  assert.equal(bad.serial, catalogue.MIN_SERIAL + 60);
  assert.match(bad.error, /signature does not verify/);
});

test('two opens at once download once', async () => {
  const { signed } = fresh();
  const { fetcher, calls } = server(signed(40));
  const [a, b] = await Promise.all([catalogue.refresh({ fetcher, force: true }), catalogue.refresh({ fetcher, force: true })]);
  assert.equal(a.serial, catalogue.MIN_SERIAL + 40);
  assert.equal(b.serial, catalogue.MIN_SERIAL + 40);
  assert.equal(calls.length, 2);
});

test('a stored copy changed on disk is not used after a restart, and one left alone is', async () => {
  const { signed, pem } = fresh();
  await catalogue.refresh({ fetcher: server(signed(50)).fetcher, force: true });
  // What a restart does: forget the parsed copy and read the store again, with the same key.
  catalogue.useKeyForTest(pem);
  assert.equal(catalogue.status().serial, catalogue.MIN_SERIAL + 50, 'CONTROL: the untouched store is used after a restart');
  const file = catalogue.cacheFile();
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.text = stored.text.replace('Chief of Staff', 'Chief 0f Staff');
  fs.writeFileSync(file, JSON.stringify(stored));
  catalogue.useKeyForTest(pem);
  const st = catalogue.status();
  assert.equal(st.loaded, false);
  assert.match(st.error, /stored catalogue was not used: its signature does not verify/);
  roles.remerge();
  assert.equal(roles.ROLES.length, BUILT_IN);
});

test('the key this version trusts is an Ed25519 public key', () => {
  assert.equal(crypto.createPublicKey(catalogue.PUBLIC_KEY).asymmetricKeyType, 'ed25519');
});

test('the catalogue was checked against the roles this version has built in', () => {
  // The catalogue repo keeps a copy of Kosmos's built-in role keys (kosmos-builtin-roles.json) and
  // names them in every build as kosmosRoles. When roles.js gains, loses or renames one, this fails:
  // update that list in joshualeestone/kosmos-catalogue and refresh test-support/catalogue-published/.
  const listed = JSON.parse(TEXT).kosmosRoles;
  assert.deepEqual(listed, roles.BUILT_IN.map((r) => r.key).sort());
});

test('an oversized answer is refused by its Content-Length before it is read, and while it streams without one', async () => {
  const { signed } = fresh();
  const good = signed(70);
  // A body that fails if it is ever read: the refusal must come from the declared length instead.
  const declared = async (url) => {
    if (url.includes('.sig')) return new Response(good.sig);
    const body = new ReadableStream({ start(c) { c.error(new Error('the body was read')); } });
    return new Response(body, { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } });
  };
  const st = await catalogue.refresh({ fetcher: declared, force: true });
  assert.match(st.error, /larger than/, 'refused, but by reading the body rather than by its declared length');
  let pulled = 0;
  const endless = async (url) => {
    if (url.includes('.sig')) return new Response(good.sig);
    return new Response(new ReadableStream({ pull(c) { pulled += 1; c.enqueue(new Uint8Array(1024 * 1024)); } }));
  };
  const st2 = await catalogue.refresh({ fetcher: endless, force: true });
  assert.match(st2.error, /larger than/);
  assert.ok(pulled <= 10, `read ${pulled} MB of an answer with no end`);
  // CONTROL: the same payload at its real size is taken.
  assert.equal((await catalogue.refresh({ fetcher: server(good).fetcher, force: true })).serial, catalogue.MIN_SERIAL + 70);
});

test('a download of the serial already held does not rewrite the stored copy', async () => {
  const { signed } = fresh();
  const same = signed(80);
  // (This is the healthy case: the stored copy is there and verifies.)
  await catalogue.refresh({ fetcher: server(same).fetcher, force: true });
  const file = catalogue.cacheFile();
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(file, old, old);
  const before = fs.statSync(file).mtimeMs;
  await catalogue.refresh({ fetcher: server(same).fetcher, force: true });
  assert.equal(fs.statSync(file).mtimeMs, before, 'the same serial was written again');
  await catalogue.refresh({ fetcher: server(signed(81)).fetcher, force: true });
  assert.notEqual(fs.statSync(file).mtimeMs, before, 'CONTROL: a new serial is written');
});

test('the browser-check harness points every board it boots at a local catalogue, never installkosmos.com', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'tools', 'browser-checks.sh'), 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('export KOSMOS_CATALOGUE_BASE='));
  assert.ok(i >= 0, 'browser-checks.sh does not export KOSMOS_CATALOGUE_BASE at top level');
  assert.match(lines[i], /http:\/\/127\.0\.0\.1:/);
  // The first CALL (a line that runs boot_board with arguments), not the function's definition.
  const firstBoot = lines.findIndex((l) => /^\s*(if )?(AGENT_WORKFORCE_HOME="[^"]*" )?boot_board(_\w+)? "\$/.test(l));
  assert.ok(firstBoot >= 0, 'premise: found the harness\'s first board boot');
  assert.ok(firstBoot > i, `the first board boots on line ${firstBoot + 1}, before the export on line ${i + 1}`);
  const shots = fs.readFileSync(path.join(__dirname, '..', 'docs', 'browser-checks', 'mobile-shots.js'), 'utf8');
  assert.match(shots, /KOSMOS_CATALOGUE_BASE: process\.env\.KOSMOS_CATALOGUE_BASE \|\| 'http:\/\/127\.0\.0\.1:9\/'/, 'mobile-shots boots a board that can ask installkosmos.com');
});

test('a signed file that is not plain UTF-8 text is refused at download, not lost at the next restart', async () => {
  const { privateKey } = fresh();
  // An invalid byte inside a JSON string: it parses (as U+FFFD), verifies, and would not survive
  // being stored as text.
  const full = TEXT.replace(/"serial": \d+/, `"serial": ${catalogue.MIN_SERIAL + 90}`);
  const at = full.indexOf('Chief of Staff');
  const head = full.slice(0, at);
  const tail = full.slice(at + 'Chief of Staff'.length);
  const body = Buffer.concat([Buffer.from(head + 'Chief '), Buffer.from([0xff]), Buffer.from('f Staff' + tail)]);
  const bomSig = crypto.sign(null, body, privateKey).toString('base64');
  const fetcher = async (url) => new Response(url.includes('.sig') ? bomSig : body);
  const st = await catalogue.refresh({ fetcher, force: true });
  assert.equal(st.loaded, false);
  assert.match(st.error, /not plain UTF-8 text/);
  assert.equal(fs.existsSync(catalogue.cacheFile()), false);
});

test('the same serial is written again when the stored copy has gone, so a restart keeps it', async () => {
  const { signed, pem } = fresh();
  const same = signed(95);
  await catalogue.refresh({ fetcher: server(same).fetcher, force: true });
  fs.rmSync(catalogue.cacheFile());
  await catalogue.refresh({ fetcher: server(same).fetcher, force: true });
  assert.ok(fs.existsSync(catalogue.cacheFile()), 'the stored copy was not written back');
  catalogue.useKeyForTest(pem);   // what a restart does
  assert.equal(catalogue.status().serial, catalogue.MIN_SERIAL + 95);
});

test('remerge, however often it runs, keeps ROLES the same array and gives every role its rhythm once', async () => {
  const { signed } = fresh();
  const same = roles.ROLES;
  await catalogue.refresh({ fetcher: server(signed(100)).fetcher, force: true });
  const builtInText = roles.BUILT_IN.map((r) => r.instructions);
  for (let i = 0; i < 5; i += 1) roles.remerge();
  assert.equal(roles.ROLES, same, 'ROLES was replaced, not rebuilt in place');
  assert.deepEqual(roles.BUILT_IN.map((r) => r.instructions), builtInText, 'a built-in role changed on remerge');
  // The summary rhythm's own opening words, counted in every role that gets one.
  const marker = roles.byKey('pm').instructions.split('\n').find((l) => /summary/i.test(l) && l.startsWith('- '));
  assert.ok(marker, 'premise: the rhythm has a line to count');
  for (const r of roles.ROLES.filter((x) => !roles.NO_SUMMARY.has(x.key))) {
    assert.equal(r.instructions.split(marker).length - 1, 1, `${r.key} carries the rhythm ${r.instructions.split(marker).length - 1} times`);
  }
  assert.ok(roles.byKey('cmo'), 'CONTROL: the catalogue roles are in the merge being counted');
});

test('a catalogue role cannot set fields beyond its own, and a malformed team is refused', async () => {
  const { signed } = fresh();
  const c = JSON.parse(TEXT);
  c.roles[0].menu = false;
  c.roles[0].shared = 'x';
  const withExtras = signed(110, JSON.stringify(c, null, 2));
  await catalogue.refresh({ fetcher: server(withExtras).fetcher, force: true });
  const r = catalogue.rawRoles().find((x) => x.key === c.roles[0].key);
  assert.equal(r.menu, undefined, 'a catalogue role marked itself hidden');
  assert.equal(r.shared, undefined);
  for (const spoil of [(t) => { t.kind = 'other'; }, (t) => { delete t.rank; }, (t) => { t.members[0].focus = [{}]; }]) {
    const d = JSON.parse(TEXT);
    spoil(d.teams[0]);
    const st = await catalogue.refresh({ fetcher: server(signed(120, JSON.stringify(d, null, 2))).fetcher, force: true });
    assert.match(st.error || '', /incomplete/, spoil.toString());
  }
});

test('duplicate keys and a team without one lead and 4 or 5 reports are refused', async () => {
  const { signed } = fresh();
  const spoils = [
    [(d) => { d.roles[1].key = d.roles[0].key; }, /two roles share a key/],
    [(d) => { d.teams[1].key = d.teams[0].key; }, /two teams share a key/],
    [(d) => { d.teams[0].members[1].reportsTo = null; }, /not a lead and 4 or 5 reports/],
    [(d) => { d.teams[0].members = d.teams[0].members.slice(0, 4); }, /not a lead and 4 or 5 reports/],
  ];
  let n = 130;
  for (const [spoil, why] of spoils) {
    const d = JSON.parse(TEXT);
    spoil(d);
    const st = await catalogue.refresh({ fetcher: server(signed(n += 1, JSON.stringify(d, null, 2))).fetcher, force: true });
    assert.match(st.error || '', why, spoil.toString());
  }
  // CONTROL: the untouched catalogue passes the same checks.
  assert.equal((await catalogue.refresh({ fetcher: server(signed(n + 1)).fetcher, force: true })).loaded, true);
});

test('a signed catalogue carrying a managed-block marker or a template marker is refused', async () => {
  const { signed } = fresh();
  const marks = [require('./messages').START, '{{TEAM}}'];
  let n = 140;
  for (const mark of marks) {
    const d = JSON.parse(TEXT);
    d.roles[0].instructions.push(mark);
    const st = await catalogue.refresh({ fetcher: server(signed(n += 1, JSON.stringify(d, null, 2))).fetcher, force: true });
    assert.match(st.error || '', /comment or template marker/, mark);
  }
  // CONTROL: {{NAME}}, which every role opens with, passes.
  assert.equal((await catalogue.refresh({ fetcher: server(signed(n + 1)).fetcher, force: true })).loaded, true);
});

test('a test run that did not sandbox the data root never reads the stored catalogue', () => {
  const { spawnSync } = require('node:child_process');
  // A home of its own, with a stored copy planted where an unsandboxed run would look.
  const home = fs.mkdtempSync(path.join(SANDBOX, 'home-'));
  const root = path.join(home, 'Library', 'Application Support', 'Kosmos', 'catalogue');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'catalogue.json'), '{"sig":"x","text":"planted"}');
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(__dirname, 'catalogue.js'))}).status().error))`;
  const run = (testContext) => {
    const env = { ...process.env, HOME: home, AGENT_WORKFORCE_HOME: home };
    delete env.AGENT_WORKFORCE_DATA;
    if (testContext) env.NODE_TEST_CONTEXT = 'child-v8'; else delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  };
  assert.equal(run(true).stdout, 'null', 'a test run read the stored copy it was not sandboxed for');
  // CONTROL: outside a test run the same process reads (and refuses) the planted copy.
  assert.match(run(false).stdout, /stored catalogue was not used/);
});
