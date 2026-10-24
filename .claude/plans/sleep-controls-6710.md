# sleep-controls-6710: long-lived bare `sleep` controls a stray pkill can end

Card: joshualeestone/kosmos#6710 (Kano), a #6671 follow-up. Liu Kang's ruling and done line:
m6232/m6235/m6242/m6244. Mona Lisa owns #6671 (branch leakctl-6671); her two files are OUT of scope here.

## The problem
On this shared box a stray `pkill -f sleep` (matching any command line that contains "sleep")
can end a test's long-lived stand-in CONTROL process mid-test. #6671 measured it: a `pkill -f
"sleep 6"` at 05:50 CDT killed a leak-guard `sleep 60` outside-the-root control, failing that
control with no fault in the guard. #6710 is the follow-up for the other such controls.

## Finished means
- Every must-stay-alive CONTROL stand-in in the scoped files no longer has `sleep` in its command
  line: it is a `perl -e 'select(undef, undef, undef, N)'` bounded wait (the shape Mona Lisa's
  review-1 settled on over `tail -f /dev/null`, because a bounded wait still ends by itself if a
  test's cleanup never runs). Same wait length or longer; `exec` kept where the pid must stay the
  same process (cwd/ancestry reads).
- Each changed test still passes (run one-by-one, not the whole suite; box free only).
- A guard in `test:shell` stops new bare-sleep controls coming back.

## Scope (Liu m6235: "the remaining class = 18 sites in 4 files from [Mona Lisa's] grep")
THIS PR converts the four files Mona Lisa's `grep -nF 'sleep 6'` handed to #6710. Classified by
three blind reads; verdicts verified against the decisive assertions:

- **tools/test-tunnel-handshake-gate.sh** (1): line 252 `sleep 30 & LIVE` (lock holder, pid-only).
  Left: lines 88, 209 are `exec -a`-renamed (runtime argv0 is `kosmos-gate-stub-…`/`kosmos-tunnel …`,
  no "sleep" — proven immune, see below).
- **tools/test-queued-heavy-4977.sh** (2): 319 `sleep 60` (GIT5923), 352 `sleep 600` (OTHER5923),
  both pid-killed, command self-sourced or not read. Left: line 75 `sleep $((U+9))` holder and the
  `sleep $((U+n))` command-under-test family are matched by EXACT unique length (`^sleep $((U+n))$`),
  the file's deliberate design (line 8: "never a broad pattern"); converting breaks the matcher.
  **Differs from Mona Lisa's list:** her line 177 is a FALSE hit — that `sleep 600` is perl's own
  internal sleep; the real process there is `sleep $((U+5))`, command-under-test, left as-is.
- **tools/test-light-side-4911.sh** (~19): HOLDER/OTHER/ORPHAN (19/20/23, `sleep 600`), the
  `exec sleep 30` light-side claim-holders (124/255/384/402/452/461/470/487), R/R2/R3 (279/303/308/354),
  PM inner `sleep 63` (335, argv0 ms-playwright path kept), PF `exec sleep 64` (357), SPG (480),
  and the generated queued-heavy.sh inner `sleep 600` (179). Left: the `/bin/sleep` COPIES at the
  real-matcher fixture (331/332/338) are exec'd under a browser path (argv0 = path, no "sleep"); and
  they are ad-hoc re-signed by the test itself (lines 325-327), because macOS SIGKILLs an unsigned
  copied system binary.
- **tools/test-cut-guard.sh** (~30): SUITE/SUITE2 (20/517, `sleep 3600`), all the `( cd X && exec
  sleep 30 )` cut/kt/frozen stand-ins and `( exec sleep 30 )` p1/p2 (90/91/122/123/156/199/213/385/393),
  `( sleep 30 )` pR/pC (417/428), mcp (612), the `sleep 60`/`sleep 300` suite-waiter/zone/queue
  stand-ins (651/879/981/1016/1028/1078/1098/1142/1183), the PAIRP inner `sleep 3600` (518), the
  deep tree's inner `sleep 60` (678), and the mark-harness.sh body `sleep 30` (451). **q_ready's
  default glob changed `sleep*` -> `perl*` IN LOCKSTEP** (line 35): q_ready is pid-scoped (polls
  `ps` for ONE given pid until its command matches the glob), so this regates only the converted
  stand-ins; a before/after count in the PR shows every stand-in still reaches ready. Left: the
  `--sleep N` seams of the fixture test-install.sh/run-tests.sh (the real installer CLI, matched by
  script name; a kill degrades the arm to a SKIP via its kill -0 gate) and the fake run-tests.sh
  busy-loop `while :; do sleep 1`.

**Beyond this PR (the honest reading of "every control"):** bare-sleep controls also live in ~8
OTHER test-*.sh (test-browser-run-guard.sh, test-site-autodeploy-5589.sh, test-pause-foreign-board-964.sh,
test-cut-claim-renew-5134.sh, test-stopmark-6651.sh, and matched-by-name ones in test-connector-verbs.sh
`^sleep 300` and test-data-root-1511.sh `pgrep -fx 'sleep 37'`). Liu scoped #6710 to the 4 files;
these are allowlisted in the guard and named on the card as a follow-up. (Awaiting Liu's ruling on
whether to fold them into this PR; recommendation is the follow-up.)

## The immune-proof (Liu m6242: show it, do not reason it)
Ran `pgrep -f sleep` against a live instance of each shape:
- bare `sleep 60`: MATCHED (positive control — pgrep -f sleep works here).
- `exec -a NAME sleep 60`: NOT matched (argv0 is NAME). Immune.
- `sh -c 'sleep 63; :' <path>`: parent MATCHED (its `-c` body carries "sleep 63"), child MATCHED.
  So PM is NOT immune as-is; converting its inner sleep to perl removes "sleep" from both. (The proof
  caught a wrong "immune" assumption.)
- `/bin/sleep` COPY exec'd by a browser path: SIGKILLed on this box when NOT re-signed (moved Apple
  binary); the real test re-signs it (ad hoc) so it runs, and its argv is the path (no "sleep").

## The guard: tools/test-sleep-control-guard-6710.sh (in test:shell)
Scans tools/test-*.sh and FAILS on a bare long-lived sleep control: `exec sleep <int>` (not
`exec -a`), a `sleep <int>` backgrounded (`& `), or `( sleep <int>`. Excludes fractional sleeps,
`--sleep`, `sleep $((...))`, `do sleep`, `sleep "$var"`, comments, and a `# sleep-control-ok`
author opt-out. Has a must-FLAG battery and must-ACCEPT controls (both arms, like
test-precommit-pipe-lint-4911.sh), asserts the 4 converted files are clean, and ALLOWLISTS
Mona Lisa's 2 files (pending leakctl-6671; Kano removes the entries in a follow-up when it merges)
plus the ~8 out-of-scope files (follow-up card).

## Decided
- perl select over tail -f /dev/null: bounded, self-terminating (no leak if cleanup misses) — the
  shape Mona Lisa's review-1 chose, and the one already in tools/lib/app-port-selftest.sh:47.
- Double-quoted perl where the conversion sits inside a single-quoted `bash -c`/`sh -c` string;
  single-quoted elsewhere (matches Mona Lisa's idiom). The deep nested `sh -c "..."` case uses `\"`.
- exec kept for cut_self/kt_*/frozen/PF (cwd/ancestry read the same process) per Liu's condition.

## Weakest part
The guard's matcher is a line regex; it catches the common persistent shapes (`&`, `exec`, `( sleep`)
but a genuinely novel shape could slip past until a reviewer or a `# sleep-control-ok` opt-out names
it. It is validated by a two-armed battery, not proven complete. Also: behavioral validation (running
each of the 4 tests) is pending the box freeing (reserved for the 0.7.61 cut); until then only bash -n
and the guard's own battery have run. A conversion that bash -n accepts could still misbehave at run
time (e.g. a q_ready that no longer matches) — that is exactly what the per-file run must confirm.

## Merge
Reviewer: Raiden (plain text in the PR body, per the no-reviewer-flag rule on Mortals). Addresses #6710.
Do NOT merge until Liu relays Splinter's lift (0.7.61 hold).
