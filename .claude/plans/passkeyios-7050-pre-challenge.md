---
pre_challenge: true
method: challenge-loop
branch: passkeyios-7050
diff_hash: 0a27d35c1ed79ffb5c347e3c6d44365a1d5ec82da5b1e8b25ac65acfd6252e93
validation: passed (iOS-only diff; not the canonical full-suite helper. At 196372d4da after a rebase onto origin/main: `xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.0-simulator ios/Kosmos/*.swift` rc=0, with a control that injects a type error and gets rc=1; `bash ios/LogicTests/run.sh` PASS 1085/1085; broken-copy control (relying-party check replaced) fails exactly the 3 host cases. The simulator build runs in this PR's CI.)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-24T22:34:08Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11 (opus on odd rounds, sonnet on even)
**Converged:** Yes (round 11: NITs only)
**Asked (awaiting user):** 0

One change after convergence (0cb640258a, rebased as 196372d4da): the web company link is disabled while a sign-in is
out, as every other control on the step (a round-11 NIT that names a lost-session path); and a comment reworded.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] availability probed at every launch, for signed-in users and screenshot builds, never re-asked --> FIXED (asked from the email step)
- [WARNING] two comments said passkeys go to the web page --> FIXED
- [NIT] rp spelling handed on, asker reuse, cancel vs failure words, offer arms untested --> FIXED
#### Iteration 2 (sonnet)
- [WARNING] controller not kept alive (a sheet that never answers leaves busy forever) --> FIXED (passkeyController)
- [WARNING] no recovery from a stuck sheet --> FIXED (cancelPasskey on back and sign-out)
- [WARNING] a transient 500 hid the link until relaunch --> FIXED (only 404 or an offer is kept)
- [WARNING] sample screens asked the live coordinator --> FIXED
- [WARNING] removed web link --> DEFERRED: the in-app web page offers no passkey (slice B); not a working path
#### Iteration 3 (opus)
- [WARNING] relying party compared case aside, but iOS builds origin and rpId hash from the given spelling --> FIXED (exact match; test moved to refused)
- [CONVENTION] stacked stale doc comment --> FIXED; 404 at press hides link --> FIXED; plan control evidence --> FIXED
#### Iteration 4 (sonnet)
- [WARNING] a sheet that never answers left the step busy --> FIXED (cancel on background, 6-minute safety timer)
- [WARNING] cancel cleared state asynchronously --> FIXED (synchronous; late answers never clear a newer sheet)
#### Iteration 5 (opus)
- [WARNING] a refused grant's sentence wiped by the email field's onChange --> FIXED (email set before verify; company flow too)
- [WARNING] background cancel depended on view ordering --> FIXED (from ContentView)
- [WARNING] no manual web escape on iOS 17.4+ --> DEFERRED: every web case reaches .web through SignIn.next (plan)
#### Iteration 6 (sonnet)
- [WARNING] availability answer from before a sign-out landed after it --> FIXED (generation counter)
- [WARNING] Send code left a sheet open --> FIXED
- [WARNING] model layer untested; real sheet unexercised --> DEFERRED: UIKit outside LogicTests by design; device gate lists the paths
#### Iteration 7 (opus)
- [WARNING] a superseded press could still spend its grant and overwrite the field --> FIXED (attempt check before both)
- [WARNING] availability not re-asked while staying on the email step --> FIXED (foreground re-ask)
#### Iteration 8 (sonnet)
- [WARNING] foreground re-ask ran for signed-in launches --> FIXED (only while nativeSignIn)
- [WARNING] device gate list --> FIXED (plan names the paths)
#### Iteration 9 (opus)
- [WARNING] return key during verify could drop an answer the coordinator acted on --> FIXED (Send code refuses while busy)
- [NIT] finish-body test blind to an authenticator-data/signature swap --> FIXED; IUO fields unwrapped --> FIXED
#### Iteration 10 (sonnet)
- [WARNING] busy checked after the address, leaving a stale sentence --> FIXED
#### Iteration 11 (opus)
- NITs only. Converged. Deferred: a passkey refusal with no server words reads "That code is not right" (verify's
  fallback, shared with the company flow; the coordinator always sends words); a narrow availability race after a 404
  at press (the next press answers again); the sample list comment.

### Strengths (across rounds)
- The relying party is exactly the coordinator's host; the grant is spent only with kpk1_ and a usable email.
- The continuation resumes once on every path; the controller and delegate live until the answer; a 6-minute timer
  bounds a sheet that never answers.
- Every await is followed by an attempt check; a superseded grant is never spent.
- Availability is asked lazily, re-asked only after unclear answers, never by a signed-in launch or a sample screen.
