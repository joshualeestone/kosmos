'use strict';
// First, for its side effect: every temp dir this file makes lands in its own, removed at exit (#4273).
require('../test-support/tmpscope');
/**
 * #5346: the org chart reader over a ChatGPT subscription, through Codex. A FAKE codex (a node script) records the
 * argv and environment it was started with and prints scripted JSON events, so these tests run the reader's real
 * spawn path and read exactly what Codex would be given, with no subscription. The capture test
 * (orgchartcodex.capture.test.js) runs the REAL Codex for the tools guarantee. Synthetic names only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// No Claude here, whatever this machine has: an empty home has no Claude account.
process.env.AGENT_WORKFORCE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5346-home-'));
delete process.env.CLAUDE_CONFIG_DIR;

const c = require('./orgchartcodex');
const keys = require('./orgchartkeys');
const o = require('./orgchartfile');

const PNG = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'orgchart-4559', 'chart.png'));
const PEOPLE = { people: [
  { person: 'Avery Quill', title: 'Chief Executive', reportsTo: null, sure: true, why: null },
  { person: 'Bo Linden', title: 'Head of Sales', reportsTo: 'Avery Quill', sure: true, why: null },
] };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5346-'));
/* An account folder with the catalog Codex fetched (two models carrying the two tool fields the read must clear). */
const acct = path.join(root, 'codex-acct');
fs.mkdirSync(acct);
const CACHE = { client_version: require('./runners').MANIFEST.openai.version, models: [
  { slug: 'm1', apply_patch_tool_type: 'freeform', tool_mode: 'code_mode_only', context_window: 1 },
  { slug: 'm2', apply_patch_tool_type: 'freeform', context_window: 2, experimental_supported_tools: ['read_file'], node_repl_disabled: false, supports_search_tool: true, multi_agent_version: 'v2', include_apps_usage_instructions: true },
] };
fs.writeFileSync(path.join(acct, 'models_cache.json'), JSON.stringify(CACHE));
const record = path.join(root, 'record.json');
const gpid = path.join(root, 'grandchild.pid');
const script = path.join(root, 'events.jsonl');
const fake = path.join(root, 'codex');
/* The fake: records argv, CODEX_HOME, the picture's bytes and the catalog file's contents, then prints the scripted
   events (or sleeps forever when the script says "hang"). Like the npm launcher, it first starts a CHILD of its own (a
   long sleep) and records its pid: a read must leave that grandchild dead however it ends (#5346 review). */
