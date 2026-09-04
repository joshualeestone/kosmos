# First-run name-step fixes (Josh live test, 2026-09-04)

Branch: `firstrun-namestep-1994wiz`. Owner: Mona Lisa. Splinter-routed from Josh's live first-run
test (name/identity step). Ref: Josh #admin msg 1545459091105652736. web/index.html only.

## Goal / done-condition

Three presentation fixes to the first-run WIZARD name step (`frPaintYou` -> `#fr-you`):
1. Restore the timezone picker (regression; Josh: "our time zone picker got taken away").
2. Size the name input so it is not full-width (Josh: "looks like a mistake, should not be full width").
3. Remove the copy "Continue saves this into every agent already set up on this computer, so they all
   address you the same way." (Josh: "that is nonsense copy, take that out").

## What I changed (web/index.html + two tests)

1. Timezone picker: added `<select id="fr-you-tz">` to `frPaintYou`'s markup, populated with the same
   zone set Settings uses (`Intl.supportedValuesOf('timeZone')` / `YOU_TZ_FALLBACK`), defaulted to
   `youTzMachine()`, prefilled from `GET /api/settings .timezone`. Saved on Continue via
   `POST /api/settings {timezone}` in `go()` (awaited + blocking before advancing, consistent with the
   `/api/you` PUT; it always carries a value so it never blocks a person who did not touch it).
2. Name input width: `#firstrun #fr-you-name, #firstrun #fr-you-tz { max-width: 20rem }` (max-width
   caps the `.inp` width:100% without an out-specify). "What do you do?" keeps full width (a sentence).
3. Removed the `#fr-you-reach` copy line and its #1772 comment.

Two prior guards contradicted Josh's live reversal and were updated (not weakened):
- `web.firstrun-you-reach-1772.test.js`: #1772 added the reach copy; Josh removed it. Rewritten to
  assert the copy is GONE (guard against re-adding) and keep the still-true `syncEveryone`-reach
  invariant.
- `web.firstrun-you-behaviour.test.js` (#1345 "exactly two labelled fields"): restoring the tz picker
  makes three (name, does, tz). Updated to 3 + assert `fr-you-tz`; extended `stubDoc`
  (options/appendChild/insertBefore/createElement/activeElement) and passed `youTzMachine` +
  `YOU_TZ_FALLBACK` into the lifted painter so the real `frPaintYou` runs under the drive.

## Key decisions
- tz save is awaited but BEST-EFFORT on Continue: we await the POST so it lands in the normal case,
  then advance regardless of its outcome. Rejected "blocking" (my first pass): two independent blind
  reviews flagged that gating the whole first-run step on a tz-save failure is a wart, because the tz
  value is the machine default the person need not have touched, and stranding them over it (with a
  message about a field they did not interact with) is worse than advancing with the default
  uncaptured. The name/does record they actually entered still blocks on its own failure, and the tz
  picker also lives in Settings for correction. Also rejected fire-and-forget-without-await (would not
  give the save a chance to complete before advancing). Weakest premise: a tz-only failure (name/does
  succeed, tz fails) is rare because both hit the same local server microseconds apart and the
  defaulted value can never 400 (validTimeZone round-trips the same Intl), so best-effort almost never
  actually drops the zone; if that assumption is wrong and tz saves fail often, a user could finish
  first-run without a saved zone and not know it (recoverable in Settings).
- The tz value is always persisted on a successful Continue (machine default included). This changes
  the prior "timezone is null until the operator sets one" contract and makes the Settings tz screen's
  first-visit "Save to confirm" hint not appear after first-run. Deliberate and correct: capturing the
  operator's zone so agents know local time is the whole point of restoring the picker here, and the
  hint is unnecessary once the zone is saved. Conscious accept, not a silent change.
- Restoring the tz picker reverses #1345's "exactly two fields" -- deliberate, on Josh's live
  instruction, recorded on both tests.
- Also capped the restored tz select width for a consistent, non-full-width look (Josh only named the
  name box, but a full-width restored picker would read the same way).

## Verification
- Smoke (real headless browser): copy gone; name input computed max-width 320px (20rem); tz select
  present, 418 zones, defaulted to the machine zone.
- All name-step-related node tests pass (firstrun-you, firstrun-you-behaviour, firstrun-a11y,
  found-every-path, firstrun-you-reach-1772).
- Committed headless browser-check docs/browser-checks/render-firstrun-namestep-1994wiz.js: DONE,
  registered in tools/browser-checks.sh and docs/browser-checks/README.md. Proven RED against the
  pre-#1994 page (10 of 12 arms fail); it captures the real POST /api/settings to prove the save
  wiring, and reads computed max-width so a stale CSS rule reds.
- Full run-tests.sh: PASSED green (the release cut-guard reds seen once were confirmed contention
  from a concurrent suite's install harness, green when re-run alone).
- Challenge-loop: converged (no new BLOCKER/WARNING/CONVENTION on the final pass); proof file at
  .claude/plans/firstrun-namestep-1994wiz-pre-challenge.md.
