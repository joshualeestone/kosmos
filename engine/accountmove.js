'use strict';

/**
 * #6173: moving agents to another account, several at once, without holding the board once per agent.
 *
 * Settings' Move used to send one `POST /api/agent/<name>/account` per agent, and each ran a synchronous restart
 * inside the request, so moving eight agents froze the board eight times in a row. Here the request does only the
 * fast part (each agent's account write) and answers; the restarts then run one at a time through
 * `remove.restartAsync`, off the board's thread on the Mac, and Settings reads how each went from the move's record.
 *
 * 🛑 ONE MOVE AT A TIME. While a move's restarts run, a second move (bulk or one agent's own Move) is refused with a
 * sentence, never run beside it: two moves interleaving restarts on the same agents is the #3418 class.
 *
 * ⚠️ THE RECORD LIVES IN MEMORY. A board that restarts mid-move loses it, and the read then answers 404. Settings
 * reads that as "not confirmed" for every agent it had not heard back about, never as moved.
 *
 * ⚠️ ON WINDOWS AND LINUX each restart still runs synchronously (their job acts are not written as steps yet), so the
 * board still freezes for one restart at a time there; it no longer holds the request open across all of them.
 */

const crypto = require('node:crypto');

const MAX_NAMES = 200;
const KEEP_MS = 10 * 60 * 1000;   // a finished move stays readable this long, then is forgotten
const KEEP_MAX = 20;
const BUSY = 'Another account move is still running. Try again when it has finished.';

const moves = new Map();   // id -> record
let running = null;        // the id whose restarts are still running

function busy() { return running !== null; }
function busyBecause() { return BUSY; }

/* The outcome and sentence for one agent's move: the one place both routes (one agent, several) word it. */
function sentence(name, wrote, back, RESTARTED) {
  const ok = !!back && back.outcome === RESTARTED;
  /* #2338: lead with the human-chosen account name (the `.kosmos-name`
     sidecar an OpenAI row carries, #2095), the same value the picker shows,
     falling back to the email/label as before. */
  const account = (wrote && wrote.account) || {};
  const who = account.name || account.email || account.label || 'that account';
  /* #2338: a codex account move is between OpenAI CODEX_HOME dirs, and codex
     conversation history lives INSIDE a home (there is no cross-home symlink,
     unlike Claude's shared history) -- so it does NOT travel, and the Claude
     "Everything it has done comes with it" sentence would be a false promise.
     What DOES travel is everything Kosmos owns: the worker folder, its files,
     role, projects and commitments (an account swap rewrites only CODEX_HOME).
     So the codex sentence is honest about the split rather than silent on it. */
  /* #3566: Gemini and Grok accounts are per-home too (GEMINI_CLI_HOME / GROK_HOME, no
     cross-home link), so their chat stays behind exactly as Codex's does. The word
     names the chat the person would look for. */
  const moveChatWord = ({ openai: 'Codex', google: 'Gemini', xai: 'Grok', alibaba: 'Qwen' })[String(account.provider || '').toLowerCase()];
  const isPerHomeMove = !!moveChatWord;
  return {
    outcome: ok ? 'changed' : 'partial',
    because: ok
      /* Same shape as the model route's sentence, and for the same
         reason: a restarted agent has done nothing, and Josh read that
         emptiness as the change having failed. The history sentence is
         here because it is the one thing a person is right to worry
         about when moving accounts. */
      ? (isPerHomeMove
        ? `${name} runs on ${who} now. It is starting again, and it will look idle `
          + 'until you say something to it. Its files and projects come with it; '
          + `its earlier ${moveChatWord} chat stays with the account it was on.`
        : `${name} runs on ${who} now. It is starting again, and it will look idle `
          + 'until you say something to it. Everything it has done comes with it.')
      : `We saved ${who}, but could not start it again: ${(back && back.because) || 'the restart did not answer.'} `
        + 'It is still on the old account until it restarts.',
    steps: (back && back.steps) || [],
  };
}

