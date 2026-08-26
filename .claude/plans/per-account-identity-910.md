# A new macOS account opens Kosmos and sees another account's agents (#910)

Josh, live-testing ahead of the Visual Edge session: "I double-clicked the
Kosmos app and it is actually pulling in all the agents from the other
user." Hit on two separately-created fresh accounts.

## Root cause, traced already (issue body, confirmed again by reading)

`install/kosmos`'s `healthy()` curls the port and checks the response body
for "Kosmos"/"Agent Workforce" -- true for ANY account's board, since
127.0.0.1 sockets are machine-wide, not per-user. `cmd_start`'s first line
is `if healthy; then say "already running"; return 0`, before any bind
attempt. So a second account's `kosmos start` sees the first account's
already-running board, calls it done, and never starts (or needs) a board
of its own. The native app then loads whatever's on the well-known port,
which is the wrong account's real, live data.

## Josh's ruling (quoted in full on the issue)

Identity is per macOS account, not per install. The app is machine-wide and
installed once (his Photoshop analogy); each account only ever sees its OWN
agents, and those sessions end at logout. Four acceptance criteria on the
issue. He explicitly left "how two accounts each get a board when localhost
is machine-wide" as implementation, naming three candidate shapes: a port
per account, a socket per account, or an identity token the client verifies
before trusting a board that answers.

## What's already correct, and doesn't need to change

Traced before designing anything, because the fix should touch only what's
actually broken:

- **The store is already per-account.** `engine/store.js`'s `ROOT` defaults
  to `~/Library/Application Support/AgentWorkforce` -- `~` differs per
  macOS account already. `KOSMOS_HOME` defaults to `~/.local/share/kosmos`,
  same reasoning. Account B's data was NEVER actually reachable by account
  A's board process; the bug is that B's client never used its OWN,
  already-correctly-scoped board -- it attached to A's instead.
- **"Already installed" already works.** `install/setup.sh` checks
  `[ -x "$KOSMOS_HOME/bin/kosmos" ]` against the per-account default home.
  A second account's install genuinely completes, writing a real, separate
  `~/.local/share/kosmos` tree for that account. The bug is entirely at
  START time, not install time -- acceptance criterion 2 needs no code
  change, just confirmation it already holds (it does; verified by reading,
  not just asserting).
- **Logout already ends an account's agent sessions**, IF each account's
  board and agent jobs are genuinely its own: `install/setup.sh`'s board
  job and `engine/create.js`'s agent jobs are both registered in the
  `gui/$(id -u)` launchd domain, which is scoped to that account's own
  login session -- a real logout (not a fast-user-switch background) tears
  down that domain's jobs. This was already true; it just never mattered
  because account B's board was never actually its own to begin with.

**So the entire bug collapses to one root cause: every account defaults to
the identical, hardcoded port (16180). Fix that one thing correctly, and
criteria 1, 2, and 4 fall out for free -- account B's client stops
attaching to A's board, starts its own (on a port A was never using),
against B's own already-correct store. Criterion 3 was already true.**

## Design: option 1 from Josh's menu (port per account), not 2 or 3

**Rejected: a socket per account.** The board is an HTTP server a browser
and a WKWebView both talk to over `http://127.0.0.1:$PORT`. Neither can
target a Unix socket directly without a proxy layer this product doesn't
have. A much bigger change than the bug warrants.

**Rejected: an identity token the client verifies (option 3), as the
PRIMARY mechanism.** Considered first, then dropped once it became clear
option 1 alone removes the collision by construction: if two accounts'
boards are simply never on the same port, `healthy()`'s existing "does
Kosmos answer here" check is already sufficient -- there is nothing left to
misattribute. Adding a live identity-check endpoint on top would be
solving a problem the port-derivation fix already prevents from occurring,
for marginal defense-in-depth at real implementation cost (a new
unauthenticated endpoint, a new client-side comparison in three different
languages/runtimes). Not built here; noted below as a real, deliberate
scope line, not an oversight.

**Chosen: a deterministic port, derived from the account's own UID, with
the single most common case pinned to the exact value every existing
install already uses.**

