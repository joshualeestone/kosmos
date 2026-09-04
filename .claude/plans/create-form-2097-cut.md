# Plan: collapse the account rung cleanly when hidden + fix its stale browser check (#2097 cut blocker)

## Context
The 0.6.29 staging cut is blocked at step 3b: `docs/browser-checks/render-create-form.js`
fails identically on chromium AND webkit (so a real failure, not a flake). This is the
create-agent-picker zone (mine, via #2097).

Ruling, confirmed by reproducing the exact one-account condition on a board + measuring +
screenshotting: **(b) stale check**, plus one real minor cosmetic regression.

## Root cause
#2097 (already on main) hides the create-agent account row (`#create-account-row`) at
fewer than two usable accounts (Josh's hide-at-one ruling). It hid the ROW but left the
wrapping `.mstep`, which kept drawing its `::before` elbow (an orphan stub pointing at the
absent account) and an extra rung of indent. The browser check was written for the retired
show-at-one layout: it asserts the account rung is always drawn, a three-rung cascade, and
exactly two elbow arms, all of which fail once #2097 hides the row at one account. (It
passed on a multi-account box and failed on the one-account build box; that env-dependence
was the staleness.)

## Changes
1. **`web/index.html`** — `#cstep-name .mstep:has(> #create-account-row[hidden])` drops the
   collapsed account mstep's elbow (`content: none`) and its indent rung (`padding-left: 0`),
   so at one account the cascade is a clean provider → model (two rungs, one elbow, model one
   level in). Scoped by direct-child `:has()` to exactly the hidden-account state; the 2+
   account and OpenAI-provider layouts are untouched.
2. **`docs/browser-checks/render-create-form.js`** — rewrite the three stale assertions to
   assert #2097's behavior:
   - the account rung is hidden at one account and shown at two or more (`acctShown === (acctCount >= 2)`);
   - each VISIBLE menu steps in from the one above (two rungs hidden — model bounded to a
     single rung so the `padding-left: 0` half is guarded — three rungs shown);
   - one elbow arm per visible rung;
   - new: a hidden account rung draws no orphan elbow (guards the `content: none` half).

## Verification
- Fixed index + updated check: 42/42 at one account and 42/42 at two accounts, both engines.
- Updated check vs main's pre-fix index at one account: 38/42 (orphan + single-rung cascade
  both red), proving both halves of the fix are load-bearing.
- Full validation green (node --test + test:shell + #1720 browser-check gate). Challenge-loop
  2 iterations, converged.

## Decisions / rejected
- **Rejected: fix only the stale check, leave the orphan elbow.** The orphan is a real
  Josh-facing cosmetic miss on the fresh-install screen he is re-testing; fixing it (small,
  cross-engine-verified) is correct, and the check then asserts the clean layout rather than
  blessing a glitch.
- **Rejected: extend the collapse to the OpenAI model-row-hidden case.** Confirmed not an
  equivalent orphan — `#create-model-why` stays visible in the model mstep and takes the
  hidden row's place, so the model elbow retains a target.
- **Weakest premise:** the collapse-CSS guards only fire in the hidden (one-account) state,
  so coverage depends on the run environment rendering it. The build box is the one-account
  box (exactly where the stale assertion failed), so the hidden path is exercised in the
  target run environment.
