# realroot-5418: a test process never gets this machine's real data root

Card: kosmos#5418 (found by Renet on a fleet Mac, 2026-10-06). Owner: April. Claimed 2026-10-06 15:10 CDT (claim log, 20:10:48Z).

## Mechanism (measured)
38 module-level captures in 35 files freeze `store.ROOT` at require time (measured 2026-10-06; see the store.js comment for the grep) (`const DIR = path.join(store.ROOT, ...)`;
sendertoken.js:58 is the one the card's records came from). `store.ROOT` itself is lazy (#1443), but a
test that requires any of those modules before setting its sandbox gets the REAL root frozen into that
module for the rest of the process, and every write lands in the operator's store.

## Decision (ask 1: make it impossible)
Apply the rule at the derivation, `store.resolveDataRoot()` (review 3 found `store.root()` was not the only one:
`create.supportDir()`, `worlds.baseRoot()` and `tools/selfreport-silence-monitor.js` called
`store.dataRootFor` directly; all four now go through `resolveDataRoot`, so one process always agrees on
one root). Review 5: `boardauth`'s legacy-token read goes through it too (`resolveDataRoot` takes the
leaf), so a test can never load a real legacy token. Left on `dataRootFor` on purpose:
`setup-assistant`'s deny-rule paths (named, never read), `win32uninstall` (its data delete is behind
`liveExecutionAllowed`, convention 3, which a test does not grant), `install/setup.sh`'s consult (an
installer), and `win32anchor` ON WINDOWS (AppData\Local, not the store). Review 11: off Windows the runtime
anchor sits inside the data root, so `anchorDir` takes the rule there (tested in "every caller agrees").
A test process is recognised by NODE_TEST_CONTEXT, KOSMOS_TEST_RUN, or live-execution's own
`inTestProcess()` (`--test*` in execArgv), reused rather than re-derived. The rule:
- A test process is one `node --test` started (NODE_TEST_CONTEXT is set in every file it runs; measured
  `child-v8` on node 26.8.1) or one `tools/run-tests.sh` started (it exports KOSMOS_TEST_RUN as its own
  temp folder, which also reaches its shell tests and whatever they start; see below).
- In a test process, a resolved root equal to the machine's REAL default root, or inside it (a named
  world hangs off it), is never used:
  - with NO sandbox variable set, the store answers ONE throwaway root of that process's own (mkdtemp,
    prefix `kosmos-test-home-<pid>-`), removed at exit (best effort; the next test process to make one sweeps
    the ones whose process is gone, store.sweepDeadTestHomes). It is the store's alone: no environment variable is set, so no other seam changes (an
    earlier version exported AGENT_WORKFORCE_HOME, which agystatus, accounts, codexupdate and others
    also read, and which overrode a HOME set later; review 2 caught it). A child process is a test
    process too and gets its own. The legacy migration is skipped for it, since its target would be
    the real store;
  - with a sandbox variable set that still resolves to the real root or inside it, the same
    throwaway (review 5: it used to throw, but an agent in a named world inherits a world's DATA,
    which is inside the real root, and cannot be told from a test's own variable, so a throw would
    fail every unsandboxed test that agent runs).
- "Real" is derived from `os.userInfo().homedir` (the account's home in the user database), NOT
  `os.homedir()`, which follows $HOME: a test that sandboxes by pointing HOME elsewhere must not be
  refused. On Windows the real root is that home's AppData\Roaming, not the APPDATA variable (a test
  may sandbox it); a machine whose AppData is redirected elsewhere is not recognised.
- Paths are compared by realpath of the nearest existing ancestor, so a symlinked spelling of the real
  home is still the real root.
