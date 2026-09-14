'use strict';

/*
 * #1659: `forgetAccount().wasDefault` must track WHERE THE DEFAULT HOME POINTS,
 * not what a folder is called. This file guards that the flag is computed
 * correctly (not a basename check): it appeared in zero test files when the
 * clause that used it shipped, and `AGENT_WORKFORCE_CODEX_HOME` / `CODEX_HOME`
 * both move the default home (`codexupdate.js:46`), with the supervisor putting
 * `CODEX_HOME` in a codex agent's environment, so a basename check and the real
 * default disagree in a reachable configuration. Arm 3 pins that.
 *
 * ⚠️ #2941: `wasDefault` NO LONGER gates the OpenAI removal history sentence. It
 * used to (the sentence was default-only, on the premise that `codexsession`
 * read `defaultHome()` alone); since #2906 the status reader reads EVERY
 * account's own home, so a labelled account's codex sessions are visible and the
 * removal disclosures now say "history stops appearing" unconditionally. The
 * flag is retained as a correct engine return (the Claude default-recovery path
 * still keys on its own account's wasDefault), which is what these arms guard --
 * the flag's correctness, not the OpenAI history-sentence gate that is now gone.
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

test('#1659: the default account reports wasDefault:true (it points at the default home)', () => {
  const out = accounts.forgetAccount(seed('.codex'));
  assert.equal(out.ok, true, 'the fixture did not disconnect, so the flag below means nothing');
  assert.equal(out.wasDefault, true,
    'the default account did not report wasDefault, so the flag does not track the default home');
});

test('#1659 CONTROL: a labelled account reports wasDefault:false, so the flag is not constant-true', () => {
  const out = accounts.forgetAccount(seed('.codex-labelled'));
  assert.equal(out.ok, true, 'the fixture did not disconnect');
  // The flag value is unchanged by #2941 (a labelled account is genuinely not the default). What
  // changed is only that the OpenAI history sentence no longer gates on it -- it is shown for
  // labelled accounts too now, because their codex sessions are read since #2906.
  assert.equal(out.wasDefault, false,
    'a labelled account reported wasDefault:true, so the flag is constant-true rather than tracking the default home');
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
