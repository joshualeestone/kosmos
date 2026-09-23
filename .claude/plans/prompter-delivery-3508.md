# #3508 - Restore the Prompter's delivery path (removed by #2623), rebuilt LOCAL

## Problem
The Prompter (heartbeat) sweep still computes which agents have stopped and are worth
a check-in (engine/heartbeat.js `toAsk`), but #2623 removed its ONLY delivery path:
the `check_in` that rode engine/notify.js, a phone-home POST, deleted as telemetry
(Josh, 2026-09-09, "invasion of privacy"). Since then the result reaches no one, and
Settings > Automation honestly said so ("can't nudge you about them yet ... still
being built"). This card builds the replacement delivery: an IN-APP, LOCAL channel.

## Why this is NOT the telemetry Josh removed
The removed seam was a POST off the Mac. This is a local 0600 file with NO endpoint
and NO switch: nothing leaves the machine, so it is not telemetry and needs no
opt-out. The web UI on the same machine reads its own file and renders the question.

## The build (three parts)
1. **Store** - `engine/prompternudge.js` (DONE, committed): a local 0600 file holding
   the current pending nudge set, REPLACED each tick from the heartbeat's `toAsk`
   (`[{ session, from, to }]`). Never throws; a read/write failure degrades to "no
   nudges". Carries only who/from/to, never a sentence (matches the removed payload's
   own rule and the heartbeat header). Unit-tested (store round-trip, 0600 mode,
   REPLACE-not-merge, the store lives under store.ROOT's Kosmos leaf, read/write cap
   symmetry, and the shouldWrite roster-null gate).
2. **Server** - `server.js` (DONE, committed): the runner hook writes each tick's
   `toAsk` to the store (best-effort), and `GET /api/prompter-nudges` returns
   `{ at, nudges, ok }` (read-only, local).
3. **UI** - `web/index.html` (THIS change): the reading end. A self-contained panel
   (`#hb-nudges`) in Settings > Automation under the Prompter control polls
   `/api/prompter-nudges` and renders one check-in per stalled agent. The QUESTION is
   COMPOSED in the UI (`prompterCheckinQuestion`) from who/from/to - "mid-something,
   finished, or stopped?", with a distinct line for `auth_failed` (lost connection).
   The pre-#3508 "can't nudge you yet" copy is replaced with copy that describes the
   check-in it now delivers. Empty -> hidden (costs nothing when nothing is stalled);
   any read failure hides rather than alarms.

## Decisions
- **Minimal, in-lane placement (Settings > Automation), not a global banner.**
  Splinter's call (2026-09-23 16:22): I build the minimal UI myself and keep #3508
  whole rather than routing to Mona (the overloaded UI bottleneck; launch-required
  cannot stall). The panel is one container + one paint function, so a more prominent
  placement later is a pure move (Mona's polish). WEAKEST PREMISE: that a check-in the
  operator only sees when Settings is open is enough delivery for launch. It is a real
  in-app surface and satisfies the card's done-condition; a prominent banner is the
  obvious follow-up if Josh wants it.
- **No privacy/opt-out gate** - the store is local, not phone-home (Splinter + the
  telemetry ruling). Adding one would wrongly imply data leaves the Mac.
- **Question composed in the UI, never stored** - keeps the two-copies-of-one-fact
  defect out and matches the store's contract.
- **Verified by an executable node test, not a Playwright browser-check.**
  `web.prompter-nudges-3508.test.js` extracts and CALLS `paintPrompterNudges` +
  `prompterCheckinQuestion` against fakes (renders the question, hides on empty,
  hides on failure, escapes the name) and asserts the copy no longer promises an
  undeliverable nudge. This runs in `npm test` (no browser dependency) and does not
  touch the browser-check emit-count guard. A `Browser-check:` trailer carries the
  reason on the web/ change.

## Verify by content
- `web.prompter-nudges-3508.test.js` green (executes the functions).
- The Settings copy no longer reads "can't nudge you about them yet ... still being
  built" and now mentions the in-app check-in.
