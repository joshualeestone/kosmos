'use strict';
/**
 * #570: the Windows agent's `kosmos` command (tools/windows/kosmos-cli.js).
 *
 * 🛑 What it must not get wrong: the route and body each verb sends (the board
 * already speaks them for install/kosmos), the two credentials it presents, and
 * the exit code a caller reads -- 3 for "maybe", never 1, which invites the retry
 * that duplicates a send. No board is needed: fetch is injected, and one test
 * runs against a real local server.
 *
 *   node --test tools.windows-kosmos-cli-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { PassThrough } = require('node:stream');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

/* Run one command against a scripted board. `answer(route, init)` returns
   { status, body } (an object is sent as JSON) or throws to simulate a failure. */
async function run(argv, answer, env, readStdin) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: env || { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    readStdin,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const a = answer ? answer(route, init) : { status: 200, body: {} };
      const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
      return { status: a.status || 200, text: async () => text };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const refusedWith = (e) => () => { throw e; };

// ── the answer that did not exist: reply ────────────────────────────────────

test('reply: POST /api/reply with the text, the agent token AND the board token; kept -> exit 0', async () => {
  const r = await run(['reply', 'OSPREY'], () => ({ body: { kept: true } }));
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/reply');
  assert.deepEqual(r.calls[0].body, { text: 'OSPREY', from_pane: '' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT, 'no agent token: a Windows agent has no pane, so the board cannot tell who it is');
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD, 'no board token: a Windows board enforces and would 403');
  assert.match(r.out, /Answered/);
});

test('reply: words arrive as one message, and an empty reply is a usage error that sends nothing', async () => {
  const r = await run(['reply', 'two', 'words']);
  assert.equal(r.calls[0].body.text, 'two words');
  const e = await run(['reply']);
  assert.equal(e.code, 2);
  assert.equal(e.calls.length, 0);
});

test('a junk KOSMOS_AGENT_TOKEN is not presented (it would take the token arm and be refused there)', async () => {
  const r = await run(['reply', 'x'], () => ({ body: { kept: true } }), { KOSMOS_AGENT_TOKEN: 'not-hex!' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], undefined);
});

// ── msg: the three delivery states and their exit codes ─────────────────────

test('msg: placed -> 0, unconfirmed -> 3 (never 1), could_not -> 1 with the board\'s own sentence', async () => {
  const placed = await run(['msg', 'mara', 'hello', 'there'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(placed.code, 0);
  assert.deepEqual(placed.calls[0].body, { to: 'mara', text: 'hello there', from_pane: '' });
  assert.equal(placed.calls[0].route, '/api/msg');
  const maybe = await run(['msg', 'mara', 'hi'], () => ({ body: { delivery: { state: 'unconfirmed', because: 'typed, Enter not confirmed.' } } }));
  assert.equal(maybe.code, 3, 'an unconfirmed send must be exit 3: exit 1 invites the duplicate a retry sends');
  const no = await run(['msg', 'mara', 'hi'], () => ({ body: { delivery: { state: 'could_not', because: 'mara is not running.' } } }));
  assert.equal(no.code, 1);
  assert.equal(no.err, 'Not delivered: mara is not running.', 'the board\'s sentence, once, with one period');
});

test('#2909: msg --stdin sends the piped text as written; refusals send nothing; a declined one is kept', async () => {
  const placed = () => ({ body: { delivery: { state: 'placed' } } });
  const r = await run(['msg', '--stdin', 'mara'], placed, undefined, async () => ({ text: 'run `x` and $y\n', ended: true }));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.calls[0].body, { to: 'mara', text: 'run `x` and $y', from_pane: '' });
  const mixed = await run(['msg', '--stdin', 'mara', 'also'], placed, undefined, async () => ({ text: 'x', ended: true }));
  assert.equal(mixed.code, 2); assert.equal(mixed.calls.length, 0);
  const trailing = await run(['msg', 'mara', '--stdin'], placed, undefined, async () => { throw new Error('stdin read for a trailing --stdin'); });
  assert.equal(trailing.code, 2); assert.equal(trailing.calls.length, 0);
  const empty = await run(['msg', '--stdin', 'mara'], placed, undefined, async () => ({ text: '', ended: false }));
  assert.equal(empty.code, 2); assert.match(empty.err, /nothing was piped in: kosmos msg --stdin <agent>/);
  const declined = await run(['msg', '--stdin', 'mara'], () => ({ body: { delivery: { state: 'could_not', because: 'mara is not running.' } } }), undefined, async () => ({ text: 'keep this msg', ended: true }));
  assert.equal(declined.code, 1);
  const saved = declined.err.match(/saved at (\S+)/);
  assert.ok(saved, declined.err);
  assert.equal(fs.readFileSync(saved[1], 'utf8'), 'keep this msg');
  fs.rmSync(path.dirname(saved[1]), { recursive: true });
  const noAgent = await run(['msg', '--stdin'], placed, undefined, async () => { throw new Error('stdin read with no agent'); });
  assert.equal(noAgent.code, 2, 'no agent refuses before reading stdin');
  assert.equal(noAgent.calls.length, 0);
  assert.match(noAgent.err, /Usage: kosmos msg \[--stdin\]/);
  const huge = await run(['msg', '--stdin', 'mara'], placed, undefined, async () => ({ text: '"'.repeat(3.5 * 1024 * 1024), ended: true }));
  assert.equal(huge.code, 2, 'an encoded msg body over the board limit is refused before sending');
  assert.equal(huge.calls.length, 0);
  assert.match(huge.err, /too large to send to the board/);
  const hugeSaved = huge.err.match(/saved at (\S+)/);
  assert.ok(hugeSaved, 'and the piped message is kept');
  fs.rmSync(path.dirname(hugeSaved[1]), { recursive: true });
  const tabs = await run(['msg', '--stdin', 'mara'], placed, undefined, async () => ({ text: 'a\tb\r\nc\r\n', ended: true }));
  assert.equal(tabs.calls[0].body.text, 'a\tb\r\nc', 'Windows msg keeps inner tabs/CRs (the documented asymmetry with bash, which flattens them)');
  const ww = await run(['msg', '--stdin', 'mara'], () => ({ status: 421, body: { wrongWorld: true } }), undefined, async () => ({ text: 'w'.repeat(200 * 1024), ended: true }));
  assert.equal(ww.code, 1, 'the outbox cannot keep it here');
  const wwSaved = ww.err.match(/saved at (\S+)/);
  assert.ok(wwSaved, 'a wrong-world piped msg the outbox refused is kept');
  fs.rmSync(path.dirname(wwSaved[1]), { recursive: true });
  const control = await run(['msg', 'mara', 'plain'], placed, undefined, async () => { throw new Error('stdin read without --stdin'); });
  assert.equal(control.code, 0, 'CONTROL: without --stdin, stdin is never read');
});

test('an unreachable board is exit 1 with the url; a TIMEOUT is exit 3, because the board may already have acted', async () => {
  const down = await run(['msg', 'mara', 'hi'], refusedWith(Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' })));
  assert.equal(down.code, 1);
  assert.match(down.err, /could not reach Kosmos .*127\.0\.0\.1:1/);
  const slow = await run(['msg', 'mara', 'hi'], refusedWith(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
  assert.equal(slow.code, 3);
});

test('a refusal ({error}) is exit 1 with the board\'s words', async () => {
  const r = await run(['msg', 'mara', 'hi'], () => ({ status: 403, body: { error: 'this board belongs to the account that started it' } }));
  assert.equal(r.code, 1);
  assert.match(r.err, /refused that request: this board belongs/);
});

// ── post, react, report, whoami, room, task ─────────────────────────────────

test('post: /api/post with the project and text; a --file attempt is refused before anything is sent', async () => {
  const r = await run(['post', 'proj-1', 'room', 'news'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls[0].body, { project: 'proj-1', text: 'room news', from_pane: '' });
  const f = await run(['post', 'proj-1', '--file=notes.md']);
  assert.equal(f.code, 2);
  assert.equal(f.calls.length, 0);
});

test('#2908: post --no-reply sends reply_expected:false; without it no field; a non-leading flag is text', async () => {
  const yes = await run(['post', '--no-reply', 'proj-1', 'thanks, got it'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(yes.code, 0);
  assert.deepEqual(yes.calls[0].body, { project: 'proj-1', text: 'thanks, got it', from_pane: '', reply_expected: false },
    '--no-reply must consume the flag and put reply_expected:false on the body');
  const no = await run(['post', 'proj-1', 'a plain message'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(no.code, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(no.calls[0].body, 'reply_expected'), false,
    'an ordinary post must omit reply_expected entirely (omitted = current behavior)');
  const mid = await run(['post', 'proj-1', 'please --no-reply on that'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(Object.prototype.hasOwnProperty.call(mid.calls[0].body, 'reply_expected'), false,
    'a non-leading --no-reply is message text, not the flag (parity with install/kosmos)');
  assert.match(mid.calls[0].body.text, /--no-reply/, 'the token stays in the text when not leading');
});

test('#3224: post --in-reply-to binds the reply; parity with install/kosmos (flag pair, = form, both orders, leading-only)', async () => {
  const ok = () => ({ body: { delivery: { state: 'placed' } } });
  const a = await run(['post', '--in-reply-to', 'm12', 'proj-1', 'the answer'], ok);
  assert.equal(a.code, 0);
  assert.deepEqual(a.calls[0].body, { project: 'proj-1', text: 'the answer', from_pane: '', in_reply_to: 'm12' },
    '--in-reply-to must consume the flag pair and put in_reply_to on the body (the parity the Windows CLI must keep)');
  const eq = await run(['post', '--in-reply-to=m7', 'proj-1', 'hi'], ok);
  assert.equal(eq.calls[0].body.in_reply_to, 'm7', 'the = form must set in_reply_to');
  const both = await run(['post', '--in-reply-to', 'm3', '--no-reply', 'proj-1', 'ack'], ok);
  assert.equal(both.calls[0].body.in_reply_to, 'm3', 'both leading flags must combine in either order');
  assert.equal(both.calls[0].body.reply_expected, false, '--no-reply must still take effect alongside --in-reply-to');
  const none = await run(['post', 'proj-1', 'a plain post'], ok);
  assert.equal(Object.prototype.hasOwnProperty.call(none.calls[0].body, 'in_reply_to'), false,
    'an ordinary post must omit in_reply_to entirely');
  const mid = await run(['post', 'proj-1', 'please --in-reply-to that thread'], ok);
  assert.equal(Object.prototype.hasOwnProperty.call(mid.calls[0].body, 'in_reply_to'), false,
    'a non-leading --in-reply-to is message text, not the flag (parity with install/kosmos)');
  const empty = await run(['post', '--in-reply-to=', 'proj-1', 'answer'], ok);
  assert.equal(empty.code, 2, 'an empty --in-reply-to= must error, not silently post unbound (parity with install/kosmos)');
  assert.equal(empty.calls.length, 0, 'nothing must be posted when the citation id is empty');
  const emptySpace = await run(['post', '--in-reply-to', '', 'proj-1', 'answer'], ok);
  assert.equal(emptySpace.code, 2, 'an empty --in-reply-to "" (space form) must error too, not silently post unbound (parity with install/kosmos)');
  assert.equal(emptySpace.calls.length, 0, 'nothing must be posted when the citation id is empty');
  const flagAsId = await run(['post', '--in-reply-to', '--no-reply', 'proj-1', 'answer'], ok);
  assert.equal(flagAsId.code, 2, '--in-reply-to --no-reply (id missing) must error, not swallow --no-reply as the citation (parity with install/kosmos)');
  assert.equal(flagAsId.calls.length, 0, 'nothing must be posted when the citation id is a flag token');
  // ENVELOPE ROUND-TRIP (parity with install/kosmos): the emitted order (flag BEFORE project) binds;
  // the trailing order `post <project> --in-reply-to <id>` must NOT bind (leading-only) -- the seam a
  // flag-after-project envelope would silently post unbound through.
  const boundRT = await run(['post', '--in-reply-to', 'm5', 'proj-1', 'the answer'], ok);
  assert.equal(boundRT.calls[0].body.in_reply_to, 'm5', 'the emitted (leading) order must bind in_reply_to');
  const trailing = await run(['post', 'proj-1', '--in-reply-to', 'm5', 'the answer'], ok);
  assert.equal(Object.prototype.hasOwnProperty.call(trailing.calls[0].body, 'in_reply_to'), false,
    'a flag AFTER the project must NOT bind (leading-only): the token becomes message text, not the citation');
  assert.match(trailing.calls[0].body.text, /--in-reply-to m5/, 'the trailing flag+id land verbatim in the message text, unbound');
});

test('#3224: post --new sends new_post:true (not held to ask which room); without it no field; combines with the other leading flags; non-leading is text', async () => {
  const ok = () => ({ body: { delivery: { state: 'placed' } } });
  const a = await run(['post', '--new', 'proj-1', 'a new post'], ok);
  assert.equal(a.code, 0);
  assert.deepEqual(a.calls[0].body, { project: 'proj-1', text: 'a new post', from_pane: '', new_post: true },
    '--new must consume the flag and put new_post:true on the body (parity with install/kosmos)');
  const none = await run(['post', 'proj-1', 'a plain post'], ok);
  assert.equal(Object.prototype.hasOwnProperty.call(none.calls[0].body, 'new_post'), false, 'an ordinary post must omit new_post');
  const both = await run(['post', '--no-reply', '--new', 'proj-1', 'ack'], ok);
  assert.equal(both.calls[0].body.new_post, true);
  assert.equal(both.calls[0].body.reply_expected, false);
  const mid = await run(['post', 'proj-1', 'this is --new stuff'], ok);
  assert.equal(Object.prototype.hasOwnProperty.call(mid.calls[0].body, 'new_post'), false, 'a non-leading --new is message text');
  const held = await run(['post', 'proj-1', 'meant for beta'], () => ({ body: { delivery: { state: 'could_not', code: 'which_room', because: 'you have an unanswered question from the person in Beta (m45)' } } }));
  assert.equal(held.code, 1);
  assert.match(held.err + held.out, /here it is to send again/, 'a which-room hold hands the text back (parity with install/kosmos)');
  assert.match(held.err + held.out, /meant for beta/);
});

test('#2909: post --stdin sends the piped text verbatim (backticks, $, newlines), either flag order; refusals send nothing', async () => {
  const placed = () => ({ body: { delivery: { state: 'placed' } } });
  const msg = 'Run `kosmos room p` then check $HOME\n\n- one\n- two';
  const r = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: msg + '\n', ended: true }));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.calls[0].body, { project: 'proj-1', text: msg, from_pane: '' }, 'the piped text, trailing newline trimmed, nothing else touched');
  const both = await run(['post', '--stdin', '--no-reply', 'proj-1'], placed, undefined, async () => ({ text: 'ack', ended: true }));
  assert.deepEqual(both.calls[0].body, { project: 'proj-1', text: 'ack', from_pane: '', reply_expected: false }, '--stdin and --no-reply combine in either order');
  const mixed = await run(['post', '--stdin', 'proj-1', 'also', 'args'], placed, undefined, async () => ({ text: 'x', ended: true }));
  assert.equal(mixed.code, 2);
  assert.equal(mixed.calls.length, 0, 'args alongside --stdin is ambiguous and must send nothing');
  const empty = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: '', ended: false }));
  assert.equal(empty.code, 2);
  assert.equal(empty.calls.length, 0, 'nothing piped in must send nothing');
  assert.match(empty.err, /nothing was piped in/);
  assert.match(empty.err, /in PowerShell, pass the text as an argument/, 'kosmos.ps1 never forwards piped input, so the refusal must say so');
  const crlf = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: 'line one\r\nline two\r\n', ended: true }));
  assert.equal(crlf.calls[0].body.text, 'line one\r\nline two', 'a CRLF file loses its trailing line ending, not just the \\n');
  const esc = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: '\u001b[31mred\u001b[0m\tdone\u0007\n', ended: true }));
  assert.equal(esc.calls[0].body.text, '[31mred[0m\tdone', 'ESC/BEL dropped and tab kept, matching install/kosmos');
  const ctl = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: '\u001b\u0007\n', ended: true }));
  assert.equal(ctl.code, 2, 'control-only input is nothing piped in');
  assert.equal(ctl.calls.length, 0);
  const huge = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: '"'.repeat(3.5 * 1024 * 1024), ended: true }));
  assert.equal(huge.code, 2, 'quotes escape to twice their size; the encoded body is over the board limit');
  assert.equal(huge.calls.length, 0);
  assert.match(huge.err, /too large to send to the board/);
  const hugeSaved = huge.err.match(/saved at (\S+)/);
  assert.ok(hugeSaved, 'a refused piped message must be kept in a file');
  assert.equal(fs.readFileSync(hugeSaved[1], 'utf8'), '"'.repeat(3.5 * 1024 * 1024));
  fs.rmSync(path.dirname(hugeSaved[1]), { recursive: true });
  const refused = await run(['post', '--stdin', 'proj-1'], () => ({ status: 403, body: { error: 'no such room' } }), undefined, async () => ({ text: 'keep me', ended: true }));
  assert.equal(refused.code, 1);
  const refusedSaved = refused.err.match(/saved at (\S+)/);
  assert.ok(refusedSaved, 'a board refusal after the read keeps the piped message too');
  assert.equal(fs.readFileSync(refusedSaved[1], 'utf8'), 'keep me');
  if (process.platform !== 'win32') assert.equal(fs.statSync(refusedSaved[1]).mode & 0o777, 0o600, 'the saved copy is private');
  fs.rmSync(path.dirname(refusedSaved[1]), { recursive: true });
  const declined = await run(['post', '--stdin', 'proj-1'], () => ({ body: { delivery: { state: 'could_not', because: 'there is no project by that name.' } } }), undefined, async () => ({ text: 'declined body', ended: true }));
  assert.equal(declined.code, 1);
  const declinedSaved = declined.err.match(/saved at (\S+)/);
  assert.ok(declinedSaved, 'a declined delivery keeps the piped message too');
  assert.equal(fs.readFileSync(declinedSaved[1], 'utf8'), 'declined body');
  fs.rmSync(path.dirname(declinedSaved[1]), { recursive: true });
  const big = 'w'.repeat(200 * 1024);
  const ww = await run(['post', '--stdin', 'proj-1'], () => ({ status: 421, body: { wrongWorld: true } }), undefined, async () => ({ text: big, ended: true }));
  assert.equal(ww.code, 1, 'the outbox cannot keep it here (no sender for this token, or over its cap): ' + ww.err.slice(0, 200));
  const wwSaved = ww.err.match(/saved at (\S+)/);
  assert.ok(wwSaved, 'the outbox refusal keeps the piped message in a file');
  assert.equal(fs.readFileSync(wwSaved[1], 'utf8'), big);
  fs.rmSync(path.dirname(wwSaved[1]), { recursive: true });
  const boomErr = [];
  const boom = await cli.main(['post', '--stdin', 'proj-1'], {
    env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub, out: () => {}, err: (x) => boomErr.push(x),
    readStdin: async () => ({ text: 'outbox broke', ended: true }),
    outbox: { keepFromClient: () => { throw new Error('engine missing'); }, WRONG_WORLD_SENTENCES: {} },
    fetch: async () => ({ status: 421, text: async () => JSON.stringify({ wrongWorld: true }) }),
  });
  assert.equal(boom, 1, 'an outbox that throws is a failure, not a crash');
  const boomSaved = boomErr.join('\n').match(/saved at (\S+)/);
  assert.ok(boomSaved, 'the piped message is kept even when the outbox throws: ' + boomErr.join(' | '));
  assert.equal(fs.readFileSync(boomSaved[1], 'utf8'), 'outbox broke');
  fs.rmSync(path.dirname(boomSaved[1]), { recursive: true });
  const argRefused = await run(['post', 'proj-1', 'typed'], () => ({ status: 403, body: { error: 'no such room' } }));
  assert.doesNotMatch(argRefused.err, /saved at/, 'argument-mode text is still on the command line; nothing is saved');
  const trailing = await run(['post', 'proj-1', '--stdin'], placed, undefined, async () => { throw new Error('stdin read for a trailing --stdin'); });
  assert.equal(trailing.code, 2, 'a --stdin after the project is refused');
  assert.equal(trailing.calls.length, 0);
  const t0 = Date.now();
  const runs = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: '\n'.repeat(200000) + 'x\n', ended: true }));
  assert.equal(runs.calls[0].body.text, '\n'.repeat(200000) + 'x', 'inner newline runs are kept, the trailing one trimmed');
  assert.ok(Date.now() - t0 < 5000, 'trimming stays linear on a long inner run of newlines');
  const noProject = await run(['post', '--stdin'], placed, undefined, async () => { throw new Error('stdin read with no project'); });
  assert.equal(noProject.code, 2, 'no project refuses before reading stdin');
  assert.equal(noProject.calls.length, 0);
  const cut = await run(['post', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: 'half a mess', ended: false }));
  assert.equal(cut.code, 2);
  assert.equal(cut.calls.length, 0, 'a pipe that went quiet without ending may be cut short and must not be posted');
  const irt = await run(['post', '--in-reply-to', 'm9', '--stdin', 'proj-1'], placed, undefined, async () => ({ text: 'the `answer`\n', ended: true }));
  assert.deepEqual(irt.calls[0].body, { project: 'proj-1', text: 'the `answer`', from_pane: '', in_reply_to: 'm9' }, '--stdin combines with --in-reply-to (#3224)');
  const control = await run(['post', 'proj-1', 'plain', 'words'], placed, undefined, async () => { throw new Error('stdin read without --stdin'); });
  assert.equal(control.code, 0, 'CONTROL: without --stdin the args are the message and stdin is never read');
  assert.equal(control.calls[0].body.text, 'plain words');
});

