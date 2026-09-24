# A targeted, auditable 3b override: KOSMOS_BC_ACCEPT_KNOWN (kosmos#1398b)

## Why
The 0.6.91 staging cut is blocked at 3b by three checks (render-thread,
render-firstrun-wizard-flow, render-push-718) that are NOT a 0.6.91 signal: they
fail on the 0.6.90 build code too, on both boxes, from a fleet-wide headless
browser-check env issue tracked in #3542, while render-fields (the one real 0.6.91
regression) is already fixed. There was no way to cut past those without either
hiding Playwright to trip the "no browser" skip (drops ALL page coverage) or
skipping 3b entirely. Splinter asked for a durable, targeted lever instead.

## What
`KOSMOS_BC_ACCEPT_KNOWN=<comma/space list>` + `KOSMOS_BC_ACCEPT_REASON="<why>"`:
accept ONLY the named failing page checks, with a mandatory reason; every other
failure still gates the cut. The accepted checks + reason are logged loudly and
recorded in the release log, and release.sh requires the reason to appear in the
served versions entry, so a shipped run that leaned on this can never read as a
clean pass.

## Design
- `tools/lib/bc-accept-known.sh`: `kosmos_bc_apply_accept_known` operates on the
  caller's global FAILED array (as browser-checks.sh's summary already does with
  RAN/RETRIED/FAILED), moving named failures into ACCEPTED_KNOWN. Matches by check
  NAME (first token) so a "name (failed twice)" suffix still matches. No reason ->
  appends a failure (refuse). A named check that did not fail -> a prune note, never
  a gate. In a lib so it is unit-tested directly, no browser/board.
- `tools/browser-checks.sh`: sources the lib and calls the function in the summary,
  just before the FAILED gate, AFTER the #2445 allowlist bookkeeping.
- `tools/release.sh` (3b step, the shared gate after both the standard and the
  #2760 overlapped path): when the page gate passed and the log shows an accept,
  writes `accepted_known=... reason=...` to cut-suite-runs.log, and REFUSES unless
  KOSMOS_BC_ACCEPT_REASON is present in the versions entry file -- so the served
  page names what shipped un-verified.

## Verification
- `tools/test-bc-accept-known-1398b.sh` (wired into package.json test:shell) drives
  the function: accept+reason removes the named check and logs the reason; no reason
  refuses; an un-named failure still gates; a suffixed entry matches by name; a
  named-but-passing check prints a prune note; comma lists parse; no accept var is a
  no-op. All pass.
- End-to-end on this box: `KOSMOS_BC_CI_ALLOWLIST=render-thread
  KOSMOS_BC_ACCEPT_KNOWN=render-thread KOSMOS_BC_ACCEPT_REASON=... browser-checks.sh`
  exits 0 with the loud ACCEPTED banner; the same without a reason exits 1.

## Scope / not in scope
- This does NOT decide whether the three checks are real; #3542 owns the headless
  env root cause. This lever lets a staging cut proceed with them NAMED and reasoned
  while that is fixed. render-push-718 is flagged unverified for Josh's staging test.
- The release.sh recording lives at the shared 3b gate, so it covers both the
  standard and the #2760 overlapped paths (the gate check runs after both).

## Weakest premise
That accepting a check whose failure is env (not code) is safe for a STAGING build.
It is: staging is for Josh's test, prod stays for Josh, the reason is in the artifact,
and every other page check still gated. If a named check later recovers, the prune
note surfaces it so the accept list shrinks rather than hides a real future red.
