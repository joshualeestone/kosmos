'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8735: `kosmos claim --how` prints engine/claimguide.js guideText on both CLIs, as `kosmos task --how` does
 * (engine/taskguide.test.js, which this mirrors). The working rules keep the claim rule and point at it for the cases
 * that come up now and then.
 *
 *   node --test engine/claimguide.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { skipOnWin32 } = require('../test-support/skip-on-win32');
const guide = require('./claimguide');

test('kosmos#8735: install/kosmos prints the claim guide with claim --how, and names it in the usage', { skip: skipOnWin32('install/kosmos is the Mac and Linux CLI, a bash script run by its shebang') }, () => {
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-how-'));
  const env = { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, KOSMOS_HOME: root, AGENT_WORKFORCE_DATA: path.join(tmp, 'data'), KOSMOS_PORT: '9' };
  const run = (args) => spawnSync(path.join(root, 'install', 'kosmos'), args, { env, encoding: 'utf8', timeout: 30000 });
  try {
    const how = run(['claim', '--how']);
    assert.equal(how.status, 0, how.stderr + how.stdout.slice(0, 300));
    assert.equal(how.stdout, guide.guideText() + '\n');
    assert.equal(run(['claim', '--how', 'more']).status, 2);
    const bare = run(['claim']);
    assert.equal(bare.status, 2);
    assert.match(bare.stderr + bare.stdout, /kosmos claim --how: what to do in the cases/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('kosmos#8735: the Windows CLI prints the same claim guide, the same refusal and the same usage', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const out = []; const err = [];
  assert.equal(await cli.main(['claim', '--how'], { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) }), 0, err.join(' '));
  assert.equal(out.join('\n'), guide.guideText());
  assert.equal(await cli.main(['claim', '--how', 'more'], { env: {}, out: () => {}, err: () => {} }), 2);
  const usage = [];
  assert.equal(await cli.main(['claim'], { env: {}, out: (x) => usage.push(x), err: (x) => usage.push(x) }), 2);
  assert.match(usage.join('\n'), /kosmos claim --how: what to do in the cases/);
});

test('kosmos#8735: the claim guide requires nothing, carries what moved, and the working rules keep the rule and the pointer', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'claimguide.js'), 'utf8'), /require\(/);
  const g = guide.guideText();
  for (const line of ['as "is claimed by", with how long ago. A claim lasts until its holder gives it',
    'agrees with the claim; it is not a claim of theirs. If a claim looks stale, ask',
    'not see it: there, still say in the room that you are taking it.', '**If someone else holds it,** read the room, and offer them help if you have']) {
    assert.ok(g.includes(line), 'the claim guide lost: ' + line);
    for (const p of require('./defaults').PLATFORMS) assert.ok(!require('./defaults').blockFor(p).includes(line), p + ': back in the working rules: ' + line);
  }
  for (const p of require('./defaults').PLATFORMS) {
    const flat = require('./defaults').blockFor(p).replace(/\s+/g, ' ');
    assert.match(flat, /Claim a request before you say you are taking it\./, p + ': the rule left the working rules');
    assert.match(flat, /post that you are taking it only if the claim is yours/, p + ': the only-if-yours rule left the working rules');
    assert.match(flat, /do not post that you are taking it\./, p + ': the someone-else rule left the working rules');
    assert.match(flat, /give it back with `kosmos claim <project> <postId> --release`; when it is done, keep it claimed\./, p + ': the release rule left the working rules');
    assert.match(flat, /A raised hand from the person agrees with a claim; it is not a claim of theirs\./, p + ': the raised-hand rule, needed at the moment of claiming, left the working rules');
    assert.match(flat, /run `kosmos claim --how`/, p + ': the pointer to the guide is missing');
    assert.match(flat, /if Kosmos does not answer, run it again; if it still cannot be reached, say in the room that you are taking it/, p + ': the unreachable fallback, needed at the moment of claiming, left the working rules');
  }
  assert.doesNotMatch(g, /\u2014|&mdash;|&#8212;|&#x2014;/i, 'an em dash in the guide');
});
