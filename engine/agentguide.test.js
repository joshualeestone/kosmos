'use strict';
/**
 * kosmos#8735 slice 7: `kosmos agent --how` prints engine/agentguide.js guideText on both CLIs, as `kosmos claim --how`
 * does (engine/claimguide.test.js, which this mirrors). The #4474 new-role asserts moved here from engine/roles.test.js.
 *
 *   node --test engine/agentguide.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { skipOnWin32 } = require('../test-support/skip-on-win32');
const guide = require('./agentguide');

test('kosmos#8735: install/kosmos prints the agent guide with agent --how, and lists it', { skip: skipOnWin32('install/kosmos is the Mac and Linux CLI, a bash script run by its shebang') }, () => {
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-how-'));
  const env = { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, KOSMOS_HOME: root, AGENT_WORKFORCE_DATA: path.join(tmp, 'data'), KOSMOS_PORT: '9' };
  const run = (args) => spawnSync(path.join(root, 'install', 'kosmos'), args, { env, encoding: 'utf8', timeout: 30000 });
  try {
    const how = run(['agent', '--how']);
    assert.equal(how.status, 0, how.stderr + how.stdout.slice(0, 300));
    assert.equal(how.stdout, guide.guideText() + '\n');
    const more = run(['agent', '--how', 'more']);
    assert.equal(more.status, 2);
    assert.match(more.stderr + more.stdout, /Usage: kosmos agent --how/);
    const bare = run(['agent']);
    assert.equal(bare.status, 2);
    assert.match(bare.stderr + bare.stdout, /kosmos agent --how +how to write a role of your own/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('kosmos#8735: the Windows CLI prints the same agent guide, the same refusal and the same usage line', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const out = []; const err = [];
  assert.equal(await cli.main(['agent', '--how'], { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) }), 0, err.join(' '));
  assert.equal(out.join('\n'), guide.guideText());
  const refused = [];
  assert.equal(await cli.main(['agent', '--how', 'more'], { env: {}, out: () => {}, err: (x) => refused.push(x) }), 2);
  assert.match(refused.join('\n'), /Usage: kosmos agent --how/);
  const usage = [];
  assert.equal(await cli.main(['agent'], { env: {}, out: (x) => usage.push(x), err: (x) => usage.push(x) }), 2);
  assert.match(usage.join('\n'), /kosmos agent --how +how to write a role of your own/);
});

test('kosmos#8735: the agent guide requires nothing, opens with who it is for, and carries the #4474 steps', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'agentguide.js'), 'utf8'), /require\(/);
  const g = guide.guideText();
  const flat = g.replace(/\s+/g, ' ');
  // Mona Lisa's read: it says who it is for, and names the setup guide's refusal before anyone meets it.
  assert.match(g.split('\n')[0], /for an agent that makes agents/);
  assert.match(flat, /The setup guide makes agents only from the roles on the list \(`kosmos agent roles`\), and Kosmos refuses a role the setup guide wrote\./);
  // Moved from engine/roles.test.js (#4474).
  assert.match(flat, /If no role on that list fits, write one, in a file named for it: run `kosmos agent role-draft --to role-<short-name>\.md`/);
  assert.match(flat, /then tell the operator the role's name and what it does, and only after they say yes run/);
  assert.match(flat, /kosmos agent create "<name>" --new-role "<role name>" --from role-<short-name>\.md "<why>"/);
  assert.match(flat, /To make another agent with that role later, use the same file\./);
  assert.doesNotMatch(g, /\u2014|&mdash;|&#8212;|&#x2014;/i, 'an em dash in the guide');
});