test('#2909: post --stdin through the REAL readStandardInput (BOM, chunks, end) composes with the post trim', async () => {
  const pipe = new PassThrough();
  setTimeout(() => { pipe.write('\ufeffline one\r\n'); pipe.write('\u001b[1mtwo\u001b[0m\r\n'); pipe.end('\r\n'); }, 10);
  const r = await run(['post', '--stdin', 'proj-1'], () => ({ body: { delivery: { state: 'placed' } } }), undefined, (ms) => cli.readStandardInput(pipe, ms));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls[0].body.text, 'line one\r\n[1mtwo[0m', 'reader strips the BOM, post drops ESC and the trailing CR/LF run');
});

test('#2909: readStandardInput stops at an optional byte cap and reports overflow; post refuses it', async () => {
  const pipe = new PassThrough();
  setTimeout(() => { pipe.write('a'.repeat(10)); pipe.write('b'.repeat(10)); }, 5);
  assert.deepEqual(await cli.readStandardInput(pipe, SHORT_QUIET_MS * 3, 15), { text: '', ended: false, overflow: true });
  const under = new PassThrough();
  setTimeout(() => { under.end('small'); }, 5);
  assert.deepEqual(await cli.readStandardInput(under, SHORT_QUIET_MS * 3, 15), { text: 'small', ended: true }, 'under the cap is unchanged');
  const r = await run(['post', '--stdin', 'proj-1'], () => ({ body: { delivery: { state: 'placed' } } }), undefined, async (ms, max) => {
    assert.equal(max, 6 * 1024 * 1024, 'post passes the board limit as the read cap');
    return { text: '', ended: false, overflow: true };
  });
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /over the 6 MB the board accepts/);
  assert.doesNotMatch(r.err, /saved at/);
});

