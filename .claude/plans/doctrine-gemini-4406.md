# #4406: an Instructions box that looks empty, and a way back to the previous version

Branch doctrine-gemini-4406, off origin/main 32511002f. Angel, 2026-09-28 (Josh's Gemini-Test2, priority).

## Finished looks like
- While an agent's Instructions box is loading (for example during a restart, when the board may be slow to
  answer), the box says it is loading. It never looks like an empty file.
- When the previous version of an agent's instructions is kept, the Instructions tab offers "Put the previous
  version in the box". It fills the box with that text and writes nothing. The person's own Save keeps it,
  through the same version check, and that Save keeps today's text as the new previous version, so it can be
  undone the same way.
- Josh can bring back his text without a Terminal if it was ever lost.
- (Splinter 14:58, on the card, after Josh's instructions were confirmed there on reopen: not wiped.) While loading:
  the loading mark and "Loading instructions..." in the box, never an empty editable box; a failed read says so
  with Try again; Save stays off until the content has loaded (already true: the loader holds the box and Save
  until the answer lands, and the server refuses a save under 20 characters; now asserted).

## What was measured first (sandbox, engine on origin/main)
- The Add ("Add Instructions & Restart") on a Gemini agent keeps the person's words, writes GEMINI.md.previous,
  and clears the notice. The restart's one writer (communityblock.tellAgent, #4289) keeps them too. The box and
  the notice read the same file. So no wipe was reproduced; the fix is the two gaps the case exposed.

## Changes
1. engine/instructions.js readPrevious(agent): the `.previous` beside the agent's file, read through
   workerfile.readWorkerFile (the same symlink, containment and size refusals as read), UTF-8 checked like
   inspect. { exists, text, because }.
2. server.js GET /api/agent/<name>/instructions/previous: knownAgent gate, as the instructions GET.
3. web/index.html: the box's placeholder says "Loading these instructions..." while a load is in flight (and
   is cleared when it lands); a button in the d-instr-prev line fills the box from the previous version and
   says nothing is saved until Save.

## Decided
- Fill the box, never write on the press: a restore that writes would be a second write path with its own
  version rules; Save already has them. Rejected: a one-click restore route.
- Not changed: the Add and the restart writers (measured correct).

## Tests
- engine/instructions test: readPrevious returns the kept text; missing -> exists false; a symlink is refused.
- server test for the route (known agent, unknown agent 404).
- browser check: loading placeholder shows while the load is held; the button fills the box with the previous
  text, saves nothing (no PUT), and Save then sends that text with the current version.

## Weakest premise
That Josh's box was empty because its load had not landed. If his file really is empty, this branch still gives
him the way back (the previous version), which is the part that matters.

## Status
- 15:07: built. Engine readPrevious (tests: kept text, none kept, symlink refused); route GET
  /instructions/previous (server.test: kept text, writes nothing, unknown and malformed names 404); page:
  loading line with the Sweep mark + placeholder, Try again on a failed load, a button that fills the box from
  the previous version and writes nothing. Browser check render-detail-header-1841.js gains the #4406 arms,
  with the page's requests answered by the check (the sandbox's stand-in agent is not one the route knows).
- Measured by the check while building: the load is keyed by session name ("beatrix-discord"), not the
  display name; a load that lands after another agent opened now clears the placeholder as well as the line.

## Review round 1 (opus, 15:13)
- Try again stranded focus on the page (the box it moved to is disabled for the load): focus now goes to the
  status line. Arm: Enter on Try again, focus is not BODY.
- The loading line and Try again survived onto another agent's card (untied opens bump no load token): both
  join openDetail's reset and setWritesOffered's untied list, the failed-load path checks the card is still
  this agent's, and Try again refuses an untied card (openDetail's own isNamedOurs test). Arm: untied card.
- A late restore answer could land in a newer load or a disabled box: it now requires the same load token
  and INSTR_READY.
- The restore replaced unsaved typing with no way back: it now refuses while the box differs from the text
  it last loaded or saved (INSTR_LOADED_TEXT), and says why. Arm.
