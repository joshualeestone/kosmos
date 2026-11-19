'use strict';
/**
 * kosmos#8735: `kosmos community --how` prints engine/communityguide.js guideText on both CLIs, as `kosmos connections --how`
 * prints the connections guide (engine/connections.test.js, kosmos#7875 item 2, which this mirrors). An agent's
 * instructions now point at this command instead of carrying the community routine, so the command is the routine.
 *
 *   node --test engine/communityguide.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const guide = require('./communityguide');

test('kosmos#8735: both CLIs print the community guide with community --how', { skip: process.platform === 'win32' && 'install/kosmos is the Mac and Linux CLI (a bash script)' }, async () => {
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'community-how-'));
  const env = { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, KOSMOS_HOME: root, AGENT_WORKFORCE_DATA: path.join(tmp, 'data'), KOSMOS_PORT: '9' };
  const run = (args) => spawnSync(path.join(root, 'install', 'kosmos'), args, { env, encoding: 'utf8', timeout: 30000 });
  try {
    // The Mac script itself (no board needed for --how): its stdout is the guide; an extra word is usage (2).
    const how = run(['community', '--how']);
    assert.equal(how.status, 0, how.stderr + how.stdout.slice(0, 300));
    assert.equal(how.stdout, guide.guideText() + '\n');
    assert.equal(run(['community', '--how', 'more']).status, 2);
    // --help lists --how; --how --help is the usage, exit 0, and never the guide.
    assert.match(run(['community', '--help']).stdout, /kosmos community --how +\(how to take part/);
    const howHelp = run(['community', '--how', '--help']);
    assert.equal(howHelp.status, 0, howHelp.stderr);
    assert.match(howHelp.stdout, /kosmos community --how/);
    assert.ok(!howHelp.stdout.includes('1. Replies.'), 'community --how --help printed the guide');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('kosmos#8735: the Windows CLI prints the same guide, and the same refusals', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const out = []; const err = [];
  assert.equal(await cli.main(['community', '--how'], { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) }), 0, err.join(' '));
  assert.equal(out.join('\n'), guide.guideText());
  assert.equal(await cli.main(['community', '--how', 'more'], { env: {}, out: () => {}, err: () => {} }), 2);
  const help = [];
  assert.equal(await cli.main(['community', '--how', '--help'], { env: {}, out: (x) => help.push(x), err: (x) => help.push(x) }), 0);
  assert.match(help.join('\n'), /kosmos community --how/);
  assert.ok(!help.join('\n').includes('1. Replies.'), 'Windows community --how --help printed the guide');
  // Not a subcommand on either CLI: a flag, as connections --how is (the parity test reads `-`-led words as flags).
  assert.ok(!cli.SUBCOMMANDS.community.includes('--how'));
});

test('kosmos#8735: the guide comes from a module that requires nothing, and carries no machine state', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'communityguide.js'), 'utf8'), /require\(/);
  assert.equal(guide.guideText('darwin'), guide.guideText('linux'), 'only the quoting rule may follow the platform');
  assert.doesNotMatch(guide.guideText(), /\u2014|&mdash;|&#8212;|&#x2014;/i, 'an em dash in the guide');
  assert.doesNotMatch(guide.pointerLines().join('\n'), /\u2014|&mdash;|&#8212;|&#x2014;/i, 'an em dash in the block\'s pointer');
});
