'use strict';

/**
 * #6173: moving agents to another account, several at once, without holding the board once per agent.
 *
 * Settings' Move used to send one `POST /api/agent/<name>/account` per agent, and each ran a synchronous restart
 * inside the request, so moving eight agents froze the board eight times in a row. Here the request does only the
 * fast part (each agent's account write) and answers; the restarts then run one at a time through
 * `remove.restartAsync`, without blocking the board's thread on the Mac, and Settings reads how each went from the move's record.
 *
 * 🛑 ONE MOVE AT A TIME. While a move's restarts run, a second move (bulk or one agent's own Move) is refused with a
 * sentence, never run beside it: two moves interleaving restarts on the same agents is the #3418 class.
 *
 * ⚠️ THE RECORD LIVES IN MEMORY. A board that restarts mid-move loses it, and the read then answers 404. Settings
 * reads that as "not confirmed" for every agent it had not heard back about, never as moved.
 *
 * ⚠️ ON WINDOWS AND LINUX each restart still runs synchronously (their job acts are not written as steps yet), so the
 * board still freezes for one restart at a time there (#6183). And on every platform the request itself makes each
 * agent's account write before it answers; on Windows and Linux that write rewrites the agent's job synchronously
 * (schtasks, the user unit), so a large move holds the request for those writes there too.
 */

const crypto = require('node:crypto');

const MAX_NAMES = 200;
const KEEP_MS = 10 * 60 * 1000;   // a finished move stays readable this long, then is forgotten
const KEEP_MAX = 20;
/* Liu Kang m5496: a move holds updates, board restarts and the Kosmos switch, so it must END. Two bounds:
   - each agent: remove.restartAsync caps itself at 300 s; AGENT_CAP_MS is a backstop above it, for a restart whose
     promise never settles at all, so one agent can never hold the move longer than this.
   - the whole move: after MOVE_CAP_MS no further agent is started; the ones not reached are said as not restarted.
   So a move ends within MOVE_CAP_MS + AGENT_CAP_MS (65.5 minutes), and releases every hold when it does. A restart
   given up on keeps its own hold in remove.js until its last command has ended (each is bounded by its own limit). */
const AGENT_CAP_MS = 330 * 1000;
const MOVE_CAP_MS = 60 * 60 * 1000;
const BUSY = 'Another account move is still running. Try again when it has finished.';
/* #6173 review 2: what a board restart (a Kosmos switch, the restart button, an update) says while a move runs. A board
   that restarts between an agent's bootout and its bootstrap leaves that agent unloaded (the #3418 class). */
const BOARD_BUSY = 'An account move is not finished with its agents yet, and this would restart the board under them. Try again in a few minutes.';   // also true while a restart it gave up on still has a command running (review 7)
const BOARD_GOING = 'The board is about to restart (an update or a restart is under way), so no agent was moved. Try again when it is back.';
const NONE_RUNNING = 'No account move is running.';

const moves = new Map();   // id -> record
let running = null;        // the id whose restarts are still running

function busy() { return running !== null; }
function busyBecause() { return BUSY; }
function boardBusyBecause() { return BOARD_BUSY; }
function boardGoingBecause() { return BOARD_GOING; }

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
    ...(m.stopped ? { stopped: true, ...(m.current && !m.done ? { waitingFor: m.current } : {}) } : {}),
    agents: m.agents.map((a) => ({ name: a.name, outcome: a.outcome, ...(a.because ? { because: a.because } : {}),
      ...(a.account ? { account: a.account } : {}) })),
  };
}

/**
 * Start a move. Answers { status, body } for the route.
 *
 * deps: setAccount(name, dir) -> create.setAccount's answer; REFUSED (create.OUTCOME.REFUSED); moveRefusal(name) ->
 * null, or { because } for an agent a restart still holds (remove.moveRefusal; #6190: asked before the write);
 * forget(name) (observed.forgetAgent); restartAsync(name, cause) -> remove's answer; RESTARTED (remove.OUTCOME.RESTARTED);
 * hold(names) and release(name) (remove.holdForMove / releaseFromMove); boardRestarting() -> true while an update or a
 * board restart is under way (the move is then refused).
 * #6214: readAccount(name) -> the account folder the agent's job is saved on now (null: the default account; throws
 * when it cannot be read), and putBack(name, dir) -> create.setAccount's answer. Both only for a stop (`stop` below):
 * without readAccount, a stop cannot put an agent back and says so.
 * Returns the restarts' promise too (`done`), for tests; the route does not wait on it.
 */
