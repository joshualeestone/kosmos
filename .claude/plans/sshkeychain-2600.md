# kosmos#2600 (narrowed): say it when a Kosmos is launched where it cannot read the Keychain

## Why
A board launched DIRECTLY (cmd_start's nohup path) runs in the security session of whatever started it, and a remote
(SSH) session cannot use the login Keychain. `claude auth status` there answers loggedIn:false, so the board calls
every Claude account "Anthropic says this account is not signed in" while the same account is signed in on the Mac
itself. Measured on Mortals 2026-09-30, three arms. It cost 14 hours on 09-29 because it looked like a build problem.

## Change (slice 1, this branch)
- `install/kosmos`: `keychain_note`, called inside `cmd_start` only on the DIRECT launch path (after the supervised
  branch returns, right before "Bringing the board up."). So `start`, `restart` (which calls cmd_start), `open` and the
  installer's start are all covered, and a SUPERVISED start (launchd kickstarts the login job in the person's desktop
  session, which can read the Keychain) and an already-running board say nothing.
- On a Mac, when `security show-keychain-info` (the DEFAULT keychain, the one claude reads; cut at 3 s) answers rc 36
  ("User interaction is not allowed") in this session, and only then, it
  says in one sentence that this Kosmos cannot read the Mac's Keychain and will show Claude accounts as not signed in,
  and that running `kosmos restart` in Terminal on the Mac itself fixes it. An agent is told to ask the person.
  Always returns 0: advice, never a refusal.

## Measured (2026-10-02 01:37)
- `security show-keychain-info` on the login keychain: over SSH to Mortals, rc 36 "User interaction is not allowed";
  in Mortals' agents' tmux server (which CAN read the Keychain, the 09-30 arm), rc 0; on Agent1s in a desktop-session
  tmux, rc 0. It reports settings only and raises no dialog.
- `launchctl managername` (the reviewer's suggestion): "Background" in all three contexts, so it cannot tell them
  apart. Rejected.
- The SSH variables (the first version's signal): tmux copies them into new windows of a session that CAN read the
  Keychain, so they misfire on the known workaround. Rejected.

## Decided
- Advice, not a refusal: starting from SSH is sometimes the only way in, and a board that is up and wrong beats one
  that is down.
- The fix named is `kosmos restart` on the Mac itself, not "open the app": the app runs `kosmos start`, which finds the
  wrong board already running and leaves it.
- NOT in this slice: the board's own "not signed in" verdict naming the likely cause (slice 2, an engine change), and
  the fleet default `CLAUDE_CODE_OAUTH_TOKEN` passthrough (parked: needs `claude setup-token` per account).

## Weakest premise
That the login keychain's `show-keychain-info` failing is the same condition as `claude` being unable to read its
credential. They matched on all three measured contexts, but the credential could live in another keychain.

## Tests
- tools/test-ssh-keychain-note-2600.sh (10 arms, in test:shell): the note when the probe fails, naming the fix, rc 0;
  CONTROL: no note when the probe succeeds; no note off a Mac; agent wording; sourcing writes nothing to HOME or
  KOSMOS_HOME (with a control that the emptiness check sees a written file); placement inside cmd_start after the
  supervised branch and before the direct launch; not called from the dispatch.
- 5 sabotages, each red: probe ignored, no Mac check, agent wording lost, not called on the direct path, called from
  the dispatch.
- Review 1 (opus, blind): 1 blocker (the note fired on the supervised path, where the board CAN read the Keychain, and
  in the installer), 5 warnings, 2 nits; all taken by the redesign above.

## Review 2 (opus, blind, 2026-10-02 01:40): 0 blockers, 4 warnings, 3 nits, all taken
- The probe asks the DEFAULT keychain (`security show-keychain-info`, no argument: the one claude reads), measured
  identical to the explicit path (rc 36 over SSH, 0 in tmux and desktop), and a missing keychain is rc 50. ONLY rc 36
  gives the note. Cut at 3 s (/usr/bin/perl alarm): a LOCKED keychain in a desktop session was not measured and might
  put up a dialog; a cut probe says nothing.
- The installer's direct start passes KOSMOS_NO_KEYCHAIN_NOTE=1 (it hands the board to launchd a few steps later, so the
  note would be wrong). Accepted residual: if that bootstrap fails over SSH, no note.
- The real branch is tested through a stub `security` (KOSMOS_SECURITY_BIN): exact arguments, rc 36 / 0 / 50, a hang
  cut at 3 s, a missing binary, the opt-out. The placement arm now requires the call AFTER the supervised block's `fi`.
- Wording: "may show Claude accounts that are signed in on this Mac as not signed in" (API-key accounts and other
  providers are not affected); the comment says SSH "normally" cannot use the Keychain.
Test: 17 arms. (Found by me while editing: a comment placed after `||` swallowed setup.sh's `die`; moved above.)

## Review 3 (opus, blind, 2026-10-02 01:45): 0 blockers, 1 warning, 3 nits, all taken
The 3 s cut no longer prints bash's "Alarm clock" line (braces around the probe; the hang arm now captures stderr and
fails on it); the block moved above agent_board_guard's doc comment it had split from its function; the board's env -u
lists scrub KOSMOS_NO_KEYCHAIN_NOTE like KOSMOS_RECLAIM_BUSY; the Change section describes the shipped probe.

## Review 4 (opus, blind, whole diff, 2026-10-02 01:48): 0 blockers, 0 warnings, 3 nits, all taken. CONVERGED.
A person's wording is asserted (and the agent's absent); `[ -x /usr/bin/perl ]` guards the cut (a missing perl gives no
note, the safe side); the missing-security arm says it covers the outcome, not the guard. Converged at iteration 4.
Next: full validation, proof, PR, merge.

## Full validation after the rebase (baba71755, 08:19): 13,983 pass / 2 fail, both mine, fixed
- cli.busy-health-4466: it pins `KOSMOS_RECLAIM_BUSY=1 "$KOSMOS_HOME/bin/kosmos" start --force`, and I had put
  KOSMOS_NO_KEYCHAIN_NOTE=1 between them. It now goes before KOSMOS_RECLAIM_BUSY=1. My own test pinned the opposite
  adjacency; it now asserts the variable is on the installer's start line without pinning its place.
- install.this-computer-1290: "this Mac's Keychain" and "signed in on this Mac" -> "this computer's Keychain" and
  "signed in on this computer" (the app's one word; the sentence is not about macOS itself). "in Terminal on the Mac"
  stays (it names where to act). Re-run green: own test all arms, 4466 53/53, 1290 3/3.
