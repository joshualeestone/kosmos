# heldwait-9011: an agent's own wait no longer vanishes from its card unexplained (kosmos#9011, part 1)

**Posture:** production

**Finished looks like (part 1):** when a needs_you or blocked the agent raised itself is ended, its card says when and
by what, in plain words, where #8979's restart line and #8991's waiting line are said (the pill's hover and its screen
reader text). Part 2 (a "waiting on review" project state) is a separate branch after this one.

## What resets a held needs_you: measured, not guessed
`selfreport.record` over a standing needs_you the agent raised (`by: 'agent'`, held or not), each follow-up in a sandbox:

| next report | lands? | card afterwards |
|---|---|---|
| the hook's automatic `working` (every PreToolUse, UserPromptSubmit) | refused (#900/#1949) | needs_you stands |
| the hook's automatic `idle` (Stop) | refused (#900) | stands |
| the hook's automatic `needs_you` (a permission prompt) | refused (#2456) | stands |
| the hook's automatic `started` (Claude: a new session, `source: startup` only; the Grok and Gemini bridges: every session start, resume and `/clear` included) | lands | the wait is gone |
| the hook's automatic `stopped` (SessionEnd: a restart, `/clear`, a quit) | lands | the wait is gone |
| the agent's own `kosmos report clear` (a working report with clear) | lands | gone (it closed the question) |
| the agent's own report of anything else | lands | gone, as a side effect: the instructions say to raise needs_you and carry on, so a later plain report (working, idle) replaces it. The likeliest silent reset. |
| a person's clear (`by: operator`), or leaving the project | lands | gone |

The board's reconcileReport keeps a reported needs_you over a working or idle screen (probed), so the reset is in the
record, never the reading. On this Mac's records no held question exists (0 rows) and the 3 deliberate waits on file
were each ended by the agent's own report, so which path the reporter hit is not known; every path now says itself.

## Decided
- **A new session still retires the old wait.** That is Josh's ruling #5943 (2026-10-12 09:34: "when an agent restarts
  as a new session, retire the needs_you its PREVIOUS session reported, or ask the new session to confirm it"), pinned
  by engine/answeredq-5943.test.js, and I hit the same wall on #8634 (its carry branch was dropped for it). The new
  session is reminded (awaydigest.lastWait, #8634). The card's ask "only the person or the agent clears it" therefore
  holds within a session (the guard above) but not across one, by Josh's design; what was missing is that it was silent.
- **So the card says it.** selfreport.latestOf carries `waitCleared` { at, by, state, held } from the same tail read()
  already reads (no extra file read per poll); status.waitClearedOf puts it on the pane and paneless card for 12 hours;
  stateReason says it on an idle or working card, low: after #8979's restart line and after every sentence that asks the
  person to act (crash loop, no message reached it, unsent text, one long step, #5154's give-up; review round 2):
  - "Its question for you was closed at 2:02 PM by the agent itself." (its `kosmos report clear`, now kept on the line
    as `cleared`; review round 4) / "... was dropped at 2:02 PM when it reported something else." (any other report
    of its own) / "... closed ... by you." / "... when it left the project."
  - "Its question for you was set aside at 2:02 PM when it started again." / "... when its session ended."
  - "What it was waiting on ..." for a blocked.
  Fixed words, never the old question's.

## Rejected
- Refusing an automatic `started`/`stopped` over an agent's own wait (carrying it across a restart): reverses #5943.
- Reading a cleared wait from a second, longer history read on every poll: the 64 KB tail read() already reads holds it.
- Saying a cleared PERMISSION prompt (the hook's own needs_you): nobody raised it, and its end is the turn moving on.
- A card line for a legacy row with no author: provenance unknown, so nothing is claimed.

## Found and not fixed here (named on the card)
- `/clear` (SessionEnd then SessionStart `source: clear`) and a resume after a clean quit (SessionStart `resume`): the
  `stopped` retires the wait, and no `started` follows, so the away reminder (asked only after `started`) is never given.
  The card now says "when its session ended". On Windows a supervisor `--resume` after a crash sends no SessionEnd, so
  the wait survives there.

## Residual
- A card with no pane carries waitCleared too, but it usually reads stopped, and the sentence speaks only on an idle or
  working card, so there it is mostly carried and not said (review round 5). Nothing false shows.
- "by you" assumes the person who pressed Clear is the board's person; anyone holding the board token can press it.
  A removed project reads "when it left the project", which is close to true.
- 12 hours is kept although a busy agent will have done other things since (review round 2 suggested shorter): the
  card's whole complaint is a person coming back to find the wait gone with no word, so the word must outlast an
  evening away.
- A person's Clear on a provider block that was covering the agent's own question reads "closed ... by you": true
  (the question is gone), though the person acted on the block they could see.

- The Grok and Gemini bridges (bin/grok-report-bridge.js, bin/gemini-report-bridge.js) send `started` on every
  SessionStart and never read `source`, so on those runners a resume or `/clear` retires the agent's own wait too. Not
  changed here: what those runners send in `source` is not measured. The card's words say "started again", which is
  true either way. Named on the card as a follow-up.

## Weakest premise
That 12 hours is the right span to show it: long enough to be seen after an evening away, short enough not to explain
yesterday's question forever. And that the 64 KB tail holds the wait: a very busy agent's wait can scroll out of it, and
then nothing is said (as for askedAt).

## Tests
- engine/waitcleared-9011.test.js: each kind kept; refused hook reports leave none; a new wait starts over; a blocked
  named; a provider block and the hook's permission wait not said; the 12-hour window and a future time; the page
  sentence per kind, after #8979's line, idle or working only, never on the tile, never the old words. Mutations: the
  page sentence off fails 1 test; the record tracking off fails 2.
- server.waitcleared-9011.test.js: over the real /api/report route, a clear is kept as closed, a plain report as
  dropped, the hook's working ends nothing. Mutation: the route's clear pass-through off fails it.
- engine/status.waitcleared-9011.test.js: the real status.snapshot() puts waitCleared on a pane card and a paneless
  card (controls: a standing wait and a stop with no wait carry null). Mutation: both cards fed waitClearedOf(null)
  fails both tests.
- docs/browser-checks/render-waitcleared-9011.js (+ gated.txt, README): 92 PASS headless; page sentence off: 40 FAIL.
- engine selfreport/status/awaydigest/answeredq/restartcard suites 836/836; web*.test.js 3857/3857; server.test.js 368/0.
