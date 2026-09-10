# release-diff-summary-615 - release notes derived from the diff, so an uncarded fix surfaces

Card: kosmos#615 ("A fix that rides inside another PR, with no card and no message line, is
invisible to every search we run"). Splinter ratified Shape B (diff-derived, not a trailer
convention) and Josh can override.

## The problem (#615)

A drive-by fix that rides inside another PR, with no card and no line in the commit subject,
exists only in the diff. The two instruments we search - `git log --grep` over commit
SUBJECTS, and the board - are blind to it by construction. Angel could only find one such fix
(the 30s-hang fix inside "The page gate goes green (#39)") by reading the diff. That does not
scale and fails precisely on the fixes nobody planned.

## Shape decisions

- **B, not A.** A `Fixes:` trailer convention (A) is discipline-dependent: it fails silently
  the moment someone forgets, which is the exact failure #615 names. Deriving from the DIFF (B)
  cannot regress that way - an unmentioned fix appears because its FILE appears.
- **Target: the bump commit BODY, not a file.** Splinter first named post-release-notes.sh; on
  reading it that is the SOCIAL poster (a diff --stat there would be a tweet), so he re-ratified
  "internal cut artifact via release.sh." I then found release.sh:393 aborts the cut if the tree
  is dirty after the bump, and dist/ is the Vercel deploy source. The strictly-safer internal
  artifact that avoids BOTH hazards is the bump commit's own body: a second `-m` on the commit
  release.sh already makes. It writes no file (no clean-tree risk, no dist/ deploy-exposure),
  stays in the private code repo's history (never the tweet, never the public versions.html
  note), and directly repairs the instrument #615 named - `git log --grep '<path>'` now finds
  the release via the changed file. This is within Splinter's ratified "internal, file/area-
  level, via release.sh"; documenting it because he pictured a file. Josh can swap to a file.
- **File/area-level only.** `git diff --stat=1000,1000` - paths + line COUNTS, never hunk
  content. The wide width keeps real paths from truncating (paths are what a reader greps).
  A content-leak guard test asserts a secret line in a change never reaches the summary.
- **Range = prior-shipped .. pre-bump HEAD.** The served pointer (latest.json) is version-only
  (`{"version":"0.6.05"}`) and records NO sha, so the prior version's sha is derived from
  release.sh's OWN distinctive `v<ver> -- version` bump subject (release-authored, anchored -
  not the arbitrary-card-number --grep hazard the bulletin warns about).

## What was built

- `tools/lib/release-diff-summary.sh` - `kosmos_release_diff_summary <repo> <from> <to>` (the
  file/area-level summary, returns 1 on an unresolvable ref) and `kosmos_release_bump_sha
  <repo> <version>` (the prior sha from the anchored bump subject, returns 1 if absent).
- `tools/release.sh` - the bump commit now carries the summary as a `-m` body, best-effort and
  NON-FATAL: it only adds a body when it can compute one, writes no file, and never dirties the
  tree (so the -DIRTY guard cannot trip). Wrapped so a missing lib / unresolvable range simply
  falls back to the current single-line bump.

## Verification

- `tools/test-release-diff-summary.sh` (13 arms): the summary names changed files incl. an
  uncarded one; a control unchanged file is absent; the content-leak guard; unresolvable refs
  return 1 with no output; the bump-sha lookup is anchored (a body-mention decoy does NOT match)
  and returns 1 when absent.
- `tools/test-release-bump-body-615.sh` (8 arms): extracts the shipped release.sh #615 sub-block
  and drives it - the bump body surfaces the drive-by file, `git log --grep '<path>'` now finds
  it, the content-leak guard holds, the tree stays CLEAN, and with the lib ABSENT the bump still
  commits (best-effort). Both wired into `test:shell`.

## Not verified by me / weakest premise

- The full release cut is not runnable in a bot session, so the release.sh integration is proven
  by extract-and-drive + the clean-tree/best-effort guards, not by a live cut. Routes to the
  next real cut for live confirmation (release owner).
- Weakest premise: the prior sha comes from the bump SUBJECT. A hand-edited or absent bump commit
  yields no sha, and the step degrades to no-body (never an error). Recommended follow-up: record
  the sha in the pointer so the range needs no grep.
