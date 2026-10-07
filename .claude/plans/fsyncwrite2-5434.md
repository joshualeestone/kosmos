# fsyncwrite2-5434: #5434 slice 2, the provider account stores

Addresses #5434. Slice 1 (#5441, merged as 9dfe3d600) made `securewrite.writeSecret` flush the temp
before the rename. This slice moves the account stores' own tmp-then-rename writes onto it.

## Scope
- `engine/claudeaccounts.js` `storeKey`, `wireApiKeyHelper`, `unwireApiKeyHelper` (via a new
  `writeSettings`).
- `engine/grokaccounts.js` `storeKey`.
- `engine/geminiaccounts.js` `storeKey`.
- The three `forgetKey`s, and a new `securewrite.reapDeadTempsOf(file)` they call (below).

Not in this slice: `store.js` profile and settings saves (after #5418 merges, it touches store.js),
`reporthook.js` settings merge (it writes the same account settings.json; until its slice the two
writers differ: it does not flush, keeps a looser mode, creates at the umask default; documented on
`wireApiKeyHelper`), the name files (`grokaccounts.js:108`, `geminiaccounts.js:81`, plain
writes, not renames), and the other files the card lists.

## Decisions
- **Through writeSecret, not a second copy of the flush.** One writer keeps one error rule (slice 1):
  "cannot flush" is skipped, a real refusal stops the write and keeps the old file.
- **What changes besides the flush, stated so it is not a surprise:**
  - The temp is writeSecret's unique `wx` temp, not `<file>.tmp`. A failed write removes its own temp.
    One left by a process that DIED between create and rename used to be caught by the next
    `forgetKey` (it removed `<keyfile>.tmp`); writeSecret only reaps it on a later write into that
    folder. So `forgetKey` now calls `securewrite.reapDeadTempsOf(keyFile)`, which removes that file's
    temps by the reaper's own proof of death (a live writer's temp is left). The `<keyfile>.tmp`
    cleanup stays for temps an older version left.
  - After three failed atomic attempts writeSecret falls back to an in-place write; main threw. That is
    the fallback every other secret already has, and a refused flush never reaches it.
  - `settings.json` keeps its existing mode masked to 0644 (no group or other write, no execute): it holds `apiKeyHelper`, a
    command Claude Code runs, and writeSecret sets a mode exactly (no umask), so a 0666 file would
    otherwise have stayed 0666 where main's fresh temp brought it back to 0644. On main every save
    went through a fresh temp at the umask default, so a 0600 file became 0644, though the docblock
    already said "mode-preserving". A new one is 0600: writeSecret sets the mode exactly, so a fixed looser default would override a
    tighter umask, and only this user's Claude Code reads it.
- **Cost:** about 8 ms per save on this Mac (slice 1's measurement). These saves happen once per key
  entered or account wired, not in a loop.

## Tests
`engine/accounts.fsync-5434.test.js`, 11 arms, also listed in `tools/windows-tests.js` (ALSO):
- each `storeKey` flushes the temp it renames into the key file (fails on main), the key reads back
  trimmed, and the mode is 0600;
- each `storeKey` still removes a stale `<keyfile>.tmp` (a guard: passes on main; fails when the
  cleanup is removed, checked by mutation);
- each `forgetKey` removes a dead writer's writeSecret temp and leaves a live one (a child process
  the test starts and keeps alive); fails when the reap call is removed;
- wire and unwire flush settings.json before its rename (fails on main);
- settings.json keeps 0600 and 0644, a 0666 one comes back 0644 (fails with the mask removed), other
  settings are kept, and a new one is 0600 under umask 022 (fails on main).
Locally: 153 files (the account and securewrite tests plus every repo-wide meta test), 4101 tests, 0 fail.

## Weakest premise
That nothing reads a new settings.json as another user. Claude Code runs as the agent's own user here;
if a deployment ran it as a different user it could not read a new 0600 file. An existing file keeps
its mode, so only a fresh account is affected.
