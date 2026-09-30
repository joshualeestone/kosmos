# sandboxpause-4651: the update pause fails closed in a sandboxed shell

Card: joshualeestone/kosmos#4651. Stacked on sandbox-4636 at bc08ac81d (Johnny agreed, m3792; he owns status exit 5 and _shell_is_sandboxed and messages each new head).

## Measured on Mortals (2026-09-30 ~01:30Z)
Setup: a stub board on 127.0.0.1:47651, with **main's pause block (`install/setup.sh` lines 2694-2819) run verbatim** in a harness (stub `kosmos`, a throwaway `KOSMOS_HOME`, `set -e`).

| Shell | curl | lsof | ps | What the pause block does |
|---|---|---|---|---|
| normal | answers | sees the pid | works | (the stub is not "ours", so it takes the #964 branch; a control only) |
| `(allow default)(deny network-outbound)` (#4636's profile) | **7**, 0 ms | **sees the pid** | denied (71) | **DIE after 11 s** at the lsof "gone by port" guard, **before any change**. But it says: *"A process is still holding port … Quit it (or run 'kill <pid>')"*, which is an instruction to kill the person's **live board**. |
| `… (deny process-info*)` (stricter) | 7 | **fails** ("can't get PID byte count: Operation not permitted", rc 1) | denied | **PASSES THE PAUSE** ("the update would now replace files"), because the guard's `lsof … \|\| true` reads an lsof **error** as "nothing listening". **This is the card's bug.** |

Also measured: #4636's `kosmos status` at bc08ac81d. Under the first profile it exits **5** ("running, but this shell cannot connect"). Under the stricter one it exits **1**: *"Kosmos is not running, and another app is using port …"*. So "stop on status exit 5" alone (the card's suggested fix) **misses the case that actually updates under a live board**. Raised with Johnny, who owns exit 5 and `_shell_is_sandboxed` in #4636.

Nothing before the pause writes to the install except `mkdir -p "$KOSMOS_HOME" "$BIN_DIR"` (line 2649). So stopping at the pause does mean "no file changed".

## The fix (install/setup.sh only, stacked on sandbox-4636 at bc08ac81d, with Johnny's agreement)
1. **The pause's post-condition fails CLOSED.** The update goes past the pause only on positive evidence that the port is free. An `lsof` that errors (non-zero **with** stderr, or a denial) is **unknown**, never "free". Unknown stops the install before any change.
2. **Blocked shell, one sentence.** When the probe cannot connect (curl 7) and the shell cannot see the board (Johnny's `kosmos status` exit 5, or an unknown port reading), the installer stops with: run the install line from a normal Terminal; nothing was changed. Not "kill <pid>", and not "another app". It **calls** #4636's `status` and never redefines its checks (Johnny's ruling, m3795).
3. **Outside a sandbox nothing changes.** The existing branches (#964, #2055's abort streak, the ten-second drain grace) keep their words and order.

## Tests
- A shell test that runs the **real** pause block under `sandbox-exec` with both profiles against a node stub board. Both must stop, change nothing (checksums of a planted `app/` before and after), and say "normal Terminal".
- **Controls:** each arm is measured red on the current code. The stricter profile gets past the pause today, and the first profile gives the kill advice today. There is also an outside-sandbox arm where nothing changes. Node only for listeners: `/usr/bin/python3` is the Xcode stub here.
- Light runs only, and no real install on this box.

## Weakest premise, named first
**That the two profiles I measured stand for the sandboxes real agent harnesses use.** A harness that denies `network-bind` or `file-read` more widely could fail a different way: for example, curl rc 1 or 6 instead of 7, or `lsof` absent. The design answers with fail-closed (any unknown stops the install), so an unseen profile is refused, not updated under. The cost is that it could also refuse an unusual but **free** machine. That is the direction I chose: a refused update can be re-run from Terminal, and an update under a live board cannot be undone.

**What would change my mind:** a real harness profile where a free port reads as unknown on an ordinary install (that would need a narrower "unknown"), or Johnny's `status` growing a port reading that works without lsof. Then I would call that instead.

**Release lane:** `install/setup.sh`, so the release lane reads it before a cut.

## Decided while building
- **The installer does not call `kosmos status`.** At the pause, the only kosmos on disk is the installed (OLD) CLI: the new bundle is installed after the pause (`install_kosmos`, after the pause block). So exit 5 is not there on the first update after release. The installer decides from its own port facts (curl exit code, lsof result or error). It neither calls nor redefines #4636's checks.
- **curl 7 plus a listener is read as a blocked shell.** Outside a sandbox a listener that accepts gets a connection; a wedged one times out (28). So only a shell that may not connect reads 7 while lsof sees a listener.
- `lsof -w`, so warnings (a stale network mount) never read as a failure.

## Done
- c2e4168fd: the fix in install/setup.sh.
- d720fee74: tools/test-setup-pause-sandbox-4651.sh, wired into test:shell. 7/7 with the fix; 4 red without it (A: kill advice; B: passed the pause, twice; B free port: passed).
- Also run: tools.shell-shard-4317 12/12, test-pause-foreign-board-964 12/12, test-update-abort-2055 10/10. server.connect.test.js has 1 failure (OpenAI accounts route) that is identical at bc08ac81d without this change: not this branch.

## Owed
- Challenge loop. Full validation (heavy: waits for Liu Kang's go). Restack on each new #4636 head. Release-lane read.