- The rule runs before the legacy migration, and a throwaway is never migrated (the migration's own target is the real store).
- `KOSMOS_ALLOW_REAL_ROOT=1` is the explicit way out for a process that must read the real store under a
  test runner.

## Rejected
- Making each of the 35 files resolve lazily: whack-a-mole, and the next module re-freezes it.
- Exporting a sandbox AGENT_WORKFORCE_DATA from run-tests.sh for every test: trips the board's #634
  "half-sandboxed" refusal, and does nothing for an agent's direct `node --test` run.

## Ask 2 (cleanup on the fleet Macs)
Separate and later. Destructive to a person's real store, so: dry-run listing first, backup, remove
only entries whose agent is not on the board AND whose dates predate this guard, never a live agent's.

## Tests
`engine/store.real-root-5418.test.js` (also run by the Windows job, `tools/windows-tests.js` ALSO), child
processes with a controlled env, reading paths only: a throwaway under NODE_TEST_CONTEXT and under
KOSMOS_TEST_RUN, with no variable leaking; one per process, one exit listener, removed at exit; HOME set
after the first read honoured; every caller agrees (store.ROOT, create.supportDir, worlds.baseRoot, the
silence monitor); a named world's inherited DATA, a DATA at the real root's parent and the real home
through a symlink all get the throwaway; the legacy leaf is a legacy-shaped throwaway, with boardauth's
read pinned to it; a sandbox by DATA, HOME var or HOME kept; the dead-pid sweep's arms (dead removed; live, malformed name, other folder, unmarked and
another host's kept) plus a separate arm for a link (neither removed nor followed); the
test-support helper and the store agree on "real". Controls: no test marker returns the real root as
before, KOSMOS_ALLOW_REAL_ROOT returns it on purpose. Each arm added in a review round was run against the
previous commit and failed there.

## Blast radius: measured, and why the first version changed
The first version threw in every case. Its full suite on Mortals (5bb6bbbbd): 15373 tests, 122 fail, 121 of
them this refusal, in about 60 files that set no sandbox at all and throw while loading a module that
freezes the root (e.g. selfreport.js:45). Those files were running against the operator's real store.
Rather than edit 60 files (and every future one), an unsandboxed test process now gets an empty
throwaway home, which is exactly what a CI runner's empty real root already gives them. AGENT_WORKFORCE_HOME
is not one of the board's #634 half-sandbox variables, so in-process boards still boot. Checked locally:
web.told-banner, server.socket-split, engine/store and engine/team (all failed under the throw) pass,
43/43, with no throwaway home left behind.

## Existing tests changed
Four controls read the unsandboxed root's PATH on purpose to prove the product's derivation: the CONTROLs
in `engine/store.lazyroot-1443`, `store.dataroot-1820` and `store.dataroot-570`, and the first
`create.supportdir-win32-2039` test. Each now says KOSMOS_ALLOW_REAL_ROOT=1 (with KOSMOS_NO_LEGACY_MIGRATION=1,
so the read cannot run the legacy rename) for that read only. The #2039 source pin accepts
`store.resolveDataRoot(` and pins that `resolveDataRoot` delegates to `dataRootFor`.

## The sweep (review 7: moved into the store, so it works on Windows too)
Throwaway names carry their pid (`kosmos-test-home-<pid>-XXXXXX`). When a test process makes its throwaway,
`store.sweepDeadTestHomes(os.tmpdir())` first removes the ones whose pid answers "no such process"
(ESRCH); a live pid, another user's (EPERM), a name with no pid and anything without the prefix are kept.
It was a bash script called only by run-tests.sh, which Windows never runs; that script is gone.
The four controls that read the real root's path share `test-support/real-root-allowed.js`;
`test-support/data-root-sandbox.js` takes "real root" from the store (one definition, not two).

## Second redesign (review 2): store-only, no environment
Exporting the throwaway as AGENT_WORKFORCE_HOME changed every seam that reads that variable, depending
on which module read the store first, and silently overrode a HOME set later. The throwaway now lives
in store.js only. Cost: a parent and the children it starts no longer share one throwaway; only
unsandboxed pairs that both used the REAL store shared before, and those are this card's leaks.

## What is protected, and what is not (review 4)
- Protected: this account's OS-default root (from the user database), equal or inside, which is where
  the card's records were. Measured in this pane: AGENT_WORKFORCE_DATA and AGENT_WORKFORCE_HOME are both
  unset, so a test started here gets that protection.
- Not protected: a store some OTHER root names, when a shell exports a non-default AGENT_WORKFORCE_DATA or
  AGENT_WORKFORCE_HOME pointing at a live board and a test inherits it. Telling an inherited value from
  a test's own sandbox is not possible from inside the process.
- A sandbox variable aimed at the real root (inherited from a named world, or a test's mistake) gets
  the throwaway; such a test is redirected, not told.
- With no user-database home (os.userInfo throws, some containers) the rule is off.
- On Windows the real root is the account home's AppData\Roaming; a machine whose AppData is redirected
  elsewhere is not recognised, by the store or by test-support/data-root-sandbox.js (one definition now,
  so one known limit rather than two different ones).
- KOSMOS_ALLOW_REAL_ROOT=1 in a test process allows READING the real root and never runs the legacy
  migration on it (pinned in source); a sandbox in the same process still migrates (tested).
- Windows 8.3 short names (RUNNER~1) are not expanded by realpath, so a real home spelled short and long
  can compare unequal (fails open, like the redirected-AppData case).
- The sweep keys on os.hostname(); a Mac whose name changed with its network leaves its earlier
  throwaways unswept (only temp folders, and it keeps rather than removes).
- macOS firmlinked spellings (/System/Volumes/Data/Users/...) are not symlinks, so realpath leaves them
  as they are and a sandbox spelled that way into the real root is not matched.
- The dead-pid sweep removes only a real folder this user owns (lstat, uid), never a link or a file, and
  only one carrying the marker every throwaway is made with (its pid and this host's name) naming a gone
  pid on this host: a folder that merely matches the name, or another host's, is kept. Two pid namespaces
  sharing one tmp, one uid AND one host name could still see each other's live throwaway as dead.
- test-support/data-root-sandbox.js compares with an uncached realpath; the store's own check caches per
  spelling (a link made later under a cached spelling is not seen there).
- Both leaves of the real root are protected (current and legacy), whichever leaf a caller asks about, so a
  sandbox variable aimed into the real legacy folder gets the throwaway too (review 13).
- The rule applies only to this machine's own platform; asking what another platform would use (a Mac
  computing a Windows path) is never redirected and never throws.
- KOSMOS_TEST_RUN is tools/run-tests.sh's own temp folder, exported once TMPDIR is that folder, and it marks
  a test process only when that process's temp folder is it or inside it. The same variable left in a shell
  (any other value) makes nothing a test, so a real board started there is never handed a throwaway
  (review 13; control tested).
- setup-assistant's guideLegacyRoots stays on dataRootFor while its worlds base goes through the rule, so
  in a test process the deny rules name a throwaway current root beside the real legacy one (named only).
- The shell side (bin/agent-supervisor.sh and shell tests deriving the root themselves): #5428.
- A plain `node file.test.js` (no `--test`, no run-tests.sh) sets no marker and is not guarded.
- Under a direct `node --test --test-isolation=none`, the test process is known by its own execArgv only,
  which its children do not inherit: a board or CLI it starts without a sandbox is not guarded.

## Full-suite measurement of THIS design
The 122-failure run was the first (throwing) design. The current design's own full suite runs once on the
final head, and its tally is recorded in `.claude/plans/realroot-5418-pre-challenge.md` (the proof file is
outside the diff it measures; writing the tally here would change that diff). The Windows job runs with the
rule live; PR CI's windows check is that run.

## Residual
A test that sets no sandbox now passes silently instead of being told. That is the trade: the card asks
that the real root be impossible to reach, and it is; it does not need every test rewritten.

## Weakest premise
That a test process is recognisable: NODE_TEST_CONTEXT (set by node --test in each file it runs, but
NOT under --test-isolation=none, measured on node 26.8.1), or `--test` in process.execArgv (which is what
covers --test-isolation=none; tested), or KOSMOS_TEST_RUN from run-tests.sh. If a future node changes
both, direct `node --test` runs lose the guard (run-tests.sh keeps it); the first arms of the test then fail
(bulletin runtime-self-detection-is-version-dependent).
