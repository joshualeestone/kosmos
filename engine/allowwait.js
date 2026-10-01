'use strict';
/* kosmos#4640: a second computer on a Kosmos+ account waits for the older computer's Allow, and
   meanwhile the coordinator refuses its relay ticket with 403 code own_lineage. The tunnel words that
   as a refusal, `Kosmos+ refused this Mac: <sentence> (HTTP 403 on /v1/mac/relay-ticket, code
   own_lineage)`, which the page would print as a fault. It is a wait, not a fault: engine/remote.js
   status() gives it its own state, 'waiting-allow', and engine/remote-report.js classifies it the same
   way. Both ask THIS module, which is pure (no store, no process) so the report's tests can load it
   without loading remote.js.
   ⚠️ COUPLING, stated because it crosses a repo: the prefix, the parenthesis shape and the fallback
   sentence are kosmos-relay's words (crates/tunnel/src/coordinator.rs refusal line, words.rs
   REFUSED_PREFIX, coordinator/src/macs.rs own_lineage sentence). A tunnel from before the code was
   added writes the same line with no `, code ...`, so that spelling is matched on the coordinator's
   sentence AND the 403 on the ticket path together. A reworded sentence there reads as an ordinary
   refusal again (fails toward today's behaviour, never toward hiding a real fault).
   The device word is not matched: the relay's line names the device ("this Mac" today), and nothing
   here shows that word to a person (only the reason sentence after the colon is read). */
const ALLOW_WAIT_LINE = /^Kosmos\+ refused this \S+: (.+) \(HTTP (\d{3}) on (\S+?)(?:, code ([A-Za-z0-9_]+))?\)\.?$/;
const ALLOW_WAIT_SENTENCE = 'this computer is not allowed yet; allow it from your other computer first';

/** The waiting-to-be-allowed refusal's sentence, or null. */
function allowWaitSentence(line) {
  if (typeof line !== 'string') return null;
  const m = ALLOW_WAIT_LINE.exec(line.trim());
  if (!m) return null;
  const [, said, http, path, code] = m;
  // The code alone is not enough (#4640 review): own_lineage also carries two FINAL refusals ("was not allowed on your
  // account", and "no other computer ... is left to allow it"), which must stay refusals, never read as a wait.
  if (!said.startsWith(ALLOW_WAIT_SENTENCE)) return null;
  const waiting = code === 'own_lineage'
    || (code === undefined && http === '403' && path === '/v1/mac/relay-ticket');
  return waiting ? said.trim() : null;
}

module.exports = { ALLOW_WAIT_SENTENCE, allowWaitSentence };
