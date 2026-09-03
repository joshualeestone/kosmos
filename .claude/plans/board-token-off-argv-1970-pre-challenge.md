---
pre_challenge: true
method: challenge-loop
branch: board-token-off-argv-1970
diff_hash: 1b26ad281eaa07425164e401b8e7c331998d81a78cef0589bf38afefa25ddff4
validation: passed
timestamp: 2026-09-03T06:44:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 fresh blind reviews (a mid-course rebase integrated #1968; the final
review ran against the integrated diff).
**Converged:** Yes (iteration 3, on the integrated diff, returned zero new
BLOCKER/WARNING/CONVENTION; reviewer: "Ship it").
**Total findings:** 0 BLOCKERs, 1 WARNING (a documented, card-sanctioned bounded residual,
not a code defect), 0 CONVENTIONs, several NITs (cosmetic / pre-existing / observations).
**Validation:** full repo gate `bash tools/run-tests.sh` green on the final HEAD --
3989 tests, 3989 pass, 0 fail (terminal tally present), including #1968's report/reply
anti-spoof tests passing with off-argv delivery.

kosmos#1970: the kosmos CLI delivered its board/agent tokens to curl via
`-H "name: value"`, putting the secret on process argv, which macOS `ps -ww -o args`
exposes cross-account -- a side channel around the mode-600 board.token file (#1946). Fix:
a token-agnostic `kosmos_curl` helper writes present auth headers to a mode-600 temp file
and passes curl `-H @file`; all six token-bearing CLI sites (msg/reply/post/whoami/report/
room) converted. Bounded residual (cmd_open + setup.sh open-once plist still put the token
in the browser URL on argv) accepted per the card and tracked as follow-up #1979.

### Per-Iteration Breakdown

#### Iteration 1 (pre-rebase)
**New:** 1 WARNING + NITs. The WARNING was the bounded-residual browser-open exposure, which
the reviewer itself called "a defensible scope call, not a blocker" (the card permits
"accept as bounded"), with a valid caveat: it is the LONG-LIVED board token and
"infrequent/interactive" is a flow property, not an enforced bound. A comment-accuracy NIT
noted "per-user temp dir" overstates when TMPDIR is unset (falls back to world-writable
/tmp, where the 0600 mode is the protection).
--> RESOLVED by tightening the three residual comments (durable/long-lived token; flow-not-
enforced; 0600 is load-bearing) and filing the follow-up #1979. The residual itself is
deferred to #1979 per the card's own language. Other NITs (cmd_post set-e dead-code:
pre-existing/out-of-scope; if-fi exit status: verified fine; no signal-trap: cosmetic 0600
litter; test-path coverage: token-agnostic, low risk) recorded, no code change.

#### Iteration 2 (pre-rebase)
**New:** 0 gating findings. The reviewer verified correctness by MUTATION (the argv-absence
assertion reds when a token is put back on argv; the positive control reds on a broken
header) and confirmed the two-header path builds and delivers. Only the same NITs
(pre-existing/acceptable/cosmetic). Converged on the pre-rebase code.

#### Rebase integration (origin/main advanced with #1968)
origin/main merged #1968 (harden report/reply against a cross-account loopback spoof), which
conflicted in install/kosmos. #1968 added `board_token || true` at callers and made
cmd_report AND cmd_reply present the board token (a new token-on-argv site my change had not
seen). Integration: kept `board_token || true` everywhere; converted cmd_report to send BOTH
agent+board tokens off argv and converted the newly-token-bearing cmd_reply; left no token
inline. Committed as a distinct commit. The full suite (incl. #1968's own report/reply auth
tests) stayed green. Because the diff changed materially, a fresh review was run.

#### Iteration 3 (post-integration)
**New:** 0 BLOCKER / 0 WARNING / 0 CONVENTION. The reviewer verified all six sites converted
with the right token args, every caller keeps `board_token || true`, #1968's anti-spoof
semantics pass off-argv (empirically + via #1968's tests), the new test is real and wired,
and kosmos_curl is correct under set -e on bash 3.2. Three cosmetic NITs, all cleared
("accurate in substance", "not a defect"). **Converged.** Shipped the reviewed text as-is.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status |
|---|------|----------|-----------|-------------|--------|
| 1 | 1 | WARNING | install/kosmos:cmd_open + setup.sh plist | browser-open leaks the long-lived board token on argv | DEFERRED to #1979 (card-sanctioned bounded residual; comments tightened) |
| 2 | 1 | NIT | install/kosmos (kosmos_curl comment) | "per-user temp dir" overstates when TMPDIR unset | FIXED (0600 is load-bearing) |
| 3 | 1/2/3 | NIT | install/kosmos (cmd_post) | rc-based timeout branch dead under set -e | ACCEPTED (pre-existing, out of scope, behavior preserved) |
| 4 | 1/2/3 | NIT | install/kosmos:kosmos_curl | return 99 surfaces a "could not reach" message | ACCEPTED (fails closed; near-impossible mktemp failure) |
| 5 | 1/2/3 | NIT | cli.token-off-argv-1970.test.js | agent-token path only tested directly | ACCEPTED (token-agnostic; two-header covered by #1968 test) |
| 6 | 3 | NIT | install/kosmos:285 | "CLOSED for every CLI call" slightly loose | ACCEPTED (next sentence names the residual; accurate in substance) |

### Strengths (verified across iterations)
- Argv-absence assertion is non-vacuous: mutating the code to put a token back on argv reds
  the test (verified in-session and by two independent reviewers).
- Full gate green on the final HEAD (3989/0), including #1968's report/reply anti-spoof tests
  passing with off-argv delivery -- the integration preserved #1968's behavior end-to-end.
- kosmos_curl fails closed, always cleans up (curl in an `if` so cleanup runs under set -e),
  mode-600 from creation, correct quoting on bash 3.2, two-header `-H @file` delivery verified.
- All six token-bearing CLI sites converted; no token remains inline (only cmd_open's browser
  URL, the tracked bounded residual).
