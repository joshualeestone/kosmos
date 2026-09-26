# signin-guard-3827 (kosmos#3827 follow-up, on top of Pete's #3843)

Pete's #3843 (6765c145) switches Kosmos+ on after an in-app sign-in, the core of #3827. My earlier branch signin-on-3827 did the same and went through 7 blind review rounds that found real races around it. This is that hardening, rebuilt on main with a simpler design (engine only; the sign-in UI is Pete's and under active change for #3837):

1. A Sign out that lands while register is in flight never switches Kosmos+ on: register records the sign-in epoch and returns SIGNIN_CANCELLED if it moved (every other sign-in step already did this).
2. forget() cancels any sign-in (epoch, session) and WAITS for a register already out, so what it retires and wipes includes that registration. Earlier rounds tried "abandon, undo later, refuse meanwhile" and it produced a new race every round; the simple wait is safe because:
3. a register and a retire are bounded (registerTimeoutMs, 60s, env seam AGENT_WORKFORCE_REGISTER_TIMEOUT_MS), so neither a hung coordinator nor a hung connector can hang Forget.
4. A failed save of the switch is logged; the Mac is registered either way and the switch honestly reads off. Chose logging over a new UI note to stay out of Pete's in-flight sign-in UI; the failure is disk-level and rare.

Tests (engine/remote.test.js, a slow-register mode in the fake): cancel during register; Forget waits, retires once, nothing left registered; a 15s register bounded at 1.5s cannot hang Forget; a failed switch save still reports the Mac registered. Controls: no epoch check fails "reported success"; no wait fails "did not retire the Mac"; no bound fails "waited out a hung register".

Weakest premise: Forget can now take up to the register bound (60s) when a register is truly hung. Worse than an instant answer, bounded, and only in a case that is already broken.

## Round 1 review (opus)
- BLOCKER: a 60s register bound killed healthy registers: the certificate step holds the call for the ACME wait (65s measured on production tonight). Now 5 minutes; it exists only so a hung register cannot hang Forget.
- BLOCKER: Forget retired only when enrolled() (needs the certificate), so a register killed mid-certificate (key and id written, the Mac registered at the coordinator) was never retired. Forget now retires whenever mac_id and mac_key exist. Test with a partial-register fake mode; control with enrolled-only fails.
- WARNING: two registers at once (the page aborts at 15s; Try again). A second register while one is out is refused, before every path. Test; control fails.
- WARNING: a sign-in started during Forget's retire. signinStart and signinRegister refuse while forgetting. Test; control fails.
- WARNING: the page gives up at 15s while a register can take over a minute: handed to Pete (his UI).
- WARNING: the switch-save test could not fail; it now asserts the log line. Control fails.
- NIT, left: resetForTests does not kill an outstanding register child (every test awaits its register).

## Round 2 review (sonnet)
- BLOCKER: two concurrent forget() calls each retired the same Mac. A second forget now returns the first one's promise (same answer, one retire). Test; control without the dedupe fails "retired the Mac twice".
- BLOCKER: forget's sentence was keyed on enrolled(), so a half-registered Mac was always told "nothing to retire", even after a successful retire, and a real retire failure was hidden. Keyed on canRetire now. Test asserts because is null after a successful retire; control fails.
- WARNING (documented): worst case a hung register then a hung retire, two bounds, about ten minutes, only when already broken.

## Round 3 review (opus)
- WARNING: the older Settings setup (setupComplete) wrote the same state dir without the guards. It now refuses while a register is in flight or a forget runs. Test; control: without it the test hangs (killed after 27 minutes), which counts as a failure but is not a clean one.
- WARNING: after a register cut off mid-certificate, Try again could register over the half identity (stranding it at the coordinator). Register now refuses while a key and id exist with no certificate, pointing to Forget. Test; control fails on the message ("did not finish").
- WARNING: the retire bound was untested. New hung-retire fake mode; Forget returns within the bound and reports retired false. Control with an unbounded retire fails.
- NIT: the env seam only accepts a positive number (never "no bound").
- NIT, left: the forgetting refusal inside signinRegister is not reached by a test (the in-flight check wins first).

