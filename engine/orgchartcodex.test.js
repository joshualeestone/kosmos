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
fs.writeFileSync(path.join(acct, 'models_cache.json'), JSON.stringify({ client_version: '0.149.1', models: [
  { slug: 'm1', apply_patch_tool_type: 'freeform', tool_mode: 'code_mode_only', context_window: 1 },
  { slug: 'm2', apply_patch_tool_type: 'freeform', context_window: 2 },
] }));
const record = path.join(root, 'record.json');
const script = path.join(root, 'events.jsonl');
const fake = path.join(root, 'codex');
/* The fake: records argv, CODEX_HOME, the picture's bytes and the catalog file's contents, then prints the scripted
   events (or sleeps forever when the script says "hang"). */
fs.writeFileSync(fake, '#!' + process.execPath + '\n' + `
const fs = require('fs');
const a = process.argv.slice(2);
const at = (f) => a[a.indexOf(f) + 1];
const cat = (a.find((x) => x.startsWith('model_catalog_json=')) || '').slice('model_catalog_json='.length);
const catPath = JSON.parse(cat || '""');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: a, home: process.env.CODEX_HOME,
  image: fs.readFileSync(at('-i')).toString('base64'), imagePath: at('-i'),
  catalog: catPath ? JSON.parse(fs.readFileSync(catPath, 'utf8')) : null,
  schema: JSON.parse(fs.readFileSync(at('--output-schema'), 'utf8')) }));
const s = fs.readFileSync(${JSON.stringify(script)}, 'utf8');
if (s === 'hang') setInterval(() => {}, 1000); else process.stdout.write(s);
`);
fs.chmodSync(fake, 0o755);
const events = (...evs) => fs.writeFileSync(script, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
const answer = (obj) => events({ type: 'thread.started' }, { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: JSON.stringify(obj) } }, { type: 'turn.completed' });

const SUB = { dir: acct, authMode: 'chatgpt', isDefault: true, email: 'ceo@example.test' };
c.setBin(() => fake);
c.setAccounts(() => [SUB]);
keys.setAccounts(() => []);
test.after(() => { c.setBin(null); c.setAccounts(null); c.setSpawn(null); c.setTimeoutMs(null); keys.setAccounts(null); });

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
  assert.equal(rec.catalog.models[0].context_window, 1, 'the rest of the catalog is the account\'s own');
  assert.deepEqual(rec.schema, keys.STRICT_SCHEMA);
  assert.equal(fs.existsSync(path.dirname(rec.imagePath)), false, 'the picture\'s folder is removed after the read');
});

test('tripwire: any tool event refuses the answer', async () => {
  for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'something_new']) {
    events({ type: 'turn.started' }, { type: 'item.started', item: { id: 'i1', type } },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: JSON.stringify(PEOPLE) } });
    const got = await o.readWithModel('chart.png', PNG, { reader: o.currentReader() });
    assert.deepEqual(got.rows, [], type);
    assert.match(got.problems[0], /tried to use a tool/, type);
  }
});

test('no catalog in the account: refused in words, Codex never started', async () => {
  const bare = path.join(root, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  fs.rmSync(record, { force: true });
  const got = await c.read({ kind: 'codex', dir: bare }, 'p', 'image/png', PNG, null);
  assert.equal(got.ok, false);
  assert.match(got.because, /has not finished setting up/);
  assert.equal(fs.existsSync(record), false);
});

test('a hung Codex ends at the timeout; a stopped read ends at once', async () => {
  fs.writeFileSync(script, 'hang');
  c.setTimeoutMs(800);
  try {
    let got = await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null);
    assert.deepEqual(got, { ok: false, because: 'reading the file took too long' });
    c.setTimeoutMs(60000);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 300);
    const t0 = Date.now();
    got = await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, ctl.signal);
    assert.deepEqual(got, { ok: false, because: 'the read was stopped' });
    assert.ok(Date.now() - t0 < 5000);
  } finally { c.setTimeoutMs(null); }
});

test('an answer that is not JSON, and no answer at all, are refusals', async () => {
  events({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'Here is your chart!' } });
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /not the list asked for/);
  events({ type: 'turn.failed', error: { message: 'Not logged in' } });
  assert.match((await c.read({ kind: 'codex', dir: acct }, 'p', 'image/png', PNG, null)).because, /sign-in on this computer has ended/);
});

test('offeredTools finds tools nested in a developer message, by name or built-in type', () => {
  const body = { input: [{ role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [
    { type: 'function', name: 'update_plan' }, { type: 'function', name: 'request_user_input' }] }] },
  { role: 'user', content: [{ type: 'input_text', text: 'exec_command is only named here' }] }], tools: [{ type: 'web_search' }] };
  assert.deepEqual(c.offeredTools(body), ['update_plan', 'request_user_input', 'web_search']);
});
