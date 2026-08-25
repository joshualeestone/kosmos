# Sandboxed installs still write to machine-global surfaces (#883)

Found during the 0.5.30/0.5.31 release walks (Pigeon Pete). A sandboxed install
(`KOSMOS_HOME` + `KOSMOS_HOME_APP_DIR` + `KOSMOS_PORT` into a scratch dir, NOT
the fuller `AGENT_WORKFORCE_DATA`/`_WORKERS`/`_LAUNCH`/`_PROJECTS` family
`tools/test-install.sh` uses) still touches four machine-global surfaces.
Escalated across three of Josh's own comments on the issue past Splinter's
"smallest first" framing: the board plist label collision is real damage (his
hand-written dev-board plist got overwritten), the auto-updater re-poisons it
on every self-update tick (same code, not a separate bug), and the STORE
itself is shared too -- a sandboxed board and the real board on one machine
read and write the same `projects.json`, avatars, chats, selfreports.

## Root cause, traced by reading, not assumed

Everything traces to one place: `install/setup.sh`'s board-plist
`EnvironmentVariables` dict (~line 2353) sets exactly four keys -- `HOME`,
`PATH`, `LANG`, `KOSMOS_PORT` -- and has never set `AGENT_WORKFORCE_DATA`,
`AGENT_WORKFORCE_PROJECTS`, or `AGENT_WORKFORCE_WORKERS`. The board process
launchd actually runs inherits ONLY what that dict carries -- nothing else,
launchd jobs don't inherit a shell's ambient environment. So a board started
via `KOSMOS_HOME=/scratch/... setup.sh` genuinely never sees any
`AGENT_WORKFORCE_*` override once it's running as the launchd job, regardless
of what the installing shell's own environment had.

Downstream, this single gap explains all three of the issue's items plus the
store escalation, because `engine/create.js`, `engine/projects.js`, and
`engine/store.js` already read `process.env.AGENT_WORKFORCE_WORKERS`,
`_PROJECTS`, and `_DATA` correctly (confirmed by reading each) -- they just
never receive a value, so they all fall back to the real machine-wide
defaults (`~/work/workers`, `~/Kosmos/Projects`,
`~/Library/Application Support/AgentWorkforce`).

The plist LABEL is a separate defect with the same root shape: `_board_label`
(setup.sh ~line 2326) is the fixed string `com.kosmos.board` regardless of
`KOSMOS_HOME`. Two installs on one machine register the SAME launchd label in
the SAME `gui/$uid` domain -- the second one silently owns the file the first
one's label points to. Confirmed via `engine/create.js`'s
`AGENT_WORKFORCE_LAUNCH || ~/Library/LaunchAgents` fallback that this ISN'T
about file location (Pete's convention doesn't set `AGENT_WORKFORCE_LAUNCH`,
so plist files already land in the same real directory for both real and
sandboxed installs) -- it's specifically the LABEL string that collides in
launchd's own registry.

## The one thing this fix must never do

**A default (real, non-sandboxed) `KOSMOS_HOME` install must produce a
byte-for-byte identical plist to before this change**, label included. Every
existing real user's board is already registered under the literal label
`com.kosmos.board`; relabeling it on the next `setup.sh` run (a plain
reinstall, or -- worse -- the NEXT AUTO-UPDATE, since `engine/update.js`
re-runs this exact script) would orphan every existing user's login job and
silently fail to survive their next reboot. That is a strictly worse
regression than the bug this card fixes. Guarded two ways, corrected here
after challenge-loop iteration 1 pointed out this section overstated the
first: the CODE PATH itself is structurally byte-identical for a default
install (`_extra_env_kv` stays empty, so the heredoc line it sits on
reduces to exactly what shipped before this change, confirmed by reading
against `git show main:install/setup.sh`), and `tools/test-install.sh`
asserts the observable half of that -- the bare label file exists, and none
of the three new key names appear in it. Not a byte-for-byte diff against a
captured reference, which is what an earlier draft of this section claimed;
the four targeted assertions are what actually shipped.

## Design

