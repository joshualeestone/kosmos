'use strict';

/**
 * The setup assistant on Kosmos's own model, the Mac side (#3660).
 *
 * Until a person has connected a model of their own, the bubble's questions go to the
 * coordinator (login.kosmosplus.com), which adds our key and asks a small model with a
 * fixed prompt (kosmos-relay `coordinator/prompts/setup-assistant.md`, Ice Cream
 * Kitty's). Once they connect a model, the guide agent exists on it (ensureGuide,
 * engine/setup-assistant.js) and the bubble talks to that instead; this path is then
 * no longer used.
 *
 * 🔑 THE CONTRACT (agreed on #3660; the coordinator's `docs/coordinator-api.md`, "The
 * setup assistant"): `{ messages: [{ role, content }], page? }`, at most 8 turns of 2000
 * characters, alternating, starting and ending with the person's; `page` at most 1000
 * characters. The answer is `{ reply, remaining }`, or a refusal `{ error, code?,
 * retry_after_secs? }`, where `error` is already a sentence for the person.
 *
 * 🔑 NO CRYPTO HERE: the tunnel's `assistant-chat` verb picks the key and signs
 * (engine/remote.js assistantChat). This module shapes the request, retries once when
 * the coordinator says to, and turns every outcome into one shape the bubble reads.
 */

const remote = require('./remote');
const pagecontext = require('./pagecontext');

const MAX_TURNS = 8;
const MAX_CHARS = 2000;
const PAGE_MAX = 1000;

/* The codes a retry can help with (the coordinator gives the message back on these).
   A retry must be signed again a second later: a signature is good once, and the same
   body in the same second signs to the same bytes (ICK, 20:04). */
const RETRY_CODES = new Set(['assistant_upstream', 'assistant_busy', 'replayed']);
const RETRY_WAIT_MS = 1100;

/**
 * The conversation as the contract wants it, or a refusal. Keeps the LAST turns (the
 * person's newest message is the one being asked), drops any leading assistant turn so
 * it starts with the person, and refuses rather than cuts an over-long message.
 *   { ok: true, messages }   |   { ok: false, because }
 */
function shapeMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, because: 'write something to ask the setup assistant' };
  const turns = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return { ok: false, because: 'we could not read that conversation' };
    }
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > MAX_CHARS) return { ok: false, because: `keep each message to ${MAX_CHARS} characters or fewer` };
    turns.push({ role: m.role, content });
  }
  /* Two turns in a row from the same side keep the NEWEST: a person who asks again after
     an error (no answer came) would otherwise be refused for the rest of the thread. */
  const merged = [];
  for (const t of turns) {
    if (merged.length && merged[merged.length - 1].role === t.role) merged[merged.length - 1] = t;
    else merged.push(t);
  }
  turns.length = 0;
  turns.push(...merged);
  if (!turns.length || turns[turns.length - 1].role !== 'user') return { ok: false, because: 'write something to ask the setup assistant' };
  let kept = turns.slice(-MAX_TURNS);
  if (kept[0].role !== 'user') kept = kept.slice(1);
  return { ok: true, messages: kept };
}

/* The screen ONLY, in the in-app guide's own words (pagecontext.describe's "Screen:"
   line), or nothing. The names that ride with a page (an agent, a project, a tab) are
   the person's and stay on this Mac: this goes to our coordinator and its model
   provider before the person has connected anything of their own. A page Kosmos does
   not know is left out, not refused: the question still stands without it. */
function pageText(page) {
  if (page === undefined || page === null) return null;
  const d = pagecontext.describe(page);
  if (!d.ok) return null;
  const line = d.text.split('\n').find((l) => l.startsWith('Screen: '));
  return line ? line.slice(0, PAGE_MAX) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask the hosted assistant. Resolves to one shape, never throws:
 *   { ok: true, reply, remaining }
 *   { ok: false, status, because, code, retryAfterSecs, unsupported? }
 * `status` is what the bubble's route answers with. `deps.run` and `deps.wait` are
 * for tests.
 */
async function ask({ messages, page } = {}, deps = {}) {
  const run = deps.run || remote.assistantChat;
  const wait = deps.wait || sleep;
  const shaped = shapeMessages(messages);
  if (!shaped.ok) return { ok: false, status: 400, because: shaped.because, code: null, retryAfterSecs: null };
  const body = { messages: shaped.messages };
  const p = pageText(page);
  if (p) body.page = p;

  let r;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { r = await run(body); } catch (err) { r = { ok: false, because: String((err && err.message) || err) }; }
    /* A TIMEOUT is not retried: the coordinator may have counted the message and be
       answering slowly, and a second try would spend another of today's messages and
       hold the bubble for twice the wait. Only "no answer at all" is retried. */
    const retryable = r && ((r.ok === false && !r.unsupported && !r.timedOut)
      || (r.ok === true && RETRY_CODES.has(r.body && r.body.code)));
    if (!retryable || attempt === 1) break;
    await wait(RETRY_WAIT_MS);
  }

  if (!r || r.ok !== true) {
    if (r && r.unsupported) {
      return { ok: false, status: 501, unsupported: true, because: 'the setup assistant arrives with the next Kosmos update', code: null, retryAfterSecs: null };
    }
    return { ok: false, status: 502, because: 'we could not reach the setup assistant just now; try again in a moment', code: null, retryAfterSecs: null };
  }
  const b = r.body || {};
  if (r.status === 200 && typeof b.reply === 'string') {
    return { ok: true, reply: b.reply, remaining: Number.isInteger(b.remaining) ? b.remaining : null };
  }
  return {
    ok: false,
    /* Only the statuses the bubble acts on pass through: 429 (a limit, with its wait)
       and 503 (resting or busy). Anything else from upstream is 502, because on this
       board 401 and 403 already mean "sign in to the board" (#2023) and must never be
       read as that. The coordinator's reason still rides in `code`. */
    status: r.status === 429 || r.status === 503 ? r.status : 502,
    /* The coordinator's own sentence, already written for the person. */
    because: typeof b.error === 'string' && b.error ? b.error : 'the setup assistant could not answer that',
    code: typeof b.code === 'string' ? b.code : null,
    retryAfterSecs: Number.isInteger(b.retry_after_secs) ? b.retry_after_secs : null,
  };
}

module.exports = { MAX_TURNS, MAX_CHARS, PAGE_MAX, RETRY_CODES, shapeMessages, pageText, ask };
