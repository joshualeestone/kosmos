# codexleak-6362: the two Codex tests stop leaving processes writing in their kts- dirs (#6362 slice 2)

Renet's full run (2026-10-17, flakes-6432 at 11ea03a4) failed its leak check with two kts- dirs that "survived" their
exit sweep, named by slice 1's owner file: engine/codexhooks-5812.test.js and engine/orgchartcodex.capture.test.js.
Both run the real Codex.

## Measured (Agent1s, codex-cli 0.149.1), and what is not
- **The cause, measured twice (19:14 and 19:17):** after engine/codexhooks-5812.test.js passed (21/21), six git processes
  were still running under the test's kts- dir, reparented to init: Codex's plugin sync, `git fetch --depth 1` into
  `<CODEX_HOME>/.tmp/plugins-clone-*`, and its index-pack. Still there 20 s later.
- **Correction (review 9, which watched a live sync):** the git processes are in **Codex's** process group, not one of
  their own, and index-pack names the dir too (`--shallow-file <dir>/...`). In codexhooks-5812 Codex is not detached,
  so that group is the test's own: the pgid read at 19:14 was the test runner's, misread as theirs. My group-kill try
  "failed" because a non-leader Codex pid is not a group id (ESRCH), not because of a separate group. The fix handles
  the real shape (an orphan inside the test's own group, by the descendant path), and a test now covers it.
- **The sync is intermittent:** in five later runs (three with the fix, two of main) it never started; a preload logged
  every cleanup call finding 0. So "0 survivors with the fix" is not evidence on its own (review 1), and the fix's
  effect on a live fetch is **reasoned, not measured**. Its pieces are measured: test-support.stray-processes.test.js
  ends a detached process naming the scope, its child (which names nothing) with it, and leaves a prefix-sibling path
  and another dir alone; a mutant that kills nothing fails it.
- engine/orgchartcodex.capture.test.js: its leak was not reproduced here; same Codex, same fix (reasoned).

## What changes
- `test-support/stray-processes.js`: `killUnderScope()` finds every process whose arguments name this file's tmpscope
  dir (as the whole path or a path under it, /var or /private/var spelling; `ps -Awwo`, as `-e` on a Mac appends the
  environment, where TMPDIR is the scope) and SIGKILLs its process group, or, when the group is the test's own, the process and its descendants; then waits until none of them is
  running (a zombie is not). It takes no dir: the only one it searches for is the scope tmpscope made, so it cannot
  reach another run on a shared Mac. (Reviews 5 and 6 each found a way past a check on a caller's dir; rather than a
  third check, the parameter is gone.) names() treats only an absolute path as a spelling ('' looped, '.' matched all).
- **Only this test's processes** (reviews 7, 12): a process counts if its parent chain reaches the test (through any number
  of unnamed processes), or it is an orphan
  tree rooted at init whose every step names the dir (the measured git survivors). Another agent's shell that merely
  mentions the path (an `ls` or `tail` of it, which a Bash tool call carries in its arguments) runs up through processes
  naming nothing to its own Claude, so it is left alone. Tested both ways, each with a mutant.
- Passes repeat until one finds nothing new (at most five): a process in our own group can fork between the listing
  and the kill (review 7 measured 152 children left by a single pass).
- **In our own group the tree is stopped (SIGSTOP) and re-listed until no new descendant appears, then killed**
  (review 10): a child forked between a listing and its parent's death was orphaned out of reach. Measured with a
  forker naming the scope in our group, forking a sleep every 10 ms: the previous commit left an orphaned child in 2 of
  8 runs, this one in 0 of 8 (leftovers matched by exact command only).
- A path is bounded by anything but a letter, digit, ".", "_" or "-" (so "~", "+", "@" bound it too: harmless, the
  name is random), or by a short option glued to it (-C/path, -xC/path).
- Not handled: a path on the second line of a multi-line argument (ps prints it as a new line); low risk, noted.
- Both Codex tests call `killUnderScope()` when Codex finishes: the whole scope, as run 3 of codexhooks gives Codex a
  linked home that Codex resolves to its real path (review 1).
- `test-support.stray-processes.test.js` (7 tests: group kill with controls, own group with a child, a named process two unnamed hops below the test, an orphan inside our own group (the codexhooks shape), an unrelated process left alone, an orphan in another group, names()), excluded from the Windows host run with its reason (#1777).

- Waiting counts only RUNNING processes in a group (ps stat, not kill(-g, 0)): on Linux an unreaped zombie keeps the
  group answering (review 2, reasoned; the Mac shows the zombie but kill answers EPERM). **Linux is not measured: no PR
  job runs the node suite on Ubuntu (linux.yml runs only on dispatch or a linux-ci-* push), so the zombie path is
  reasoned only** (review 9 corrected my earlier claim that the PR measured it).

## Decided
- **Kill by the folder named, then by group or by descendants**: in the test's own group, by descendants (a group kill
  would end the test); in another group (orgchartcodex's detached Codex), by group.
- **The whole tmpscope dir, not the paths a test passes**: Codex resolves links, so a passed path can miss.
- **In the two tests, not in tmpscope's exit sweep** (which would cover the class but run ps at every file's exit).
  Reconsider if a leak report names a non-Codex test.

## Weakest premise
That every process writing under the dir either names it or is a descendant of one that does (in our own group) or
shares a group with one that does (elsewhere). git fetch and index-pack both name it; a process that only has the dir
as its cwd, with no such relative, would not be found. The next
leak report's owner names and listing will show if one turns up.
