# Plan: #2406 — context ring resolves an imported agent's transcript by its on-disk canonical path

## Problem
Josh's 0.6.45 re-test: the context-window ring around an agent icon reads
"<name>'s memory could not be read. We cannot find a transcript for it." for
running imported/seed agents — BOTH Claude ("rust-starter-template", Claude
Sonnet 5, Idle) and OpenAI agents, together. His biggest punch-list item.

## Root cause (reproduced in-session)
`engine/status.js byWorkdirDetailed` locates an agent's transcript at
`projects/<flatten(recordedDir)>/` and matches with a strict
`transcriptCwd(f) === recordedDir` — both halves use the RAW recorded path from
`store.readProfile(name).dir`.

But the agent is launched through the launchd `WorkingDirectory = workerDir(name)`
key (create.js:1866), and Claude Code writes its transcript under
`projects/<flatten(process.cwd())>/`, where `process.cwd()` (getcwd) resolves
CASE and SYMLINKS. So a folder recorded as `.../work` but stored on disk as
`.../Work` (Josh named the seed folder "Work") has its transcript under
`projects/<flatten("...Work...")>/`, while the reader looked in
`projects/<flatten("...work...")>/` — a different directory (flatten is
case-sensitive) — and found nothing. It is a property of the PATH, not the
runtime, which is why both providers' rings broke together.

This is the same divergence already fixed for the codex trust key in #2129/#5
(create.js `trustCodexFolder`), which uses `trust.canonicalOnDisk`. The
transcript-read path never got the same treatment.

## Reproduction (faithful sandbox, with a passing control)
Modelled the runner writing under `canonOf(recordedDir)` with `cwd =
canonOf(recordedDir)`. Old code: aligned control FOUND, collision guard refuses
(both correct), but the symlink / trailing-slash / case-variant arms all return
NO_TRANSCRIPT. That is the bug.

## Fix
In `byWorkdirDetailed`, canonicalize the recorded dir with
`trust.canonicalOnDisk` (realpathSync.native + case recovery + `/private` twin,
path.resolve fallback when the folder is gone) before flattening AND before the
cwd compare. Search both `flatten(canon)` and `flatten(raw)` (deduped) and match
when `cwd === raw` OR `cwd === canon` OR `canonicalOnDisk(cwd) === canon`.

Strictly additive: with no divergence canon is the resolved raw path, so the
common case is unchanged. The two-paths-flatten-to-one collision guard is
preserved because distinct real paths stay distinct under canonicalOnDisk.

## Tests
`engine/status.context-ring-canon-2406.test.js`: aligned control, symlink
(FS-portable), trailing slash, case-variant (skipped on case-sensitive FS), and
the collision guard. Proven armed: fails the 3 divergence arms on old code,
passes all on the fix; controls behave correctly both ways.

## Scope
Fixes the CLAUDE transcript-read half. The OpenAI ring has a second, separate
half (codex agents write rollout files, not `.jsonl`; `readContext` reads only
`.jsonl`) tracked at #2257 — not this PR. Weakest premise: the exact divergence
on Josh's box is unconfirmed (a lookup I will not put on him); the fix is robust
to all normalizations, so it is worth shipping regardless, and Josh re-tests the
ring after deploy. If a seed agent still reads "could not find a transcript"
after this, the remaining candidate is the import flow not recording
`profile.dir` (Renet's #1652 lane).
