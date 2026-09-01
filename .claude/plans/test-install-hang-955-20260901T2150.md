# test-install-hang-955: the #910 selftest hangs on a stale bundle instead of failing

Branch: `test-install-hang-955` (worktree off origin/main). Addresses #955. Routed by Splinter.
Owner of the gate: Angel; taken with no conversation claim outstanding.

## Verified premise
`tools/test-install.sh:632` (inside the `#910` section) runs
`_swift_got="$("$KOS_SRC/app/bin/kosmos-app" --kosmos-app-port-selftest "$_uid")"`. A bundle
that PREDATES the `--kosmos-app-port-selftest` flag does not know it, starts the app normally,
and the app sits there -- so the command substitution never returns and the section hangs
(12 minutes, seen 2026-08-26). No FAIL, no timeout, no verdict; the log's last line is the
`== #910 ... ==` header, so it reads like progress. A stale `dist/` is the normal state of a
worktree that copied dist/ rather than rebuilding, so this recurs. "A gate that hangs is worse
than one that fails" (same class as a silent fail-soft).

## Fix design (Splinter's pointer: the two-arm premise check, per installed-cli-can-predate-the-verb)
Do not just add a timeout -- prove the flag is REAL by contrast. A #910-aware bundle ANSWERS
the real flag (a numeric port) and does NOT treat a known-FAKE flag the same way; a bundle
that predates #910 does not know EITHER flag, so it starts the app for both and they behave
identically (both hang). So:

1. `tools/lib/app-port-selftest.sh` (new, sourced by test-install.sh AND the test):
   - `bounded_run <secs> <cmd...>`: run the command in the background, kill it after <secs>,
     print its stdout, return its rc or 124 on timeout. macOS has no `timeout`, so this is a
     kill-after-N poll (the file already uses this shape for wait_for_file).
   - `kosmos_app_selftest_current <app> <secs>`: BEHIND (return 1) if the real flag hung (124),
     or the real and fake flags produced the same rc AND output, or the real flag did not
     answer a plain numeric port. CURRENT (return 0) otherwise.
2. Rewire test-install.sh #910: run `kosmos_app_selftest_current` first. If BEHIND, one chk
   FAIL naming that the bundle predates #910 and dist/ should be rebuilt (not a hang). If
   CURRENT, run the existing per-uid checks, each via `bounded_run` so a future regression
   cannot hang either.
3. `tools/test-app-port-selftest.sh` (new, red-capable): stub bundles under mktemp --
   a CURRENT stub (answers the real flag with the expected port, differs on the fake), a
   BEHIND-HANG stub (ignores all flags and sleeps, simulating the app starting), a BEHIND-EXIT
   stub (exits 0 with no port). Assert current->0, behind->1, and that bounded_run returns 124
   on the hanging stub WITHIN the timeout (the test itself must not hang). A real control: it
   asserts both the detect-current arm and the detect-behind arm.
4. Wire `tools/test-app-port-selftest.sh` into package.json test:shell (bash -n + run).

Not doing fix-shape #2 (VERSION sha compare) unless the loop asks -- the real/fake premise
check is the rigorous half and directly matches the bulletin.

## Checklist
- [ ] tools/lib/app-port-selftest.sh (bounded_run + kosmos_app_selftest_current)
- [ ] rewire test-install.sh #910 section to use it (source the lib; premise-gate the loop)
- [ ] tools/test-app-port-selftest.sh (stub-driven, red-capable, must not hang)
- [ ] wire the test into test:shell
- [ ] full suite green; the test reds a behind bundle and passes a current one
- [ ] /challenge-loop, PR, self-merge (repo-local test hardening; Angel owns the gate but the fix is add-only)