test('react: /api/react with project, post id and emoji, and the agent hears WHICH way the toggle went', async () => {
  const r = await run(['react', 'proj-1', 'm3', '🔥'], () => ({ body: { ok: true, op: 'add' } }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls[0].body, { project: 'proj-1', of: 'm3', emoji: '🔥', from_pane: '' });
  assert.equal(r.out, 'Reacted 🔥 to that post.');
  const off = await run(['react', 'proj-1', 'm3', '🔥'], () => ({ body: { ok: true, op: 'remove' } }));
  assert.equal(off.out, 'Took your 🔥 back off that post.', 'a second react takes it back, and the agent must be told');
  const no = await run(['react', 'proj-1', 'm9', '🔥'], () => ({ body: { ok: false, because: 'there is no post m9.' } }));
  assert.equal(no.code, 1);
  assert.equal(no.err, 'Not reacted: there is no post m9.');
});

test('report: the flags become fields; a blocked report with nothing to act on is refused locally (#2001)', async () => {
  const r = await run(['report', 'blocked', '--on', 'the deploy', '--owner', 'baron', 'waiting'], () => ({ body: { recorded: true } }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls[0].body, { state: 'blocked', text: 'waiting', on: 'the deploy', owner: 'baron', until: '', project: '', auto: false, from_pane: '' });
  const empty = await run(['report', 'needs_you']);
  assert.equal(empty.code, 2);
  assert.equal(empty.calls.length, 0);
  const show = await run(['report', 'show'], () => ({ body: 'You are idle.\n' }));
  assert.equal(show.calls[0].route, '/api/report?as=text&from_pane=');
  assert.equal(show.out, 'You are idle.');
});

test('whoami prints the BOARD\'s sentence, verbatim', async () => {
  const r = await run(['whoami'], () => ({ body: { because: 'You are leo, on the default account.' } }));
  assert.equal(r.out, 'You are leo, on the default account.');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
});

test('room and task sanitize the project id the way install/kosmos does, and present no agent token', async () => {
  const room = await run(['room', 'proj/../x y'], () => ({ body: 'room text\n' }));
  assert.equal(room.calls[0].route, '/api/project/proj..xy/room?as=text');
  assert.equal(room.calls[0].headers['x-kosmos-agent-token'], undefined);
  const list = await run(['task', 'list', 'p1'], () => ({ body: { tasks: [{ number: 1, sentence: 'ship it', isClosed: false, whoNames: ['leo'] }] } }));
  assert.equal(list.calls[0].route, '/api/tasks?project=p1');
  assert.equal(list.out, '[1] ship it (leo)');
  const add = await run(['task', 'add', 'p1', 'write docs', 'more', 'detail'], () => ({ body: { task: {} } }));
  assert.deepEqual(add.calls[0].body, { sentence: 'write docs', detail: 'more detail', from_pane: '' });
  assert.equal(add.calls[0].headers['x-kosmos-agent-token'], undefined, 'the tasks route ignores it; sending it only suggests it counts');
  const close = await run(['task', 'close', 'p1', 'two']);
  assert.equal(close.code, 2, 'a non-number task is a usage error, sent nowhere');
  assert.equal(close.calls.length, 0);
});

test('project create: POST /api/projects with name+folder and the BOARD token (not the agent token); id -> 0; error -> 1; missing args -> 2', async () => {
  const okBody = { project: { id: 'my-project' }, told: [], id: 'my-project', agentsUnreadable: false };
  const ok = await run(['project', 'create', 'My Project', '/tmp/mp', 'a demo'], () => ({ body: okBody }));
  assert.equal(ok.code, 0);
  assert.equal(ok.calls[0].route, '/api/projects');
  assert.equal(ok.calls[0].method, 'POST');
  assert.deepEqual(ok.calls[0].body, { name: 'My Project', folder: '/tmp/mp', from_pane: '', description: 'a demo' });
  assert.equal(ok.calls[0].headers['x-kosmos-agent-token'], undefined, 'a board write: the create route does not name the sender from the agent token');
  assert.equal(ok.calls[0].headers['x-kosmos-board-token'], BOARD, 'an enforcing board would 403 without the board token');
  assert.equal(ok.out, 'Created project "My Project" (id: my-project). It\'s on your board now.');

  // description omitted when not given
  const nod = await run(['project', 'create', 'Nodesc', '/tmp/nd'], () => ({ body: okBody }));
  assert.equal(Object.prototype.hasOwnProperty.call(nod.calls[0].body, 'description'), false,
    'description must be absent from the body when the caller did not pass one');

  // the load-bearing control: a refused create exits non-zero with the board's reason
  const rate = await run(['project', 'create', 'Rate', '/tmp/r'],
    () => ({ status: 429, body: { error: 'agents have made 12 projects in the last hour, so Kosmos is pausing agent-made projects' } }));
  assert.equal(rate.code, 1);
  assert.match(rate.err, /did not create that project/);
  assert.match(rate.err, /pausing agent-made projects/);

  // missing folder is a usage error, sent nowhere
  const bad = await run(['project', 'create', 'OnlyName']);
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});

test('no verb, or an unknown one, is a usage error', async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['start'])).code, 2, 'the board is Kosmos.exe; this command has no start');
});

