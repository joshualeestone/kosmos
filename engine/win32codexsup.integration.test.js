'use strict';
/**
 * #3380 INTEGRATION: a codex agent driven through the real supervision path against
 * a real, signed-in OpenAI account on this box -- proving it actually responds and
 * that the supervisor's queue + resume wiring keeps continuity across turns.
 *
 * 🛑 WIN32-GATED AND ENV-GATED. It spawns the real codex binary and makes real API
 * calls, so it SKIPS off-win32 (macOS CI would red) and skips when the binary or a
 * signed-in test home is absent. It touches NEITHER the store NOR the live board:
 * the session prepare, token retire, prune and stream sink are all injected fakes,
 * and it runs in a throwaway temp cwd. Prompts are trivial (2 turns) to keep cost
 * near zero.
 *
 *   node --test engine/win32codexsup.integration.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { superviseCodexStreaming } = require('./win32codexsup');
const win32codex = require('./win32codex');

const CODEX_BIN = 'C:/Users/joshu/.local/share/kosmos/runners/openai/pkg/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
const CODEX_HOME = 'C:/Users/joshu/work/codex-test-home';

const ready = process.platform === 'win32'
  && fs.existsSync(CODEX_BIN)
  && fs.existsSync(path.join(CODEX_HOME, 'auth.json'));

test('#3380 a codex agent responds and recalls context across two turns', { skip: !ready, timeout: 180000 }, async () => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codexsup-3380-')));
  const seen = [];
  /* Wrap the REAL driver so the turn's actual response is observable; the supervisor
     still owns the thread id it passes in, so this exercises real continuity. */
  const runTurn = async (o) => {
    const r = await win32codex.runCodexTurn(o);
    seen.push({ threadIn: o.sessionId || null, ok: r.ok, response: r.response, threadOut: r.sessionId });
    return r;
  };

  const h = superviseCodexStreaming(
    { name: 'codex-it', cwd, runner: 'codex', claudeBin: CODEX_BIN },
    {
      bin: CODEX_BIN,
      runTurn,
      env: Object.assign({}, process.env, { CODEX_HOME }),
      prepare: () => ({ ok: true, sessionId: 'it-sess', name: 'codex-it', token: null, instance: null, tokenBecause: null }),
      retireRun: () => ({ ok: true }),
      sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
      stream: { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} },
      onEvent: () => {},
    },
  );

  try {
    await new Promise((res) => h.send('Remember the secret word: banana. Reply with just OK.', res));
    // Wait for the first turn to actually complete (it establishes the thread id).
    await waitFor(() => seen.length >= 1, 120000);
    assert.equal(seen[0].ok, true, 'turn 1 responded: ' + JSON.stringify(seen[0]));
    assert.ok(seen[0].threadOut, 'turn 1 established a codex thread id');

    await new Promise((res) => h.send('What was the secret word? Reply with just the word.', res));
    await waitFor(() => seen.length >= 2, 120000);
    assert.equal(seen[1].threadIn, seen[0].threadOut, 'turn 2 RESUMED the thread turn 1 opened');
    assert.match(seen[1].response, /banana/i, 'the agent recalled the secret across turns: ' + JSON.stringify(seen[1]));
  } finally {
    h.stop();
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function waitFor(pred, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out waiting for the codex turn'));
      setTimeout(tick, 200);
    };
    tick();
  });
}
