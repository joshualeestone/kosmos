'use strict';

/*
 * #1659: `wasDefault` decides whether the person is told their history stops
 * appearing. It must track WHERE THE DEFAULT HOME POINTS, not what a folder is
 * called.
 *
 * 🛑 WHY THIS FILE EXISTS. The clause it guards was added with no coverage at
 * all: `wasDefault` appeared in zero test files, so a basename check shipped and
 * nothing said so. `codexsession` reads transcripts out of `defaultHome()`
 * alone, and `AGENT_WORKFORCE_CODEX_HOME` / `CODEX_HOME` both move it
 * (`codexupdate.js:46`), with the supervisor putting `CODEX_HOME` in a codex
 * agent's environment. So the two disagree in a reachable configuration.
 *
 * The wrong version is wrong in BOTH directions, which is why arm 3 matters as
 * much as arm 1: under an override the real default reports false and the
 * person is NOT told about a loss that happened, while a leftover `.codex`
 * reports true and they are told about one that did not.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-wasdefault-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const accounts = require('./openaiaccounts.js');

function seed(name) {
  const dir = nodePath.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ OPENAI_API_KEY: 'sk-test-WASDEFAULT1' }));
  return dir;
}

test('#1659: the default account reports wasDefault, so the history sentence is shown', () => {
  const out = accounts.forgetAccount(seed('.codex'));
  assert.equal(out.ok, true, 'the fixture did not disconnect, so the flag below means nothing');
  assert.equal(out.wasDefault, true,
    'the default account did not report wasDefault, so the person is never told their '
    + 'transcripts stop appearing');
});

test('#1659 CONTROL: a labelled account reports FALSE, so the flag is not constant-true', () => {
  const out = accounts.forgetAccount(seed('.codex-labelled'));
  assert.equal(out.ok, true, 'the fixture did not disconnect');
  assert.equal(out.wasDefault, false,
    'a labelled account claimed to be the default, so the sentence would be shown to '
    + 'someone who lost no history at all');
});

test('#1659: an operator-NAMED codex home is the default, whatever the folder is called', () => {
  const named = nodePath.join(SANDBOX, '.codex-work');
  process.env.CODEX_HOME = named;
  try {
    seed('.codex-work');
    const row = accounts.list().find((r) => nodePath.resolve(r.dir) === nodePath.resolve(named));
    assert.ok(row, 'the named home did not appear in list(), so this arm tests nothing');
    assert.equal(row.isDefault, true,
      'the row the UI marks default is not the named home, so the premise of this arm is wrong');
    const out = accounts.forgetAccount(named);
    assert.equal(out.ok, true, 'the fixture did not disconnect');
    assert.equal(out.wasDefault, true,
      'the account the UI marks DEFAULT was disconnected reporting wasDefault:false, so the '
      + 'person is not told the history is gone at exactly the moment it is');
  } finally {
    delete process.env.CODEX_HOME;
  }
});

test('#1659: a leftover .codex is NOT the default once the home is named elsewhere', () => {
  const named = nodePath.join(SANDBOX, '.codex-elsewhere');
  process.env.CODEX_HOME = named;
  try {
    seed('.codex-elsewhere');
    const stale = seed('.codex-stale');
    fs.renameSync(stale, nodePath.join(SANDBOX, '.codex'));
    const out = accounts.forgetAccount(nodePath.join(SANDBOX, '.codex'));
    assert.equal(out.ok, true, 'the fixture did not disconnect');
    assert.equal(out.wasDefault, false,
      'a folder merely NAMED .codex claimed the history consequence, so the person is told '
      + 'transcripts stopped appearing when codex never read that folder');
  } finally {
    delete process.env.CODEX_HOME;
  }
});