// ── win32-cli-verbs: task message, room reopen, feedback, --help ────────────

test('task message: POST .../task/<n>/message with the Mac\'s body AND the agent token; ok -> 0; refusal -> 1; timeout -> 3', async () => {
  const ok = await run(['task', 'message', 'proj/1', '4', 'looks', 'good'], () => ({ body: { ok: true, delivered: [] } }));
  assert.equal(ok.code, 0);
  assert.equal(ok.calls[0].route, '/api/project/proj1/task/4/message');
  assert.equal(ok.calls[0].method, 'POST');
  assert.deepEqual(ok.calls[0].body, { text: 'looks good', from_pane: '' });
  assert.equal(ok.calls[0].headers['x-kosmos-agent-token'], AGENT, 'without the token the board cannot name a Windows sender or leave it off the notified list');
  assert.equal(ok.out, 'Message recorded on task 4 of proj/1; any agents assigned to it were notified.');
  const no = await run(['task', 'message', 'p1', '4', 'x'], () => ({ status: 404, body: { error: 'there is no task by that number.' } }));
  assert.equal(no.code, 1);
  assert.equal(no.err, 'Kosmos refused that message: there is no task by that number.');
  const slow = await run(['task', 'message', 'p1', '4', 'x'], refusedWith(Object.assign(new Error('t'), { name: 'TimeoutError' })));
  assert.equal(slow.code, 3, 'the board may already have recorded and delivered it; 1 invites the duplicate');
  const odd = await run(['task', 'message', 'p1', '4', 'x'], () => ({ body: '<html>' }));
  assert.equal(odd.code, 1, 'an answer that is not the board\'s {ok:true} must not read as done');
});

