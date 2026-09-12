'use strict';
/*
 * #2684: allow deleting the PRIMARY/default (.codex) OpenAI connection.
 *
 * Unlike Claude, an OpenAI account's identity (auth.json) and config live INSIDE
 * its own dir, and disconnect already moves the whole default dir aside, so
 * deleting the default is the same rmSync act as deleting a secondary -- guarded
 * by the same running-agents / sign-in-in-flight / arbitrary-path defences.
 * FIXTURE-ONLY: AGENT_WORKFORCE_HOME points at a temp dir, so defaultDir()
 * resolves to <tmp>/.codex and nothing here touches the real ~/.codex.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const openai = require('./engine/openaiaccounts');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-delprimary-oai-2684-'));
  const dir = path.join(home, '.codex'); // this IS defaultDir() when only AGENT_WORKFORCE_HOME is set
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-primarytesttesttesttest' }));
  fs.writeFileSync(path.join(dir, 'config.toml'), 'model = "gpt-5"\n');
  return { home, dir };
}

function withHome(home, fn) {
  const prevHome = process.env.AGENT_WORKFORCE_HOME;
  const prevCodex = process.env.AGENT_WORKFORCE_CODEX_HOME;
  const prevCodex2 = process.env.CODEX_HOME;
  process.env.AGENT_WORKFORCE_HOME = home;
  // ensure defaultDir() resolves to <home>/.codex, not an inherited codex home
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  delete process.env.CODEX_HOME;
  try { return fn(); } finally {
    if (prevHome === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = prevHome;
    if (prevCodex === undefined) delete process.env.AGENT_WORKFORCE_CODEX_HOME; else process.env.AGENT_WORKFORCE_CODEX_HOME = prevCodex;
    if (prevCodex2 === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevCodex2;
  }
}

test('removeAccount deletes the DEFAULT .codex and reports wasDefault', () => {
  const { home, dir } = makeHome();
  const res = withHome(home, () => openai.removeAccount(dir, []));
  assert.strictEqual(res.ok, true, 'ok');
  assert.strictEqual(res.removed, true, 'removed');
  assert.strictEqual(res.wasDefault, true, 'wasDefault true for the default .codex');
  assert.ok(!fs.existsSync(dir), 'the default .codex dir is deleted');
});

test('CONTROL: a running agent on the default REFUSES and leaves the dir intact', () => {
  const { home, dir } = makeHome();
  const res = withHome(home, () => openai.removeAccount(dir, ['watson']));
  assert.strictEqual(res.ok, false, 'refused');
  assert.strictEqual(res.removed, false, 'not removed');
  assert.deepStrictEqual(res.usedBy, ['watson'], 'names the agent');
  assert.ok(fs.existsSync(dir), 'the .codex dir survives a refusal');
  assert.ok(fs.existsSync(path.join(dir, 'auth.json')), 'identity survives a refusal');
});

test('CONTROL: a name-shaped non-account default is still refused (arbitrary-path defence)', () => {
  // a .codex dir with NO auth.json is not an account; the identity guard refuses.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-delprimary-oai-2684-noid-'));
  const dir = path.join(home, '.codex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.toml'), 'model = "gpt-5"\n'); // config but no auth.json
  const res = withHome(home, () => openai.removeAccount(dir, []));
  assert.strictEqual(res.ok, false, 'refused: not an account (no identity)');
  assert.ok(fs.existsSync(dir), 'the dir survives');
});

test('CONTROL: a SECONDARY .codex-label still deletes (unchanged path)', () => {
  const { home } = makeHome();
  const sec = path.join(home, '.codex-work');
  fs.mkdirSync(sec, { recursive: true });
  fs.writeFileSync(path.join(sec, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-worktesttesttesttest' }));
  const res = withHome(home, () => openai.removeAccount(sec, []));
  assert.strictEqual(res.ok, true, 'ok');
  assert.strictEqual(res.removed, true, 'removed');
  assert.ok(!res.wasDefault, 'not the default');
  assert.ok(!fs.existsSync(sec), 'secondary dir deleted');
  assert.ok(fs.existsSync(path.join(home, '.codex')), 'the default is untouched by a secondary delete');
});
