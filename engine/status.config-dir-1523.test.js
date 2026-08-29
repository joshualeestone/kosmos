'use strict';
/**
 * A RELOCATED CLAUDE CONFIG DIR IS STILL A CONFIG DIR (#1523).
 *
 * `CLAUDE_CONFIG_DIR` is a real Claude Code feature, 37 occurrences in the installed
 * 2.1.251 binary. Before this change `configRoots()` mentioned it only in a comment and
 * built its roots solely by scanning `$HOME` for `.claude*`, so a person who pointed it
 * anywhere else got ZERO agents discovered and nothing saying why.
 *
 * ⭐ THE CODEX ARM ALREADY HANDLED THIS, and that is why the fix is small: measured
 * before the change, `CODEX_HOME` pointing at `codex-elsewhere/` produced the relocated
 * agent, while `CLAUDE_CONFIG_DIR` pointing at `agents-config/` produced nothing.
 *
 * ⚠️ WHY THE FLEET MACHINE NEVER NOTICED, WHICH IS NOT THE SAME AS HARMLESS. Its extra
 * config dirs are named `~/.claude-account-b` and similar, so the `.claude*` glob caught
 * them BY ACCIDENT OF NAMING rather than by honouring the variable. That is exactly the
 * shape that keeps a gap invisible on the one machine everybody tests on.
 *
 * 📌 ARM A IS NOT VACUOUS AND IS NOT ASSUMED TO BE. The identical condition measured
 * against the pre-fix tree returns `false` for the relocated directory and `true` for
 * the conventional one, so this test genuinely fails without the change. The three
 * negative arms below are what make the positive one mean anything: a root list that
 * simply appended every value of the variable would pass arm A and fail B, C and D.
 *
 * Each arm runs in its own child, because the environment is read at module load, so
 * mutating `process.env` in-process would measure the wrong world.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const STATUS = path.join(__dirname, 'status.js');

/* Builds a home holding a conventional `.claude` plus a second config directory whose
   name does NOT match the `.claude*` glob, which is the whole point: a name the scan
   cannot find by accident. */
function home({ relocatedHasProjects = true } = {}) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgdir-1523-'));
  fs.mkdirSync(path.join(h, '.claude', 'projects'), { recursive: true });
  fs.mkdirSync(
    relocatedHasProjects ? path.join(h, 'agents-config', 'projects') : path.join(h, 'agents-config'),
    { recursive: true }
  );
  return h;
}

/* Returns configRoots() as seen by a child whose HOME and environment are the sandbox. */
function rootsIn(h, env) {
  const out = execFileSync(
    process.execPath,
    ['-e', `console.log(JSON.stringify(require(${JSON.stringify(STATUS)}).configRoots()));`],
    {
      encoding: 'utf8',
      env: { ...process.env, HOME: h, AGENT_WORKFORCE_DATA: path.join(h, 'data'),
             AGENT_WORKFORCE_CONFIG_ROOT: '', CLAUDE_CONFIG_DIR: '', ...env },
    }
  );
  return JSON.parse(out.trim().split('\n').pop());
}

test('#1523 arm A: a config dir named by CLAUDE_CONFIG_DIR is a root, and the conventional one still is', () => {
  const h = home();
  const roots = rootsIn(h, { CLAUDE_CONFIG_DIR: path.join(h, 'agents-config') });
  const has = (d) => roots.some((r) => path.resolve(r) === path.resolve(path.join(h, d)));

  /* CONTROL FIRST. If the conventional root stopped being found, a passing arm A would
     mean the fix had traded one blindness for another. */
  assert.equal(has('.claude'), true, 'the conventional ~/.claude root was lost');
  assert.equal(has('agents-config'), true, 'CLAUDE_CONFIG_DIR is still not honoured');
  fs.rmSync(h, { recursive: true, force: true });
});

test('#1523 arm B: with the variable unset, the relocated directory is NOT a root', () => {
  /* The negative arm that makes arm A evidence. Without it, a configRoots() that
     returned every directory in $HOME would pass arm A and be badly wrong. */
  const h = home();
  const roots = rootsIn(h, {});
  assert.equal(roots.some((r) => /agents-config/.test(r)), false,
    'a directory nobody named was picked up, so arm A proves nothing');
  assert.equal(roots.some((r) => r.endsWith('.claude')), true, 'the conventional root vanished');
  fs.rmSync(h, { recursive: true, force: true });
});

test('#1523 arm C: the variable pointing at a directory with no projects/ is ignored', () => {
  /* A relocated config dir that Claude has never run in has nothing to discover, and
     adding it would make `looked` count a directory that can only ever be empty. */
  const h = home({ relocatedHasProjects: false });
  const roots = rootsIn(h, { CLAUDE_CONFIG_DIR: path.join(h, 'agents-config') });
  assert.equal(roots.some((r) => /agents-config/.test(r)), false,
    'a config dir with no projects/ was added as a root');
  fs.rmSync(h, { recursive: true, force: true });
});

test('#1523 arm D: the variable pointing at the conventional dir yields one root, not two', () => {
  /* The scan would find `~/.claude` anyway, so without a dedup this is the common case
     that silently doubles the walk and can report an agent twice. */
  const h = home();
  const roots = rootsIn(h, { CLAUDE_CONFIG_DIR: path.join(h, '.claude') });
  const dotClaude = roots.filter((r) => path.resolve(r) === path.resolve(path.join(h, '.claude')));
  assert.equal(dotClaude.length, 1, `~/.claude appeared ${dotClaude.length} times: ${JSON.stringify(roots)}`);
  fs.rmSync(h, { recursive: true, force: true });
});