test('task message: a missing part or a non-number task is a usage error that sends nothing', async () => {
  for (const argv of [['task', 'message'], ['task', 'message', 'p1'], ['task', 'message', 'p1', '4'], ['task', 'message', 'p1', 'four', 'hi']]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.calls.length, 0, argv.join(' '));
  }
});

test('an unknown task subcommand lists all four, as install/kosmos does', async () => {
  const r = await run(['task', 'reassign', 'p1']);
  assert.equal(r.code, 2);
  assert.equal(r.err, 'Unknown: kosmos task reassign. Try: list | add | close | message');
});

test('room reopen: POST .../room/reopen with no body and no agent token; 2xx -> 0, 404 -> 1, other -> 1 with the board\'s because', async () => {
  const ok = await run(['room', 'reopen', 'proj 1'], () => ({ body: { ok: true } }));
  assert.equal(ok.code, 0);
  assert.equal(ok.calls[0].route, '/api/project/proj1/room/reopen');
  assert.equal(ok.calls[0].method, 'POST');
  assert.equal(ok.calls[0].body, undefined);
  assert.equal(ok.calls[0].headers['x-kosmos-agent-token'], undefined);
  const missing = await run(['room', 'reopen', 'nope'], () => ({ status: 404, body: { ok: false, because: 'there is no project by that name' } }));
  assert.equal(missing.code, 1);
  assert.equal(missing.err, 'There is no project called "nope", so there is no room to reopen.');
  const bad = await run(['room', 'reopen', 'p1'], () => ({ status: 400, body: { ok: false, because: 'that project id contains characters we cannot read' } }));
  assert.equal(bad.code, 1);
  assert.equal(bad.err, 'We could not reopen that room: that project id contains characters we cannot read');
  const bare = await run(['room', 'reopen']);
  assert.equal(bare.code, 2);
  assert.equal(bare.calls.length, 0, 'a bare reopen must not read a room called "reopen"');
});