**Board plist label**: unique only when `KOSMOS_HOME` differs from the real
default (`$HOME/.local/share/kosmos`, matching how `KOSMOS_HOME` itself is
first resolved at setup.sh's top). Suffix is a short deterministic hash of
`KOSMOS_HOME` (`shasum -a 256`, first 8 hex chars) so the SAME sandboxed
install re-run (a walk's own update tick, a second `setup.sh` invocation)
produces the SAME label each time -- required for the existing
"an already-loaded job is left alone" idempotency check a few lines below to
keep working, rather than accumulating a new orphaned label on every run.

**`AGENT_WORKFORCE_DATA`/`_PROJECTS`/`_WORKERS`**: derived as `$KOSMOS_HOME/data`,
`$KOSMOS_HOME/projects`, `$KOSMOS_HOME/workers` ONLY when (a) `KOSMOS_HOME` is
non-default AND (b) the corresponding env var isn't already explicitly set in
the installing shell's own environment (an explicit override always wins,
matching every other `${VAR:-default}` in this file). Plumbed into the
plist's `EnvironmentVariables` as three new optional keys. For a real,
default install these three keys are omitted entirely (not merely empty),
matching the plist's byte-for-byte-unchanged invariant above.

**`AGENT_WORKFORCE_LAUNCH` deliberately NOT touched.** Considered and
rejected: moving agent-job plist files under `$KOSMOS_HOME` would mean they
are no longer in the one directory macOS actually auto-scans at login
(`~/Library/LaunchAgents`), which is a real, separate behavior change (agent
jobs created under a sandbox would not survive its own next reboot even
before the sandbox directory is deleted) that the issue does not ask for and
that changes agent-restart semantics rather than data-leakage semantics.
Left as the "fuller shape... one explicit sandbox switch" the issue itself
names as a follow-up, not this card.

**Agent job LABEL uniqueness (`com.kosmos.agent.<name>`) also deliberately
NOT touched.** `engine/create.js`'s `serviceLabel(name)` is name-only,
called from `create.js`/`register.js`/`remove.js`/`machine.js` -- making it
KOSMOS_HOME-aware is a real, wider-blast-radius change (every caller's
assumption about what a label looks like) that the issue's own "smallest
first... a fuller shape is one explicit sandbox switch" framing defers.
Two installs both naming an agent the identical name is the residual gap;
the issue names the walker's own teardown ledger as the interim defense
until a fuller shape exists, and that stands.

## Verification plan

- New test (shell-level, extending `tools/test-install.sh` directly): a
  default-KOSMOS_HOME install produces a plist with label `com.kosmos.board`
  and NO `AGENT_WORKFORCE_*` keys beyond `KOSMOS_PORT` -- targeted
  assertions against the specific bytes this card could add, not a full
  diff against a captured reference.
- A non-default-KOSMOS_HOME install (Pete's exact 3-var convention: KOSMOS_HOME
  + KOSMOS_HOME_APP_DIR + KOSMOS_PORT, deliberately NOT the fuller
  AGENT_WORKFORCE_* family) produces: a label distinct from `com.kosmos.board`,
  and the three derived env keys present and pointed under KOSMOS_HOME.
- Re-running the SAME non-default install twice produces the SAME label both
  times (idempotency, not two orphaned jobs).
- An explicit `AGENT_WORKFORCE_PROJECTS` override alongside a non-default
  KOSMOS_HOME wins over the derived default (override always wins).
- Full `tools/test-install.sh` run before merge, to confirm nothing in the
  existing 219-case suite (which already exercises AGENT_WORKFORCE_LAUNCH's
  existing sandboxing) regresses.

## Done, and what building it actually took

The env-derivation had to happen in TWO places, not one, discovered by
running the real fix rather than assuming the design above was complete:
`install/setup.sh`'s "Keeping Kosmos running after a restart" step (the
plist) is NOT the only place a board starts -- "Starting Kosmos" a few
lines earlier starts one too, as a plain child of the installing shell, and
a launchd job's `EnvironmentVariables` only reaches a FUTURE reboot/update,
never that same-session start. Deriving only at the later step left the
CURRENT install's own board starting with the caller's original,
unsandboxed environment -- which collided with the pre-existing #634 guard
("Kosmos will not start half-sandboxed") the moment `AGENT_WORKFORCE_LAUNCH`
was set (for file-write safety) but the other three were not yet derived.
Fixed by deriving and `export`-ing once, before "Starting Kosmos", and
having the later plist step simply read what is now already resolved.

`uninstall()` needed the identical label derivation too, independently --
it is a separate function with its own, previously-hardcoded `_board_label`.
Without it, uninstalling a non-default-KOSMOS_HOME install would look for
the bare `com.kosmos.board.plist`, never find the suffixed file the install
path now writes, and leave the login job registered forever -- the exact
orphan class #891 fixed for the app's remembered-answer files, reintroduced
for the label if this had shipped without the matching uninstall fix.

**Challenge-loop iteration 1 found a real, if narrow, hole in the
byte-identical invariant itself:** `_kosmos_home_default` was built from raw
`$HOME`, but `KOSMOS_HOME` (the thing it gets compared against) had already
been slash-normalized (`tr -s '/'`, strip trailing `/`) a few lines above --
this file's own header already measured that exact mismatch once, for a
different comparison ("a trailing slash on $HOME made every ownership and
board proof in this file use //-flavored paths"). A `$HOME` carrying a
trailing or doubled slash would have made a genuinely-default install
compare as non-default: suffixed label, extra env keys, the precise
regression this whole card exists to prevent. Fixed by normalizing
`_kosmos_home_default` the identical way, in both places it is computed
(the install-path derivation and `uninstall()`'s independent copy). Pinned
with a dedicated `tools/test-install.sh` scenario using a trailing-slash
`$HOME`, added after iteration 2 flagged that the first fix shipped
without one.

Also confirmed, precisely rather than assumed, while building the
verification tests: the same identity gap #910 was filed for (`healthy()`
answering "is A Kosmos board here" rather than "is MY Kosmos board here")
reproduces WITHIN this test suite itself, between two disposable sandboxed
scenarios sharing one port -- an occasionally-slow-to-die prior scenario's
board reads as "already running" to the next one's `cmd_start`, so the next
scenario's own process never starts. Not a #883 defect; fixed in the test
harness (a force-kill fallback in `wait_port_free` guarantees a clean port
between scenarios) and written up on #910 as corroborating evidence, since
it shows the same missing identity proof causing two different failure
shapes depending on which code path (start vs. stop) hits it.
