# kosmos#2969: a Mac installed from staging keeps following staging

## Why
Josh's laptop (josh0925-150pm), 2026-09-28 09:16 CDT: Settings > Updates read "BETA · version 0.7.03 · Up to date" while latest-staging.json served 0.7.05 and latest.json 0.6.99. 0.7.03 was only ever on staging, so it was installed with KOSMOS_UPDATE_CHANNEL=staging. But the board's launchd job (install/setup.sh) carries HOME, PATH, LANG and KOSMOS_PORT and no channel, and engine/update.js updateChannel() read only the environment, so the board polled latest.json from its first start. 0.6.99 is not newer than 0.7.03, so the card said "Up to date." The #3100 boot warning named this state, but only on stderr.

## Call
- engine/update.js updateChannel(): on the Mac, an unset or empty AGENT_WORKFORCE_UPDATE_CHANNEL and KOSMOS_UPDATE_CHANNEL now fall back to <store.ROOT>/source-channel, which setup.sh already writes on every install and update. An explicit variable still wins; 'staging' is staging and any other value is prod, as before. A missing, unreadable or unexpected stamp is prod. Windows is unchanged (it reads only KOSMOS_UPDATE_CHANNEL and has no stamp).
- One parser for the stamp: readSourceChannelAt(root) in update.js; server.js recordedSourceChannel() uses it.
- A readable staging look on the Mac also reads the prod pointer, and the newer build is the offer (review 1: release.sh cuts straight to prod by default and never touches latest-staging.json, so staging can be BEHIND prod). The installer is spawned with KOSMOS_UPDATE_CHANNEL = the pointer the offer came from (installPointer), so it installs exactly the version the card offered, and KOSMOS_SOURCE_CHANNEL = the subscription, which setup.sh now stamps, so a staging box taking a prod hotfix stays on staging. An UNREADABLE staging answer is still never retried against prod (unchanged). A prod subscriber still reads exactly one pointer.
- web/index.html paintUpdateCard: the verdict names the channel it checked: "Up to date on the staging channel." / "Up to date on the release channel." A channel the page was not told keeps "Up to date." rather than guess.
- server.js #3100 warning: now reachable only with an explicit non-staging variable, so its text names that override instead of the old "not carried across login".
- #2934 coupling, decided: a staging subscriber on a build prod has since published reads STAGING until the next staging build. True answer to "which builds will this box get".

## Rejected
- Making every prod cut also advance latest-staging.json (keeping "staging >= prod" true by tooling). It depends on every pointer writer (release.sh, promote-channel, publish-staging-pointer, a hand edit) keeping the invariant; the client comparison holds by construction.
- Writing the channel into the launchd plist. It is a second copy of the same fact that can disagree with the stamp, it only reaches boxes on their next install, and the stamp is already the single funnel both install paths share.
- A NODE_TEST_CONTEXT guard on the stamp read. The #3100 and #2934 wiring tests run grandchild processes that inherit it, so it would have kept the old behaviour exactly where the new one is tested. The tests that exercise the default sandbox the data root instead.

## Weakest premise
That source-channel is written only by the installer and means "the pointer this box should follow". A box installed from staging stays a staging subscriber until someone reinstalls it with a plain prod line (which rewrites the stamp to prod). That is also how to leave the beta, and it is the behaviour a tester expects.

## What would change the call
A box whose stamp says staging but whose owner never chose staging (for example a stamp written by a test or a copied data folder). Then an explicit prod variable is the override, and the #3100 warning names it.

## Evidence
- engine/update.win32-check.test.js: the fallback against the REAL stamp read (sandboxed store.ROOT), an empty variable is unset, an explicit variable wins, Windows unchanged, trimmed/lowercased, five non-staging contents stay prod, the seam resets; a staging-stamped Mac with no variable fetches latest-staging.json, with a no-stamp control that fetches latest.json. All four #2969 tests (with the two below) are red with the fallback removed.
- server.sourcechannel-promote-2934.test.js: the arms that claim the prod-pointer comparison now set channel 'prod' explicitly (without it they would pass through the staging-pointer rung and test nothing they name); new arm: staging stamp, no variable, polls staging, badge STAGING.
- server.staging-revert-warn-2036.test.js: new arm: staging stamp, no variable, resolves staging, no warning; the revert arms set an explicit prod variable; the message names the override.
- web.win32-update-offer.test.js: release and staging sentences, and the untold-channel arm; 4 tests red with the old sentence restored.
- docs/browser-checks render-updates-stale.js and render-update-win32-manual.js: current-state controls expect the named channel (run in 6j by tools/browser-checks.sh; a hand-started board is refused on this box).

## Review rounds
- Round 1 (Opus): WARNING my "staging is always at or ahead of prod" claim was false (a prod-only cut), so a staging subscriber would sit on "Up to date" past a prod hotfix. Fixed: the prod comparison, installPointer and KOSMOS_SOURCE_CHANNEL above; test red without it. WARNING engine/update.test.js read the real machine's stamp (red on a staging-stamped box): sandboxed, as is engine.update-poll-1945.test.js (a staging look is two fetches). Checked by running every test file that drives the updater under a staging-stamped ambient data root: all pass except one that the half-sandbox guard refuses to load under that probe (its children are fully sandboxed). CONVENTION three comments made false: rewritten. NITs taken: the env-vs-stamp note on updateChannel, browser-check header prose, a note on server.test.js's untold-channel arm. NIT deferred: the verdict names updateChannel() at paint time rather than the look's own cache.channel; they differ only if the stamp or environment changes between a look and a paint.
- Round 2 (Sonnet): CONVERGED. Checked installPointer against a stale or cross-channel cache (it falls back to the subscription), readProdAlongside can only add an offer and never erase a staging answer, prodPublishesRunning keys on the subscription and not the pointer, Windows is untouched, old and new setup.sh against old and new boards both degrade safely, the wire-test extraction is asserted byte for byte. No BLOCKER, WARNING or CONVENTION.