test('feedback verbs call the engine and send nothing to the board', async () => {
  const written = [];
  const engine = {
    feedback: { write: (b) => { written.push(b); return { ok: true }; }, today: () => '2026-09-12', isDateKey: (d) => /^\d{4}-\d{2}-\d{2}$/.test(d), readBody: (d) => (d === '2026-09-12' ? 'today\'s note\n' : null), list: () => ['2026-09-12', '2026-09-11'] },
    feedbackpull: { pull: async () => ({ ok: false, because: 'the collected-feedback token is not filed yet' }) },
  };
  const go = async (argv, stdin) => {
    const out = []; const err = []; const calls = [];
    const code = await cli.main(argv, { env: {}, hook: hookStub, engine, readStdin: () => ({ text: stdin || '', ended: true }), out: (s) => out.push(s), err: (s) => err.push(s), fetch: async () => { calls.push(1); throw new Error('feedback reached the network'); } });
    return { code, out: out.join('\n'), err: err.join('\n'), calls };
  };
  assert.equal((await go(['feedback', 'write', 'two', 'words'])).code, 0);
  assert.equal((await go(['feedback', 'write'], 'from stdin')).code, 0);
  assert.deepEqual(written, ['two words', 'from stdin']);
  assert.equal((await go(['feedback', 'write'], '   ')).code, 2);
  assert.equal((await go(['feedback', 'show'])).out, 'today\'s note');
  assert.equal((await go(['feedback', 'show', '2026-01-01'])).code, 1);
  assert.equal((await go(['feedback', 'show', 'junk'])).code, 2);
  assert.equal((await go(['feedback', 'list'])).out, '2026-09-12\n2026-09-11');
  const pull = await go(['feedback', 'pull']);
  assert.equal(pull.code, 1);
  assert.match(pull.err, /not filed yet/);
  assert.equal((await go(['feedback', 'pull', '--dir'])).code, 2);
  assert.equal((await go(['feedback'])).code, 2);
});

