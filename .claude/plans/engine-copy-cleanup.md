# Plan: engine-copy-cleanup

Project board card "Engine copy: 28 user-facing sentences are written for
someone with a terminal," verified against the live checker rather than
the stale patch file it links to
(`Josh-Brain/Projects/kosmos-engine-copy-PATCH-2026-08-20.md`, which
claimed 44 hits and a 6-remaining target). Ran the actual current
checker first: `python3 Projects/kosmos-design/jargon.py --engine`
reports **9** hits today, not 44 -- most of the patch's own scope was
already fixed by earlier work. This branch closes the current, real
list to 0.

## Change

Three files, `engine/*.js` only:

- `engine/delete-leftover.js` (5 hits, all "startup job"): the four
  user-facing sentences in the leftover-deletion dialog ("Its startup
  job, so nothing tries to start it again", "Move/Delete the startup
  job...", "A startup job for X is still on this computer...") and the
  one `move()` label all become "auto-start file" -- a concrete,
  non-jargon noun for the same thing (the launchd plist on disk), kept
  parallel to how the folder branch of the same dialog already reads.
- `engine/projects.js` (2 hits): "that folder is inside a temporary
  directory" -> "...temporary folder" (the sentence already says
  "folder" twice elsewhere, this makes it three for three); "and told
  it in its pane" -> "and told it on its screen". Also updated the
  file-header doc comment that quotes this exact sentence verbatim, so
  the comment doesn't go stale next to the string it describes.
- `engine/sandbox.js` (2 hits, both on one line): this is the
  half-sandboxed startup refusal (`server.js`'s `sandbox.audit()`
  check) -- it writes to stderr and calls `process.exit(2)` BEFORE the
  server starts listening, so it never reaches a browser screen; its
  only reader is a developer standing up a sandboxed test environment,
  who needs the literal env var name (`AGENT_WORKFORCE_TMUX_BIN`)
  intact. Added a `jargon-ok:tmux` marker (verified it actually
  suppresses the hit) and reworded "a real agent's pane" -> "a real
  agent's live terminal" for the pane hit, since jargon.py's own
  `\bpanes?\b` pattern strips to a form (`panes?`, literal trailing
  `?`) that its `jargon-ok:` marker mechanism can never capture (the
  marker's own regex is `[a-z ]+`, which cannot contain `?`) -- so no
  marker text could ever suppress that specific pattern. Documented
  this in a comment rather than silently reword with no explanation.

## Found but explicitly out of scope

`server.js:1166-1176` carries the same "startup job" jargon in three
live, real user-facing sentences (the stray/orphan-agent detection
row) -- but `jargon.py --engine` only globs `engine/*.js` at the repo
root, never `server.js`, so this was never flagged and is a real,
separate gap. `web/index.html:15920` and `:16060` also mention
"startup job," but both are inside comments, not rendered copy --
confirmed, no change needed there. Filing the server.js finding as its
own issue rather than folding it into this branch, since it needs its
own verification pass and this branch's diff hash is already scoped to
exactly what jargon.py --engine flagged.

## Verification

- [x] `KOSMOS_REPO=<this worktree> python3 Projects/kosmos-design/jargon.py --engine`:
      0 hits (was 9).
- [x] `node --test engine/delete-leftover.test.js engine/projects.test.js
      server.projects.test.js server.stray-removable.test.js
      server.leftover-removable.test.js engine/create.test.js
      engine/remove.test.js server.test.js`: 650/650 pass. Two
      assertions and one test title updated to match the new copy
      (`p.loses[1]`, `told.because`, and the doc comment quoting it);
      everything else was already independent of the changed strings.
- [x] `node --test engine/sandbox.test.js web.delete-leftover.test.js`
      (the direct test files for the two remaining changed functions,
      caught as a coverage-list gap by challenge-loop iteration 1):
      15/15 pass, both unaffected by the copy change.
- [x] Grepped for leftover references to the old copy across
      `.js`/`.html`: only comments, test descriptions, and a genuinely
      separate `server.js` surface remain, all accounted for above.

## Challenge-loop iteration 1 fixes (beyond the original scope above)

- `engine/projects.js`'s second doc comment (directly above
  `toldOverride`, missed because the file-header comment was the one
  explicitly checked) still said "tells the agent in its pane" -- fixed
  to "on its screen", matching the string it describes.
- The file-header comment's own line-number citation for the changed
  string was stale even before this branch (said `:2131`, the real
  line is `:2155`) -- fixed since the comment was already being
  touched for the wording change.
