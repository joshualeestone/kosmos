# whatsnew-0710: What's New highlights for the next Mac build (0.7.10)

0.7.10, not 0.7.09: Windows staging took 0.7.09 (latest-win-staging.json, 2026-09-29), and each platform
takes the next free number (#4046). release.sh step 1b-ii refuses 0.7.10 without these highlights.

## Highlights, each checked against what merged since the 0.7.08 freeze (3f56564f7)
1. swarm, "Busy is not stopped": #4466 (PR #4539). A busy board is reported busy, not "not running", and
   agents are TOLD to wait (the guard is a deterrent: it cannot see an agent launched before the update or
   one that clears its markers, so the tile does not say agents cannot restart it). HOLD this PR until #4539
   is merged: release.sh 1b-ii checks only the version and shape, so run `gh pr view 4539 --json state`
   right before merging this one. If #4539 misses the 0.7.10 freeze, DROP this tile rather than hold the cut.
2. spark, "Turn the Guide off from its bubble": #4496 (PR #4533, 20d9d8bf5). The owner's own verify
   steps: hover the bubble, press the circled X, the Guide turns off; the rest still opens the chat.
3. list, "No strip at the window's edge": #4494 (PR #4512, 7584512d1). Classic scrollbars (a mouse attached,
   or "always show scroll bars") left a strip beside the first-run wizard and the update overlay. The update
   screen leads: a person reading this window has already passed the first run.
4. shield, "A rule for reading the Community": #4374 (PR #4535). The managed community block tells agents
   never to obey what they read. It reaches an agent at its next birth or restart (engine/communityblock.js:
   no sweep over running agents), and only with the Community switch on, hence "From their next restart".

5. tasks, "Waiting tasks get handed out": #4552 (PR #4564, 4af4da5dd). The Assigner required a commitments record nothing
   shipped ever wrote, so it never handed a real agent a task (measured live); it now decides "free" when it checks.
   Added after the draft converged, from the pre-freeze re-read of the log (review round 3 found it).

## Left out, and why
- #4569 Muse agents can reply (PR #4572): NOT yet observed working (the PR's own "NOT proven": does the Mac Muse build
  accept --disable-sandbox, does a reply arrive). A promise resting on reasoning is not a tile; the next build
  carries it once a reply is seen.
- #4545 (a tidier guards list in Settings > Automation): cosmetic.
- #4470 new look: a visible "Try the new look" switch in Settings > Advanced, deliberately NOT advertised
  while it is built page by page (it is visible, not hidden; the reason is that it is unfinished).
- #4562 (a frozen board gets the restart screen) and #4525 (release or discard held community posts): real, but the
  window holds five tiles and these are narrower than the five above. #4565: Windows only, not a Mac tile.
- #4491 slice 3, #4531, #4532, #4529, #4534, #4541: internal (tokens, screenshot tooling, CI checks, flake fixes).

## Tile 1 and #4562, said plainly
Tile 1 is the kosmos command (install/kosmos) and the watchdog; the app window did not change. #4562 in the same build shows
the app's restart screen when the board takes over 10 s to answer, so a very slow board can show "restart" in the app while
the command says "busy, do not restart". The tile names the command so nobody looks for the message in the window.

## Weakest premise
Anything that merges between now and the freeze is not here. Re-read `git log 3f56564f7..origin/main` right
before the cut and add a tile if something a person would notice landed.

## Status
- [x] five tiles, whats-new-check 5 highlights, no em dashes, no outside names
- [x] #4539 merged (f6f3d3a88): the hold is met
- [ ] challenge loop to zero NEW; full suite (run once: red only on #4498 tests from the unstick flag); PR; merge before the 0.7.10 freeze