## Round 4 review (sonnet)
- BLOCKER: signinStart did not refuse while a register was in flight; the finishing register then cleared the new sign-in's session ("finish the code steps first"). It refuses now, like setupComplete and signinRegister. Test; control fails.

## Round 5 review (opus)
- BLOCKER: the half-identity refusal sent the person to "Forget this computer", which no screen offers (and any certificate failure leaves a half identity, not only the bound). No dead end now: a register (in-app or Settings) retires the half identity first and proceeds. Test: a retry after a killed register succeeds, retire before register.
- WARNING: setupComplete was not tracked or bounded: now registerInFlight + registerTimeoutMs, like the in-app register, so Forget waits for it and nothing starts beside it.
- WARNING: setupComplete had no half-identity handling: it clears it first too.
- WARNING: signinVerify/Second/Enrol/ConfirmEnrol did not refuse while a register was out or while forgetting. One busy() check now heads every sign-in step and setupComplete. Test covers the four steps.
- NIT: "key and id exist" has one definition (halfRegistered), used by forgetNow too.
- Controls: without clearHalfIdentity fails "not retired before the new register"; without busy() in signinVerify fails "verify ran while a register was out" (that run then hung and was killed).
- Two new-test expectations fixed: a sign-in during Forget with a register still out gets "still signing in" (busy checks the register first); the call-name map read "retire --coordinator".

## Round 6 review (sonnet)
- WARNING fixed: busy() is now the first statement of signinRegister (it ran after the session and name checks).
- WARNING open: tests for the forgetting branch on setupComplete and the four signin steps; a test for clearHalfIdentity's failed-retire log.

## Round 6 review (opus)
- WARNING: busy() first in signinRegister. Fixed in 0ffc60806.
- WARNING: the `forgetting` branch was untested. Test: with a registered Mac and a hung retire, a Forget in progress refuses start, verify, second, enrol, confirm, register and the Settings setup with "being forgotten" (no register out, so only that branch can refuse). Control (busy() ignores forgetting) fails.
- WARNING: clearHalfIdentity's failed-retire log was untested. Test: a killed register leaves a half identity, the retire hangs past its bound, the line is logged and the new register still succeeds. Control (log removed) fails.
- NIT: enrolled() now says why mac_key is not listed.

## Round 7 review (sonnet)
- WARNING: after a half identity could not be retired, the new register's 409 ("a Mac on this account already has that name") read as another Mac's name, when it is most likely this computer's own stranded attempt. clearHalfIdentity now answers why its retire failed; a 409 after that says it may be this computer's own earlier sign-in and what to do (remove it on the account page, or another name). Test with a 409 mode in the fake; an in-test control shows a plain 409 is left alone; mutation control (explainStranded a no-op) fails by name.
- WARNING: setupComplete's half-identity retire was untested. Test: a killed in-app register, then the Settings setup retires before `setup complete`. Control (no retire there) fails by name.
- NIT: busy() now says "being forgotten" first: while a Forget waits on a register both are true, and Forget is what the person asked for.
- NIT (no change): forget's `address` is null for a half-registered Mac. Nothing reads it: server.js relays it and no page consumes it (searched web/ and bin/).