fs.writeFileSync(fake, '#!' + process.execPath + '\n' + `
const fs = require('fs');
const g = require('child_process').spawn('/bin/sleep', ['300'], { stdio: 'ignore' });
g.unref();   // the fake exits when its script ends, as the launcher does when native Codex finishes
fs.writeFileSync(${JSON.stringify(gpid)}, String(g.pid));
const a = process.argv.slice(2);
const at = (f) => a[a.indexOf(f) + 1];
const cat = (a.find((x) => x.startsWith('model_catalog_json=')) || '').slice('model_catalog_json='.length);
const catPath = JSON.parse(cat || '""');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: a, home: process.env.CODEX_HOME,
  homeVar: process.env.HOME,
  inherited: Object.keys(process.env).filter((k) => /^(OPENAI_|CODEX_|AGENT_WORKFORCE_|NODE_OPTIONS$|ANTHROPIC_)/i.test(k)),
  proxy: process.env.HTTPS_PROXY || null,
  image: fs.readFileSync(at('-i')).toString('base64'), imagePath: at('-i'),
  catalog: catPath ? JSON.parse(fs.readFileSync(catPath, 'utf8')) : null,
  schema: JSON.parse(fs.readFileSync(at('--output-schema'), 'utf8')) }));
const s = fs.readFileSync(${JSON.stringify(script)}, 'utf8');
if (s === 'hang') setInterval(() => {}, 1000);
else if (s.startsWith('stderr:')) { process.stderr.write('Reading additional input from stdin...\\n' + s.slice(7)); process.exitCode = 1; }
else process.stdout.write(s);
`);
fs.chmodSync(fake, 0o755);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/* The grandchild the fake started is gone (polled briefly: a SIGKILL is delivered asynchronously). */
async function grandchildGone() {
  const pid = Number(fs.readFileSync(gpid, 'utf8'));
  assert.ok(pid > 1, 'the fake recorded no grandchild');
  for (let i = 0; i < 40 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
  const left = alive(pid);
  if (left) process.kill(pid, 'SIGKILL');   // exact pid this test's fake started; never a pattern
  assert.equal(left, false, 'Codex\'s own child outlived the read');
}
const events = (...evs) => fs.writeFileSync(script, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
const answer = (obj) => events({ type: 'thread.started' }, { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: JSON.stringify(obj) } }, { type: 'turn.completed' });

const SUB = { dir: acct, authMode: 'chatgpt', isDefault: true, email: 'ceo@example.test' };
c.setBin(() => fake);
c.setAccounts(() => [SUB]);
const PINNED = require('./runners').MANIFEST.openai.version;
c.setVersion(() => PINNED);
c.setSystemConfigPaths(() => []);
keys.setAccounts(() => []);
test.after(() => { c.setBin(null); c.setVersion(null); c.setSystemConfigPaths(null); c.setAccounts(null); c.setSpawn(null); c.setTimeoutMs(null); keys.setAccounts(null); });

test('pick: a ChatGPT-subscription account reads, default first; key accounts and no Codex do not', () => {
  c.setAccounts(() => [{ dir: '/k', authMode: 'apikey', isDefault: true }, { dir: '/b', authMode: 'chatgpt', email: 'b@x.test' }, { ...SUB, isDefault: true }]);
  assert.deepEqual(c.pick(), { kind: 'codex', provider: 'openai', dir: acct, account: 'ceo@example.test' });
  c.setAccounts(() => [{ dir: '/k', authMode: 'apikey' }]);
  assert.equal(c.pick(), null);
  c.setAccounts(() => [SUB]);
  c.setBin(() => null);
  assert.equal(c.pick(), null, 'no Codex this board can run: no reader');
  c.setBin(() => fake);
});

test('order: no Claude, a ChatGPT subscription is chosen before a key account', () => {
  keys.setAccounts(() => [{ provider: 'openai', dir: '/k', account: 'work' }]);
  try {
    assert.equal(o.currentReader().kind, 'codex');
    c.setAccounts(() => []);
    assert.equal(o.currentReader().kind, 'key', 'CONTROL: with no subscription the key reads');
  } finally { c.setAccounts(() => [SUB]); keys.setAccounts(() => []); }
});

test('consent names OpenAI, ChatGPT and the account, on the plan, with what OpenAI does with it', () => {
  const r = o.currentReader();
  const got = o.consentFor(r);
  assert.equal(got.provider, 'OpenAI (ChatGPT, ceo@example.test)');
  assert.equal(got.uses, 'using your plan');
  assert.equal(got.keeps, c.KEEPS);
  assert.match(got.reader, /^codex:[0-9a-f]{12}$/);
  assert.notEqual(got.reader, o.readerId({ kind: 'codex', dir: acct + '-other' }), 'another account is another reader');
});

test('a PDF is refused before the consent, in words', () => {
  assert.match(o.readerProblem('chart.pdf', o.currentReader()), /^ChatGPT cannot read a PDF/);
  assert.equal(o.readerProblem('chart.png', o.currentReader()), null);
});

test('a read: every switch is on the command line, the picture goes in, the catalog is cleared, the answer is used', async () => {
  answer(PEOPLE);
  const got = await o.readWithModel('chart.png', PNG, { reader: o.currentReader() });
  assert.deepEqual(got.rows.map((r) => r.person), ['Avery Quill', 'Bo Linden']);
  const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
  for (const f of c.DISABLED_FEATURES) assert.ok(rec.argv.join(' ').includes('--disable ' + f), 'missing --disable ' + f);
  for (const k of c.CONFIG) assert.ok(rec.argv.includes(k), 'missing -c ' + k);
  for (const f of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--json']) assert.ok(rec.argv.includes(f), 'missing ' + f);
  assert.equal(rec.home, acct, 'run on the account the consent named');
  assert.equal(rec.image, PNG.toString('base64'), 'the picture itself is handed to Codex');
  assert.deepEqual(rec.catalog.models.map((m) => [m.slug, m.apply_patch_tool_type, m.tool_mode]), [['m1', null, null], ['m2', null, null]]);
  // Every tool-switching field the server could set is forced off, whatever the cache said.
  for (const m of rec.catalog.models) {
    for (const [k, v] of Object.entries(c.FORCED)) assert.deepEqual(m[k], v, m.slug + ' ' + k);
    assert.equal('multi_agent_version' in m, false, m.slug);
  }
  // Spelled out here, not read from c.FORCED, so dropping a field from FORCED reds this.
  const m2 = rec.catalog.models.find((m) => m.slug === 'm2');
  assert.deepEqual([m2.experimental_supported_tools, m2.node_repl_disabled, m2.supports_search_tool, m2.include_apps_usage_instructions], [[], true, false, false]);
  assert.notEqual(rec.homeVar, process.env.HOME, 'Codex runs with a home of its own, not the person\'s');
  assert.equal(path.dirname(rec.homeVar), path.dirname(rec.imagePath), 'inside the read\'s own folder, removed afterwards');
  assert.equal(rec.catalog.models[0].context_window, 1, 'the rest of the catalog is the account\'s own');
  assert.deepEqual(rec.schema, keys.STRICT_SCHEMA);
  assert.equal(fs.existsSync(path.dirname(rec.imagePath)), false, 'the picture\'s folder is removed after the read');
  await grandchildGone();
});

test('only allowlisted variables reach Codex: no key, token, base URL or NODE_OPTIONS; the proxy is kept', async () => {
  const NAMES = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'Openai_Api_Key', 'NODE_OPTIONS', 'ANTHROPIC_API_KEY', 'AGENT_WORKFORCE_TOKEN', 'HTTPS_PROXY'];
  const saved = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  for (const k of NAMES) process.env[k] = k === 'HTTPS_PROXY' ? 'http://proxy.example.test:3128' : k === 'NODE_OPTIONS' ? '--no-warnings' : 'TEST-5346';
  try {
    answer(PEOPLE);
    await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null);
    const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.deepEqual(rec.inherited, ['CODEX_HOME']);
    assert.equal(rec.home, acct);
    assert.equal(rec.proxy, 'http://proxy.example.test:3128', 'the person\'s proxy is kept, or a company network cannot reach OpenAI');
  } finally {
    for (const k of NAMES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  await grandchildGone();
});

test('reader id: another ChatGPT account signed in to the same folder is another reader', () => {
  assert.notEqual(o.readerId({ kind: 'codex', dir: acct, account: 'a@x.test' }), o.readerId({ kind: 'codex', dir: acct, account: 'b@x.test' }));
});

test('tripwire: any tool event refuses the answer', async () => {
  for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'something_new']) {
    events({ type: 'turn.started' }, { type: 'item.started', item: { id: 'i1', type } },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: JSON.stringify(PEOPLE) } });
    const got = await o.readWithModel('chart.png', PNG, { reader: o.currentReader() });
    assert.deepEqual(got.rows, [], type);
    assert.match(got.problems[0], /tried to use a tool/, type);
    await grandchildGone();
  }
});

