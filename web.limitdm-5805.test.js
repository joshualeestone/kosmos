'use strict';
/* #5805 slice 2b: only the DM thread composer (which shows a held row and Send now anyway) is held; the terminal
 * composer and the assistant bar post with anyway: true, typed straight in as before, since they have no held state.
 *   node --test web.limitdm-5805.test.js */
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits
{
  // The Send now anyway test installs a fleet card, so the agent roots are sandboxed (never this machine's agents).
  const os = require('node:os');
  const SANDBOX = require('node:fs').realpathSync(require('node:fs').mkdtempSync(require('node:path').join(os.tmpdir(), 'aw-weblimitdm-5805-')));
  for (const [k, n] of [['AGENT_WORKFORCE_HOME', 'home'], ['AGENT_WORKFORCE_DATA', 'data'], ['AGENT_WORKFORCE_WORKERS', 'workers'], ['AGENT_WORKFORCE_PROJECTS', 'projects'], ['AGENT_WORKFORCE_LAUNCH', 'launch']]) {
    process.env[k] = require('node:path').join(SANDBOX, n); require('node:fs').mkdirSync(process.env[k], { recursive: true });
  }
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = require('node:path').join(SANDBOX, 'claude.json');
  process.env.AGENT_WORKFORCE_TMUX_BIN = require('node:path').join(__dirname, 'test-support', 'fake-tmux.sh');
  process.env.AGENT_WORKFORCE_DRY_RUN = '1';
}
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('#5805 2b review 2: every non-automatic POST to a thread route says whether it may be held', () => {
  const posts = [...PAGE.matchAll(/encodeURIComponent\(([A-Za-z.]+)\) \+ '\/thread', \{[\s\S]{0,400}?body: JSON\.stringify\(([^)]*)\)/g)].map((m) => m[2]);
  assert.ok(posts.length >= 3, 'CONTROL: the thread POSTs were not found: ' + posts.length);
  const anyway = posts.filter((b) => /anyway: true/.test(b));
  assert.equal(anyway.length, 2, 'the terminal composer and the assistant bar must send anyway: true: ' + JSON.stringify(posts));
});

/* The page's own function, lifted out of index.html and run (not a copy of it). */
function lift(name, scope) {
  const m = PAGE.match(new RegExp('\\n(async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  const keys = Object.keys(scope);
  return new Function(...keys, m[0] + '\nreturn ' + name + ';')(...keys.map((k) => scope[k]));
}

test('#5805 2b review 3: a held row the sweep could not type says why, after why it is held', () => {
  const words = lift('dmHeldWords', { quotaResetWords: undefined });
  const plain = words('casey', { state: 'held', heldUntil: null });
  assert.doesNotMatch(plain, /tried/, 'CONTROL: a row never tried says it was tried');
  const stuck = words('casey', { state: 'held', stuck: { because: 'its screen waits on a question.', at: 'x' } });
  assert.match(stuck, /out of usage\. Kosmos sends it after the reset\. Kosmos tried to send it and could not: its screen waits on a question\.$/);
  assert.match(words('casey', { behind: true, stuck: { because: 'no window' } }), /while it was out of usage\. Kosmos tried to send it and could not: no window\.$/);
});

test('#5805 2b review 3: Send now anyway says the route\'s refusal under the box instead of silently re-enabling', async (t) => {
  const fleet = require('./test-support/fleet');
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);   // a real card (fixture discipline)
  t.after(() => board.restore());
  const card = board.agents.find((c) => c.sessionName === 'casey');
  assert.ok(card, 'CONTROL: the fleet card');
  const say = { textContent: '' };
  const run = async (res) => {
    say.textContent = '';
    const painted = [];
    const send = lift('dmHeldSend', {
      CURRENT: card,
      fetch: async () => res,
      document: { getElementById: (id) => (id === 'd-say-msg' ? say : null) },
      paintTalk: async (s) => { painted.push(s); },
    });
    const btn = { disabled: false, textContent: 'Send now anyway', dataset: { heldAt: 't' } };
    await send(btn);
    return { btn, painted };
  };
  const failed = await run({ ok: false, status: 500, json: async () => ({ error: 'the thread is busy.' }) });
  assert.equal(say.textContent, 'Not sent: the thread is busy.');
  assert.equal(failed.btn.disabled, false);
  assert.deepEqual(failed.painted, []);
  // A refusal with no reason in it says so in words: never a bare status number on screen.
  const bare = await run({ ok: false, status: 503, json: async () => { throw new Error('not json'); } });
  assert.equal(say.textContent, 'Kosmos could not send it. Try again.');
  assert.doesNotMatch(say.textContent, /\d/, 'a status number reached the screen');
  assert.equal(bare.btn.disabled, false);
  const gone = await run({ ok: false, status: 409, json: async () => ({ error: 'no longer held' }) });
  assert.equal(say.textContent, '', 'CONTROL: a 409 (sent or dropped meanwhile) repaints, it is not an error');
  assert.deepEqual(gone.painted, ['casey']);
});
