'use strict';
/**
 * kosmos#6506, the Windows half: `kosmos handoff` in tools/windows/kosmos-cli.js (verbHandoff),
 * mirroring cli.handoff-6506.test.js for install/kosmos. The verb is thin: it calls the shared
 * engine/handoff.js render (unit-tested in engine/handoff.test.js) and prints the lines. Driven
 * through main() with its out/err/env seams; nothing leaves the process and no board is called.
 *
 *   node --test tools.windows-kosmos-cli-handoff-6506.test.js
 */
require('./test-support/tmpscope');   // #4273: first, so every mkdtemp dir here (incl. the per-test artifact dirs) is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Sandbox the data + workers roots BEFORE requiring any store-using module, as the other
   windows-cli tests do, so nothing reads or writes a real agent's files. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-handoff-data-'));
const WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-handoff-workers-'));
process.on('exit', () => { for (const d of [DATA, WORKERS]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;

const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const instructions = require('./engine/instructions');
const selfreport = require('./engine/selfreport');

function harness(env = {}) {
  const lines = { out: [], err: [] };
  const io = {
    env,
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => 'agent-tok', readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async () => { throw new Error('verbHandoff must not call the board'); },
  };
  return { io, lines, out: () => lines.out.join('\n'), all: () => lines.out.concat(lines.err).join('\n') };
}

test('#6506: verbHandoff prints the shared contract and the facts, exits 0, and calls no board', async () => {
  const session = 'winhandoff';
  const r = selfreport.record(session, { state: 'working', because: 'writing the handoff' });
  assert.ok(r.recorded, 'precondition: self-report recorded: ' + (r.because || ''));
  const file = instructions.fileFor(session);
  assert.ok(file && file.startsWith(WORKERS + path.sep), 'precondition: instruction file inside the sandbox, got ' + file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# ' + session + '\n');

  const h = harness({ KOSMOS_AGENT_SESSION: session });
  assert.equal(await cli.main(['handoff'], h.io), 0, h.all());
  const out = h.out();
  assert.match(out, /## What a handoff must cover/, out);
  assert.match(out, /- current branch and sha/, 'the shared contract bullets must print');
  assert.match(out, /Live state \(self-report\): working/, out);
  assert.match(out, /Instruction file .*: last changed /, out);
});

test('#6506: with no session verbHandoff says so rather than guessing', async () => {
  const h = harness({ KOSMOS_AGENT_SESSION: '' });
  assert.equal(await cli.main(['handoff'], h.io), 0, h.all());
  assert.match(h.out(), /Live state \(self-report\): cannot tell which agent this is \(no session\)/, h.out());
});

test('#6506: a named artifact is fingerprinted, a missing one said as missing', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-handoff-art-'));
  const f = path.join(d, 'out.txt');
  fs.writeFileSync(f, 'payload');
  const h = harness({ KOSMOS_AGENT_SESSION: '' });
  assert.equal(await cli.main(['handoff', f, path.join(d, 'gone.bin')], h.io), 0, h.all());
  assert.match(h.out(), /out\.txt`: sha256:[0-9a-f]{64}/, h.out());
  assert.match(h.out(), /gone\.bin`: missing \(no such file\)/, h.out());
});

test('#6506: handoff --help prints usage, exits 0, and gathers nothing', async () => {
  const h = harness({ KOSMOS_AGENT_SESSION: 'winhandoff' });
  assert.equal(await cli.main(['handoff', '--help'], h.io), 0, h.all());
  assert.match(h.all(), /^Usage: kosmos handoff /m, h.all());
  assert.doesNotMatch(h.all(), /## Prefilled facts/, '--help must not gather the facts');
});
