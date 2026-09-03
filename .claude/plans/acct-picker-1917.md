# Plan: acct-picker-1917 -- the account-screen half of the Ben blocker (#1917)

## Problem (real external tester, Ben, 0.6.22, boxed in ~1 hour)

Ben had two Claude accounts on ONE email. Three screen defects, in Splinter's
fix-first order:

1. He could not remove the broken account: Disconnect is greyed out on the default,
   and the default was the dead one. Dead end.
2. The create-agent picker could not distinguish two accounts on one email (two
   identical options), so he picked and ran on the dead one.
3. He could not tell which account was the original (labels auto-assigned after the
   fact).

Liveness/the lying green badge is Angel's half (#1916). This card is the SCREEN.

## Fixes

### 1. Signpost the dead-end default Disconnect (defect #1)
The engine refuses to remove `~/.claude` (it is the symlink hub for every account's
history at `~/.claude/projects`) -- correct and load-bearing. But the refusal was a
pure wall. `Sign in again` (#1492, `data-reauth`) is already on that same row and
re-auths the account in place, which is the real recovery for a broken default. The
pressed disabled-Disconnect message now points at it.
- Appended to the SPOKEN message (the click handler's `say`), NOT `btn.title`: the
  title stays pinned to the engine `because` (web.account-qualifier.test.js compares
  `title="Kosmos does not remove` against the engine sentence), and the remedy is
  UI-specific ("above") so it does not belong in the engine string.

### 2 + 3. Distinguish same-email accounts in the create picker (defects #2, #3)
`fillCreateAccounts` rendered options by email alone. Now it applies
`accountQualifiers` -- the same discriminator the Settings list already uses -- so a
duplicated email is distinct and the default (the original) reads `(main)`. Empty for
a unique email, so the common single-account case is unchanged.
- DISCRIMINATES BY LABEL / DEFAULT, NOT SIGN-IN STATE. The badge cannot see a
  rejected token (#874), so a liveness-based discriminator would still hide the dead
  one. `main` names which account is the original without a check the page cannot make.

## Test
`web.acct-picker-1917.test.js` EXECUTES `fillCreateAccounts` (extracted with `esc` +
`accountQualifiers`) against a fabricated list. The control the card asks for: two
accounts, same email, BOTH reading `connected`, asserted distinguishable without
clicking; the default marked `(main)`. Control arm: a unique email gets no qualifier.
Plus source pins that the press message names the remedy and did not leak into the
pinned title.

## Decisions / deferrals
- ADDED-AT deferred. `#1917` done-item 1 lists "when it was added" as a discriminator,
  but `list()` carries no timestamp; adding one needs a new engine field (config
  birthtime) and more render surface. The default=`main` + label already give a
  reliable, liveness-independent discriminator that identifies the original and
  distinguishes duplicates, which is what unblocks Ben. Added-at is additive polish and
  a clean follow-up.
- SWITCH picker (`fillSwitchAccounts`) is OpenAI-only, so the two-same-email-Claude
  case does not arise there. Scoped to the create picker, the surface Ben reported.
- The "adding/re-auth refreshes rather than duplicates" done-item is satisfied by the
  card's own "or, if duplicates are legitimate, they must be visibly distinct" -- this
  codebase's stated model is that a config dir IS an account and two dirs on one email
  are legitimately two accounts (accounts.js header), so visible distinctness is the
  chosen resolution, not dedup-on-add.

## Dependency: the Disconnect remedy is downstream of a CONFIRMED reauth defect
The pressed default-Disconnect points at `Sign in again`. Confirmed from Ben (via Josh,
2026-09-02): `Sign in again` runs the whole flow, returns a green check "like
everything's active", and does NOT capture a working credential -- his agent kept
401'ing. (The mechanism model was right and Angel confirmed it: `Add a provider` makes a
duplicate, `Sign in again` refreshes in place; the defect is that the in-place refresh
returns green without capturing.) It is RECURRING, not a one-off on Ben's Mac -- it also
hit Casey -- and Splinter is filing it as its own card.

So the message must NOT promise `Sign in again` fixes the account, or it loops a user
back to a false green. It names the step to try AND warns that a green check confirms a
sign-in ran, not that it captured a working credential (the same thing #874 measured
about the row badge). That warning is true whether or not the reauth flow captures, so
the sentence stays correct however the reauth defect resolves. When reauth is fixed, the
wording can be strengthened to name `Sign in again` as the fix.

## Overlap with Angel (#1916)
Both touch the account render in web/index.html. This half does not DEPEND on her fix:
it discriminates by main/label, not by the badge. Once her fix makes the connection
state see a rejected token, the picker's existing state handling becomes truthful for
free. Coordinated via Splinter (routes both halves).
