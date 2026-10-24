---
pre_challenge: true
method: challenge-loop
branch: iosroutes-7055
diff_hash: fd0efa1993b242e7b52c8e01d2f0b5bcd141ed33957daf59f4047c3da146903d
validation: passed (full suite via validation_log_run_or_skip at d98ea3cdc1, hash=fd0efa1993b2, EXIT=0, node 23487 pass 0 fail, shell-shard 286/286, 2026-10-24 15:30 CDT)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-24T20:32:09Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap), one fresh blind reviewer at a time.
**Converged:** No. Round 8 found no silent miss on today's tree and three silent warnings plus one false red on plausible Swift; all were fixed with a control case each but not re-reviewed (cap).
**Design change:** after five rounds of route-string heuristics kept missing shapes, round 5's fixes redesigned the parser to count requests: every request the app builds must be read, skipped for a stated reason, or declared.
**Total findings:** 4 BLOCKERs, 22 WARNINGs, 0 CONVENTIONs, 26 NITs. All addressed. Deferred: 0.

## Iteration 1
- [WARNING] Attachment file routes (path from the board) never checked. Fixed: declared and pinned.
- [WARNING] Unknown-route control could not fail on a reply that quotes the path. Fixed: byte for byte at every method and depth.
- [WARNING] A method set more than 3 lines after the URL read as GET. Fixed: read to the end of the builder; every httpMethod claimed.
- [NIT] Subfolders skipped; query strings dropped; variable-method check loose; no permanent red-path test; page deep links out of scope. Fixed or stated.

## Iteration 2
- [WARNING] Neighbour's method taken through closures and attribute-prefixed functions. Fixed: brace-depth scope, one claim per line.
- [WARNING] A second variable-method site read as GET silently. Fixed: variable method only on a declared route; callers matched exactly.
- [WARNING] Unknown-route control aimed at the wrong prefix. Fixed: per-route sibling control.
- [NIT] False red on a guard; comments and nested interpolation; extension avatar coverage by coincidence; sandbox parity. Fixed.

## Iteration 3
- [WARNING] Two literals on a line, a request without URL(string:), a path helper in another file. Fixed: reported.
- [WARNING] False red on coordinator requests via appendingPathComponent. Fixed: claimed.
- [WARNING] Block comments, multi-line strings, nested parens in interpolation. Fixed: whole-file scanner.
- [NIT] Braces in strings; caller regex on raw source; spacing around =; count wording; method-loss control. Fixed.

## Iteration 4
- [BLOCKER] A board route not written as one literal skipped silently. Fixed: partial paths, joins, unknown paths reported.
- [WARNING] No unclaimed-method check in files without a literal. Fixed: app-wide.
- [WARNING] Phone-notify callers missed on unusual spelling. Fixed: loose match and count.
- [NIT] Raw-string route; comments overclaimed. Fixed.

## Iteration 5
- [BLOCKER] Method taken from the next request bound to another variable. Fixed by redesign: method read only from the request's own variable.
- [BLOCKER] A request whose URL is built elsewhere neither read nor reported. Fixed by redesign: every request accounts for itself.
- [WARNING] False reds on ordinary Swift (file joins, web links, log lines). Fixed by redesign: string heuristics removed.
- [NIT] Stale comments; dead code; plan formatting. Fixed.

## Iteration 6
- [BLOCKER] Declared path helpers never checked their callers. Fixed: callers read and matched, scope checked against private.
- [BLOCKER] Any https URL skipped as another service. Fixed: an https URL with a board path is reported.
- [WARNING] Joins after the literal; method set in a branch; URL reassigned; more request shapes; httpMethod == as a set. Fixed.
- [NIT] Dead hidden-string code; controls for each shape. Fixed.

## Iteration 7
- [WARNING] A route written away from its request (URL built, fetched later). Fixed: every route literal must be used on its line or tied to SITES.
- [WARNING] Bare reassignment of the request variable swapped methods. Fixed.
- [NIT] Early return before the method hid the GET; other-service evidence read from the whole line. Fixed.

## Iteration 8
- [WARNING] Other path changes after the literal (appending(component:) and more). Fixed: allowlist after the literal.
- [WARNING] URL swapped on a builder's result. Fixed: every URL swap must belong to a found request or a SITES file.
- [WARNING] https URL with an interpolated host skipped. Fixed: host must be written out.
- [WARNING] False red on an unrelated guard. Fixed: only an exit that returns the request counts.
- [NIT] Typed bindings; header wording. Fixed.
