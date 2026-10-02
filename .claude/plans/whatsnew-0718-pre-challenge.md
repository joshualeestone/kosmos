---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0718
diff_hash: e93f4770c865a629bc539906e6f90b3422ce1494706508455c54ac834071c33a
subdir_audit: passed
timestamp: 2026-10-02T17:09:59Z
converged: true
---

## Challenge loop: 3 blind rounds, Opus and Sonnet alternating; rounds 2 and 3 found only NITs

Each round checked every highlight against the code (origin/main for #4930 and #4926; PR #5042 and branch
guidecap-5029 for the two lines whose PRs had not merged at writing). Ledger in `.claude/plans/whatsnew-0718.md`.

## [BLOCKER] Round 1 (opus)
FIXED B: the hold-to-talk line announced voice, which has never been announced (#4899 pulled 0.7.16's line) and is
not yet observed working in the Mac app (#4409); dropped, replaced by #4926. FIXED W: line 3 said Finder (Windows
says File Explorer; over Kosmos+ the button is Download). FIXED W: line 1 overclaimed Windows (win32launch.js does not
write the key). DECIDED W: observing the switch on a Kosmos-launched agent is a condition for the PROD promote, not
for this merge; line 1 comes out first if it is not seen on staging.

## [NIT] Round 2 (sonnet)
NITs only. CONVERGED. NIT TAKEN: line 4 says what the person sees (teammates stop getting an agent's post twice).

## [NIT] Round 3 (opus)
NITs only. CONVERGED, line 4 confirmed against #5001 (the agent re-posted after a false failure; nothing else
duplicated it). LEFT NITs: line 4's title reads broader than the narrow fix; "see it full page" is generous for a
file kind the preview shows only by name and size; two lines share the chat icon.

## Checks
tools/whats-new-check.js 0.7.18: 4 highlights, every line at most 140 characters; no em dash in any spelling.
