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

## What would change the call
If measurement shows count>1 is effectively never hit by real users, the residual it protects
against is negligible; but refusing there is cheap (honest message, clear next step) and the
wrong-user install it prevents is silent, so refusing is the safer default. If Josh rules that
count>1 must also never refuse (full "investors must install" even on simultaneous multi-account
Installers), revert this one block - the P0 fallback is preserved in history.

Addresses #3111 (non-closing).
