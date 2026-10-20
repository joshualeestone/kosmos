'use strict';

/**
 * kosmos#6717: the board's minute sweep that clears text stuck unsent in an idle agent's input box.
 *
 * #6249 made the card say when text has sat in a Claude Code agent's input box (status unsentInputOf sets the card's
 * `unsentInput.since`). That only told a person to open the agent and press Enter, and an agent stayed deaf until one
 * did. This sweep picks the cards whose box has held the same text for STUCK_INPUT_MS while idle and hands each to
 * chat.recoverStuckInput, which presses the board's own line or saves anything else as a draft and clears the box.
 *
 * One line in the board log per recovery, and one per text it had to leave (not every minute). Gated like the other
 * sweeps: inert under test and before the live-execution opt-in. Never throws.
 */

/* Which cards to try now: a Claude Code card, idle, whose box has shown the same text for at least `stuckMs`. */
function stuckCards(roster, now, stuckMs) {
  if (!Array.isArray(roster)) return [];
  return roster.filter((c) => {
    if (!c || c.state !== 'idle' || !c.sessionName) return false;
    if (String(c.runner || 'claude') !== 'claude') return false;
    const since = c.unsentInput && typeof c.unsentInput.since === 'string' ? Date.parse(c.unsentInput.since) : NaN;
    return Number.isFinite(since) && now - since >= stuckMs;
  });
}

/**
 * deps: { allowed() -> bool, roster() -> cards, recover(card, since) -> Promise<{ outcome, because?, id? }>,
 *         stuckMs, log(line), now?() }. Returns the tick (async; resolves when this pass is done).
 */
function makeTick(deps) {
  const told = new Map();   // sessionName -> 'since|outcome|because' last logged, so a text left in place is said once
  let running = false;
  return async function tick() {
    if (running) return;   // a slow pass (a clear waits between reads) is never overlapped by the next minute's
    running = true;
    try {
      if (!deps.allowed()) return;
      let roster = null;
      try { roster = deps.roster(); } catch { roster = null; }
      const now = deps.now ? deps.now() : Date.now();
      const cards = stuckCards(roster, now, deps.stuckMs);
      const names = new Set(cards.map((c) => c.sessionName));
      for (const k of [...told.keys()]) if (!names.has(k)) told.delete(k);
      for (const card of cards) {
        const since = card.unsentInput.since;
        let r;
        try { r = await deps.recover(card, since); } catch (err) { r = { outcome: 'waiting', because: 'failed: ' + String((err && err.message) || err) }; }
        if (!r || r.outcome === 'waiting') continue;   // tried again next minute; not news
        const mins = Math.round((now - Date.parse(since)) / 60000);
        const key = since + '|' + r.outcome + '|' + (r.because || '');
        if (r.outcome === 'left' && told.get(card.sessionName) === key) continue;
        told.set(card.sessionName, key);
        const what = r.outcome === 'pressed' ? 'pressed Enter on the line Kosmos had left there'
          : r.outcome === 'drafted' ? 'saved the text as a draft in its conversation and cleared the box'
            : r.outcome === 'drafted-not-cleared' ? 'saved the text as a draft in its conversation; the box was not cleared (' + (r.because || 'unknown') + ')'
              : 'left the text in the box (' + (r.because || 'unknown') + ')';
        try { deps.log(`stuck-input: ${card.name || card.sessionName} (${card.sessionName}) text unsent in its input box ~${mins} min: ${what}\n`); } catch { /* best effort */ }
      }
    } finally { running = false; }
  };
}

module.exports = { makeTick, stuckCards };