function prune(now) {
  for (const [id, m] of moves) {
    if (m.done && now - m.finishedAt > KEEP_MS) moves.delete(id);
  }
  const done = [...moves.values()].filter((m) => m.done).sort((a, b) => a.finishedAt - b.finishedAt);
  while (done.length && moves.size > KEEP_MAX) moves.delete(done.shift().id);
}

/* What the read route answers: the move as it stands. `account` only on the agents that were saved. */
function view(m) {
  return {
    id: m.id,
    done: m.done,
    agents: m.agents.map((a) => ({ name: a.name, outcome: a.outcome, ...(a.because ? { because: a.because } : {}),
      ...(a.account ? { account: a.account } : {}) })),
  };
}

/**
 * Start a move. Answers { status, body } for the route.
 *
 * deps: setAccount(name, dir) -> create.setAccount's answer; REFUSED (create.OUTCOME.REFUSED);
 * forget(name) (observed.forgetAgent); restartAsync(name, cause) -> remove's answer; RESTARTED (remove.OUTCOME.RESTARTED).
 * Returns the restarts' promise too (`done`), for tests; the route does not wait on it.
 */
function start(body, deps) {
  if (busy()) return { status: 409, body: { outcome: 'refused', because: BUSY } };
  const dir = body && body.dir;
  const raw = body && body.names;
  if (typeof dir !== 'string' || !dir) return { status: 400, body: { outcome: 'refused', because: 'we need the account to move them to' } };
  if (!Array.isArray(raw) || raw.length === 0) return { status: 400, body: { outcome: 'refused', because: 'we need the agents to move' } };
  if (raw.length > MAX_NAMES) return { status: 400, body: { outcome: 'refused', because: `that is more than ${MAX_NAMES} agents in one move` } };
  if (raw.some((n) => typeof n !== 'string' || !n)) return { status: 400, body: { outcome: 'refused', because: 'that is not a name we can read' } };
  const names = [...new Set(raw)];

  const m = { id: crypto.randomUUID(), done: false, startedAt: Date.now(), finishedAt: 0, agents: [] };
  for (const name of names) {
    let wrote;
    try { wrote = deps.setAccount(name, dir); }
    catch (err) { wrote = { outcome: deps.REFUSED, because: String((err && err.message) || err) }; }
    if (!wrote || wrote.outcome === deps.REFUSED) {
      m.agents.push({ name, outcome: 'refused', because: (wrote && wrote.because) || 'that did not work' });
      continue;
    }
    try { deps.forget(name); } catch { /* #5959: a move keeps the name, not its sighting */ }
    m.agents.push({ name, outcome: 'pending', wrote, account: wrote.account });
  }
  moves.set(m.id, m);
  prune(Date.now());

  const pending = m.agents.filter((a) => a.outcome === 'pending');
  if (!pending.length) {
    m.done = true; m.finishedAt = Date.now();
    return { status: 202, body: view(m), done: Promise.resolve() };
  }
  running = m.id;
  const done = (async () => {
    try {
      for (const a of pending) {
        let back;
        try { back = await deps.restartAsync(a.name, 'account'); }
        catch (err) { back = { outcome: 'partial', because: String((err && err.message) || err), steps: [] }; }
        const said = sentence(a.name, a.wrote, back, deps.RESTARTED);
        a.outcome = said.outcome; a.because = said.because; a.steps = said.steps;
      }
    } finally {
      /* Only an unexpected throw leaves one pending here: say so rather than leave it reading as still going. */
      for (const a of pending) {
        if (a.outcome !== 'pending') continue;
        const said = sentence(a.name, a.wrote, { outcome: 'partial', because: 'the move stopped before it reached this agent.' }, deps.RESTARTED);
        a.outcome = said.outcome; a.because = said.because;
      }
      m.done = true; m.finishedAt = Date.now();
      running = null;
      prune(Date.now());
    }
  })();
  return { status: 202, body: view(m), done };
}

/* The move as it stands, or null when this board does not know the id (never started here, or the board restarted). */
function read(id) {
  const m = moves.get(id);
  return m ? view(m) : null;
}

function resetForTests() { moves.clear(); running = null; }

module.exports = { start, read, busy, busyBecause, sentence, resetForTests };
