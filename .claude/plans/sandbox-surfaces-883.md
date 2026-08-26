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

**A new residual gap this card's own fix introduces, named by challenge-loop
iteration 5, not fixed here.** Before this fix, every sandboxed install
shared ONE board-plist label, so an abandoned scratch `KOSMOS_HOME` (a walk
directory deleted without running `--uninstall` against it) left at most
one stale, self-overwriting entry -- broken (that overwrite IS #883), but
self-limiting. After this fix, each distinct `KOSMOS_HOME` gets its OWN
permanent, uniquely-labeled launchd job. `uninstall()` only derives and
removes the label for whatever `KOSMOS_HOME` is set to AT uninstall time --
nothing sweeps for OTHER `com.kosmos.board.*.plist` entries whose
referenced tree no longer exists. A walk convention that uses a fresh
scratch directory per run and is torn down by deleting the directory
(rather than running `--uninstall` against that exact `KOSMOS_HOME`) now
accumulates one permanently-orphaned launchd job per walk, forever --
precisely the failure class this file's own header is otherwise paranoid
about ("an orphan with a new cause, invisible to a person who believes
they uninstalled the product"), just for a different surface than the one
that header names. Checked `tools/clean-machine.sh` and `engine/
machine.js`'s `labelTruthCheck` for an existing sweep that might already
cover this: neither does -- `labelTruthCheck` catches an IMPOSTOR (a label
pointing at a file that is not its own), not an orphan whose label still
correctly points at its own, now-dead file. Traded one collision-prone
shared label for unbounded per-install accumulation. Worth a real decision
(a sweep keyed on "does this label's own KOSMOS_HOME still exist on disk",
likely as part of the same "fuller shape... one explicit sandbox switch"
the issue already names for the agent-label gap) rather than silently
shipped as if it were free -- named here explicitly so it is not
rediscovered later at full cost.

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

**Challenge-loop iteration 3 found the most serious defect of the three
rounds: the fix, as it shipped through iteration 2, would have broken
Pete's real walk convention outright.** `engine/sandbox.js`'s `audit()`
(#634) refuses to start the board whenever ANY of `{AGENT_WORKFORCE_DATA,
_PROJECTS, _WORKERS, _LAUNCH}` plus tmux-inertness is sandboxed while ANY
is not -- symmetric, either direction. This card's own design deliberately
derives only three of those four (leaving `AGENT_WORKFORCE_LAUNCH` and
tmux untouched, both by design -- see "deliberately NOT touched" above).
Pete's real convention (`KOSMOS_HOME` + `KOSMOS_HOME_APP_DIR` + `KOSMOS_PORT`
only) never sets `AGENT_WORKFORCE_LAUNCH` and needs real, non-inert tmux to
be a genuinely usable walk. So the derived environment -- three sandboxed,
one live, tmux live -- is exactly the shape `#634` was built to refuse. The
board would not start at all for the one scenario this whole card exists
to fix. Nothing in this card's own test suite caught it: the "Pete's exact
convention" scenario always explicitly set `AGENT_WORKFORCE_LAUNCH` (for
the test's own file-write safety, but contradicting its comment's claim to
reproduce Pete's convention exactly), and the whole file globally exports
`AGENT_WORKFORCE_DRY_RUN=1`, making tmux permanently inert throughout --
both incidentally satisfy `#634`'s "all sandboxed" bar and hid the gap.

**Fixed by setting `AGENT_WORKFORCE_HALF_SANDBOX_OK=1`** alongside the
three derived vars, in the same non-default-KOSMOS_HOME branch. That
variable is `#634`'s own named escape hatch ("for the person who has read
this and means it") -- and choosing a non-default `KOSMOS_HOME` is exactly
that deliberate choice, not an accident. This does not reopen `#634`'s
original incident (a real message typed into two real agents' tmux panes,
two real `CLAUDE.md` files rewritten): that incident was `WORKERS` staying
live while `DATA`/`PROJECTS` were sandboxed; `WORKERS` is one of the three
this card derives, so that specific exposure stays closed. What remains --
an agent job or tmux session created under a sandboxed `KOSMOS_HOME`
colliding by NAME with a real one -- is the same class of gap `#910` and
the deferred agent-job-label work already name, not something this line
newly creates.

Verified with a precise, safe unit test rather than a full end-to-end run
with real tmux: `engine/sandbox.test.js` already tests `audit()` directly
(a pure function, no process, no real tmux) with exactly this pattern of
cases; added one more asserting the shape this card's derivation produces
(`DATA`/`PROJECTS`/`WORKERS` set, `HALF_SANDBOX_OK` set, `LAUNCH` and tmux
NOT set) resolves to `partial: false`. Deliberately did not attempt a full
shell-level reproduction with real, non-stubbed tmux: this machine runs
other agents' real tmux sessions on the same default socket
(`install/kosmos`'s own comment: "share a socket directory" is the whole
point of a private tmux BINARY, it is not a private tmux SERVER), and a
test that starts a real board with real tmux risks touching them for
marginal confidence beyond what the direct `audit()` test already gives.

**Also fixed, lower stakes, found in the same round:** the three new plist
keys were landing on one squished physical line instead of one line each
(command substitution strips trailing newlines at every level of nesting,
so three separately-substituted `_env_kv` calls each lost the newline
meant to separate them) -- valid XML either way (`plutil -lint` accepts
both), but inconsistent with the rest of the file's one-key-per-line
style. Fixed with the standard portable trick for keeping a trailing
newline through command substitution (append a sentinel character, strip
it after capture). Verified directly by installing and reading the actual
generated plist.

**Challenge-loop iteration 4 found a second critical defect in the SAME
`AGENT_WORKFORCE_HALF_SANDBOX_OK` fix iteration 3 shipped, by direct
reproduction rather than reading.** The fix exported the override into
THIS session's own shell, before "Starting Kosmos" -- which correctly
clears `#634` for the install's own first start. But it was never added to
the persisted launchd plist alongside `AGENT_WORKFORCE_DATA`/`_PROJECTS`/
`_WORKERS`. A real reboot or self-update runs `kosmos start` as a FRESH
process whose entire environment IS the plist's `EnvironmentVariables`
dict -- nothing this session exported survives. So the exact scenario
"Keeping Kosmos running after a restart" exists to handle -- a reboot, or
`engine/update.js`'s self-update -- would hit `#634`'s refusal all over
again, deferred rather than fixed. Reproduced directly: invoked `bin/
kosmos start` with ONLY the plist's own `EnvironmentVariables` as its
environment (simulating exactly what launchd runs at the next login) and
watched it die with the identical "will not start half-sandboxed"
sentence. Fixed by adding `AGENT_WORKFORCE_HALF_SANDBOX_OK` as a fourth
`_env_kv` call alongside the other three, in the same non-default-
`KOSMOS_HOME` branch.

Pinned with a dedicated `tools/test-install.sh` scenario doing the same
reproduction the review did: stop the board (so a genuinely fresh process
must start, not `healthy()` seeing the prior one still live -- the first
version of this test skipped this and passed vacuously either way, caught
by re-testing it against the reverted fix and watching it pass when it
should not have), then start `bin/kosmos start` under `env -i` with ONLY
the plist's own keys, and assert both a clean exit and that `board.log`
(not the shell wrapper's own stdout, which never carries the actual
server-side message -- a first version of this assertion checked the wrong
file and passed vacuously too, also caught by testing against the
reverted fix) carries no half-sandboxed refusal. Confirmed discriminating
both times: reverted the respective fix, rebuilt, watched the corrected
assertion fail for the right reason; restored, confirmed green.

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

**One more thing ruled out, not fixed:** while confirming iteration 4's fix,
`tools/test-install.sh`'s pre-existing "== update ==" scenario (far earlier
in the file, `$SB/home`'s first install, nothing this card touches)
intermittently failed with its board's pidfile missing and the port
unreachable -- looked at first like a regression this branch introduced.
Ruled out by running the identical harness against completely unmodified
`main`: it failed at the exact same point, at the same point in time, on
this same machine. Pre-existing, environment-dependent, unrelated to this
card's changes -- not investigated further here, since it reproduces
without a single line of this branch's diff present.
