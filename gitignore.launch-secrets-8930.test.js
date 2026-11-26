'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8930: from a source checkout with no AGENT_WORKFORCE_DATA, the supervisor writes agent secrets to
   <checkout>/launch-secrets (bin/agent-supervisor.sh: ${AGENT_WORKFORCE_DATA:-$_app}/launch-secrets, $_app the folder
   above bin/), and its run logs to <checkout>/runs (record_run). The root .gitignore keeps both out of a broad `git add`.
   node --test gitignore.launch-secrets-8930.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
// Review 1: a missing git gives no stdout; read it as "not in a work tree" instead of throwing while the file loads.
const inGit = () => String(spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout || '').trim() === 'true';
const ignored = (p) => spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', '--no-index', p]).status === 0;

test('kosmos#8930: the supervisor still writes both folders under the folder above bin/ when no data root is set', () => {
  const sup = fs.readFileSync(path.join(ROOT, 'bin', 'agent-supervisor.sh'), 'utf8');
  assert.match(sup, /_launch_secret_dir="\$\{AGENT_WORKFORCE_DATA:-\$_app\}\/launch-secrets"/,
    'the supervisor no longer writes launch-secrets where this rule expects; re-check whether the rule is still needed');
  assert.match(sup, /else _dir="\$\(cd "\$\(dirname "\$0"\)\/\.\." 2>\/dev\/null && pwd\)\/runs"; fi/,
    'the supervisor no longer writes runs/ where this rule expects; re-check whether the rule is still needed');
});

test('kosmos#8930: the root .gitignore ignores /launch-secrets/ and /runs/', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('/launch-secrets/'), 'the root .gitignore has no /launch-secrets/ rule');
  assert.ok(lines.includes('/runs/'), 'the root .gitignore has no /runs/ rule');
});

test('kosmos#8930: git ignores those folders at the root, and only there', { skip: inGit() ? false : 'not inside a git work tree' }, () => {
  assert.equal(ignored('launch-secrets/agent-secrets.Ab12Cd'), true, 'a launch secret in the checkout root would be committed');
  assert.equal(ignored('runs/elon.log.tmp'), true, 'a run log left mid-trim in the checkout root would be committed');
  // CONTROLS. Each fails for one kind of wrong rule (review 1: a control that cannot fail was replaced).
  assert.equal(ignored('engine/launch-secrets/x'), false, 'CONTROL: the rule is not anchored to the checkout root');
  assert.equal(ignored('launch-secrets'), false, 'CONTROL: the rule lost its trailing slash, so a FILE of that name is ignored');
  assert.equal(ignored('engine/runs/x.log.tmp'), false, 'CONTROL: the runs rule is not anchored to the checkout root');
});