## Round 8 review (opus)
- WARNING: explainStranded matched every 409 (its "already has that name" half matched only the fixture). It now matches only the coordinator's same-account sentence ("already in use by a Mac on this account"); the fake now prints the coordinator's real sentences in the tunnel's "Kosmos+ said no (409): ..." form. Test: after a refused retire the same-account 409 gets the note; after a working retire, or another account's "that name is taken", it does not. Control (any 409) fails by name.
- WARNING: a retire that got no answer still deleted the only key that could retire the half identity. Now: no answer (timeout, unreachable, would not start) keeps the key and the register answers "could not be removed yet; try again in a moment"; the retry retires and registers. A retire that worked or a definite refusal (said no 4xx) wipes as before. Test; control (always wipe) fails by name.
- WARNING: Kosmos+ could be turned on during Forget's retire wait, starting a tunnel from the key about to be deleted. setOn(true) refuses while forgetting; forgetNow also stops any child after its final write. Test; control fails by name.
- WARNING: a register the page gave up on (15s vs ~65s) succeeded, cleared the session, and a Try again at the same name was told "finish the code steps first". The already-set-up-at-this-name answer now comes before the session check. Test; control fails "finish the code steps first".
- NIT: the Forget worst case is three bounds (~15 min); comment corrected.
- NIT: the "being forgotten or still signing in" assertion now asserts being forgotten (busy() order). The in-test control now plants a half identity and retires it before the plain 409.
- NIT: doubled period in the stranded note fixed (tested). setupComplete now has the epoch check signinRegister has: a Forget during a Settings setup answers cancelled, not set up. Test; control fails by name.

## Round 9 review (sonnet)
- BLOCKER: the definite-refusal check matched "said no (4xx)", which only setup/register print. `retire` goes through the tunnel's signed_request, which prints "Kosmos+ refused this Mac: ... (HTTP <code> on <path>)" or "Kosmos+ answered <code> for <path>: ...". So a real refusal (e.g. "this Mac was retired", 401) was kept as transient and the register said "try again in a moment" forever: a dead end. My fixture printed the wording I assumed, so the suite was green. Now the rule is inverted: only a named transient failure keeps the key (unreachable, no answer in time, could not be started, HTTP 5xx / answered 5xx); anything else is final and wiped (this also covers a key this computer cannot read). The fake now prints the tunnel's real sentences (refused 401, unreachable, answered 503). Tests: a definite refusal registers (no dead end); unreachable and 5xx are kept and a retry clears them. Controls: the old rule fails (the real 401 reads "try again in a moment"); 5xx dropped from the transient list fails by name.
- BLOCKER: setRelay starts the tunnel (ensure) and was not gated, reopening the Forget race setOn was closed against. It now refuses while busy. Test (relay during a Forget); control fails by name.
- WARNING: setOn(true) checked only forgetting, not a register still out (which may already have written the certificate). Turning on now waits on busy() like every other entry; turning off never waits. Test (on and relay refused beside a slow register, off allowed); control fails by name.

