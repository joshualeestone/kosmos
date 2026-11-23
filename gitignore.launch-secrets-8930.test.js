'use strict';
/* kosmos#8930: from a source checkout with no AGENT_WORKFORCE_DATA, the supervisor writes agent secrets to
   <checkout>/launch-secrets (bin/agent-supervisor.sh: ${AGENT_WORKFORCE_DATA:-$_app}/launch-secrets, $_app the folder
   above bin/). The root .gitignore must keep that folder out of a broad `git add`.
   node --test gitignore.launch-secrets-8930.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
const inGit = () => spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout.trim() === 'true';
const ignored = (p) => spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', '--no-index', p]).status === 0;

test('kosmos#8930: the supervisor still writes launch-secrets under $_app when no data root is set', () => {
  const sup = fs.readFileSync(path.join(ROOT, 'bin', 'agent-supervisor.sh'), 'utf8');
  assert.match(sup, /_launch_secret_dir="\$\{AGENT_WORKFORCE_DATA:-\$_app\}\/launch-secrets"/,
    'the supervisor no longer writes launch-secrets where this rule expects; re-check whether the rule is still needed');
});

test('kosmos#8930: the root .gitignore ignores /launch-secrets/', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('/launch-secrets/'), 'the root .gitignore has no /launch-secrets/ rule');
});

test('kosmos#8930: git ignores a secret there, and only there (CONTROLS: a file named for it elsewhere is not ignored)', { skip: inGit() ? false : 'not inside a git work tree (an installed bundle)' }, () => {
  assert.equal(ignored('launch-secrets/agent-secrets.Ab12Cd'), true, 'a launch secret in the checkout root would be committed');
  assert.equal(ignored('notes/launch-secrets.md'), false, 'CONTROL: the rule ignores a note named after the folder');
  assert.equal(ignored('engine/launch-secrets/x'), false, 'CONTROL: the rule is not anchored to the checkout root');
});
