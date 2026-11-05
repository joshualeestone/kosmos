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

/* #7212: a text still not cleared this long after it was first seen is said once, with why the sweep keeps waiting
   (a gate, a busy delivery, an unreadable box, not idle). Those were silent, so a box stuck for a week left no line. */
const SAY_WAITING_MS = 30 * 60 * 1000;

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
 *         stuckMs, log(line), now?(), heldBehind?(card) -> bool, noteHeld?(card, now), clearHeld?(sessionName) }. Returns
 *         the tick (async; resolves when this pass is done).
 */
function makeTick(deps) {
  const told = new Map();   // sessionName -> 'since|outcome|because' last logged, so a text left in place is said once
  /* sessionName -> since of a text already saved whose box would not empty (keys rebound, vim mode): not tried again
     while the same text sits there, so it is not cleared at again every minute. A new text has a new since. */
  const gaveUp = new Map();
  const waitedSaid = new Map();   // #7212: sessionName -> since already said as still waiting
  const notedHeld = new Set();   // #8021: sessionNames this sweep has counted, so it can take back what it began
  const sayWaitingMs = Number.isFinite(deps.sayWaitingMs) ? deps.sayWaitingMs : SAY_WAITING_MS;
  let running = false;
  return async function tick() {
    if (running) return;   // a slow pass (a clear waits between reads) is never overlapped by the next minute's
    running = true;
    try {
      if (!deps.allowed()) return;
      let roster = null;
      try { roster = deps.roster(); } catch { roster = null; }
      const now = deps.now ? deps.now() : Date.now();
      /* #8021: nothing kept any more and no line landed (kept messages age out with no verdict): nothing else would end
         a streak this sweep began, and its old start would date the next unrelated failure. */
      for (const s of [...notedHeld]) {
        let still = false;
        try { still = !!deps.heldBehind({ sessionName: s }); } catch { still = true; }   // unreadable: not known to be gone
        if (!still) { notedHeld.delete(s); try { deps.clearHeld(s); } catch { /* next time it fails, it starts from then */ } }
      }
      const cards = stuckCards(roster, now, deps.stuckMs);
      const names = new Set(cards.map((c) => c.sessionName));
      /* Both kept while the agent is on the board at all (a minute busy does not forget them); a new text has a new since. */
      const onBoard = new Set((Array.isArray(roster) ? roster : []).map((c) => c && c.sessionName));
      for (const m of [told, gaveUp, waitedSaid]) for (const k of [...m.keys()]) if (!onBoard.has(k)) m.delete(k);
      for (const card of cards) {
        /* #8021: messages kept behind a full box never reach a delivery verdict (messages.js keeps them first), so a box
           that stays full was never a stall: one card sentence, nothing on the phone. Each pass with some kept counts as
           one verdict, so the stall's line, push and end come from the one place they already do. Before the give-up skip
           below: a box this sweep gave up on is the one that most needs saying. */
        try { if (deps.heldBehind && deps.noteHeld && deps.heldBehind(card)) { deps.noteHeld(card, now); notedHeld.add(card.sessionName); } } catch { /* next pass */ }
        const since = card.unsentInput.since;
        if (gaveUp.get(card.sessionName) === since) continue;
        let r;
        try { r = await deps.recover(card, since); } catch (err) { r = { outcome: 'waiting', because: 'failed: ' + String((err && err.message) || err) }; }
        if (!r || r.outcome === 'waiting') {   // tried again next minute; not news, until it has gone on half an hour
          const waited = now - Date.parse(since);
          /* 'empty': the box has emptied since the card was read, so nothing is stuck to say. */
          if (waited >= sayWaitingMs && waitedSaid.get(card.sessionName) !== since && !(r && r.because === 'empty')) {
            waitedSaid.set(card.sessionName, since);
            /* A thrown error's message is free text: logged as its kind only. */
            const because = !r || !r.because ? 'no answer' : String(r.because).startsWith('failed:') ? 'failed' : r.because;
            try { deps.log(`stuck-input: ${card.name || card.sessionName} (${card.sessionName}) text unsent in its input box ~${Math.round(waited / 60000)} min: not cleared yet, still waiting (${because})\n`); } catch { /* best effort */ }
          }
          continue;
        }
        if ((r.outcome === 'drafted-not-cleared' && !r.retry) || r.giveUp === true) gaveUp.set(card.sessionName, since);
        const mins = Math.round((now - Date.parse(since)) / 60000);
        const key = since + '|' + r.outcome + '|' + (r.because || '');
        if ((r.outcome === 'left' || r.outcome === 'drafted-not-cleared') && told.get(card.sessionName) === key) continue;
        told.set(card.sessionName, key);
        const what = r.outcome === 'pressed' ? 'pressed Enter on the line Kosmos had left there'
          : r.outcome === 'drafted' ? (r.already ? 'the same text was already kept as a draft in its conversation; cleared the box'
            : 'saved the text as a draft in its conversation and cleared the box')
            : r.outcome === 'drafted-not-cleared' ? 'saved the text as a draft in its conversation; the box was not cleared (' + (r.because || 'unknown') + ')'
              : 'left the text in the box (' + (r.because || 'unknown') + ')';
        try { deps.log(`stuck-input: ${card.name || card.sessionName} (${card.sessionName}) text unsent in its input box ~${mins} min: ${what}\n`); } catch { /* best effort */ }
      }
    } finally { running = false; }
  };
}

module.exports = { makeTick, stuckCards, SAY_WAITING_MS };
