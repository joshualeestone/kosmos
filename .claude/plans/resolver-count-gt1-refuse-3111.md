# #3111 - resolve-install-user.sh: refuse on ambiguous multi-account (count>1)

## What
Belt-and-suspenders hardening to the #2511 P0 install-resolver fix (merged in #3114). The P0 fix
correctly dropped candidate-1's root-false-negative Aqua-session gate AND relaxed candidate-2
(console fallback) to fire whenever candidate 1 did not resolve - including on `owner_count > 1`
(an ambiguous multi-account: several accounts each running Installer at once). This card reverses
ONLY the `count > 1` half of that fallback: on a genuine multi-account ambiguity, REFUSE (with a
clear next step) rather than silently install for the physical-console holder, who may not be who
invoked THIS install (the #1880 wrong-user class).

## Why
A silent wrong-user install (agents land in the wrong account's home) is worse than an honest
refusal. `count > 1` requires multiple accounts running Installer at the SAME instant (fast user
switching / a second Screen-Sharing session) - rare, and genuinely ambiguous (no signal says which
one invoked). The single-investor install Josh's "investors MUST install" ruling protects is
`count == 1`, which still resolves via candidate 1 (no session gate); `count == 0` still falls back
to console. So this narrows the console fallback to the cases where it cannot install for the wrong
user, without reintroducing #1880's refusal for the case the ruling protects.

## Reversible-call provenance
The `count > 1` fallback was explicitly marked in the P0 code as "Splinter, 2026-09-15 -- a
reversible product call" per Josh's "investors must install" priority. Splinter is now directing the
reversal (#3111), so this is his reversible call being revised, within authority. The trade is
documented in the code + this plan so a future reader (and Josh) sees exactly what changed and why.

## Change
`install/pkg-scripts/resolve-install-user.sh`:
- Insert a `count > 1` REFUSE block between candidate 1 and candidate 2, with a clear RIU_REASON
  (names the competing accounts; tells the user to quit the other Installer(s) or sign in as one
  account and reopen). count>1 never reaches candidate 2 now.
- Candidate 2 (console fallback) therefore only handles `count == 0` and the `count == 1` uid-fail
  edge; its comment is updated to say so.
- The final refuse block's dead `count > 1` branch is removed (unreachable now).

`tools/test-resolve-install-user.sh`:
- ARM 6 (count>1 + no console): still refuses; reason-assertion updated to the new message.
- ARM 6b (count>1 + console present): REVERSED from "falls back to bob" to "REFUSES even with a
  usable console user, and does NOT install for the console holder" - the key #3111 assertion.

## Not changed
count==0 (console fallback) and count==1 (candidate 1 resolves, no session gate) - the "investors
must install" behavior. ARMs 2/4/7 assert this and still pass.

## Known edge - count>1 can be SPURIOUSLY hit (stale Installer), and it is accepted
`_riu_installer_owners` counts any process occupying the CoreServices Installer.app path, so
count>1 is NOT always a genuine simultaneous multi-account install: a STALE / hung Installer.app
left running in another account (an abandoned, not force-quit, prior install) also inflates the
count. In that case this change refuses an otherwise-unambiguous single-investor install that the
pre-#3111 code would have silently completed via console fallback. Accepted, deliberately:
- The refusal is RECOVERABLE in one step - the message names the competing accounts and tells the
  user to quit the other Installer(s), after which count==1 and candidate 1 resolves. It is a
  messaged, actionable refusal, not a lockout, and it beats a silent possibly-wrong install.
- A robust liveness filter to drop stale Installers is NOT cleanly available: the only obvious
  liveness signal is the root-context `launchctl print gui/<uid>` session probe, which is exactly
  the signal #2511 removed as unreliable (it false-negatives from the installd/root context). So a
  filter would reintroduce the flakiness the P0 fix eliminated.

## What would change the call
If measurement shows count>1 is effectively never hit (neither genuine simultaneous installs nor
stale Installers), the residual is negligible and refusing there is cheap. If stale Installers
prove COMMON on shared Macs, the follow-up is a process-age filter in `_riu_installer_owners` (drop
Installer processes older than a threshold) so a leftover process stops inflating the count -
tracked as a future hardening, not built here. If Josh/Splinter rules count>1 must NEVER refuse
(full "investors must install" even on simultaneous multi-account Installers, accepting the
wrong-user residual), revert this one block - the P0 fallback is preserved in history.

Addresses #3111 (non-closing).