function start(body, deps) {
  if (busy()) return { status: 409, body: { outcome: 'refused', because: BUSY } };
  if (typeof deps.boardRestarting === 'function' && deps.boardRestarting()) return { status: 409, body: { outcome: 'refused', because: BOARD_GOING } };
  const dir = body && body.dir;
  const raw = body && body.names;
  if (typeof dir !== 'string' || !dir) return { status: 400, body: { outcome: 'refused', because: 'we need the account to move them to' } };
  if (!Array.isArray(raw) || raw.length === 0) return { status: 400, body: { outcome: 'refused', because: 'we need the agents to move' } };
  if (raw.length > MAX_NAMES) return { status: 400, body: { outcome: 'refused', because: `that is more than ${MAX_NAMES} agents in one move` } };
  if (raw.some((n) => typeof n !== 'string' || !n.trim())) return { status: 400, body: { outcome: 'refused', because: 'that is not a name we can read' } };
  /* One agent once, however it is spelled: the engine trims a name (create.cleanName), so two spellings are one agent
     and would be restarted twice (review 2). The first spelling is kept, as the page sent it. */
  const seen = new Set();
  const names = raw.filter((n) => { const k = n.trim(); if (seen.has(k)) return false; seen.add(k); return true; });

  const m = { id: crypto.randomUUID(), done: false, startedAt: Date.now(), finishedAt: 0, agents: [],
    stopped: false, current: null, deps };
  /* #6214: the account each agent was saved on before this move, and the one this move saved, as its job reads them.
     A stop puts an agent back only from the second to the first. `ok: false` when a read failed: then it is not put back. */
  const readNow = (name) => {
    if (typeof deps.readAccount !== 'function') return { ok: false };
    try { return { ok: true, dir: deps.readAccount(name) }; } catch { return { ok: false }; }
  };
  for (const name of names) {
    /* #6190: an agent a restart still holds is refused before its account is written, not after (the write used to land
       and only its restart was refused). The move's own hold comes after this loop, so this sees only earlier holds. */
    let held = null;
    /* Fails CLOSED (review 2): a caller that leaves out the check refuses every agent rather than writing past it. */
    try { held = typeof deps.moveRefusal === 'function' ? deps.moveRefusal(name) : { because: 'we could not check whether it is still being restarted' }; }
    catch { held = { because: 'we could not check whether it is still being restarted' }; }   // review 3: a person's sentence, not the error
    if (held) {
      m.agents.push({ name, outcome: 'refused', because: held.because || 'that did not work' });
      continue;
    }
    const from = readNow(name);
    let wrote;
    try { wrote = deps.setAccount(name, dir); }
    catch (err) { wrote = { outcome: deps.REFUSED, because: String((err && err.message) || err) }; }
    if (!wrote || wrote.outcome === deps.REFUSED) {
      m.agents.push({ name, outcome: 'refused', because: (wrote && wrote.because) || 'that did not work' });
      continue;
    }
    try { deps.forget(name); } catch { /* #5959: a move keeps the name, not its sighting */ }
    m.agents.push({ name, outcome: 'pending', wrote, account: wrote.account, from, to: readNow(name) });
  }
  moves.set(m.id, m);
  prune(Date.now());

  const pending = m.agents.filter((a) => a.outcome === 'pending');
  if (!pending.length) {
    m.done = true; m.finishedAt = Date.now();
    return { status: 202, body: view(m), done: Promise.resolve() };
  }
  /* Every agent this move will restart is held from a sync restart until its own turn is over (#6173 review 1): one
     restarted in between by its own page was restarted again when the move reached it. Held before the move is marked
     running, so a hold that throws cannot leave every later move refused (review 2). */
  try { deps.hold(pending.map((a) => a.name)); }
  catch (err) {
    /* Saved, but nothing will restart them: say so for each, and end the move (it never ran). */
    for (const a of pending) {
      try { deps.release(a.name); } catch { /* best effort */ }
      let said;
      try { said = sentence(a.name, a.wrote, { outcome: 'partial', because: `the move could not start (${String((err && err.message) || err)}).` }, deps.RESTARTED); }
      catch { said = { outcome: 'partial', because: 'We saved the account, but the move could not start its restart.' }; }
      a.outcome = said.outcome; a.because = said.because;
    }
    m.done = true; m.finishedAt = Date.now();
    return { status: 202, body: view(m), done: Promise.resolve() };
  }
  running = m.id;
  const agentCap = Number.isFinite(deps.agentCapMs) ? deps.agentCapMs : AGENT_CAP_MS;   // tests shorten these
  const moveCap = Number.isFinite(deps.moveCapMs) ? deps.moveCapMs : MOVE_CAP_MS;
  const done = (async () => {
    try {
      for (const a of pending) {
        if (m.stopped) break;   // #6214: the person stopped it; `stop` has already said and released the rest
        if (a.outcome !== 'pending') continue;
        if (Date.now() - m.startedAt >= moveCap) break;   // the rest are said below as not reached
        m.current = a.name;
        try {
          let back;
          let timer = null;
          const late = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ outcome: 'partial', steps: [],
              because: `its restart did not answer within ${Math.round(agentCap / 1000)} seconds.` }), agentCap);
            /* Unref'd: on the board the server keeps the process alive, so it still fires; on its own it must not hold a
               process open for 330 s (#6226). */
            if (timer && typeof timer.unref === 'function') timer.unref();
          });
          /* Called at once (not a tick later), and a throw from the call itself is a failed restart like a rejection. */
          let started;
          try { started = Promise.resolve(deps.restartAsync(a.name, 'account')); } catch (err) { started = Promise.reject(err); }
          try { back = await Promise.race([started, late]); }
          catch (err) { back = { outcome: 'partial', because: String((err && err.message) || err), steps: [] }; }
          finally { clearTimeout(timer); }
          let said;
          /* A sentence that cannot be worded ends this agent as not confirmed and moves on to the next one. */
          try { said = sentence(a.name, a.wrote, back, deps.RESTARTED); }
          catch { said = { outcome: 'partial', because: 'We saved the account, but could not say how its restart went.', steps: [] }; }
          a.outcome = said.outcome; a.because = said.because; a.steps = said.steps;
        } finally { m.current = null; try { deps.release(a.name); } catch { /* the move must still end */ } }
      }
    } finally {
      for (const a of pending) { try { deps.release(a.name); } catch { /* the move must still end (review 3) */ } }
      /* The move's time cap, or an unexpected throw, leaves one pending here: say so rather than leave it reading as
         still going. */
      for (const a of pending) {
        if (a.outcome !== 'pending') continue;
        let said;
        try { said = sentence(a.name, a.wrote, { outcome: 'partial', because: 'the move ended (it ran out of time, or failed) before it reached this agent.' }, deps.RESTARTED); }
        catch { said = { outcome: 'partial', because: 'The move stopped before it reached this agent.' }; }
        a.outcome = said.outcome; a.because = said.because;
      }
      m.done = true; m.finishedAt = Date.now(); m.deps = null;
      running = null;
      prune(Date.now());
    }
  })();
  /* Nothing waits on `done` in the board, so a throw here must not become an unhandled rejection (#6173 review 1). */
  done.catch(() => {});
  return { status: 202, body: view(m), done };
}

