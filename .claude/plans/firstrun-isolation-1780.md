# firstrun-isolation-1780: one env var isolates the first-run About-you write

kosmos#1780. Walking first-run performs a real write to every agent instruction file on the
machine (the `/api/you` PUT calls `you.syncEveryone`). There is no way to exercise that flow
without reconfiguring the live fleet, which is how the #1772 incident happened: an isolated git
worktree on a private port did not isolate the DATA, because the writes resolve through
`os.homedir()` and a worktree cannot move a homedir.

## The real bug (measured, not assumed)

`AGENT_WORKFORCE_HOME` already exists as the general home-redirect seam and six engine modules
honour it (`accounts.js`, `openaiaccounts.js`, `runners.js`, `codexupdate.js`,
`delete-leftover.js`, `runningas.js`). The two roots in the first-run WRITE chain did NOT:

- `engine/create.js` `homeDir()` returned raw `os.homedir()` -> the workers root
  (`create.workerDir`, which both `instructions.fileFor` and `create.instructionFile` resolve
  through).
- `engine/store.js` `root()` passed raw `os.homedir()` as the home base -> `store.ROOT`, where
  profiles (the recorded-dir lookup) and `you.json` live.

So an operator who set `AGENT_WORKFORCE_HOME` (the documented seam) isolated account/runner
reads but the instruction WRITES still fell through to the real machine. That is the leak.

## The fix (additive, single var, per call)

Make both roots honour `AGENT_WORKFORCE_HOME`, resolved per call (a const would re-freeze it,
#1432/#1443). In `store.root()` the seam sits BELOW `AGENT_WORKFORCE_DATA`, which still wins.
Behaviour is identical when the seam is unset, so production is untouched; the change only takes
effect for a test instance or a QA walk that sets the var.

⇒ `AGENT_WORKFORCE_HOME=<disposable>` now isolates the two roots the first-run About-you write
resolves through: the store (`store.ROOT`, where profiles and `you.json` live) and the workers
root (`create.workerDir`, the agent CLAUDE.md files). One setting for the whole About-you write,
instead of separately setting `AGENT_WORKFORCE_DATA` and `AGENT_WORKFORCE_WORKERS` and hoping no
raw-`os.homedir()` root was missed. This also gives #1794 (Baron) the filesystem verification arm
it was missing (his 12 `store.ROOT` tests).

⚠️ SCOPE, stated precisely so nobody over-trusts it: `AGENT_WORKFORCE_HOME` covers the About-you
write chain, NOT every root a broader QA walk might touch. `projects.js` `projectsRoot()` honours
only `AGENT_WORKFORCE_PROJECTS` (falling back to raw `os.homedir()`), so a walk that CREATES a
project still needs that separate var; and the require-time freezes below are their own case. This
card isolates the write it was scoped to (About-you), not the entire walk.

## What finished looks like

- `create.js homeDir()` and `store.js root()` honour `AGENT_WORKFORCE_HOME`.
- A proof test (`engine/firstrun-isolation-1780.test.js`) that RUNS the real write path and
  asserts by the real files, not by a unit assertion that the var is read:
  - with the seam set, `store.ROOT` and `create.workerDir` sit under the disposable home (and a
    control with the seam unset shows they fall to `os.homedir()`);
  - the actual `you.syncEveryone` write lands under the disposable home and a byte-identical
    sentinel under a throwaway "pretend-real" home (via a redirected `HOME`) is unchanged;
  - PERTURB: with the seam unset the same write clobbers the sentinel, proving the seam is
    load-bearing rather than decorative.
  - A hard guard asserts `os.homedir()` resolves to the throwaway home before any write, so a
    platform where `$HOME` is ignored fails loud rather than reaching the operator's real files.

## Boundary (deliberately out of scope)

- `status.js` and `subscription.js` still call raw `os.homedir()` (one each) and are READERS
  (session registry / subscription state), so they cannot clobber the fleet. Not in the
  About-you write path, and (measured by Splinter) none of #1794's os.homedir tests touch them.
- `trust.js` also calls raw `os.homedir()` but is a WRITER, not read-side: it writes trust flags
  into `~/.claude.json` (writeFileSync/renameSync at 259/268/385/443-448), honouring
  `CLAUDE_CONFIG_DIR` but NOT `AGENT_WORKFORCE_HOME`. It is out of #1780's scope because it writes
  during connect/create, not during the first-run About-you `syncEveryone` write this card fixes.
  BUT it is a real gap against the card's broader stated purpose ("a QA walk cannot reconfigure
  the live fleet"): a walk that connects a provider or creates an agent, under a HOME-only sandbox,
  can still mutate the operator's real `~/.claude.json` trust state. FOLLOW-UP (worth its own card,
  flagged to Splinter): make trust.js's config path honour `AGENT_WORKFORCE_HOME` (or standardise
  the connect/create writers on `CLAUDE_CONFIG_DIR` for the QA-walk mode). Not fixed here to keep
  #1780 to the About-you write it was scoped to.
- `you.js` freezes `BASE = AGENT_WORKFORCE_DATA || store.ROOT` at require, and `firstrun.js`
  freezes `store.ROOT` into its completion-flag path the same way. For a launched test instance
  (env set before require) both capture the sandboxed store correctly, so neither is the #1780
  leak; making them per-call is a latent robustness follow-up, not required here (firstrun.js
  freezes only the completion flag, not About-you content).

## Not in scope

Changing production behaviour (the change is inert when the seam is unset); the UI half (#1772,
shipped as #1779); the read-side modules above.
