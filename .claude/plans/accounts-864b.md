# Plan: accounts-864b

Josh, #chaoskosmos-design, 2026-08-25 11:54.

## Changes

1. **Renamed "Accounts" to "AI Models"** (nav label and section
   heading). His words: "accounts" is ambiguous ("is this my user
   account or what is this account?") and Your Profile already covers
   the person's own account. Internal ids untouched.
2. **Removed the standalone "Claude subscription" summary box.** His
   words: "both of those accounts that it's listing are Claude Max
   subscriptions. This top box really could just go away." Also
   retires a real contradiction risk: the box and the provider rows
   below read from two independent checks that could disagree, which
   is exactly what a screenshot he sent earlier today caught (added to
   #864's own comments).
3. **The connected dot pulses**, reduced-motion respected, the same
   mark-pulses/word-stays-legible split the working-agent card already
   makes.

## Deliberately NOT built

The "An agent moved here keeps its conversation history" line and its
negative-arm "...would start with no history. Fix this" button. Josh's
words called the positive-arm sentence confusing filler he didn't
recognize, but the negative arm is a real, working control -- deleting
the whole conditional would remove a working fix for an account that
doesn't share history, not just a sentence. Flagged in the issue and
Discord for his input rather than guessed at either way.

## Verification

- [x] `npm test` (full suite) -- two tests needed updating for the
      genuinely deleted `accountRow()`/`#set-account` (not renamed,
      not hidden, actually removed): one server-side test's
      accountRow-specific assertions removed (its chkRow assertions,
      still valid, kept); one settings-nav test's `set-account` entry
      dropped from its id-to-section map. A new test added pinning the
      rename, the box's removal, and the pulse. 0 failures.
- [x] Real live-server Playwright verification: navigated to Settings
      > AI Models, confirmed the rename, the box's absence, and no
      console errors, against a real running instance with real
      provider rows.
- [x] `bash tools/browser-checks.sh` (full suite) -- see pre-challenge
      proof. Rebased onto main after an unrelated cut-blocking check
      fix (fix-render-projects-check) landed; re-ran the full suite
      clean post-rebase rather than trusting the pre-rebase result.
