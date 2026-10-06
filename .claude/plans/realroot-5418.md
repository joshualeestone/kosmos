# realroot-5418: a test process is refused this machine's real data root

Card: kosmos#5418 (found by Renet on a fleet Mac, 2026-10-06). Owner: April. Claimed 2026-10-06 15:10 CDT (claim log, 20:10:48Z).

## Mechanism (measured)
About forty engine modules freeze `store.ROOT` at require time (`const DIR = path.join(store.ROOT, ...)`;
sendertoken.js:58 is the one the card's records came from). `store.ROOT` itself is lazy (#1443), but a
test that requires any of those modules before setting its sandbox gets the REAL root frozen into that
module for the rest of the process, and every write lands in the operator's store.

## Decision (ask 1: make it impossible)
Refuse at the derivation, `store.resolveDataRoot()` (review 3 found `store.root()` was not the only one:
`create.supportDir()`, `worlds.baseRoot()` and `tools/selfreport-silence-monitor.js` called
`store.dataRootFor` directly; all four now go through `resolveDataRoot`, so one process always agrees on
one root). Left on `dataRootFor` on purpose: `boardauth` and `setup-assistant` read the LEGACY root,
`win32uninstall` targets win32 explicitly with its own home. The rule:
- A test process is one `node --test` started (NODE_TEST_CONTEXT is set in every file it runs; measured
  `child-v8` on node 26.8.1) or one `tools/run-tests.sh` started (it now exports KOSMOS_TEST_RUN=1, which
  also reaches its shell tests and whatever they start).
- In a test process, a resolved root equal to the machine's REAL default root, or inside it (a named
  world hangs off it), is never used:
  - with NO sandbox variable set, the store answers ONE throwaway root of that process's own (mkdtemp,
    prefix `kosmos-test-home-`), removed at exit (best effort; run-tests.sh sweeps ones older than two
    hours). It is the store's alone: no environment variable is set, so no other seam changes (an
    earlier version exported AGENT_WORKFORCE_HOME, which agystatus, accounts, codexupdate and others
    also read, and which overrode a HOME set later; review 2 caught it). A child process is a test
    process too and gets its own. The legacy migration is skipped for it, since its target would be
    the real store;
  - with a sandbox variable set that still resolves to the real root, it throws a named error.
- "Real" is derived from `os.userInfo().homedir` (the account's home in the user database), NOT
  `os.homedir()`, which follows $HOME: a test that sandboxes by pointing HOME elsewhere must not be
  refused. On Windows the real root is that home's AppData\Roaming, not the APPDATA variable (a test
  may sandbox it); a machine whose AppData is redirected elsewhere is not recognised.
- Paths are compared by realpath of the nearest existing ancestor, so a symlinked spelling of the real
  home is still the real root.
- The refusal runs before the legacy migration, which would otherwise rename the real store first.
- `KOSMOS_ALLOW_REAL_ROOT=1` is the explicit way out for a process that must read the real store under a
  test runner.

## Rejected
- Making each of the ~40 modules resolve lazily: whack-a-mole, and the next module re-freezes it.
- Exporting a sandbox AGENT_WORKFORCE_DATA from run-tests.sh for every test: trips the board's #634
  "half-sandboxed" refusal, and does nothing for an agent's direct `node --test` run.

## Ask 2 (cleanup on the fleet Macs)
Separate and later. Destructive to a person's real store, so: dry-run listing first, backup, remove
only entries whose agent is not on the board AND whose dates predate this guard, never a live agent's.

## Tests
`engine/store.real-root-5418.test.js`, child processes with a controlled env, reading `store.ROOT` only:
refused under NODE_TEST_CONTEXT and under KOSMOS_TEST_RUN; sandbox by DATA or HOME var allowed; HOME
pointed elsewhere allowed; real home through a symlink refused; controls: no test marker returns the
real root as before, KOSMOS_ALLOW_REAL_ROOT returns it on purpose. On origin/main's store.js the two
refusal tests fail; on the first (string-compare) version the symlink test fails.

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

## The harness sweep
Throwaway names carry their pid (`kosmos-test-home-<pid>-XXXXXX`); tools/run-tests.sh removes one only
when that process is gone (tested: dead pid removed; live pid, malformed name and other dirs kept). It
runs before run-tests.sh re-points TMPDIR, so it reaches leftovers of direct `node --test` runs.

## Second redesign (review 2): store-only, no environment
Exporting the throwaway as AGENT_WORKFORCE_HOME changed every seam that reads that variable, depending
on which module read the store first, and silently overrode a HOME set later. The throwaway now lives
in store.js only. Cost: a parent and the children it starts no longer share one throwaway; only
unsandboxed pairs that both used the REAL store shared before, and those are this card's leaks.

## Residual
A test that sets no sandbox now passes silently instead of being told. That is the trade: the card asks
that the real root be impossible to reach, and it is; it does not need every test rewritten.

## Weakest premise
That NODE_TEST_CONTEXT stays set by node --test (bulletin runtime-self-detection-is-version-dependent).
If a future node stops setting it, direct `node --test` runs lose the guard (run-tests.sh keeps it).
The test above would then fail its first arm, which is the signal.
