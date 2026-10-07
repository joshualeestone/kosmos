---
method: challenge-loop
branch: linuxclaude-5419
diff_hash: 3edb65f080149eefe0a875c1b6bef719e6e4d9bc57113bf65cc1489e9d29b8b1
timestamp: 2026-10-07T09:38:49Z
converged: true
---

# Challenge-loop proof: linuxclaude-5419 (#5419 slice 1, Linux downloads Claude Code)

The board on Linux downloads Anthropic's own linux-<arch> or linux-<arch>-musl build, checksum-verified against the
manifest before it is placed or run, and refuses in plain words where it cannot finish (an arch Anthropic does not
build; no tmux to sign in with, checked at the start of the flow, at download and at sign-in). Blind reviewers
alternated Sonnet and Opus for 33 iterations. Iteration 19 converged; the full validation then found one failure (two
test seams unexcused in the reachability guard), whose fix re-entered the loop, and iterations 20 to 32 found further
real gaps (the musl library check, the C-library rule with gcompat and Debian musl, the tmux hint, a lane test of
the real detection); iteration 33 found nothing beyond NITs, so the loop converged again. Every FIXED finding with a behaviour change has a test that went red with its defect planted. The Linux
lane (linux.yml, dispatched on the branch) was read per file: the four connect files it had listed as red for #5419
pass on Linux; runners, server.runners and muserun stay red for slice 2.

#### Iteration 1
- [WARNING] engine/connect.js:1072 (BRANCH): non-x64/arm64 linux arch mapped to x64. FIXED: 22465b0ee (test planted red)
- [WARNING] engine/connect.js:1064 (BRANCH): musl detection fails open to glibc. FIXED: 22465b0ee (loader fallback; test)
- [WARNING] engine/runners.js:1322 (PRE-EXISTING): runners.install claude darwin-only. DEFERRED: Windows parity (connect path); slice 2; plan
- [WARNING] engine/connect.test.js:2930 (SELF): rejects without matcher. FIXED: 22465b0ee
- [WARNING] engine/connect.test.js:2918 (SELF): default-detector assertion untestable. FIXED: 22465b0ee (removed; detectMusl tested)
- [WARNING] - (BRANCH): Linux install-and-resolve unverified. DEFERRED: CI lane #4919; plan weakest premise
- [CONVENTION] engine/connect.js:1055 (SELF): stale platformKey/download comments. FIXED: 22465b0ee
- [CONVENTION] engine/platform.js:50 (SELF): stale CLAUDE_DOWNLOADS comment. FIXED: 22465b0ee