test('no catalog in the account: refused in words, Codex never started', async () => {
  const bare = path.join(root, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  fs.rmSync(record, { force: true });
  const got = await c.read({ kind: 'codex', dir: bare }, 'p', 'image/png', PNG, null);
  assert.equal(got.ok, false);
  assert.equal(got.because, c.WHY_CATALOG);
  assert.equal(fs.existsSync(record), false);
});

test('a hung Codex ends at the timeout; a stopped read ends at once', async () => {
  fs.writeFileSync(script, 'hang');
  c.setTimeoutMs(800);
  try {
    let got = await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null);
    assert.deepEqual(got, { ok: false, because: 'reading the file took too long' });
    await grandchildGone();
    c.setTimeoutMs(60000);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 300);
    const t0 = Date.now();
    got = await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, ctl.signal);
    assert.deepEqual(got, { ok: false, because: 'the read was stopped' });
    assert.ok(Date.now() - t0 < 5000);
    await grandchildGone();
  } finally { c.setTimeoutMs(null); }
});

test('an answer that is not JSON, and no answer at all, are refusals', async () => {
  events({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'Here is your chart!' } }, { type: 'turn.completed' });
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /not the list asked for/);
  await grandchildGone();
  events({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: JSON.stringify(PEOPLE) } }, { type: 'turn.failed', error: { message: 'stream cut' } });
  assert.deepEqual(await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null), { ok: false, because: 'ChatGPT did not answer' }, 'a message before a failed turn is not used');
  await grandchildGone();
  events({ type: 'turn.failed', error: { message: 'Not logged in' } });
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /sign-in on this computer has ended/);
  await grandchildGone();
});

