# whatsnew-0831: What's New for 0.8.31

The gap alarm (kosmos#1050), 2026-11-28 01:27 CST: main 73 commits past staging 0.8.30.

## The change
- The window's one line, for #9217 slice 2 (heavy jobs take turns): "Agents take turns on heavy jobs" (31) / "The
  board's heavy-job note now says who is next in line for a turn, and gives the day for a job not started today." (114).
  Rank 10.95, since 0.8.31, untagged: paintHeavyJobs on the shared board page now paints data.heavyLine ("Next: ...",
  or "No heavy job is running; next in line: ...") and a date before the time for a job not started today.
- Two notes-only lines: #9257 (Windows only: an agent whose task ended during the running-agents lookup is not started
  again beside the new copy) and #9243 (delivery checks point at the receipt, not at another probe).
- build 0.8.31 recorded prod 0.8.30 and Windows prod 0.8.30 itself and marked its idle-agents line shown.

## Checks
- whats-new-check 0.8.31: mac 1, windows 1. prod-check exit 0. notes 0.8.31 exit 0 on mac, linux and windows.
- What's New tests by name (check-3955, pool-5711, pool-sync-5713, pool-win-8924, web.whatsnew-3955, web.whatsnew-phone-7839): 74 pass, 0 fail.

## Rejected
- Lines for #9238 (community refuses words plus a piped body), #9246 (queued-heavy announces), #9254 (test browsers
  never ask for the keychain): agent- or test-facing refinements with no new verb or screen.

## Weakest premise
That "who is next in line" reads true on Windows. The note is the shared board page and the line comes from the board's
own status, but no Windows run of slice 2's note is recorded on its card.