```
if uid == 501:
  port = 16180                          # unchanged: the primary/first
                                         # account on a personal Mac,
                                         # matching every current install
else:
  port = 16180 + 1 + (uid % 3999)       # 16181..20179, stable, never 16180
```

Why 501 specifically: macOS reserves UIDs below 500 for system/service
accounts; the Setup Assistant's first created user account gets 501 on
every personal or family Mac, which is the overwhelming majority of real
Kosmos installs today, all of them already hardcoded to 16180. Pinning
that exact case means **the single most common install on this planet
changes zero bytes of observable behavior.**

Why `+1` on the modulo, not `uid % 4000` alone: `uid % 4000` can itself
equal exactly 0, which added to 16180 reproduces the literal primary port
-- for some OTHER account, not the pinned uid-501 case. `+1` shifts the
range to 16181..20179, so the two cases (pinned primary, derived
secondary) can never collide with each other by construction, not just by
low probability.

**No runtime probing, no persisted "which port did I end up on" record,
no negotiation.** Every command (`start`/`stop`/`status`/the native app's
own resolution) independently computes the same answer from `id -u()`
alone -- a pure function, stable regardless of which OTHER accounts'
boards are up or down at the moment of the call. A probe-based design
("check the well-known port, see whose it is, fall back if foreign") was
considered and rejected: it makes account B's OWN port depend on the
TRANSIENT state of account A's board (if A's board happens to be down at
the exact moment B checks, B would wrongly conclude the well-known port is
free and go looking for its own board in the wrong place). A pure
function of UID has no such race.

**Accepted, not solved: an 8000-account port-hash collision.** Range is
~4000 wide; two distinct UIDs landing on the identical derived port is
astronomically unlikely for any realistic number of accounts on one Mac.
Same acceptance already given to #883's own KOSMOS_HOME label-hash
collision risk.

## Where the derivation must move together (five sites, was three)

`install/kosmos`'s own comment already names the discipline: "ONE OF THREE
COPIES OF THIS DEFAULT, and they must move together: here, `server.js`,
and `install/setup.sh`." Splinter counted 23 references to `16180` across
8 files while this was being built and asked the right question:
propagation, not enumeration -- which sites COMPUTE the default and which
merely CONSUME an already-resolved value passed to them. Confirmed by
reading each, not by counting occurrences:

**Computing sites (change the formula, three shell + one Swift = still
counts as four independent implementations, since Swift can't `require()`
a shell script):**

- `install/kosmos`: replaces the bare `PORT="${KOSMOS_PORT:-16180}"` with
  the derivation (still overridden first by an explicit `KOSMOS_PORT`,
  unchanged precedence).
- `install/setup.sh`: same replacement, so a FRESH install bakes the
  correct port into the plist and the native app's `kosmos-install.json`
  from the start, rather than discovering a collision at runtime.
- `native-app/main.swift`: the `#664` different-account branch (line ~150,
  `ResolvedInstall(kosmosHome: defaultHome, port: 16180, isOwnAccount:
  false)`) currently hardcodes the primary port for a DIFFERENT account
  that has no baked config of its own -- exactly the #910 scenario. Needs
  the same UID-based derivation in Swift, computed from `getuid()`.
  The `?? 16180` fallback (two call sites, no config AND no explicit
  override, i.e. THIS account resolving its OWN default) needs the same
  derivation too, for the same reason. Cross-checked against the shell
  formula for a spread of UIDs via a new `--kosmos-app-port-selftest
  <uid>` exit hatch (matching the existing `--kosmos-app-selftest`
  build-check pattern) -- confirmed byte-identical output for every uid
  tried.
