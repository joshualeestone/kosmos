# Gap-B (win32 report/self-report wiring): Pete's two pinned questions, answered

Lane position (from `win32-capture.md`): roster (#2171, DONE) -> create.js
record-write (#2174, DONE) -> win32 live-state (DONE) -> **Gap-B report/self-report
win32 wiring (this arm)** -> LAST flip `platform.js` SUPPORTED.

Pete is holding his live-state seam on these two. Both are answered below from
source plus measurement on the Windows box, not from reading intent.

---

## Q1: does the report ROUTE resolve a win32 sender with no pane?

**YES -- the route is already done, and it was done deliberately for this case.**

`resolveAgentSender` (`server.js:479`) is TOKEN FIRST, PANE SECOND, landed as
#570 item 2. Its own comment names this exact caller: *"An agent with no pane --
Windows, or an SDK runner that was never in a terminal -- presents the launch
token it was handed instead."*

The token arm needs no pane at any step:

- `sendertoken.resolve(presented, roster)` (`server.js:499`) -- roster-carded arm.
- falling back to `sendertoken.resolveName` + `liveness.alive` (`server.js:502-505`),
  which returns a synthesized card with **`paneless: true`** and the `instance`.

`POST /api/report` (`server.js:5726`) then takes `sender.card.sessionName` as
`who` and records `sender.instance`. Nothing on that path reads `TMUX_PANE`.

⚠️ **NO DOWNGRADE, and it cuts both ways.** A presented token DECIDES: if it does
not resolve, the route refuses rather than falling back to the pane
(`server.js:506-510`). Correct, and it means a win32 agent holding a bad token
gets no second chance.

### So the route is not the work. THE TOKEN HANDOFF IS.

The route resolves a paneless sender **only if the agent presents a token**, and
on win32 nothing hands it one:

- The Mac launch path mints and exports it: `bin/agent-supervisor.sh:304`
  assigns `KOSMOS_AGENT_TOKEN`, validates its charset (`:317-320`), and exports
  it into the agent's environment. `install/kosmos` reads it back at `:830-837`
  and sends it as the `x-kosmos-agent-token` header (`:343`).
- `engine/win32create.js` mints a **session id**, NOT a sender token. There is no
  `sendertoken.mint` call anywhere in the win32 modules (`win32create.js`,
  `win32roster.js`, `win32capture.js`, `win32sessions.js`).

And the failure is fail-CLOSED rather than silent, which is the good news:
`POST /api/report` sets `denyPaneFallback` on an enforcing board
(`server.js:5771-5783`), so a win32 agent with neither token nor pane is refused
with a sentence, not recorded as somebody else.

⇒ **First unit of Gap-B work: mint per launch in the win32 create path and hand
`KOSMOS_AGENT_TOKEN` to the spawned agent, mirroring the supervisor.** Note the
`sendertoken.js:46` rule while doing it: *whoever stops or deletes an agent MUST
call `revoke()`* -- minting is no longer enough, because `mint` stopped rotating.

---

## Q2: does the report HOOK fire and reach it?

**NO. Not as wired, and it fails before any Kosmos code runs.**

### 2a. The hook command cannot start on Windows (measured)

`engine/reporthook.js:62` writes the settings.json entry as:

```js
command: 'bash "' + scriptPath + '"'
```

Measured on this Windows box (`Get-Command bash`):

```
bash NOT on PATH
EXISTS: C:\Program Files\Git\bin\bash.exe     <- present but NOT on PATH
EXISTS: C:\Program Files\Git\usr\bin\bash.exe <- present but NOT on PATH
```

So the command fails to launch. This is a developer box that has Git for Windows;
a stock Kosmos user's box need not have `bash` at all.

### 2b. And the payload underneath it is a POSIX toolchain, two layers deep

- `install/kosmos-report-hook.sh` is `#!/usr/bin/env bash`, and uses `jq`, `date`,
  `tr`, `printf`, `readlink`, `mkdir`, `cat`.
- It resolves `$KOSMOS` (`:95-137`) to `install/kosmos`, which is `#!/bin/bash`
  and posts with `curl`.

Porting is therefore not "find bash": it is a decision about what the win32
writer IS. Flagging it rather than choosing unilaterally, since the shape is
Pete's interface call.

### 2c. Two defects that survive even if the shell problem is solved

**THE THROTTLE COLLAPSES ALL PANELESS AGENTS ONTO ONE KEY.** `:181`:

```sh
MARK="$THROTTLE_DIR/$(printf '%s' "${TMUX_PANE:-nopane}" | tr -c 'A-Za-z0-9_-' '_')"
```

`TMUX_PANE` is unset for every win32 agent, so all of them share the single mark
`nopane`. `heartbeat_due` gates the PreToolUse beat at 60s against that one file
(`:197-201`), so agent A's beat suppresses agent B's for a minute. The natural
win32 key is the session id `win32create.js` already mints -- the same id the
roster re-checks -- so the fix has a value ready and does not need a new one.

**THE DEDUP MARKER IS A FILENAME.** `engine/reporthook.js:43` sets
`MARKER = 'kosmos-report-hook.sh'` and `entryIsOurs` matches on it. A win32
sibling under a different filename would NOT dedup against an existing entry, so
a box that gets both wirings stacks two hooks and double-reports. The module
comment already states that a change to the command TEXT needs its own
migration; a change to the NAME needs one too, and that is not yet written down.

### 2d. Flagged, NOT verified -- do not treat as a finding

`resolve_kosmos` gates its rungs on `[ -x ... ]` (`:98-102`). Whether the exec-bit
test behaves under whatever shell the win32 arm ends up using is UNMEASURED here.
Calling it out because this lane has already paid once for a host-flavour
assumption (the `path.extname` bug in #2183), not because I have evidence.

Also carried forward from `win32-sep-guard.md`: any external-tool-output split
this arm adds must use `/\r?\n/`, never `'\n'`.

---

## Order of work this implies

1. **Token handoff** (unblocks Q1's dependency): mint per launch in the win32
   create path, export `KOSMOS_AGENT_TOKEN`, and pair it with `revoke()` on
   stop/delete per `sendertoken.js:46`.
2. **Decide the win32 writer's shape** with Pete, against his stated constraints
   (notify.js vocabulary, one selector keyed on recipient shape, the inbox
   socket, deliverability != liveness). 2b is the input to that call.
3. **Throttle key** off the minted session id, replacing the `nopane` collapse.
4. **Dedup migration** for `MARKER` before any second hook filename ships.

The two-question answer for Pete, in one line each: **the route is ready and
needs a token nobody mints on win32; the hook does not fire at all, because its
command is `bash` and there is no `bash`.**

---

# Progress, and two findings the work turned up (2026-09-05)

## DONE: item 1, the token handoff

`prepareSession` now mints the sender token beside the session id and returns
`env` (`KOSMOS_AGENT_TOKEN`, or `{}` so a caller can spread it blind), plus the
`token`/`instance`/`name` the retire needs. `abandon` takes the prepared OBJECT
and retires that run's token as well as forgetting the record.

Six tests through the real sendertoken store; the strongest resolves one prepared
session through BOTH arms the route uses — `resolveName` with no roster at all,
and `resolve` against the roster the real `win32roster` + `status.js` build — and
asserts they land on the same agent.

Design points worth keeping:

- **Keyed on `meta.name` with NO derivation.** The Mac has to derive the roster
  name from the tmux session (`${SESSION%-discord}`); here `meta.name` already IS
  the string the record stores, the roster emits, and `isNamedOurs` matches. The
  absence of a derivation is the correct code, not a missing step.
- **A failed mint does not fail the launch** (the supervisor's rule) but IS
  surfaced as `tokenBecause`, because the consequence differs on this platform:
  with no pane to fall back to, a tokenless win32 agent is CAPTURE-ONLY — it keeps
  live state and loses `needs_you`/`blocked`, the two words that mean a person is
  the blocker.
- **RETIRE, never REVOKE.** `revoke` drops every token for the name; one failed
  launch must not silence a healthy concurrent run.

---

## FINDING 1 (fixed): the Windows-coupling audit was disabled by Windows coupling

`engine/windows-coupling-audit-1732.test.js` builds its scan keys with
`path.join`, and its INVENTORY writes `file` as a forward-slash literal. On macOS
those are the same string. On Windows the key is `engine\status.js`, matches no
row, and `expectedCount()` returns 0.

Measured here: **all eleven classified files read as unclassified at once.**

```
engine\attachments.js [path-delimiter-literal]: 2 match(es), inventory accounts for 0.
engine\status.js      [fs-root-literal]:        2 match(es), inventory accounts for 0.
... nine more, every row in the inventory
```

So the ratchet built to catch Windows-hostile coupling was itself turned off by
Windows-hostile coupling, on the only platform it is about — and it is green on
this all-macOS fleet, which is the one place nobody would ever look.

`path.join` is on that file's own portable-API list, and the list is not wrong: it
is portable for REACHING a file, not for building a string you compare to a
literal. **The path flavour has to be chosen by what the value is FOR** — the same
sentence #2183 paid for with `path.extname`, in this same lane, three days ago.

Fixed with `relKey()`, guarded with two arms because one of them cannot see it:
an inventory-reachability invariant that runs everywhere, and a SOURCE PIN on the
key builder, because the reachability arm passes on macOS both before and after
the fix. Perturbation-verified on Windows (4 pass / 3 fail when reverted).

---

## FINDING 2 (open, needs a decision): the token's 0600 does not exist on Windows

This one matters more now that the work above makes win32 agents depend on that
store for their only credential.

`engine/sendertoken.test.js` fails **10 of 44** on Windows, and every failure is a
POSIX file-mode assertion (`438 !== 384` — 0o666 vs 0o600). Measured directly:

```
fs.writeFileSync(f, 'x', { mode: 0o600 })  -> mode reads 666
fs.chmodSync(f, 0o600)                     -> mode reads 666
```

Node's `chmod` on Windows toggles only the read-only bit; **owner-only is not
expressible**. So `securewrite.writeSecret`'s tightening — the whole of #1761 — is
a no-op on win32, and the mode-based guarantee is simply absent there.

⚠️ **BOTH FAILURES ARE PRE-EXISTING, PROVEN NOT ASSUMED.** Ran both files on a
detached clean `origin/main`: identical counts (sendertoken 34/10,
coupling-audit 4/1). Neither comes from this branch.

**The property is still met on Windows, but by a different mechanism, and nothing
checks it.** The real protection is the inherited NTFS ACL:

```
NT AUTHORITY\SYSTEM        FullControl  Inherited=True
BUILTIN\Administrators     FullControl  Inherited=True
PizzaRama\joshu            FullControl  Inherited=True
```

No other standard user has access — so a token under the user profile is in
practice as private as a 0600 file. But that is **inherited and incidental, not
asserted**. Move the store root somewhere with looser inheritance (ProgramData, a
shared volume, a mapped drive) and the confidentiality is gone with nothing red.

⇒ **This is the same asymmetry the `dl/` defect had**, and it is worth stating as
the general rule rather than as one more instance: *every assertion in this area
checks that something EXPECTED IS PRESENT — the mode we set, the directory we
made. Nothing checks that something UNEXPECTED IS ABSENT — that nobody else can
read the token.* On macOS the mode assertion is a proxy for that, and on Windows
the proxy silently detaches from the thing it stands for.

**Deliberately NOT fixed unilaterally.** Making those 10 tests pass on Windows
means either skipping them there (silencing a security assertion — the exact move
this codebase's guards forbid) or asserting the ACL instead, which is a real
posture decision: whether Kosmos ASSERTS an explicit ACL on `sendertokens/` at
creation on win32 rather than inheriting one. Proposed shape, for the card:
`securewrite.secureDir` grows a platform-injectable win32 arm that sets an
explicit owner-only ACL, and the tests assert the PROPERTY (no other principal can
read) per platform rather than the POSIX mechanism on both.

---

## Order of work, updated

1. ~~Token handoff~~ — **DONE** (this branch).
2. **Decide the win32 report-writer's shape** with Pete, against his stated
   constraints. Q2 above is the input: the hook is `bash "<path>"` onto a POSIX
   script that shells to `curl`, and there is no `bash`.
3. **Throttle key** off the minted session id, replacing the `nopane` collapse.
4. **Dedup migration** for `MARKER` before any second hook filename ships.
5. **Token confidentiality on win32** (Finding 2) — needs a card and a decision,
   not a test edit.

## Note for whoever runs this suite on Windows next

There is no `node` on PATH on this box, and no `bash` either. The suite entry
point is `bash tools/run-tests.sh`, so it cannot run as-is. These files were run
with the bundled runtime directly:

```
C:\Users\joshu\Downloads\kosmos-0.6.24-win-x64\runtime\node.exe --test engine/<file>.test.js
```

That is worth its own step in the port: the Windows dev loop currently has no
supported way to run the tests.

---

# Input for decision 2: what the win32 report writer can be built on

Pete's call to make, not mine. This is the measurement it should be made on,
taken on the Windows box 2026-09-05 rather than reasoned about.

## What a Windows hook can actually invoke

```
  bash         no          <- what reporthook.entryFor writes today
  sh           no
  jq           no          <- the hook script's JSON reader
  node         no          (not on PATH)
  pwsh         no
  curl.exe     YES         C:\windows\System32\curl.exe  (8.10.1, ships with Windows 10+)
  powershell   YES         C:\windows\System32\WindowsPowerShell\v1.0\powershell.exe
  cmd          YES         C:\windows\system32\cmd.exe
  claude       YES         C:\Users\joshu\.local\bin\claude.exe
```

Three of the four things the current chain needs are missing. `curl` survives,
which is the one people assume is missing.

## The bundle already ships the interpreter

```
kosmos-0.6.24-win-x64\
  app\
  runtime\node.exe        <- present
  Kosmos.cmd
  manifest.json
```

This matters more than the PATH table, because it maps onto the constraint the
hook script's own comment says is structural:

> 🔑 THE CLI IS THE ONE THIS SCRIPT SHIPPED WITH, resolved from the script's own
> location, never searched for. […] Shipping the script beside its CLI makes
> version skew structurally impossible.

`runtime\node.exe` sits at a fixed offset from `app\`, exactly like the installed
layout rung the resolver already probes for. So a node writer resolves its
interpreter the same way the bash one resolves its CLI — by RELATIONSHIP, not by
search — and the property that comment is protecting is preserved rather than
argued around.

## Proposed shape: a node script run by the bundled runtime

It removes all three missing dependencies at once, and it collapses a chain:

| | today (macOS) | proposed (win32) |
|---|---|---|
| hook command | `bash "<script>.sh"` | `<KOSMOS_HOME>\runtime\node.exe "<script>.js"` |
| read the event | `jq` (or a fallback parser) | `JSON.parse` |
| deliver | shell out to `install/kosmos` → `curl` | in-process `http` to the board |
| processes per firing | bash + subshell + curl (+ jq) | one |

It can also `require('./engine/selfreport')` directly rather than shelling to a
CLI, which is what makes the two-layer resolution problem disappear instead of
being ported.

### The constraint that decides it, measured

The hook fires on EVERY `PreToolUse`, so startup cost is the objection, and it is
the thing worth measuring rather than assuming:

```
bundled node, bare              min 33ms   median 36ms   max 41ms   (n=10)
bundled node + require(selfreport)   min 39ms   median 42ms   max 47ms   (n=10)
```

~40ms per firing, and that is against a Mac path that today spawns bash, a
subshell, and curl — so this is very likely CHEAPER than what ships, not a cost
to be traded off. (Measured with a control that genuinely failed — a spawn of a
non-existent binary — because a spawn measurement on this box that cannot fail is
not a measurement.)

### What this does NOT settle, and is still Pete's

- **The vocabulary and the selector.** Nothing above touches `notify.js`'s
  KINDS, the one selector keyed on recipient shape, or the inbox socket. A node
  writer changes the transport, not the interface.
- **deliverability != liveness.** The synchronous SessionStart delivery check
  (the one foreground send, the once-per-session place where failure is said out
  loud) has to keep that distinction. A node writer makes it easier to state,
  not automatically correct.
- **Whether the two writers converge.** A node writer that works on Windows would
  also work on macOS, so the honest question this raises is whether the bash
  script should survive at all, or whether this becomes one writer with one
  vocabulary. That is a bigger call than the win32 port, and I am not making it
  by shipping a second copy quietly.

### The two defects that must be carried, whatever shape wins

1. The throttle key: `${TMUX_PANE:-nopane}` collapses every paneless agent onto
   one mark. The minted session id is the ready-made per-agent key.
2. `reporthook`'s dedup `MARKER` is a filename, so a second writer under a new
   name stacks a hook instead of deduping. That needs a migration BEFORE any
   second filename ships, and it is not written down anywhere yet.

---

## Full-suite regression check (165 engine test files, Windows)

Ran every `engine/*.test.js` on this branch and again on a detached clean
`origin/main`, and diffed the two:

```
baseline (clean origin/main) files with failures: 55
branch                       files with failures: 54

in BRANCH but not baseline (regressions):  (none)
in BASELINE but not branch (fixed):        engine/windows-coupling-audit-1732.test.js  was 4/1
same file, different counts:               (none)
```

So the 54 remaining failures are pre-existing Windows platform failures —
**proven by control, not asserted** — and this branch's net effect on the suite is
one file moved from red to green. Not one file fails here that did not fail on
clean main, and no file fails harder.
