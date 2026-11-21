# whatsnew-0814: What's New for the 0.8.14 staging cut

Gap alarm 11-21 17:1x (#1050): main 48 commits / 24 h past staging 0.8.13. Decided on #1050: cut 0.8.14 to staging,
with What's New written first, so usage auto-balance (#8846, on by default) does not reach staging boards unannounced.

## What
- `release/whats-new-pool.json`: four entries, since 0.8.14.
  - Highlight: "Agents move off an account that is running out" (#8846). Line read against engine/autobalance.js
    (AT_RISK_PCT 80, TARGET_MAX_PCT 70, idle agents) and the Settings switch ("Move agents off an account that is
    running out"); 132 characters (the window's limit is 140).
  - Notes only: #8845 (a Following read says when nothing new came; an answered reply is marked), #8839 (agent move
    --yes takes the listed name), #8844 (feedback --unchanged keeps a single piped line, or says why not: in
    PowerShell the Windows CLI refuses a pipe), #8853 (kosmos post --how), #8858 (kosmos agent --how).
  - Review 1: "two or more Claude subscriptions" (an API-key account does not count, usagepoll.claudeAccountsLinked).
- `web/whats-new.json`: built by `tools/whats-new-pool.js build 0.8.14`, not by hand. The window: the auto-balance line
  plus four 0.8.12 entries the tool ranked in (still pending, because prod has not been promoted past 0.8.11).

## Decisions
- No entry for the iPhone New Project wording (#8837): it ships in the iPhone app, not the board.
- No entry for #8860 (throwaway board labels) or #8735's brief-wording slices (#8850, #8854, #8855): nothing a person
  runs or sees. #8735's two new commands (post --how, agent --how) do get notes lines.
- The auto-balance line says what it does and that Settings turns it off; it claims nothing about per-model limits.
  #8862 (the mover ignores per-model limits) is open; Splinter's condition on #1050: 0.8.14 is not promoted to prod
  until #8862 is in or auto-balance is off by default again.

- Review 2: the highlight says "idle agents", and the mover also moves agents stopped at their limit (#8048). Kept as
  is: every wording that adds that case and keeps the trigger runs past the 140-character window (145 to 161
  measured), and the one that fits (137) drops "near its weekly limit" and reads as if every idle agent moves. The
  line under-claims; the Settings text names both cases.

## Weakest premise
That "near its weekly limit" and "one with room" are fair summaries of 80% and under 70%: a person reading "near"
might expect a lower trigger. The Settings text gives the exact numbers.

## Checks
- `tools/whats-new-check.js 0.8.14`: 5 highlights for 0.8.14 (mac 5, windows 5).
- The What's New test files: 72 tests, 0 failed.
