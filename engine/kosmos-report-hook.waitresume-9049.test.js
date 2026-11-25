'use strict';
/**
 * kosmos#9049: the Windows report hook, at a SessionStart that continues a conversation after its SessionEnd (a /clear,
 * or a resume after a quit), asks /api/away for the reminder of the agent's own wait alone (wait=only) and prints it.
 * It sends no report there (#1058), a compaction asks nothing, and a session with no agent token is not asked.
 *
 *   node --test engine/kosmos-report-hook.waitresume-9049.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hook-9049-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const hook = require('./kosmos-report-hook');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const JSONLINE = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Kosmos: before this session x' } });

/* Answers /api/away with the hook JSON and every other request as a recorded report, recording each URL. */
function board(seen) {
  return async (url) => {
    seen.push(url);
    if (/\/api\/away\?/.test(url)) return { ok: true, status: 200, text: async () => JSONLINE };
    return { ok: true, status: 200, text: async () => JSON.stringify({ recorded: true }) };
  };
}
function start(source, env) {
  const seen = []; const printed = [];
  return {
    seen, printed,
    io: {
      input: JSON.stringify({ hook_event_name: 'SessionStart', source }),
      url: 'http://127.0.0.1:1', boardToken: null, throttleDir: path.join(SANDBOX, 'throttle'),
      now: () => 1000, ppid: 4242, env, fetchImpl: board(seen), stdout: (s) => printed.push(s),
    },
  };
}
const TOKEN = { KOSMOS_AGENT_TOKEN: 'a1a1a1' };

test('a /clear or a resume asks for the wait reminder alone, prints it, and sends no report', async () => {
  for (const source of ['clear', 'resume']) {
    const s = start(source, TOKEN);
    assert.equal(await hook.main(s.io), 0, source);
    const away = s.seen.filter((u) => /\/api\/away\?/.test(u));
    assert.equal(away.length, 1, source + ': ' + s.seen.join(', '));
    assert.match(away[0], /[?&]wait=only(&|$)/, source);
    assert.equal(s.seen.filter((u) => /\/api\/report$/.test(u)).length, 0, source + ': no started over the wait (#1058)');
    assert.deepEqual(s.printed, [JSONLINE + '\n'], source);
  }
});

test('a compaction asks nothing; a session with no agent token is not asked', async () => {
  const c = start('compact', TOKEN);
  await hook.main(c.io);
  assert.equal(c.seen.filter((u) => /\/api\/away\?/.test(u)).length, 0);
  assert.deepEqual(c.printed, []);
  for (const source of ['clear', 'resume']) {
    const n = start(source, {});
    await hook.main(n.io);
    assert.equal(n.seen.filter((u) => /\/api\/away\?/.test(u)).length, 0, source);
    assert.deepEqual(n.printed, [], source);
  }
});

test('CONTROL: a real startup still asks the full away (no wait=only) after its started', async () => {
  const s = start('startup', TOKEN);
  await hook.main(s.io);
  const away = s.seen.filter((u) => /\/api\/away\?/.test(u));
  assert.equal(away.length, 1, s.seen.join(', '));
  assert.doesNotMatch(away[0], /wait=only/);
  assert.equal(s.seen.filter((u) => /\/api\/report$/.test(u)).length, 1);
});
