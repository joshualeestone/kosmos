'use strict';
/**
 * #3380 the codex turn driver: arg construction and JSONL parsing, both pure and
 * asserted on any platform with no codex, no key and no spawn. runCodexTurn is
 * driven through an injected fake child.
 *
 *   node --test engine/win32codex.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const codex = require('./win32codex');

test.after(() => codex.setSpawn(null));

test('#3380 a fresh turn: --json, git check skipped, autonomy, message last -- no resume', () => {
  const args = codex.codexTurnArgs({ message: 'hello', autonomy: true });
  assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', codex.AUTONOMY_FLAG, 'hello']);
});

test('#3380 a continuing turn resumes the thread id, before the flags', () => {
  const args = codex.codexTurnArgs({ message: 'again', sessionId: 'thread-abc', autonomy: true });
  assert.deepEqual(args, ['exec', 'resume', 'thread-abc', '--json', '--skip-git-repo-check', codex.AUTONOMY_FLAG, 'again']);
});

test('#3380 a model is passed with -m, codex\'s own spelling', () => {
  const args = codex.codexTurnArgs({ message: 'm', model: 'gpt-5.6', autonomy: true });
  assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5.6', codex.AUTONOMY_FLAG, 'm']);
});

test('#3380 autonomy is OMITTED when not asked -- the flag is not invented', () => {
  const args = codex.codexTurnArgs({ message: 'x' });
  assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', 'x']);
});

test('#3380 the parser reads thread.started, agent_message and turn.completed', () => {
  const out = [
    '{"type":"thread.started","thread_id":"11111111-2222-4333-8444-555555555555"}',
    '{"type":"item.started","item":{"type":"reasoning"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"the answer"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10}}',
  ].join('\n');
  const r = codex.parseCodexTurn(out);
  assert.equal(r.sessionId, '11111111-2222-4333-8444-555555555555');
  assert.equal(r.response, 'the answer');
  assert.equal(r.turnComplete, true);
});

test('#3380 the parser keeps the PRIOR id when a resume emits no fresh thread.started', () => {
  const out = '{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}\n{"type":"turn.completed"}';
  const r = codex.parseCodexTurn(out, 'prior-thread');
  assert.equal(r.sessionId, 'prior-thread');
  assert.equal(r.response, 'hi');
});

test('#3380 the parser joins multiple agent_message items and ignores non-JSON banners', () => {
  const out = [
    'Reading prompt from stdin...',              // a non-JSON banner codex may print
    '{"type":"item.completed","item":{"type":"agent_message","text":"one"}}',
    'garbage that is not json',
    '{"type":"item.completed","item":{"type":"agent_message","text":"two"}}',
  ].join('\n');
  const r = codex.parseCodexTurn(out);
  assert.equal(r.response, 'one\ntwo');
  assert.equal(r.turnComplete, false);
});

/* A fake codex child: an EventEmitter with stdout/stderr the driver reads, and a
   way to make it emit lines then close. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('#3380 runCodexTurn resolves ok with the response and thread id on a clean exit', async () => {
  const child = fakeChild();
  let sawArgs = null;
  let sawEnv = null;
  codex.setSpawn((bin, args, opts) => { sawArgs = args; sawEnv = opts.env; return child; });
  const p = codex.runCodexTurn({ bin: 'codex', message: 'hi', autonomy: true, env: { CODEX_HOME: '/x' } });
  child.stdout.emit('data', '{"type":"thread.started","thread_id":"t-1"}\n');
  child.stdout.emit('data', '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n');
  child.emit('close', 0);
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.response, 'done');
  assert.equal(r.sessionId, 't-1');
  assert.equal(sawEnv.CODEX_HOME, '/x', 'the passed env reaches the spawn');
  assert.ok(sawArgs.includes('--skip-git-repo-check'));
});

test('#3380 runCodexTurn reports not-ok with the exit code and stderr on a failed turn', async () => {
  const child = fakeChild();
  codex.setSpawn(() => child);
  const p = codex.runCodexTurn({ bin: 'codex', message: 'hi' });
  child.stderr.emit('data', 'auth error: not signed in');
  child.emit('close', 1);
  const r = await p;
  assert.equal(r.ok, false);
  assert.match(r.error, /exit 1/);
  assert.match(r.error, /auth error/);
});

test('#3380 runCodexTurn hands the child to onSpawn so a stop can kill it', async () => {
  const child = fakeChild();
  codex.setSpawn(() => child);
  let captured = null;
  const p = codex.runCodexTurn({ bin: 'codex', message: 'hi', onSpawn: (c) => { captured = c; } });
  assert.equal(captured, child, 'the in-flight child is exposed');
  child.stdout.emit('data', '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n');
  child.emit('close', 0);
  await p;
});

test('#3380 runCodexTurn never rejects when the spawn itself throws', async () => {
  codex.setSpawn(() => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; });
  const r = await codex.runCodexTurn({ bin: 'nope', message: 'hi', sessionId: 't-keep' });
  assert.equal(r.ok, false);
  assert.match(r.error, /spawn/);
  assert.equal(r.sessionId, 't-keep', 'the resume id survives a spawn failure');
});