- `install/pkg-scripts/postinstall` -- **found by Splinter asking about
  propagation, not by my own original count.** This root-descended .pkg
  script bakes a progress/spinner page (`sed "s/__KOSMOS_PORT__/
  ${KOSMOS_PORT:-16180}/"`) BEFORE the real installer even runs, in a
  subshell where `KOSMOS_PORT` is never exported. The real board (started
  moments later, in the same script, via the genuine `setup.sh`) derives
  correctly -- but the progress page itself would poll the WRONG port for
  any non-primary account, spinning forever instead of ever seeing "the
  board answers." The install completes regardless (setup.sh has its own
  fallback open at the end), so no test that only asserts "did it
  install" would catch this -- the only symptom is a page that never
  transitions, on the exact account population nobody testing from their
  own primary Mac account would ever see. Fixed: root already resolves
  `$CONSOLE_UID`; compute the same formula there and thread it into the
  page as an explicit argument instead of leaving it to the subshell's
  own unexported fallback.

**Consuming sites (read an already-resolved value; do not need the
formula themselves, confirmed by reading, not assumed just because they
mention 16180):**

- `server.js`: `PORT = Number(process.env.PORT || 16180)` -- always
  receives an explicit `PORT` from `install/kosmos`'s `cmd_start`, which
  always sets it before spawning `node`. The `|| 16180` fallback only
  fires on a bare `node server.js` invoked outside that path entirely (a
  dev-only shortcut), never in the real multi-account install/start flow.
- `engine/create.js`'s `boardPort()`/`DEFAULT_BOARD_PORT`: reads
  `process.env.PORT` from the actual running server (correct by
  construction once the server itself was started correctly) and uses
  the literal 16180 only to decide whether to OMIT an explicit
  `KOSMOS_PORT` stamp on a newly-created agent's launchd job (the
  common-case optimization its own comment describes). For a non-primary
  account this now always stamps explicitly rather than omitting --
  MORE correct, not a regression, and existing agents' plists are never
  rewritten later so nothing here needs to track a future formula
  change.

## Existing-install transition, traced precisely rather than assumed

Checked `engine/update.js`: self-update spawns `curl -fsSL <setupUrl> | sh`
as a child of the RUNNING board process, inheriting `process.env` -- which
already carries `KOSMOS_PORT`, because the launchd plist that started the
board explicitly sets it (baked at the LAST install/update). `PORT=
"${KOSMOS_PORT:-16180}"` (and the derivation replacing it) never reaches
its own fallback when the caller's environment already has `KOSMOS_PORT`
set -- the explicit override always wins, unchanged precedence.

**So a self-update alone does NOT retroactively move an already-running,
already-colliding non-primary account onto its own port.** It keeps
whatever port its own plist already had (16180, the only value that has
ever existed, for every install prior to this fix) -- the exact same
collision-prone value, forever, until something OTHER than a self-update
re-derives it: a manual re-run of the install line in Terminal (no
inherited `KOSMOS_PORT` in a fresh shell), or `--uninstall` followed by a
fresh install.

**Scoped deliberately, not an oversight: this card fixes FRESH accounts,
which is the reported bug** -- Josh's exact test was two just-created macOS
accounts with no prior Kosmos state to inherit from, so they derive
correctly from their very first install, no transition needed. An
ALREADY-existing secondary account that is ALREADY colliding with a
primary account's board today (if any exist in the wild -- unconfirmed,
not reported) would need an explicit action to self-heal. Worth naming as
a possible follow-up (a one-time port-migration nudge, or simply
documentation of the manual fix) if it turns out to matter in practice;
not fixed here, since the reported bug doesn't require it.

## Verification plan

- `install/kosmos` / `install/setup.sh`: unit-level shell test asserting
  the derivation formula for a handful of UIDs (501 -> 16180; a spread of
  others -> the expected 16181-20179 values; an explicit `KOSMOS_PORT`
  still wins over any of it).
- `tools/test-install.sh`: a two-account scenario -- two sandboxed
  installs under DIFFERENT simulated UIDs (or, more practically, an
  explicit `KOSMOS_PORT` override standing in for "my derived port" per
  scenario, since the harness cannot spawn two real macOS accounts) both
  come up successfully, each serving its own, distinct data, neither ever
  reading `healthy()` as "already running" for the other's board.
- `native-app`: whatever test harness the Swift side already has (check
  before assuming none exists) exercising the `#664` different-account
  branch, confirming the derived port matches the shell formula for the
  same UID.
- Full `tools/test-install.sh` run before merge.