## Round 10 review (opus)
- WARNING: a Sign out during a register could still bring the Mac online: the switch can be on before signing in, the cancelled register still wrote a full identity, and the board's 15s ensure tick then started the tunnel. A cancel that lands after a register (or Settings setup) SUCCEEDED now switches Kosmos+ off and stops any tunnel (cancelledAfter). Test with the switch on before the sign-in; control (no switch-off) fails by name.
- WARNING: Forget left the switch on through its retire wait, so the ensure tick could restart the tunnel on the key being retired. Forget now writes off before the wait, and ensure() never starts a tunnel while forgetting. Test; control (the early off removed) fails by name.
- WARNING: a retire borrowed the 5-minute register bound, so each Try again over a half identity could block every step for 5 minutes. Retire has its own bound (60s, AGENT_WORKFORCE_RETIRE_TIMEOUT_MS, never above the register's); Forget's worst case is now about 7 minutes (comment corrected). Test; control (register bound) fails by name.
- WARNING: the stranded note was appended to the coordinator's sentence, which is false in this case ("If that is this Mac, it is already signed in / set up"). It now replaces it: "The name X may be held by an earlier sign-in on this computer that Kosmos+ could not remove. Remove it on your account page, or pick another name." The retire's raw reason stays in the log. Tested on both the register and the Settings setup paths; control (appending) fails by name.
- NIT: the half-registered fixture now writes what the tunnel's write_registration writes before the certificate (address, coordinator_pubkey, allow_list); the half-identity Forget test asserts the answer names the address.
- NIT: the Forget-during-register test now asserts the register's own answer is "cancelled".
- NIT: the session-less already-set-up shortcut only answers when the switch is already on, so a stale Try again after a Sign out does not switch it back on. Test; control fails by name.
- Slip, recorded: one control's --test-name-pattern contained "Kosmos+", a regex that matched no test; the run exited 0 with "tests 1" (the file). Rerun with a literal-safe pattern: it fails by name. Every other control this round named its failing assertion.

## Round 11 review (sonnet)
- WARNING: cancelledAfter trusted the program's answer, not the disk: a register killed by its bound after writing the identity reports failed, so a Sign out then left the switch on and the ensure tick brought the new identity online. It now also switches off when enrolled(). Test with a fake mode that writes the full identity and hangs past the bound; control (answer only) fails by name.
- WARNING: halfRegistered matched any not-enrolled state with key and id, including a set-up Mac missing only its address file; the next register would retire and wipe a working certificate. It now means exactly key and id with no certificate. Test (address file removed, register again: no retire); control fails by name.
- WARNING: a 408 or 429 on retire counted as final and wiped a half identity that a minute's wait would have retired. RETIRE_TRANSIENT now includes 408 and 429. Test arm (the tunnel's 429 sentence) is kept and a retry clears it; control fails by name.
- WARNING: secondReset and the device verbs (allow, deny, remove) signed with this Mac's key during a Forget or a register. They now wait on busy(). devicesList (a read the page polls) is left open. Test (all four refused during a Forget); control (allow ungated) fails by name.
- NIT: the two retire calls are one retireHere().
- NIT: the fake's successful retire now prints the coordinator's JSON answer, as the real one does.

## Round 12 review (opus)
- WARNING: turning Kosmos+ off while a register was out (the page gives up at 15s, the certificate takes ~65s) was undone when the register finished (turnOnAfterSignin). setOn(false) now bumps an off epoch, and a register that sees it moved does not switch on. The existing test now asserts the switch stays off; control (always switch on) fails by name. setupComplete never switches on by itself, so it needs nothing.
- WARNING: the transient-retire check read only setupRun's last stderr line. A gateway's multi-line HTML 502 (the tunnel prints the raw body) ends in "</html>", so it was read as final and the key wiped. The check now scans the whole stderr and the kept answer names the matching line. Fake arm prints a multi-line HTML 502; the kept loop and a Settings-path test cover it; control (last line only) fails by name.
- NIT: the ensure() Forget guard was untested (Forget switches off before its retire wait, so only a Forget waiting on a register exposes it). Test: a set-up, running Mac; a slow register for a new name; a Forget waiting on it; the tunnel killed so its 1s restart fires inside the wait: no tunnel. Control (guard removed) fails by name. KEPT_HALF on the Settings path is now tested.
- NIT (hardening, no dedicated test): the session-less shortcut requires a session that carries a token (not a mid-flow challenge); "has a certificate" is tls.crt alone (the tunnel writes tls.key first, so key-without-certificate is half registered).
- NIT (no change): clearHalfIdentity's wipe also takes the assistant's install_key/install_id in the same dir, as Forget always has.