test('offeredTools finds tools nested in a developer message, by name or built-in type', () => {
  const body = { input: [{ role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [
    { type: 'function', name: 'update_plan' }, { type: 'function', name: 'request_user_input' }] }] },
  { role: 'user', content: [{ type: 'input_text', text: 'exec_command is only named here' }] }], tools: [{ type: 'web_search' }] };
  assert.deepEqual(c.offeredTools(body), ['update_plan', 'request_user_input', 'web_search']);
});

test('a Codex that is not the version Kosmos pins is not used, and the person is told why', () => {
  c.setVersion(() => '9.9.9');
  try {
    assert.equal(o.currentReader(), null);
    assert.match(o.whyNoReader(), /Codex on this computer \(version 9\.9\.9\): Kosmos has checked only version /);
    c.setVersion(() => null);
    assert.equal(o.currentReader(), null, 'a version that cannot be read is not used either');
  } finally { c.setVersion(() => PINNED); }
  assert.equal(o.currentReader().kind, 'codex', 'CONTROL: the pinned version reads');
});

test('an account with its own instructions file (AGENTS.md or AGENTS.override.md) is not used: Codex would send it', async () => {
  for (const f of c.INSTRUCTION_FILES) {
    fs.writeFileSync(path.join(acct, f), 'private instructions');
    try {
      assert.equal(o.currentReader(), null, f);
      assert.equal(o.whyNoReader(), c.WHY_INSTRUCTIONS, f);
    } finally { fs.rmSync(path.join(acct, f)); }
  }
  assert.equal(o.currentReader().kind, 'codex', 'CONTROL: without the file it reads');
});

test('a file made after the consent is caught at the read: Codex is never started', async () => {
  const r = o.currentReader();
  fs.writeFileSync(path.join(acct, 'AGENTS.md'), 'private instructions');
  fs.rmSync(record, { force: true });
  try {
    const got = await c.read(r, 'p', 'image/png', PNG, null);
    assert.deepEqual(got, { ok: false, because: c.WHY_INSTRUCTIONS });
    assert.equal(fs.existsSync(record), false);
  } finally { fs.rmSync(path.join(acct, 'AGENTS.md')); }
});

test('with no reader at all, a switched-off key provider\'s reason wins over the ChatGPT one', () => {
  keys.setAccounts(() => [{ provider: 'google', dir: '/g', account: 'g' }]);
  c.setVersion(() => '9.9.9');
  try {
    assert.equal(o.currentReader(), null);
    assert.equal(o.whyNoReader(), keys.OFF_WHY.google);
    keys.setAccounts(() => []);
    assert.equal(o.currentReader(), null);
    assert.match(o.whyNoReader(), /Kosmos has checked only version/, 'CONTROL: alone, the ChatGPT reason is shown');
  } finally { keys.setAccounts(() => []); c.setVersion(() => PINNED); }
});

test('a catalog with a field this Codex does not know, or written by another Codex version, is not used', async () => {
  const write = (cache) => fs.writeFileSync(path.join(acct, 'models_cache.json'), JSON.stringify(cache));
  try {
    write({ ...CACHE, models: [...CACHE.models, { slug: 'm3', new_tool_switch: true }] });
    assert.equal(c.deriveCatalog(acct), null);
    const got = await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null);
    assert.equal(got.because, c.WHY_CATALOG_UNKNOWN);
    assert.equal(o.currentReader(), null, 'and the reader is not offered: the reason shows before the consent box');
    assert.equal(o.whyNoReader(), c.WHY_CATALOG_UNKNOWN);
    write({ ...CACHE, client_version: '9.9.9' });
    assert.equal(c.deriveCatalog(acct), null);
    assert.equal(o.currentReader(), null);
    assert.equal(o.whyNoReader(), c.WHY_CATALOG_VERSION);
    write(CACHE);
    assert.ok(c.deriveCatalog(acct), 'CONTROL: the known catalog is used');
  } finally { write(CACHE); }
});