/* #6214: what a stop does with one agent the move had not reached. Its account was saved on the new one when the move
   started, but it was never restarted, so it still runs on the old one: put the saved account back to match (Liu Kang
   m5659: left saved, the next restart for any reason would move it hours later). Only when the saved account is still
   the one this move wrote; a person who changed it since keeps their change. The read and the write are one synchronous
   block, so nothing on the board can change it in between. */
function putBack(m, a) {
  const deps = m.deps;
  const failed = (why) => {
    let said;
    try { said = sentence(a.name, a.wrote, { outcome: 'partial', because: `you stopped the move before its turn, and we could not put it back on its old account (${why}).` }, deps.RESTARTED); }
    catch { said = { outcome: 'partial', because: 'You stopped the move before its turn, and we could not put it back on its old account.' }; }
    a.outcome = said.outcome; a.because = said.because;
  };
  if (!a.from || !a.from.ok || !a.to || !a.to.ok || typeof deps.putBack !== 'function') { failed('we could not read which account it was on'); return; }
  let now;
  try { now = deps.readAccount(a.name); } catch { failed('we could not read its account just now'); return; }
  if (now !== a.to.dir) {
    a.outcome = 'stopped';
    a.because = 'you stopped the move before their turn, and their account had been changed since the move saved it, so we left it as it is now.';
    delete a.account;
    return;
  }
  let back;
  try { back = deps.putBack(a.name, a.from.dir); }
  catch (err) { failed(String((err && err.message) || err)); return; }
  if (!back || back.outcome === deps.REFUSED) { failed((back && back.because) || 'that did not work'); return; }
  const acct = back.account || {};
  const who = acct.name || acct.email || acct.label || 'the account they were on';
  a.outcome = 'stopped';
  a.because = `you stopped the move before their turn. They stay on ${who}.`;
  delete a.account;
}

/**
 * #6214: stop the running move. No further agent is restarted. The one being restarted now is NOT cut (a restart cut
 * between its old job's unload and its new job's load leaves the agent unloaded, #3418): it finishes, within its own
 * cap. Every agent not reached yet is put back on its old account and released at once. The move then ends when that
 * one restart does, which releases the board. Answers { status, body } for the route; a second stop changes nothing.
 */
function stop() {
  const m = running === null ? null : moves.get(running);
  if (!m || m.done) return { status: 409, body: { outcome: 'refused', because: NONE_RUNNING } };
  if (m.stopped) return { status: 200, body: { ...view(m), already: true } };
  m.stopped = true;
  for (const a of m.agents) {
    if (a.outcome !== 'pending' || a.name === m.current) continue;
    try { putBack(m, a); } catch { a.outcome = 'partial'; a.because = 'You stopped the move before its turn, and we could not put it back on its old account.'; }
    try { m.deps.release(a.name); } catch { /* the move's own end releases it again */ }
  }
  return { status: 200, body: view(m) };
}

/* The move as it stands, or null when this board does not know the id (never started here, or the board restarted). */
function read(id) {
  const m = moves.get(id);
  return m ? view(m) : null;
}

function resetForTests() { moves.clear(); running = null; }

module.exports = { start, stop, read, busy, busyBecause, boardBusyBecause, boardGoingBecause, sentence, resetForTests };