test('#1674: `kosmos reply --help` prints the usage and SENDS NOTHING (it used to send "--help" to the person)', async () => {
  for (const argv of [['reply', '--help'], ['reply', '-h'], ['reply', 'real words', '--help'], ['msg', 'mara', '--help'], ['report', '--help'], ['whoami', '-h']]) {
    const r = await run(argv, () => { throw new Error('--help sent a request'); });
    assert.equal(r.calls.length, 0, argv.join(' '));
    assert.equal(r.code, 0, argv.join(' '));
    assert.equal(r.out, cli.USAGE[argv[0]]);
  }
  const mention = await run(['reply', 'use --help next time'], () => ({ body: { kept: true } }));
  assert.equal(mention.calls.length, 1, 'a message that only MENTIONS --help must still be sent');
});

test('kosmos --help, -h and help print the verb list, exit 0, and send nothing', async () => {
  for (const argv of [['--help'], ['-h'], ['help'], ['start', '--help']]) {
    const r = await run(argv);
    assert.equal(r.code, 0, argv.join(' '));
    assert.equal(r.calls.length, 0);
    assert.match(r.out, /^Usage: kosmos <msg\|/);
  }
});

// ── review round 2: stdin is used only when it ENDED ─────────────────────────
// Driven through the real reader (readStandardInput) on an in-memory pipe, with
// a short quiet limit so the tests are fast.

const SHORT_QUIET_MS = 80;
function feedbackRun(argv, readStdin, engine) {
  const out = []; const err = []; const written = [];
  const eng = Object.assign({ feedback: { write: (b) => { written.push(b); return { ok: true }; }, reportsForTriage: () => ({ ok: true, reports: [], notes: [] }) } }, engine || {});
  return cli.main(argv, { env: {}, hook: hookStub, engine: eng, readStdin, out: (s) => out.push(s), err: (s) => err.push(s), fetch: async () => { throw new Error('feedback reached the network'); } })
    .then((code) => ({ code, out: out.join('\n'), err: err.join('\n'), written }));
}

test('round 2: readStandardInput says whether the input ENDED; a partial write that never ends is ended:false', async () => {
  const pipe = new PassThrough();
  pipe.write('PART1 ');
  assert.deepEqual(await cli.readStandardInput(pipe, SHORT_QUIET_MS), { text: 'PART1 ', ended: false });
});

test('round 2: a first chunk that arrives late, before the end, is read whole and ended', async () => {
  const pipe = new PassThrough();
  setTimeout(() => { pipe.write('late '); pipe.end('and whole'); }, SHORT_QUIET_MS / 2);
  assert.deepEqual(await cli.readStandardInput(pipe, SHORT_QUIET_MS * 3), { text: 'late and whole', ended: true });
});

test('round 2: feedback write REFUSES a piped report that stopped without ending: exit 2, nothing saved', async () => {
  const pipe = new PassThrough();
  pipe.write('PART1 ');   // PART2 never comes, and the pipe never ends
  const r = await feedbackRun(['feedback', 'write'], () => cli.readStandardInput(pipe, SHORT_QUIET_MS));
  assert.equal(r.code, 2);
  assert.deepEqual(r.written, [], 'half a report was saved');
  assert.match(r.err, /^Nothing was saved: .*Pass the report as an argument/);
});

test('round 2: feedback write saves a piped report that ENDED, a late second part included', async () => {
  const pipe = new PassThrough();
  pipe.write('PART1 ');
  setTimeout(() => pipe.end('PART2'), SHORT_QUIET_MS / 2);
  const r = await feedbackRun(['feedback', 'write'], () => cli.readStandardInput(pipe, SHORT_QUIET_MS * 3));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.written, ['PART1 PART2']);
});

test('round 2: triage --cards - uses a card that arrives late, before the end, and it still matches its report', async () => {
  const pipe = new PassThrough();
  setTimeout(() => pipe.end('The dock icon is easy to lose among other applications\n'), SHORT_QUIET_MS / 2);
  const reports = [{ date: '2026-09-01', body: '- The dock icon is easy to lose among other apps.\n' }];
  const r = await feedbackRun(['feedback', 'triage', '--cards', '-'], () => cli.readStandardInput(pipe, SHORT_QUIET_MS * 3), { feedback: { reportsForTriage: () => ({ ok: true, reports, notes: [] }) } });
  assert.equal(r.code, 0, r.err);
  const carded = r.out.split('\n## ').find((s) => /^Likely already carded/.test(s)) || '';
  assert.match(carded, /dock icon/i, 'the late card did not match: ' + r.out);
});

