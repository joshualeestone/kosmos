---
pre_challenge: true
method: challenge-loop
branch: stepupsheet-8791
diff_hash: cd64464b81bfe362694bf589666b4b9062f86071ed392af7aa2fb50cd0fbc45a
validation: local only, on a21c4ab9dc (rebased on origin/main): simulator build clean (iPhone, iOS Simulator SDK); ios/LogicTests run.sh 2181/2181, run-room.sh 901/901, run-agentinfo.sh 191/191, run-actions.sh 99/99, run-settings.sh 48/48 (all suites passed on faf74b142a after the BoardClient change); simulator shots of the first step, light and dark, in ~/work/design-shots/kosmos-8791-ios. The full suite runs on the PR's CI.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-20T08:36:00Z
iterations: 4
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** No, by the strict rule: round 4 raised no BLOCKER and one WARNING it could not confirm (a cover setter after a programmatic dismiss), fixed with a one-line guard and not re-reviewed. Stopped there with no BLOCKER open.
**Total actionable findings:** 4 BLOCKERs, 12 WARNINGs, 1 CONVENTION (plus NITs)
**Fixed:** 4 BLOCKERs, 11 WARNINGs | **Documented / accepted:** 1 WARNING (ended Allow is a full sign-out, as the main sign-in), NITs below | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 3 BLOCKERs, 4 WARNINGs, 3 NITs
- [BLOCKER] retry on a stale .live phase, before the reconnect --> FIXED (BoardClient.admissions / admittedUnder, SignIn.Fresh.retryNow, tests with a control)
- [BLOCKER] no way out on the Mac's no or second-step setup --> FIXED (Not now on every step)
- [BLOCKER] a fresh sign-in left behind when the sheet closes --> FIXED (ended on any other change and on sheet close)
- [WARNING] company sign-in link on a fresh sign-in --> FIXED (hidden)
- [WARNING] an ended Allow is a full sign-out --> DOCUMENTED (as the main sign-in)
- [WARNING] the web step over the sheet --> FIXED (closes and says why)
- [WARNING] state machine untested --> PARTLY FIXED (pure rules tested)
- NITs: signed-out wording, no-loop flag reset, place check --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 3 NITs, 1 CONVENTION
- [WARNING] retry after a hand-pressed Create (a second agent) --> FIXED
- [WARNING] passes outliving the fresh sign-in --> FIXED (cleared on admission and sheet open)
- [WARNING] the BoardStates button unreadable in dark --> FIXED (card colour, 44 pt)
- [WARNING] the cloud Open's tried flag set after .live --> FIXED (set at issue)
- NITs: Keychain-only session gap DOCUMENTED; 44 pt FIXED; edited draft (fixed in round 3)
- [CONVENTION] onIssued in onAppear --> ACCEPTED (idempotent)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 3 NITs
- [BLOCKER] the retry could go to another computer after the reconnect --> FIXED (admittedAddress, SignIn.Fresh.landing; the sheet closes; tests with a control)
- [WARNING] a begin() outliving a dismissed sheet --> FIXED (generation)
- [WARNING] an address from the previous account --> FIXED (session re-checked after the read)
- [WARNING] the retry sending an edited form --> FIXED (says press Create)
- NITs: no-loop flag after another refusal, em-dash coverage --> FIXED; center tests --> ACCEPTED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs, 1 CONVENTION
- [WARNING] a cover setter after finish() could clear a pass (unconfirmed) --> FIXED (the setter ends only a sign-in still showing)
- [NIT] freshTried set before create()'s guard --> ACCEPTED (guard fails only with nothing to send)
- [NIT] a team retry can offer a second sign-in after a member is made --> ACCEPTED (bounded by taps, progress made)
- [NIT] a session change during the address read does nothing visible --> ACCEPTED (rare; pressing again works)
- [NIT] Keychain-only session --> DOCUMENTED (round 2)
- [CONVENTION] FreshSignInCenter untested --> ACCEPTED (class-level; its rules are pure and tested)