## Round 13 review (sonnet)
- WARNING: a stale Try again (no token-bearing session) on a Mac already set up at exactly that name with the switch off was told "finish the code steps first", sending the person through email and second factor for nothing. It now answers "this computer is already signed in as <address>; turn Kosmos+ on in Settings to be reachable" (still ok:false, so a Sign out stands). Test assertion added; control fails by name.
- WARNING: no test had setupComplete's register as the one in flight. Test: a slow Settings setup blocks the in-app register, turning on, the relay, a device allow and a second-factor reset, each with "still signing in". Control (setupComplete not marking itself in flight): the register arm is refused only for lack of a session and the "still signing in" match fails on it.
- NIT: the real tunnel prints "Error: " before every retire failure (main returns the Result); every retire fixture now does too.
- Validation after round 13 failed: 21 tests in files this branch does not touch (codex/grok login, Windows opener, not-running view: 4-5s timeouts at load 10), plus one of mine. My stranded-name test set a 1.5s register bound for the whole test, so a register expected to SUCCEED had to finish in 1.5s, and under load it did not. Now the short bound covers only the step that must be killed (the shared helper resets it before each kill); after it, registers get 20s and retires 1.5s. Tests only; 73/73 pass.

## Round 14 review (opus)
- BLOCKER (pre-existing on main, and very likely the #3827 symptom itself): a fresh register's stdout is two lines, because the tunnel's fetch_certificate prints "certificate for <address> written to ... (key stayed here)" before emit() prints the JSON (kosmos-relay setup.rs and signin.rs on origin/main; the string is in the shipped 0.6.95 kosmos-tunnel). parseSaid ran JSON.parse over all of stdout, so every first sign-in read as "the tunnel program answered in a shape we could not read" while the Mac was registered, and turnOnAfterSignin never ran. parseSaid now reads the last JSON line. The fake now prints the certificate line first, as the real one does, so every register test runs against the real shape. Test; control (whole stdout) fails "a real first sign-in read as a failure".
- WARNING: a Sign out or Forget during the half-identity retire (up to a minute) did not stop the register that followed; it was sent with the captured token. Both signinRegister and setupComplete now re-check the epoch after the retire, before sending. Test (slow retire, cancel during it: no register recorded); control fails by name. Consequence for three older tests: they now wait until the register has been sent (registerSent) before cancelling, so they still test a cancel that lands while the register is out at the coordinator.
- WARNING: Forget's answer (and the kept/stranded reasons) used setupRun's last stderr line, so a gateway 502 read "(</html>)". retireReason picks the tunnel's "Kosmos+ ..." line, drops "Error: " and any raw body after ": <". Test; control shows "(</html>)".
- WARNING: a cancel switched off a Mac whose register then failed and changed nothing (enrolled() could not tell a new identity from the old). cancelledAfter now switches off only when the register succeeded or the mac_id changed. Test (on, register a new name that fails slowly, cancel: still on); control fails by name.
- NIT: Forget stops the tunnel at once, not after its wait. NIT: the register answer carries switchedOn (false when the person turned off during it), so the page need not say "connecting" about a switch that is off.

## Merged origin/main (after round 14)
Main gained the split-out parseSaid fix (PR #3893: lastJsonLine, used by parseSaid, macRequest and assistantChat), #3838 (the board token file for the tunnel), and fed-msg (#3887). Resolved:
- engine/remote.js takes main's lastJsonLine/parseSaid; this branch's own parseSaid copy is gone.
- engine/remote.test.js is this branch's file plus main's additions: the kept-shape and mac-request fake branches, the run-env recording block, main's four parseSaid tests and four #3838 tests.
- A line-level check found every line main added since the merge base present in both files. The only exception is a two-line comment this branch words differently at the same spot.
- 85/85 remote tests pass.
- Slip, recorded: my first resolution concatenated both sides of shared-tail hunks and broke the file's syntax. The second rebuilt from this branch's side and at first dropped main's #3838 tests. The line-level check caught it, and they were restored.

## Round 15 review (sonnet, on the merge): 1 WARNING
- WARNING: the merge kept two near-identical "fresh register prints its certificate line first" tests (this branch's and main's). This branch's copy is removed; main's keeps it, with the "(the #3827 symptom)" wording folded into its assertion. Everything else in the resolution checked clean: parseSaid/lastJsonLine once, the #3838 tests and run-env block once, fake register order matches the real tunnel.
