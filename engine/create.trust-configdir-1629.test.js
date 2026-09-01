'use strict';

/**
 * Creating an agent trusts the folder in the account the agent will RUN under
 * (#1629, the create half).
 *
 * 🛑 THE BUG THIS PINS. `createAgentInner` computed `configDir` from the chosen
 * account and put it in the plist, so the agent starts under that account - but
 * the Claude trust write was `trustFolder(workerDir(name))` with no second
 * argument, so the entry landed in the DEFAULT account's `.claude.json`. Claude
 * Code then asked, on a machine where the answer had been written to the wrong
 * file. Josh hit exactly this creating agents on a second Claude account, and it
 * blocked a demo.
 *
 * ⭐ The codex arm ninety lines earlier already passed the same variable
 * (`trustCodexFolder(workerDir(name), configDir)`), and that asymmetry inside one
 * function is what gave it away.
 *
 * ⚠️ THIS ASSERTS THE ARGUMENT, NOT THE FILE, and that is deliberate rather than
 * weaker: `engine/trust.flip-1629.test.js` already proves the EFFECT - that
 * `trustFolder` with a `configDir` writes into that config and without one writes
 * into ours. The only thing unproven was whether the create path passes it. So
 * this pins the call and that file pins the behaviour; together they are the
 * claim.
 */

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-createtrust-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));

const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('./create');
const trust = require('./trust');

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };

/* Capture what the create path hands the trust module. Restored in a
   synchronous finally, because create() reads its collaborators synchronously. */
function withTrustSpy(fn) {
  const real = trust.trustFolder;
  const seen = [];
  trust.trustFolder = (...args) => { seen.push(args); return { ok: true }; };
  try { fn(seen); } finally { trust.trustFolder = real; }
}

test.afterEach(() => { create.setRunner(null); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#1629 create half: the trust write is given a configDir, not left to default', () => {
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  withTrustSpy((seen) => {
    create.createAgent({ ...BINS, name: 'ct-default', role: 'pm' });
    assert.ok(seen.length >= 1, 'PRECONDITION: the create path reached the trust write at all');
    const [dir, opts] = seen[0];
    assert.match(String(dir), /ct-default$/, 'it trusts the agent’s own folder');
    /* 🛑 THE REGRESSION GUARD. Before the fix this was `undefined`: no second
       argument at all, so trust.js fell back to OUR config no matter which
       account the agent was about to run under. */
    assert.notEqual(opts, undefined, 'a second argument must be passed, or the account is ignored');
    assert.ok(Object.prototype.hasOwnProperty.call(opts, 'configDir'),
      'and it must carry configDir, which is the whole point');
  });
});

test('#1629 create half: an OpenAI agent never gets a CODEX_HOME as its CLAUDE trust config', () => {
  /* ⚠️ `configDir` holds a CODEX_HOME on the OpenAI path, and this Claude trust
     write is not otherwise provider-guarded. Passing it through unconditionally
     would write a Claude trust entry into a codex home - a new bug shipped by the
     fix for an old one. */
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  withTrustSpy((seen) => {
    create.createAgent({ ...BINS, name: 'ct-openai', role: 'pm', provider: 'openai' });
    if (!seen.length) return; // an openai refusal earlier is fine; nothing to assert
    const [, opts] = seen[0];
    assert.equal(opts && opts.configDir, null,
      'the CLAUDE trust write must not receive the codex home');
  });
});