test('a computer with Codex settings an administrator manages is not used', async () => {
  const managed = path.join(root, 'etc-codex');
  fs.mkdirSync(managed, { recursive: true });
  c.setSystemConfigPaths(() => [managed]);
  try {
    assert.equal(o.currentReader(), null);
    assert.equal(o.whyNoReader(), c.WHY_MANAGED);
    fs.rmSync(record, { force: true });
    assert.deepEqual(await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null), { ok: false, because: c.WHY_MANAGED });
    assert.equal(fs.existsSync(record), false, 'Codex never started');
  } finally { c.setSystemConfigPaths(() => []); }
  assert.equal(o.currentReader().kind, 'codex', 'CONTROL: without it the read is offered');
});

test('a reconnect error followed by a completed turn is still an answer; one with no completed turn is not', async () => {
  events({ type: 'error', message: 'Reconnecting... 1/5' }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: JSON.stringify(PEOPLE) } }, { type: 'turn.completed' });
  assert.equal((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).ok, true);
  events({ type: 'error', message: 'Reconnecting... 5/5' }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: JSON.stringify(PEOPLE) } });
  assert.equal((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).ok, false);
  await grandchildGone();
});

test('a PDF with ChatGPT and a key account goes to the key; with no key, ChatGPT is the reader and says it cannot', () => {
  keys.setAccounts(() => [{ provider: 'openai', dir: '/k', account: 'work' }]);
  try {
    assert.equal(o.currentReader('chart.pdf').kind, 'key');
    assert.equal(o.currentReader('chart.png').kind, 'codex', 'CONTROL: a picture still goes to ChatGPT first');
    assert.equal(o.readerAndWhy('chart.pdf').reader.kind, 'key');
  } finally { keys.setAccounts(() => []); }
  const r = o.currentReader('chart.pdf');
  assert.equal(r.kind, 'codex');
  assert.match(o.readerProblem('chart.pdf', r), /^ChatGPT cannot read a PDF/);
});

test('Windows: ChatGPT is not used to read org charts, and the person is told why', async () => {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    assert.equal(o.currentReader(), null);
    assert.equal(o.whyNoReader(), c.WHY_WINDOWS);
    fs.rmSync(record, { force: true });
    assert.deepEqual(await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null), { ok: false, because: c.WHY_WINDOWS });
    assert.equal(fs.existsSync(record), false);
  } finally { Object.defineProperty(process, 'platform', real); }
  assert.equal(o.currentReader().kind, 'codex', 'CONTROL: on this platform it reads');
});

test('a Codex upgraded after the consent is caught at the read: Codex is never started', async () => {
  const r = o.currentReader();
  c.setVersion(() => '9.9.9');
  fs.rmSync(record, { force: true });
  try {
    const got = await c.read(r, 'p', 'image/png', PNG, null);
    assert.equal(got.ok, false);
    assert.match(got.because, /version 9\.9\.9/);
    assert.equal(fs.existsSync(record), false);
  } finally { c.setVersion(() => PINNED); }
});

test('a read stopped before it starts never starts Codex', async () => {
  const ctl = new AbortController();
  ctl.abort();
  fs.rmSync(record, { force: true });
  assert.deepEqual(await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, ctl.signal), { ok: false, because: 'the read was stopped' });
  assert.equal(fs.existsSync(record), false);
});

test('tripwire: an item with no readable type is refused too', async () => {
  events({ type: 'item.started', item: { id: 'x' } }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: JSON.stringify(PEOPLE) } }, { type: 'turn.completed' });
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /tried to use a tool/);
  await grandchildGone();
});

test('offeredTools fails closed: a tool of a kind never seen before, in any tools list, is counted', () => {
  const body = { tools: [{ type: 'tool_search' }, {}], input: [{ role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'web_fetch' }, { type: 'function', name: 'update_plan' }] }] }] };
  assert.deepEqual(c.offeredTools(body).sort(), ['tool_search', 'unknown', 'update_plan', 'web_fetch'].sort());
});

test('only PNG and JPEG are read: a GIF or WebP is refused before the consent, in words', () => {
  const r = o.currentReader('chart.png');
  assert.match(o.readerProblem('chart.gif', r), /^ChatGPT cannot read this kind of picture/);
  assert.match(o.readerProblem('chart.webp', r), /^ChatGPT cannot read this kind of picture/);
  assert.equal(o.readerProblem('chart.jpg', r), null);
});