#### Iteration 2
- [WARNING] engine/connect.js:173 (BRANCH): Linux sign-in dead end (homebrew tmux default). FIXED+DEFERRED: 6288ff7e7 (PATH tmux default; real Linux sign-in proven in #4919/D; plan)
- [WARNING] engine/connect.js:1076 (SELF(it1)): getReport without excludeNetwork. FIXED: 6288ff7e7 (test planted red)

#### Iteration 3
- [WARNING] engine/connect.js:172 (SELF(it2)): bare tmux instead of create's Linux picker. FIXED: 76e5a1a43 (test planted red)
- [WARNING] engine/connect.js:2241 (BRANCH): canInstallClaude not gated until lane passes. DEFERRED: no Linux board until D; D + #4919 prove it; plan
- [WARNING] engine/connect.js:1076 (SELF(it1)): musl from a missing glibc field alone. FIXED: 76e5a1a43 (loader cross-check; test)
- [CONVENTION] engine/platform.js:76 (SELF): dated measurement in a source comment. FIXED: 76e5a1a43 (moved to plan)

#### Iteration 4
- [WARNING] engine/connect.js:1072 (SELF(it3)): comment claims checksum guards a wrong musl guess. FIXED: f448827f1 (comment + plan)
- [WARNING] engine/connect.test.js:2963 (SELF(it3)): tmux test expected value from code under test. FIXED: f448827f1 (seams; literal paths; planted red)

#### Iteration 5
- [WARNING] engine/connect.js:176 (SELF(it2)): no tmux: 200MB download then sign-in ENOENT. FIXED: fcdc5eb75 (pre-download check; test planted red)
- [WARNING] engine/connect.js:1099 (SELF(it1)): musl cache filled on non-Linux host. FIXED: fcdc5eb75
- [WARNING] engine/connect.js:1064 (SELF(it1)): platformKey doc detached; 'maps to darwin'. FIXED: fcdc5eb75

#### Iteration 6
- [WARNING] engine/connect.js:178 (SELF(it2)): unreliable launcher tmux pick on Linux trusted. FIXED: 6143b9873 (fall through; test planted red)
- [WARNING] engine/connect.js:1182 (SELF(it5)): wired tmux guard untested. FIXED: 6143b9873 (seam; test planted red)
- [WARNING] engine/connect.js:681 (BRANCH): canInstallClaude true on every Linux host. DEFERRED: dup of row 12 (plan decision)

#### Iteration 7
- [WARNING] engine/connect.js:1189 (SELF(it5)): Linux download tests depend on host tmux. FIXED: 67ab9c367 (seam pinned)
- [WARNING] engine/connect.js:181 (SELF(it2)): win32 tmux default changed. FIXED: 67ab9c367 (control planted red)
- [WARNING] engine/connect.js:1117 (BRANCH): wrong musl build undiagnosable. DEFERRED: dup of row 15 (plan)
- [WARNING] engine/connect.js:1189 (BRANCH): connect and create tmux picks can differ. DEFERRED: Linux sign-in unproven, rows 9/12 (plan)

#### Iteration 8
- [WARNING] engine/connect.js:181 (SELF(it6)): guard vouches for a tmux agents do not use. FIXED+DEFERRED: 20a76fd8d (sentence narrowed to sign-in; agent pick is D's; plan)
- [WARNING] engine/connect.js:687 (BRANCH): offer shown where download will refuse. FIXED: 20a76fd8d (local facts folded in; test planted red)

#### Iteration 9
- [WARNING] engine/connect.js:689 (SELF(it8)): hidden offer leaves Linux screen with no reason. FIXED: 3870c0826 (reverted it8 gating)
- [WARNING] engine/connect.js:696 (SELF(it8)): tmux walk on every state poll. FIXED: 3870c0826 (reverted)
- [WARNING] engine/connect.js:171 (BRANCH): agent tmux pick differs. DEFERRED: dup of row 27 (D)
- [WARNING] engine/connect.js:1096 (BRANCH): musl on glibc+musl-tools. DEFERRED: dup of rows 15/25
- [CONVENTION] engine/connect.test.js (BRANCH): name the runner for Linux-only paths. FIXED: 3870c0826 (plan: linux.yml #4919)

#### Iteration 10
- [WARNING] engine/connect.js:1100 (SELF(it3)): detectMusl doc + plan Change describe old rule. FIXED: efa754c6a
- [WARNING] engine/connect.js:181 (BRANCH): agent tmux pick vs guard. DEFERRED: dup of row 27; written into D's plan (handoff)
- [WARNING] .github/workflows/linux.yml (BRANCH): Linux lane never ran on this branch. FIXED: dispatched run 37563836935; plan; read before merge

#### Iteration 11
- [WARNING] engine/connect.js:1192 (SELF(it5)): default-platform download tests fail on tmux-less Linux. FIXED: f4e493051 (file-wide pin)
- [WARNING] engine/connect.js:194 (SELF(it3)): tmux pick walks PATH every tick. FIXED: f4e493051 (30 s memo; test planted red)
- [WARNING] engine/connect.js:1083 (BRANCH): wrong-libc undiagnosable. DEFERRED: dup of rows 15/25/32
- [WARNING] web/index.html (BRANCH): Linux screen copy unaudited. DEFERRED: plan: Linux-blind copy; say so in the PR
- [CONVENTION] engine/connect.js (SELF): review-N tags. FIXED: f4e493051
- [CONVENTION] engine/connect.js:1137 (PRE-EXISTING): download doc above sha256File. FIXED: f4e493051
- [CONVENTION] plan (BRANCH): lane result unverifiable from diff. DEFERRED: read the run before merge (process step)

#### Iteration 12
- [WARNING] engine/connect.install-997.test.js:48 (SELF(it5)): other test files hit the tmux guard on Linux. FIXED: f91b39166 (pinned in 4 files)
- [WARNING] engine/connect.js:1197 (SELF(it5)): no-tmux only checked at download; sign-in ENOENT. FIXED: f91b39166 (launchSignin check; test planted red)

#### Iteration 13
- [WARNING] engine/connect.js:213 (SELF(it11)): memo caches the bare fallback. FIXED: 0d72353fb (test planted red)
- [WARNING] engine/connect.js:2748 (BRANCH): stuck screen way out Mac-shaped on Linux. DEFERRED: card #5449
- [WARNING] .github/workflows/linux.yml:14 (SELF): green claim not backed. FIXED: 0d72353fb (reading cited; per-file count was run before)
- [WARNING] engine/connect.js:1098 (BRANCH): musl on multi-libc. DEFERRED: dup rows 15/25/32/39
- [WARNING] engine/connect.js:2420 (BRANCH): install-and-resolve unproven on Linux. DEFERRED: dup row 6 (plan weakest premise; D + lane)

#### Iteration 14
- [WARNING] engine/connect.js:1210 (SELF(it5/12)): no-tmux at download shows a generic headline. FIXED: f1200963e (runFlow check; test planted red)

#### Iteration 15
- [WARNING] engine/connect.js:191 (SELF(it11)): held pick not re-checked. FIXED: 05e509768 (test planted red)
- [WARNING] engine/connect.js:200 (BRANCH): sign-in vs agent tmux differ. DEFERRED: dup row 27 (#4920)
- [WARNING] engine/connect.js:1155 (BRANCH): install-and-resolve unproven. DEFERRED: dup row 6
- [WARNING] .github/workflows/linux.yml:14 (SELF): header claim unverifiable. FIXED: 05e509768 (evidence in plan)

#### Iteration 16
- [WARNING] engine/connect.test.js (SELF(it12/14)): launchSignin guard test cannot fail. FIXED: 3c701ae34 (two-step seam; planted red)
- [WARNING] .github/workflows/linux.yml:14 (SELF): lane read predates it12-15. FIXED: lane re-dispatched on 3c701ae34; cite that run once read

#### Iteration 17
- [WARNING] engine/connect.js:2423 (SELF(it14)): signed-in reinstall blocked without tmux. DEFERRED: decided (agents need tmux); plan; pinned by test 8797a4c79
- [WARNING] engine/runners.js:1322 (BRANCH): runners.install claude darwin-only unexplained. FIXED: 8797a4c79 (comment at the gate)
- [WARNING] engine/connect.js:1096 (BRANCH): musl multi-libc. DEFERRED: dup rows 15/25/32/39/49
- [WARNING] engine/connect.js:1117 (BRANCH): unknown arch refused (arm on arm64 kernel). DEFERRED: accepted fail-closed; tested
- [CONVENTION] engine/connect.test.js (SELF): no test for haveBinary=true + no tmux. FIXED: 8797a4c79

#### Iteration 18
- [WARNING] engine/connect.js:186 (SELF(it5/12)): production branch of the tmux check untested. FIXED: b182bf58e (Linux-lane arm + off-Linux arm; Mac arm planted red)

#### Iteration 19
- [WARNING] engine/connect.js:193 (BRANCH): sign-in vs agent tmux pick. DEFERRED: dup row 27 (#4920)
- [WARNING] engine/connect.js:1100 (BRANCH): musl multi-libc. DEFERRED: dup rows 15/25/32/39/49/60
- [WARNING] engine/runners.js:1309 (BRANCH): runners.install claude darwin-only. DEFERRED: dup row 59; traced: the only production caller is POST /api/runners/<p>/install, which refuses claude on Linux exactly as on Windows (Connect installs it)
- [WARNING] engine/connect.js:3620 (BRANCH): memo state between tests. DEFERRED: not an issue: every memo test uses its own fake launcher key, so the real key is never memoized by a test; resetForTests clears it
- [CONVENTION] plan (BRANCH): platform-gate-wiring named but not in diff. DEFERRED: not a defect: it is an existing test the plan relies on; ran 3/3 at b182bf58e

### Final Ledger
- 68 rows over 19 iterations; converged at iteration 19 (zero new findings).
- Deferred with reasons: the agent path's Linux tmux pick (#4920), the Linux stuck copy (#5449), Linux install-and-resolve
  (the lane and piece D), musl on multi-libc hosts, runners.install('claude') (slice 2).
- converged: true

#### Iteration 19 (6j)
- [BLOCKER] engine.reachable.test.js:49 (BRANCH): final-validation: two test seams unexcused in the reachability guard. FIXED: 08eb8e5e1 (EXCUSED rows; control red)

#### Iteration 20
- [WARNING] engine.reachable.test.js:50 (SELF(6j fix)): excuse names runners.linux-5419.test.js, absent on this branch. FIXED: 8dbc7289b
- [WARNING] engine/connect.js:2425 (SELF(it8/9)): runFlow refuses Linux-no-tmux even with Claude installed. DEFERRED: decided at it8/9 (agents run in tmux); stated in the PR body
- [WARNING] engine/connect.js:1128 (BRANCH): musl cache/compat-loader edge. DEFERRED: reviewer accepts; detectMusl glibc-named branch covers it
- [NIT] comment order above LINUX_NO_TMUX (left); "Review N" residue (left); memo scope comment (left); linux.yml header run claim (posted on PR, left: editing invalidates proof).

#### Iteration 21
- [WARNING] .github/workflows/linux.yml:14 (SELF(it10 header)): lane claim predates later connect changes. FIXED: 1535c8153 (dated to 3870c0826; fresh lane 37585561715 dispatched on HEAD)
- [WARNING] engine/connect.js:1099 (BRANCH): Alpine musl build needs libgcc/libstdc++/ripgrep. DEFERRED: unreachable until D; plan records it for D (#5445 list)
- [NIT] tmuxMissingOnLinux comment order (FIXED); tmux seam excuse wording (FIXED); setTmuxCheckForTests not test-gated (left: siblings vary); dead setMusl line (FIXED).

#### Iteration 22
- [WARNING] engine/connect.js:208 (BRANCH): memo hit arm untested. FIXED: d6680ad89 (hit test + control; no-memo plant red)
- [WARNING] engine/connect.js:1143 (SELF(it21)): musl runtime gap stated only in the plan. FIXED: d6680ad89 (code comment at platformKey)
- [WARNING] .github/workflows/linux.yml:14 (SELF(it21 fix)): dated green claim still in a long-lived header. FIXED: rewrite to cite lane 37585561715 once read per file
- [WARNING] .github/workflows/linux.yml:14 (SELF(it21 fix)): dated green claim. FIXED: 9447d6ced (cites 37585561715 on the connect code)
- [NIT] comment placement above LINUX_NO_TMUX (dup it20, left); "Review N" residue (dup, left); excuse "when runnable" (left); bare 'tmux' sentinel (not reachable, left).

#### Iteration 23
- [WARNING] engine/connect.js:187 (BRANCH): tmux elsewhere reads as missing; hint says only install. FIXED: d6307e2d0 (hint names the folders searched + link into /usr/local/bin)
- [WARNING] engine/connect.js:194 (SELF(it2/3, plan)): sign-in and agents pick tmux differently. DEFERRED: D's plan now carries it (linux-setup-4920 plan, 02:32)
- [NIT] excuse wording (FIXED); plan overlong line (left); serveRelease key via platformKey (literal asserts compensate, left).

#### Iteration 24
- [WARNING] engine/connect.js:1145 (SELF(it21/22 deferral)): musl host without libstdc++/libgcc downloads 200MB then fails. FIXED: 4118afef6 (pre-download refusal, headline + download; 2 plants red). REVERSES the it21/22 deferral
- [WARNING] engine/connect.js:1131 (BRANCH): Debian musl pkg + null process.report -> musl guess. DEFERRED: process.report is present on every supported Node; the loader-only branch is detectMusl's documented fallback
- [WARNING] engine.reachable.test.js:51 (SELF): excuse wording. FIXED: 4118afef6 ("when it is runnable")
- [NIT] comment tangle (dup, left); download() check only defence in depth (by design); memo comment (left); header run id (left, cites the measurement); platform-gate test seams (fine).

#### Iteration 25
- [WARNING] .github/workflows/linux.yml:14 (SELF(it24 code)): cited lane predates the musl library code. FIXED: lane re-dispatched on bb49620e1; header to cite it once read
- [WARNING] engine/connect.test.js (SELF(it24)): no test for an installed Claude on a musl host missing libraries. FIXED: bb49620e1 (driver test; !haveBinary plant red)
- [WARNING] .github/workflows/linux.yml:14 (SELF(it24 code)): cited lane predated the musl library code. FIXED: 2ee82a680 (cites 37591886707 on the final connect code)
- [NIT] plan fossil (FIXED); hint list (FIXED); armv7l (FIXED); siblings pin musl seam (FIXED); host-arch tests (left: CI is x64).

#### Iteration 26
- [WARNING] engine/connect.js detectMusl (BRANCH): gcompat glibc Node on Alpine picks glibc build. DEFERRED: accepted: same compat layer runs it; plan records
- [WARNING] engine/connect.js MUSL_LIBS_MISSING (SELF(it24)): says not installed; only 3 folders searched. FIXED: cb984dd5f (names the folders)
- [WARNING] engine/connect.js runFlow (SELF(it8/9/17/20)): tmux refusal with Claude installed. DEFERRED: dup, decided and stated in the PR
- [NIT] comment placement (dup, left); memo comment (FIXED); gate test null restore (left, per-process).

#### Iteration 27
- [WARNING] engine/connect.js:1137 (SELF(it24)): musl library check nearly never fires on a running board; overclaimed as Alpine cover. FIXED: febeaade8 (comment + plan corrected; ripgrep open with D)
- [NIT] Debian musl pkg + no report (dup it24, left); header wording (FIXED); memo tests reset (FIXED); comment line break (left).

#### Iteration 28
- [WARNING] engine/connect.js:1107 (SELF(it24/27)): Debian musl pkg + no report picks musl. FIXED: f9f51685c (glibc loader wins; plant red)
- [WARNING] engine/connect.test.js memo test (SELF): no-tmux-found test leaves a held pick. FIXED: f9f51685c (reset in finally)
- [WARNING] engine/connect.js download() (SELF): sign-in sentence in a general entry point. DEFERRED: measured: one production caller (installClaudeCode); plan
- [NIT] review labels in comments (left); header run claim (left: cites the measurement); 700 ms literal (left).

#### Iteration 29
- [WARNING] engine/connect.js:1121 (SELF(it28 fix)): glibc-loader veto applied with a readable musl report (Alpine + gcompat got glibc). FIXED: 96ca3afba (veto only for unreadable report; plant red)
- [WARNING] .github/workflows/linux.yml:131 (SELF(it25 header)): header says later commits are copy only; it28/29 changed detectMusl. FIXED: lane re-dispatched on 96ca3afba; cite it once read
- [WARNING] .github/workflows/linux.yml:131 (SELF): header claimed copy-only later commits. FIXED: 9d8c1a671 (cites 37596187037 on the final rule)
- [NIT] doc comment rule (FIXED); plan line (FIXED); muslLibsMissing Linux wiring test (left); sha256File move note (left).

#### Iteration 30
- [WARNING] engine/connect.js musl check (SELF(it26)): gcompat glibc Node path. DEFERRED: dup of it26, accepted and recorded
- [WARNING] engine/connect.test.js memo tests (SELF): no reset in finally. FIXED: 90b576b44
- [CONVENTION] plan:101 (SELF(it25 edit)): review-24 bullet garbled by my regex edit. FIXED: 90b576b44
- [NIT] overlapping tmux comments (dup, left); runnable default note (left); excuse wording (left).

#### Iteration 31
- [WARNING] engine/connect.js DEFAULT_IS_MUSL (BRANCH): real detection never asserted on a real host. FIXED: 7f6ccadbe (Linux-lane test, seams cleared); lane dispatched to prove it runs
- [WARNING] engine/connect.js sign-in tmux (BRANCH): tmux 2.x joins new-session args; premise misnamed as glibc. DEFERRED: plan names tmux version as the unmeasured premise; carried to D
- [NIT] arch refusal after tmux/libs (left, rare); hint omits explicit AGENT_WORKFORCE_TMUX_BIN (left); plan line 45 (FIXED); excuse (FIXED).

#### Iteration 32
- [WARNING] engine/connect.js platformKey (SELF(it26/30)): gcompat glibc Node path. DEFERRED: dup, accepted at it26
- [WARNING] engine/connect.js LINUX_TMUX_HINT (SELF(it23)): hint offers only a root-level fix. FIXED: 106424428 (says it needs administrator rights)
- [NIT] comment interleave (dup, left); Review N labels (dup, left); muslCache vs resetForTests (left); gate test null restore (dup, left); header run claim (cites the run).

#### Iteration 33
- No BLOCKER, WARNING or CONVENTION: NITs only (hint folder list copied from create.js; header cites a run one copy edit back; plan cites an older run in one bullet; a test reads the report directly; constant names). CONVERGED.

#### Iteration (Linux lane findings)
- [WARNING] engine/connect.test.js:2951 (SELF(it24)): test forcing musl on is host-dependent via the real library check. FIXED: 86df3a487 (file-wide MUSL_LIBS_PRESENT pin; reproduced red/green)
