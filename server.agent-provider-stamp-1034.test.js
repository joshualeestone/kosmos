'use strict';
/**
 * THE AGENT VIEW SAYS WHICH PROVIDER IT ASKED FOR, RATHER THAN BELIEVING THE ROW.
 *
 * 🛑 THE FAILURE THIS GUARDS IS THE WORST SHAPE THIS CARD HAS. The route pairs
 * `accounts.listLive()` with `openaiAccounts.listLive()`. If a row arrives whose
 * `provider` key is absent or drifted, nothing throws and nothing reads as
 * `cannot tell`. The provider renders `signedIn: "none"`, `howMany: 0`, and the
 * sentence "this computer has no working sign-in for it" - A CONFIDENT NEGATIVE
 * ABOUT A PROVIDER WE READ PERFECTLY WELL.
 *
 * That is precisely the collapse the three-state rule exists to refuse, and it
 * arrives through an UNSTAMPED FIELD rather than through a sentence, which is
 * why every existing test misses it: they assert the sentences.
 *
 * ⚠️ IT WAS AN ASYMMETRY, NOT AN OVERSIGHT IN BOTH ARMS. The Claude rows were
 * always stamped at the route; the OpenAI rows were spread verbatim and relied
 * on `engine/openaiaccounts.js` setting `provider` for them. One arm was guarded
 * by construction and the other by a coupling nobody held. This drives the arm
 * that was not.
 *
 *   node --test server.agent-provider-stamp-1034.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-provstamp-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const openaiAccounts = require('./engine/openaiaccounts');
const subscription = require('./engine/subscription');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const ask = () => fetch(base + '/api/agent/connections').then((r) => r.json());
const gpt = (body) => (body.providers || []).find((p) => p.id === 'openai');

/**
 * The shape `openaiaccounts.rowFor()` really produces, plus the `connection`
 * that `listLive()` attaches (`connection: await module.exports.checkLive(row.dir)`
 * in openaiaccounts.js). Copied from the field set
 * in the source rather than invented.
 *
 * ⚠️ THE FIRST VERSION OF THIS FIXTURE WAS HAND-ROLLED AND MEASURED THE WRONG
 * BRANCH. It carried flat `connected: true, working: true` fields that exist
 * nowhere in this codebase. `stateOf` reads `row.connection.state`, so every arm
 * including the control returned `unknown` - an accurate answer to a question
 * nobody asked. A fixture that encodes a belief tests the belief.
 */
const WORKING = {
  providerName: 'OpenAI',
  dir: '/tmp/fixture-codex',
  label: 'work',
  isDefault: true,
  email: 'someone@example.com',
  authMode: 'key',
  keyTail: 'abcd',
  connection: { state: subscription.STATE.CONNECTED, because: 'this computer has a working sign-in for it' },
};

function stubbedOpenai(row) {
  const real = openaiAccounts.listLive;
  openaiAccounts.listLive = async () => [row];
  return { restore() { openaiAccounts.listLive = real; } };
}

test('an OpenAI row with NO provider key is still read as OpenAI, and reads as connected', async () => {
  const s = stubbedOpenai({ ...WORKING });
  try {
    const p = gpt(await ask());
    assert.ok(p, 'the agent view listed no OpenAI provider at all');
    assert.notEqual(p.signedIn, 'none',
      'an UNSTAMPED but working OpenAI row rendered as a confident "not connected": the route is believing the row instead of stamping what it asked for');
    assert.equal(p.signedIn, 'connected', `expected a working row to read as connected, got ${p.signedIn}`);
    assert.ok((p.howMany || 0) >= 1, `the working row was not counted: howMany=${p.howMany}`);
  } finally { s.restore(); }
});

test('control: a row carrying the correct provider key reads identically', async () => {
  /**
   * If BOTH arms said `connected` for a reason unrelated to the stamp, the
   * assertion above would pass without testing anything. These two arms differ
   * in exactly one field.
   */
  const s = stubbedOpenai({ ...WORKING, provider: 'openai' });
  try {
    const p = gpt(await ask());
    assert.equal(p.signedIn, 'connected',
      'the STAMPED row did not read as connected, so this file is measuring the wrong thing entirely');
  } finally { s.restore(); }
});

test('control: a row that mislabels itself is still claimed by the provider the route asked', async () => {
  const s = stubbedOpenai({ ...WORKING, provider: 'anthropic' });
  try {
    const p = gpt(await ask());
    assert.equal(p.signedIn, 'connected',
      'a row that mislabelled itself was not reclaimed by the provider the route actually asked for');
  } finally { s.restore(); }
});

test('control: a genuinely absent sign-in still reads as none, so connected is not the default', async () => {
  /* Without this, every assertion above is consistent with the route reporting
     `connected` unconditionally. */
  const s = stubbedOpenai({ ...WORKING, connection: { state: subscription.STATE.NONE, because: 'nope' } });
  try {
    const p = gpt(await ask());
    assert.equal(p.signedIn, 'none', `an unconnected row read as ${p.signedIn}, so the connected assertions above prove nothing`);
  } finally { s.restore(); }
});
