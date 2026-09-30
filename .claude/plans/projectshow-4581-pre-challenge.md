---
pre_challenge: true
method: challenge-loop
branch: projectshow-4581
diff_hash: eb3cd613358c9df54b70831d7427db0cdf5a43a99de005f48ded104d3d1959b5
validation: passed
subdir_audit: passed
timestamp: 2026-09-30T06:09:38Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 separate blind reviewers (Opus and Sonnet alternating), after the loop's own review pass
**Converged:** Yes (round 6: nothing above NIT)
**Total findings acted on:** 1 BLOCKER, 16 WARNINGs, several NITs
**Fixed:** every BLOCKER and WARNING | **Deferred:** 0 (named residuals in the plan) | **Asked:** 0

Severity tags are reconstructed from each round's fix commit and the plan. Full validation: clean on Mortals at
f11283dc8 after main (with #4609's queue fix) was merged in, recorded for hash eb3cd613358c (2026-09-30 06:09Z).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs
- [WARNING] an agent folder that cannot be found read "none yet", which the PM role would raise as a missing summary --> FIXED (17702f695): "we do not know where its folder is"; a symlinked summaries/ reads unreadable
- [WARNING] no summary read should reach a member not tied to its pane --> FIXED (17702f695)
- [WARNING] double quotes inside the brief could close the quotation and read as Kosmos's words --> FIXED (17702f695): single quotes
- [WARNING] a non-JSON answer exited 0 --> FIXED (17702f695): exit 1 on both CLIs

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs
- [WARNING] a stopped member was kept off its own folder --> FIXED (a4fec5a03): only a live stranger holding the name is
- [WARNING] show said "not running" for everyone when the board could not read its agents --> FIXED (a4fec5a03): "state unknown" with a caveat
- [WARNING] a wrong-shaped JSON answer read as empty --> FIXED (a4fec5a03): refused, exit 1
- [WARNING] Unicode tag characters (readable by a model, invisible to a person) passed through --> FIXED (a4fec5a03)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs
- [BLOCKER] round 2's scrubber damaged real text (family emoji, flags, Persian and Indic spellings) and changed the folder path --> FIXED (f985eb2ee): drop only what hides or reorders text; the folder prints exactly, with "?" for a carrier
- [WARNING] a symlinked agent folder read "no folder" --> FIXED (f985eb2ee): unreadable
- [WARNING] the summaries cap counted names, not files --> FIXED (f985eb2ee)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs
- [WARNING] the flag exception kept any run of tag characters, so a fake flag carried a hidden instruction --> FIXED (fa32f1b84): only a real subdivision flag (4 to 6 tags); an unbounded run fails the test
- [WARNING] a future-dated file hid a real current summary --> FIXED (fa32f1b84)
- [WARNING] the Mac's no-node fallback exited 0 on a body that is not JSON --> FIXED (fa32f1b84)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs
- [WARNING] runs of joiners or variation selectors were still a zero-width channel --> FIXED (5849ed9af): runs of three or more removed; a flag's pair kept
- [WARNING] the two 500 paths had no tests --> FIXED (5849ed9af): removing the server's try fails one
- [WARNING] hitting the scan bound with no file found read "none" --> FIXED (5849ed9af): unreadable

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 4 NITs
- [NIT] a member not running shows "family unknown" --> STATED in the plan
- [NIT] the Mac CLI's refusal text is cut at an escaped quote (display only) --> STATED
- [NIT] the brief's done section is found inside a code fence and ends at a `---` in the person's text --> STATED
- [NIT] with KOSMOS_BIND_HOST set on purpose, a remote agent with its own token can read these routes --> STATED (consistent with any agent reading any project)
