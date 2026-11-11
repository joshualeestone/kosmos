'use strict';

/* kosmos#5895: the Windows opener's environment list (engine/childenv.js winOpenerEnv), used by the company sign-in
   opener (remote.js runCompanyOpener) and the Claude/OpenAI sign-in opener (win32signin.js browserOpenCommand). The
   pure arms run on any host. The last arm runs on Windows only: a real child started with the list must keep the
   listed variables Windows hands it and must not see a board variable, matched against a real Windows environment,
   whose names Windows itself treats case-blind. "win32" is in this file's name, so the Windows CI job runs it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const childenv = require('./childenv');

test('winOpenerEnv keeps exactly the listed Windows variables, case-blind, one per name, and nothing else', () => {
  const got = childenv.winOpenerEnv({ PATH: 'p', Path: 'q', ComSpec: 'c', comspec: 'd', SystemRoot: 'w', TOKEN: 't',
    HOME: 'h', KOSMOS_AGENT_TOKEN: 'a'.repeat(32), EMPTY_PATHEXT: '', PATHEXT: '', commonprogramfiles: 'cpf' });
  assert.deepEqual(got, { PATH: 'p', ComSpec: 'c', SystemRoot: 'w', commonprogramfiles: 'cpf' },
    'listed names in any case, the first spelling of each, nothing else, no empty values');
  for (const k of childenv.WIN_OPENER_KEYS) {
    assert.equal(childenv.winOpenerEnv({ [k.toUpperCase()]: 'v' })[k.toUpperCase()], 'v', `${k} in upper case`);
    assert.equal(childenv.winOpenerEnv({ [k.toLowerCase()]: 'v' })[k.toLowerCase()], 'v', `${k} in lower case`);
  }
  assert.deepEqual(childenv.winOpenerEnv({}), {});
});

test('the Claude/OpenAI sign-in opener passes only the list to rundll32', () => {
  const signin = require('./win32signin');
  const [cmd, args, opts] = signin.browserOpenCommand('https://example.test/x', {
    SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\system32', KOSMOS_AGENT_TOKEN: 'b'.repeat(32), BOARD_SECRET: 's',
  });
  assert.equal(cmd, 'C:\\Windows\\System32\\rundll32.exe');
  assert.deepEqual(args, ['url.dll,FileProtocolHandler', 'https://example.test/x']);
  assert.deepEqual(opts.env, { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\system32' }, 'no token, no board variable');
  assert.equal(opts.detached, true);
});

test('on a real Windows host, a child started with the list keeps what Windows gave and never sees a board variable', { skip: process.platform === 'win32' ? false : 'needs a real Windows environment' }, () => {
  const { execFileSync } = require('node:child_process');
  const env = childenv.winOpenerEnv({ ...process.env, KOSMOS_5895_BOARD: 'board-only', kosmos_agent_token: 'c'.repeat(32) });
  for (const k of ['SystemRoot', 'PATH', 'USERPROFILE', 'LOCALAPPDATA']) {
    assert.ok(Object.keys(env).some((n) => n.toLowerCase() === k.toLowerCase()), `${k} is kept from the real environment`);
  }
  const childEnvOf = (e) => JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env: e, encoding: 'utf8', windowsHide: true }));
  const has = (obj, k) => Object.keys(obj).some((n) => n.toLowerCase() === k.toLowerCase());
  const seen = childEnvOf(env);
  assert.equal(seen.KOSMOS_5895_BOARD, undefined);
  assert.equal(has(seen, 'kosmos_agent_token'), false, 'a token in any case stays out');
  /* Listed variables that node's process layer does NOT copy in on its own (it copies SYSTEMROOT, PATH, TEMP and a
     few more into every Windows child), so only the list can have put them there. Control: a child given an empty
     environment does not get them. */
  for (const k of ['LOCALAPPDATA', 'ComSpec', 'APPDATA']) {
    if (!has(process.env, k)) continue;
    assert.ok(has(seen, k), `${k} reaches the child through the list`);
    assert.equal(has(childEnvOf({}), k), false, `control: ${k} is not added to a child by node itself`);
  }
});
