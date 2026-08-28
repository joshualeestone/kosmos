'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dismissUpdateNotice, defaultHome } = require('./codexupdate');

/**
 * #1315, the durable half. #1332 dismissed codex's update notice at CREATION,
 * which unblocked new agents and left the class open: when OpenAI ships the next
 * release `latest_version` moves, the creation-time dismissal stops matching,
 * and every EXISTING agent meets a blocking prompt on its next restart. This
 * module is called from creation AND from the launch shim.
 */

function home(contents) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pete-cu-'));
  if (contents !== undefined) {
    fs.writeFileSync(path.join(d, 'version.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return d;
}
const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8'));

test('#1315: it dismisses the version codex reports as latest', () => {
  const d = home({ latest_version: '0.150.1', dismissed_version: null });
  assert.equal(dismissUpdateNotice(d), true);
  assert.equal(read(d).dismissed_version, '0.150.1');
});

test('#1315: a NEW release re-arms the prompt, and a second call answers it', () => {
  /* 🔑 THIS IS THE WHOLE REASON THE LAUNCH CALL EXISTS. Creation dismissed
     0.150.1; codex then learns about 0.151.0 and the notice blocks again. A
     creation-only fix cannot reach this, because creation already happened. */
  const d = home({ latest_version: '0.150.1', dismissed_version: null });
  dismissUpdateNotice(d);
  const after = read(d);
  after.latest_version = '0.151.0';
  fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify(after));
  assert.equal(dismissUpdateNotice(d), true, 'a newer release left the agent facing the prompt again');
  assert.equal(read(d).dismissed_version, '0.151.0');
});

test('#1315: it preserves every other field codex wrote', () => {
  const d = home({ latest_version: '0.150.1', last_checked_at: 'when', other: 42, dismissed_version: null });
  dismissUpdateNotice(d);
  const a = read(d);
  assert.equal(a.last_checked_at, 'when');
  assert.equal(a.other, 42);
});

test('#1315: already dismissed is a no-op, not a rewrite', () => {
  const d = home({ latest_version: '0.150.1', dismissed_version: '0.150.1' });
  assert.equal(dismissUpdateNotice(d), false);
});

test('#1315 CONTROL: it NEVER invents a version', () => {
  assert.equal(dismissUpdateNotice(home(undefined)), false, 'no version.json');
  assert.equal(dismissUpdateNotice(home('not json')), false, 'unparseable');
  assert.equal(dismissUpdateNotice(home({ dismissed_version: null })), false, 'no latest_version');
  assert.equal(dismissUpdateNotice('/tmp/pete-no-such-home-1315'), false, 'missing home');
});

test('#1315: defaultHome prefers CODEX_HOME, which is what codex itself reads', () => {
  const prev = process.env.CODEX_HOME;
  const prevSeam = process.env.AGENT_WORKFORCE_CODEX_HOME;
  try {
    delete process.env.AGENT_WORKFORCE_CODEX_HOME;
    process.env.CODEX_HOME = '/tmp/pete-codex-home-probe';
    assert.equal(defaultHome(), '/tmp/pete-codex-home-probe');
    /* CONTROL: with it unset the answer must MOVE, or the assertion above is
       satisfied by a hardcoded string. */
    delete process.env.CODEX_HOME;
    assert.notEqual(defaultHome(), '/tmp/pete-codex-home-probe');
    assert.match(defaultHome(), /\.codex$/);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    if (prevSeam !== undefined) process.env.AGENT_WORKFORCE_CODEX_HOME = prevSeam;
  }
});