test('round 2: triage --cards - with a list that never ends exits 2 and prints NO digest', async () => {
  const pipe = new PassThrough();
  pipe.write('The dock icon is easy to lose\n');   // and the pipe never ends
  const r = await feedbackRun(['feedback', 'triage', '--cards', '-'], () => cli.readStandardInput(pipe, SHORT_QUIET_MS));
  assert.equal(r.code, 2);
  assert.equal(r.out, '', 'a digest from part of a card list was printed');
  assert.match(r.err, /^Nothing was triaged: /);
});

test('round 2: the feedback usage states both stdin limits, with the numbers the code uses', () => {
  assert.ok(cli.USAGE.feedback.includes('stops for ' + (cli.STDIN_QUIET_LIMIT_MS / 1000) + ' s without ending'), cli.USAGE.feedback);
  assert.ok(cli.USAGE.feedback.includes('up to ' + (cli.CARDS_STDIN_QUIET_LIMIT_MS / 1000) + ' s of silence'), cli.USAGE.feedback);
});

// ── one derivation: the routes are install/kosmos's routes ──────────────────

test('every route this sends is one install/kosmos sends', () => {
  const bash = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  for (const route of ['/api/msg', '/api/reply', '/api/post', '/api/react', '/api/report', '/api/whoami', '/api/tasks?project=', '/room?as=text', '/tasks', '/close', '/message', '/room/reopen']) {
    assert.ok(bash.includes(route), 'install/kosmos no longer uses ' + route + '; the Windows CLI is speaking a route the board may have dropped');
  }
});

// ── the real hook, and a real board ─────────────────────────────────────────

test('the default wiring finds the engine and its hook in a source checkout', () => {
  const dir = cli.engineDir(path.join(__dirname, 'tools', 'windows'));
  assert.ok(fs.existsSync(path.join(dir, 'kosmos-report-hook.js')), 'engineDir did not find the engine from tools/windows');
  const hook = require(path.join(dir, 'kosmos-report-hook.js'));
  assert.equal(hook.agentToken({ KOSMOS_AGENT_TOKEN: 'zz' }), null);
  assert.match(hook.resolveUrl({ KOSMOS_PORT: '17001' }, -1), /:17001$/);
});

test('against a real local server: the request is well-formed on the wire', async () => {
  let seen = null;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { seen = { url: req.url, headers: req.headers, body: JSON.parse(b) }; res.end(JSON.stringify({ kept: true })); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const code = await cli.main(['reply', 'over the wire'], {
      env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub, url: 'http://127.0.0.1:' + srv.address().port, out: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.equal(seen.url, '/api/reply');
    assert.equal(seen.headers['x-kosmos-agent-token'], AGENT);
    assert.equal(seen.body.text, 'over the wire');
  } finally { await new Promise((r) => srv.close(r)); }
});

// ── the arguments kosmos.ps1 hands over in a temp file ─────────────────────

test('argvFrom: kosmos.ps1\'s JSON file is read ONLY behind its flag, exactly, and a bare number becomes text', () => {
  const file = JSON.stringify(['reply', 'line one\nline two', 'She said "go & echo X" ok', '100%PATH%', 3]);
  assert.deepEqual(cli.argvFrom([cli.ARGV_FILE_FLAG, 'f.json'], () => file), ['reply', 'line one\nline two', 'She said "go & echo X" ok', '100%PATH%', '3']);
  assert.deepEqual(cli.argvFrom([cli.ARGV_FILE_FLAG, 'f.json'], () => '\uFEFF' + file)[0], 'reply', 'a BOM broke the read');
  assert.deepEqual(cli.argvFrom(['reply', 'hi'], () => { throw new Error('read a file it was not given'); }), ['reply', 'hi']);
});

test('argvFrom: a PowerShell list or table is REFUSED, never stringified into different words', () => {
  assert.throws(() => cli.argvFrom([cli.ARGV_FILE_FLAG, 'f'], () => JSON.stringify(['msg', 'foo', { a: 1 }])), /list or table, not text/);
  assert.throws(() => cli.argvFrom([cli.ARGV_FILE_FLAG, 'f'], () => JSON.stringify(['msg', 'foo', ['a', 'b']])), /list or table/);
  assert.throws(() => cli.argvFrom([cli.ARGV_FILE_FLAG, 'f'], () => 'not json'), /could not read the arguments/);
});

test('main reads kosmos.ps1\'s file, and refuses a mangled argument with exit 2 before sending anything', async () => {
  const calls = [];
  const ok = await cli.main([cli.ARGV_FILE_FLAG, 'x'], { env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub, out: () => {}, err: () => {}, readFile: () => JSON.stringify(['reply', 'two\nlines']), fetch: async (u, init) => { calls.push(JSON.parse(init.body)); return { status: 200, text: async () => '{"kept":true}' }; } });
  assert.equal(ok, 0);
  assert.equal(calls[0].text, 'two\nlines', 'the multi-line answer was cut, which is the defect the .ps1 shim exists to end');
  const errs = [];
  const bad = await cli.main([cli.ARGV_FILE_FLAG, 'x'], { env: {}, hook: hookStub, out: () => {}, err: (s) => errs.push(s), readFile: () => JSON.stringify(['reply', { a: 1 }]), fetch: async () => { throw new Error('sent a mangled message'); } });
  assert.equal(bad, 2);
  assert.match(errs.join(' '), /Put that part in quotes/);
});
