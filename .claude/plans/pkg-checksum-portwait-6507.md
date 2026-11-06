# pkg-checksum-portwait-6507 — scale the port-wait budget in test-pkg-checksum-1670.sh (#5727)

## Card
`Addresses #5727` (the flaky wall-clock test class). Seen-red reported by Baron Draxum
(2026-11-05 19:55 CST, card comment): `tools.pkg-checksum-home-6507.test.js` failed in the
Mac runner's suite (node) three times in a row on three unrelated heads (main `024df11c8f`,
PR #8077 at scale 1.38x, PigeonPete's #8074 at scale 1.18x). Every failure was the same inner
line: `FAIL  CONTROL: the harness cannot detect a run; every refusal arm above is vacuous`.
The file passes alone on Agent1s. Same class as C1/C2: a fixed wall-clock budget that false-reds
under fleet load.

## Root cause (confirmed by reading the script)
`tools/test-pkg-checksum-1670.sh` starts a local `python3 -m http.server 0` three times (setup
L55, ARM-4 flip server L245, final control L299) and polls the server log for the assigned port
with a **fixed** `for _ in 1..20; do … sleep 0.25; done` = **5 s**. Under fleet load python can
take longer than 5 s just to bind and print its port (process-spawn starvation), so the poll
times out.

Two defects, not one:
1. **The flake:** the 5 s port-wait is a fixed wall-clock budget — the exact #5727 class.
2. **The masking bug (the worse one):** the setup loop (old L69) and ARM 4 (old L273) both
   guard an empty port. The **final control did not** — on timeout it built
   `URL="http://127.0.0.1:/setup"` (empty port), `run_arm` fetched nothing, `RAN` was never
   written, and the control reported *"every refusal arm above is vacuous."* So a server-startup
   timeout masqueraded as a harness/logic failure, which is exactly the misleading line Baron saw.

## Fix (in-class with C1/C2, adapting Baron's suggestion)
Scale the WAIT (a liveness ceiling, never a stimulus delay) by the suite's time scale, the
established #5727 mechanism:
- Source `tools/lib/test-time-scale.sh`. Use `KOSMOS_TEST_TIME_SCALE` from the env when run under
  `run-tests.sh` (propagated into the node→bash child via `spawnSync({...process.env})`), else
  compute it live from the box. **floor 1** (a quiet box's SUCCESS path is unchanged — the poll
  breaks the instant the port appears) and **cap 4** (past that a stuck server is a real hang).
- Base **15 s**, scaled → 15 s at scale 1, 60 s at cap 4. The wait gives up after that many
  **elapsed wall-clock seconds** (bash `$SECONDS`), not after a fixed poll count: under load each
  `sleep`/`sed` also stretches, so a poll count understates the real give-up time — a seconds
  deadline is what makes the bound a true ceiling. Because the poll breaks the moment the port
  appears, the ceiling costs the happy path nothing; it only governs how long we wait before
  declaring a real failure. (Baron suggested 20 s; 15 s keeps the three sequential waits provably
  under the spawn timeout — see the ceiling bound below — and is still 3× the old 5 s, well above
  the observed 5–20 s loaded bind.)
- Consolidate the three identical loops into one `wait_for_port <log>` helper with honest
  diagnostics (names the budget + scale + server log on timeout).
- **Guard empty PORT in the final control:** a startup timeout now fails with
  *"the local origin did not start … so the run-vs-refusal control could not run"* (+ the server
  log), never the vacuous-harness line.

## Why it is safe / outcome-preserving
- **Happy path unchanged:** the loops break on the first poll that sees the port, so on any box
  that starts a server the runtime is identical (measured: 3.6 s standalone, 3.3 s at forced
  scale 4 — same). The scale only raises the give-up ceiling.
- **floor 1** means the budget is never shorter than before (it is *longer*: 5 s → 15 s base),
  so the change can only convert a false-fail into a pass, never a pass into a fail.
- Scaling a liveness ceiling never lowers an assertion or touches a stub's stimulus delay
  (the `KOSMOS_PKG_RETRY_SLEEP=0`/`RETRY_MAX` knobs, the flip server's first-hit-bad logic, the
  checksum arms) — all untouched.
- **Ceiling bound vs the harness timeout:** the node test is `timeout: 240000`, spawn
  `timeout: 230000`. Because each wait gives up on an elapsed-seconds deadline (`$SECONDS`), not a
  poll count, 3 × 60 s = **180 s** is a *true* upper bound on total give-up time at the cap (a poll
  count would not bound wall-clock under load — the iter-2 finding). With the fast arm work in
  between that stays under the 230 s spawn timeout, so even a pathologically slow box reports a
  clean per-arm result, never a SIGKILL. This is why the base is 15 s, not 20 s: 20 s × cap 4 × 3 =
  240 s would have crossed the spawn timeout. (All-fail is also bounded the other way: the setup
  loop exits the whole script on timeout, so the three never stack.)

## Weakest part (named)
The port-wait timeout path (helper returns 1) is **not exercised on a quiet box** — on this
hardware python binds in <250 ms, so every real run breaks on poll 1 and the new give-up/guard
branches are not hit end-to-end by the integration test. Mitigation: the branch logic is proven
by targeted unit (helper returns 1 on an empty log; the final-control `if ! PORT=…` path prints
the new "did not start … could not run" message, not the vacuous line) + the scale→tries mapping
table (floor/cap verified). The integration test proves the happy path and the no-regression of
the scaling at scale 1 and 4.

## Validation done before PR
- `bash -n` clean.
- Scale→seconds (base 15 s, elapsed-wall-clock deadline): 1→15 s, 1.38→20 s, 2→30 s, 4→60 s;
  empty/`abc`/`nan`→15 s (floor); 9/`inf`→60 s (cap). Never below the old 5 s; 3×cap = 180 s < 230 s
  spawn timeout (a true upper bound, since the deadline is wall-clock not poll count).
- Helper: breaks immediately on a real port line; returns 1 after budget on an empty log.
- Masking fix proven by unit: empty port → "did not start … could not run" + log.
- Node test green: standalone 3.6 s, forced `KOSMOS_TEST_TIME_SCALE=4` 3.3 s (outcome identical),
  second natural run green. 3/3 green.
- Then: blind challenge-loop to convergence + hash-verified proof, create-pr (no `--reviewer` on
  Mortals), CI green by name, merge per standing rule.