- The loading line is role="status" aria-live, so it is announced. Arm.
- The check now proves what Save sends after a restore: the restored text with the loaded version. Arm.
- Update's reload (#3050) no longer shows two loaders: the loading line stays hidden while its own shows.
- Conventions: the check's comment names server.test.js; the README row names the #4406 arms. NITs: the
  input dispatch is gone (nothing listens on #d-instr); the restore button explains itself when the box is
  not editable; the CSS rule moved below the rule its neighbour comment describes; one ellipsis character.
- The check marks its stand-in card tied (isNamedOurs), the state a real agent's tab is in: the sandbox
  cannot tie it, which is why the route answered 404 there. Stated in the check.
- The first (6.0) validation run was stopped before it finished: iteration 1's findings needed code changes,
  so it would have validated a superseded tree; the validation after these fixes is the baseline.

## Review round 2 (sonnet, 15:27)
- The unsaved-typing guard ran only before the fetch, so typing during it was still replaced (round 1's own
  code): it is asked again after the wait. Arm: the read is held, the person types, the typing stays.
- Round 1's CSS move left the #3731 comment trailing the new rule: the first-run lines are back as they were
  and the #d-instr-prev rule sits above #d-instr.

## Review round 3 (opus, 15:52)
- BLOCKER, the check was flaky: the page's 5 s poll read the sandbox's stand-in as not on the board (and its
  missing file as not editable) and took the editor away mid-arm, so arms passed or failed by where a tick
  landed. The check's /api/status route now keeps the card present and tied with no instructions summary, the
  state a real tied agent's poll is in; a probe with a forced tick before the restore passes.
- A missing instruction file hid the restore (read's missing branch reported no hasPrevious): it now does, and
  the line says the previous version is kept. Engine test with a control.
- The untied arm now drives the real race (a failed load landing after an untied card opened) and Try again's
  refusal on an untied card (no load sent).
- Focus after Try again went to a status line the load then emptied: it moves to the box when the load lands.
- NITs taken: the restore refuses a disabled box; a bad .previous names the previous version, not "its
  instruction file". Left: a second press after a restore is refused as unsaved (reopen drops it); the
  status line keeps tabIndex -1 (harmless).
- The validation after round 2 was red only on engine/musefront.test.js "a long turn keeps saying working",
  not in this diff, the same load-sensitive test that passed alone 15/15 this morning.

## Review round 4 (sonnet, 16:04)
- DEFERRED: a file that exists but is refused (not UTF-8, over the size ceiling, a symlink) does not offer the
  kept previous version. Read on purpose: that branch answers editable:false, so Save is refused there and a
  restore into the box could never be kept; offering it would be the action-that-cannot-finish this screen
  avoids everywhere. What would change it: letting Save replace a refused file, which is its own decision.
- NIT taken: the new route wraps readPrevious in try/catch like the instructions GET beside it. Left: the
  UTF-8 round-trip check is written twice (inspect and readPrevious); both are one line.

## Review round 5 (opus, 16:21)
- BLOCKER: the 5 s poll re-offered the card's writes through setWritesOffered and turned the box and Save
  ON mid-load, so a slow load (the restart case this card is about) gave an empty, editable box whose typing
  the landing load replaced. The box and Save now also wait for INSTR_READY there. The loading and failed-load
  arms now wait past a real poll tick and assert the box and Save are still off.
- The untied reset and openDetail clear the placeholder, so no card says "Loading" for a load it will not make.
- An empty kept file (a failed backup write) is not offered as a previous version (engine test with a
  control), and the restore says "the kept previous version" rather than naming which change it came before.
- NITs taken: focus after Try again moves to the box only when the load leaves it editable; "nothing written"
  counts every non-GET request to /instructions; the check's request listeners are removed after use; the
  check closes first run for sure before its first click (an existing flake: Escape raced the overlay).
- The 6g validation after round 4 was stopped before it finished: this round's blocker needed code changes.
- Measured after the fix: web.made-before.test.js pins openDetail's model-message clear within its first 4000 characters; round 5's three reset lines pushed it to 3971. Compacted to one line (3812) rather than widening that test's window. render-fields.js needs the full runner's board on :4399 and was not run alone.

## Review round 6 (sonnet, 16:35)
- The poll's editable===false branch withdrew the editor but left the restore link up: it hides it too.
- The validation after round 5 was red on server.test "the detail panel withdraws the writes it cannot
  perform": it pinned the old rule (a tied card turns the box on at once). Updated to the new one, both
  sides: tied and still loading keeps the box and Save off (everything else on); tied and loaded turns them
  on. Also red there, unrelated: engine/updating-988.test.js #3626 (hung tunnel), 40/40 alone, not in this diff.
- NITs left: a second restore press is refused as unsaved (accepted in round 5); readPrevious's catch
  passes err.message (house style, unreachable in practice).