test('a read removes a read folder left by a board that died over 15 minutes ago, and keeps a recent one', async () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), c.TMP_PREFIX));
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), c.TMP_PREFIX));
  const past = (Date.now() - 16 * 60 * 1000) / 1000;
  fs.utimesSync(old, past, past);
  try {
    answer(PEOPLE);
    await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null);
    assert.equal(fs.existsSync(old), false, 'the stale folder (a chart with real names) is gone');
    assert.equal(fs.existsSync(fresh), true, 'CONTROL: a recent one, maybe another read in progress, is kept');
  } finally { fs.rmSync(old, { recursive: true, force: true }); fs.rmSync(fresh, { recursive: true, force: true }); }
  await grandchildGone();
});

test('tripwire: an event of an unknown kind (a tool call outside an item, say) is refused', async () => {
  events({ type: 'turn.started' }, { type: 'function_call', name: 'exec_command' }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: JSON.stringify(PEOPLE) } }, { type: 'turn.completed' });
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /tried to use a tool/);
  await grandchildGone();
  answer(PEOPLE);
  assert.equal((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).ok, true, 'CONTROL: the events a real read sends pass');
  await grandchildGone();
});

/* Runs everywhere, Codex installed or not: the exact command line the capture test certified. Any change to a switch
   reds here, so the capture test (which needs the pinned Codex) is re-run before the change ships. */
test('the exact Codex command line is pinned', () => {
  const a = c.codexArgs({ dir: '/D', catalog: '/C', schema: '/S', image: '/I', prompt: 'P' });
  assert.deepEqual(a, ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'read-only', '-C', '/D',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'browser_use',
    '--disable', 'browser_use_external', '--disable', 'browser_use_full_cdp_access', '--disable', 'computer_use',
    '--disable', 'image_generation', '--disable', 'multi_agent', '--disable', 'multi_agent_v2', '--disable', 'hooks',
    '--disable', 'memories', '--disable', 'plugins', '--disable', 'remote_plugin', '--disable', 'view_image',
    '--disable', 'in_app_browser', '--disable', 'code_mode_host', '--disable', 'tool_suggest', '--disable', 'skill_search',
    '--disable', 'goals', '--disable', 'shell_snapshot', '--disable', 'skill_mcp_dependency_install',
    '--disable', 'workspace_dependencies', '--disable', 'enable_request_compression', '--disable', 'recommended_plugins',
    '-c', 'web_search="disabled"', '-c', 'tools.view_image=false', '-c', 'agents.enabled=false', '-c', 'history.persistence="none"',
    '-c', 'skills.bundled.enabled=false', '-c', 'skills.include_instructions=false', '-c', 'include_permissions_instructions=false',
    '-c', 'include_environment_context=false', '-c', 'include_apps_instructions=false',
    '-c', 'include_collaboration_mode_instructions=false', '-c', 'project_doc_max_bytes=0',
    '-c', 'model_catalog_json="/C"', '--output-schema', '/S', '-i', '/I', '--', 'P']);
});

test('Codex exiting before any turn with its own reason: a missing sign-in is named as one', async () => {
  fs.writeFileSync(script, 'stderr:Error: no Codex credentials were found. Run codex login to sign in.\n');
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /sign-in on this computer has ended/);
  await grandchildGone();
  fs.writeFileSync(script, 'stderr:Error: something else went wrong\n');
  assert.equal((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, 'ChatGPT did not answer', 'CONTROL: any other reason is not called a sign-in');
  await grandchildGone();
});

test('a model catalog far past a real one is refused unread, so its size cannot stall the board', () => {
  const big = path.join(root, 'big-acct');
  fs.mkdirSync(big, { recursive: true });
  fs.writeFileSync(path.join(big, 'models_cache.json'), JSON.stringify({ ...CACHE, pad: 'x'.repeat(c.MAX_CATALOG_BYTES) }));
  assert.equal(c.deriveCatalog(big), null);
  fs.writeFileSync(path.join(big, 'models_cache.json'), JSON.stringify(CACHE));
  assert.ok(c.deriveCatalog(big), 'CONTROL: the same catalog at its real size is used');
});
