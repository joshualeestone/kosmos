---
pre_challenge: true
method: challenge-loop
branch: tasknative-7074
diff_hash: 42edaebb59fca2d46aa76ac52ee70655e1787fdd4d88478249fdbc91fb61146e
validation: passed (iOS diff plus one repo test. At f28e766f37 on origin/main: `xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.0-simulator ios/Kosmos/*.swift` rc=0 (Debug too), with a control that injects a type error and gets rc=1; run-taskpage 108/108, run.sh 1152/1152, run-tasks 90/90, run-room 154/154, run-actions 99/99, run-settings 42/42; every repo test that reads ios/Kosmos (7 files, including server.ios-routes-6838 5/5) green, with a control route that goes red; broken-copy controls across rounds all red except where a second guard covers the same case by design (noted). Debug simulator build OK; light and dark shots taken. The simulator build also runs in this PR's CI.)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-25T03:03:14Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (opus on odd rounds, sonnet on even)
**Converged:** Yes (round 14: NITs only, the cheap ones fixed)
**Asked (awaiting user):** 0
**Split out:** round 1's finding that native requests carry no Sec-Fetch-Site became kosmos#7075 (priority), merged as PR #7076 before this branch.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] seen marked without the person being there (no tkPresent); scenePhase captured as a snapshot --> FIXED f3bdb5bb0d (presence on the model: on screen, app active, touched in 120 s; read live at mark and retry)
- [WARNING] a state that lands off screen never marked on return --> FIXED f3bdb5bb0d (markSeen on appear and on becoming active)
- [WARNING] Sec-Fetch-Site also decides the tunnel's board token; native reads carry none --> SPLIT to #7075 (priority, PR #7076): every Mac-bound request now carries it; this branch drops its own copy after rebasing on it
- [WARNING] out-of-order read guard untested --> FIXED f3bdb5bb0d (held-read tests for page and activity; retry-after-leaving test)
- [NIT] addedLine matched text and could lower a name --> FIXED (by kind)
- [NIT] reads sent for a stale page --> FIXED (guard before send)
- [NIT] hold line names an act the phone cannot do --> FIXED ("on your computer's board")
- [NIT] stack can grow (Part of / subtask loops) --> DEFERRED: each push is a page the back button pops; the board's own links behave the same
- [NIT] part count without progress; unknown kind --> FIXED (Open/Done without progress); unknown kind already returns its name
Mutants (round 1 fixes): 6 written, 6 red. Initial build: 9 written (incl. the close-note one added after a green), 9 red.

#### Iteration 2 (sonnet)
- [WARNING] a state arriving while idle never marked after a touch --> FIXED e9d7e5a7ea (seen mark after every read; reads gated on presence)
- [WARNING] VoiceOver/Switch Control users never present --> FIXED e9d7e5a7ea (assistive counts as present while on screen and in front)
- [WARNING] return does not re-record an unchanged state (tkTabReturn) --> FIXED e9d7e5a7ea (markSeen(again:))
- [NIT] times freeze --> FIXED e9d7e5a7ea (TimelineView 30 s)
- [NIT] folded runs cannot be expanded --> DEFERRED in the plan
- [NIT] reads not gated on presence --> FIXED e9d7e5a7ea
- [NIT] pressing not said to VoiceOver --> FIXED e9d7e5a7ea
- [NIT] subtask row at accessibility sizes --> DEFERRED in the plan
Mutants (round 2): 2 written, 2 red.

#### Iteration 3 (opus)
- [WARNING] keyboard and Full Keyboard Access never count as present --> FIXED 73d39161c9 (PresenceProbe on the window: touches and key presses)
- [WARNING] page-wide DragGesture over the ScrollView can stop scrolling on newer iOS --> FIXED 73d39161c9 (removed; the window recognizer fails at once and never claims touches); device check kept
- [NIT] again re-sends refused states --> FIXED 73d39161c9 (recordedKey)
- [NIT] nameless member named by session --> FIXED 73d39161c9 (membership kept, roster name)
- [NIT] Int(Double) trap --> FIXED 73d39161c9 (clamped counts)
- [NIT] tick rule in the view, untested --> FIXED 73d39161c9 (shouldRead, tested)
- [NIT] in-progress said twice --> FIXED 73d39161c9
- [NIT] info button on a gone task --> FIXED 73d39161c9
Mutants (round 3): 2 written, 2 red.

#### Iteration 4 (sonnet)
- [WARNING] keyboard reach claimed, unproven --> FIXED 9f369b9a28 (comments say so; device check 3 with UIKeyCommand fallback)
- [WARNING] a touch held two minutes counts once --> DECIDED, in the plan (reading is new touches)
- [WARNING] plan named the removed gesture --> FIXED 9f369b9a28 (device checks rewritten)
- [NIT] Release var never mutated --> FIXED 9f369b9a28
- [NIT] stale refusal after the task changed elsewhere --> FIXED 9f369b9a28 (tested)
- [NIT] Part of has no hint --> FIXED 9f369b9a28
Mutants (round 4): 1 written, 1 red.

#### Iteration 5 (opus)
- [WARNING] the task itself stopped updating after two idle minutes (the board gates only the activity) --> FIXED d8da8454bc (shouldReadTask on screen; shouldReadActivity on presence)
- [WARNING] a seen mark whose retry is skipped is never sent again --> FIXED d8da8454bc (left unmarked, as onDone(false))
- [WARNING] Part of not a 44 pt target --> FIXED d8da8454bc
- [NIT] stale comments in ContentView and TasksLogic --> FIXED d8da8454bc
Mutants (round 5): 2 written, 2 red (one test given a never-recorded state after its control passed).

#### Iteration 6 (sonnet)
- [WARNING] a cancelled request read as a failure; a cancelled seen mark lost for good --> FIXED 19601081c1 (cancel checks after the send and the wait; reads record no failure)
- [NIT] the stale-page press test could not fail --> FIXED 19601081c1 (page read first, then the epoch moves)
- [NIT] task N not a link --> DEFERRED in the plan
- [NIT] projects parsed on the main actor --> FIXED 19601081c1 (Task.detached)
- [NIT] probe comment claims key presses --> FIXED 19601081c1 ("may")
Mutants (round 6): 4 written; the seen-cancel test was rewritten after its control passed for the wrong reason (the retry made the count); now red with both cancel checks removed (either alone suffices by design); others red.

#### Iteration 7 (opus)
- [WARNING] a cancelled retry settled the state --> FIXED 118f0bd06b (tested, red without)
- [NIT] an older mark answering late overwrote recordedKey --> FIXED 118f0bd06b (only while seenKey == key)
- [WARNING] the post-parse guard untested --> FIXED 118f0bd06b (injectable parse; held-parse tests for a newer answer and a newer failure, red without)
- [NIT] stale TasksLogic comment --> FIXED 118f0bd06b
- [NIT] unused taskURL(for:) overloads --> FIXED 118f0bd06b (removed)
Mutants (round 7): 2 written, 2 red.

#### Iteration 8 (sonnet)
- [BLOCKER] server.ios-routes-6838.test.js failed: task requests not declared --> FIXED e3a8a871e1 (SITES entries with callers; 5/5; a control with a wrong route goes red; every repo test reading ios/Kosmos run: 7 files green)
- [NIT] activity times below AA in dark mode --> FIXED e3a8a871e1 (secondary)
- [NIT] string-valued counts --> DEFERRED: the engine writes numbers only

#### Iteration 9 (opus)
- [WARNING] a new TaskAct case could send an undeclared route (substring pin) --> FIXED a10b0dabc9 (exhaustive switch, each route a literal caller; control: an added "undo" act fails the routes check)
- [NIT] SITES exempts the whole file from the URL-swap check --> DECIDED, noted in the SITES comment (same as the other SITES files)
- [NIT] a test name claimed client wiring --> FIXED a10b0dabc9

#### Iteration 10 (sonnet)
- [WARNING] activity parsed and phrased on the main actor, laid out eagerly --> FIXED (rows built off the main thread from a names snapshot, newer-read guard after the build; LazyVStack)
- [NIT] two hidden NavigationLinks per tab --> device check 1 (Check it and Answer each push once)
- [NIT] coming back counts as present --> DECIDED: the board's focus-based tkTabReturn, said in the comment

#### Iteration 11 (opus)
- [WARNING] the return mark was sent for the old state before the activity was read again --> FIXED 078078e3c0 (marked again only after the loop's first successful read; readActivity says whether it drew)
- [WARNING] the post-build guard untested --> FIXED 078078e3c0 (injectable build; held-build tests, red without)
- [WARNING] unchanged ticks republished every flag --> FIXED 078078e3c0 (set only on change; tested with objectWillChange, red without)
- [NIT] unused name() --> FIXED 078078e3c0
Mutants (round 11): 3 written, 3 red.

#### Iteration 12 (sonnet)
- [WARNING] a new ISO formatter per event per tick; unchanged history rebuilt --> FIXED 1da2a863ab (shared formatters; skip when answer and names unchanged; tested, red without)
- [NIT] tick logic only in the view --> FIXED 1da2a863ab (TaskPageModel.tick, tested; red with the mark ahead of the read)
- [NIT] a blocked return cleared seenKey --> FIXED 1da2a863ab (reset only when the mark can go; tested, red without)
Mutants (round 12): 3 written, 3 red.

#### Iteration 13 (opus)
- [WARNING] InputRecognizer overrides without calling super --> FIXED c97a1fefea
- [NIT] first activity build without member names --> FIXED c97a1fefea (merged in the model; tested, red without)
- [NIT] Debug sample data race --> FIXED c97a1fefea (lock)
- [NIT] formatter thread-safety comment overclaims --> FIXED c97a1fefea (says what is documented)
- [NIT] appActive not read on appear --> FIXED c97a1fefea

#### Iteration 14 (sonnet)
- No BLOCKER or WARNING. NITs fixed: subtask rows spoken as one plain label; the Debug sample lock and the shared formatters use withLock (formatters now locked); Part of keeps its text-width tap area (height 44 met) --> DEFERRED as cosmetic.
