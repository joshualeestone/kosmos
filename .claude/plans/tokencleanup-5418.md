# tokencleanup-5418: #5418 ask 2, the one-time cleanup tool

Addresses #5418 (ask 2). Ask 1 (PR #5452, merged 1683b0f3e) made it impossible for a test process to reach the real
data root. This adds the tool for the records test runs had ALREADY left in a real sender-token store (on one fleet
Mac, measured 10-06: 22 entries, 17 matching no agent and dated 08-28 to 09-08, one dangling symlink, two stray temps).

## The tool: `tools/cleanup-fixture-tokens-5418.js`
- Dry run by default; `--apply` to change anything. `--port` and `--cutoff` are required, never assumed (the board
  port is per account; the cutoff is the date before which a stray record can only have come from a test run).
- **The roster is the only guard for a live agent** (the cutoff is in the past for every live file). Each row of
  `GET /api/status` (`agents[]`) and of the removal records counts under every spelling a token file can carry:
  `sessionName` (tokens are minted under it, via the supervisor's `token_roster_name`: `+world` stripped, then
  `-discord`), those stripped forms, and the display `name`. A display name alone is WRONG: Splinter's card reads
  "Splinter" but its tokens live in `claudebot.json` (review 1 found this; the e2e arm pins it).
- **What it keeps, always:** a token file under any such spelling, at any age; a file whose name is not one the store
  writes (`safeKey(key) !== key`: `revoke` would remove a DIFFERENT file); anything written on or after the cutoff;
  anything that is not a token file, a temp or a link; a link whose target exists; a token file written after the
  plan was made (re-checked just before removal).
- **What it may remove:** a token file matching neither list and written before the cutoff; a `*.tmp` written before
  the cutoff; a link pointing at nothing.
- **No roster, no removal:** an unreachable board, a non-OK answer, no agent list, an EMPTY agent list, no board
  token for this store, or a roster that matches NONE of the store's token files (a board serving another store)
  stops it before planning.
- **Backup first:** `--apply` copies every file and link (with modes; links as links; a subfolder is neither copied
  nor removed) to a new
  `sendertokens.backup-5418-<time>` folder beside it, refusing to overwrite, and stops if that fails.
- Token files are removed through `sendertoken.revoke` (under its lock); temps and links are re-checked
  (still a file, still a link) just before unlinking. Prints names and counts, never a token.

## Rejected
- Matching by profile files instead of the board's roster: the 10-06 inventory found fixture-looking names WITH
  profiles, so fixture profiles leaked too. The board's live roster is the only list that means "a real agent here".
- Sweeping the store's other folders in this tool: each has its own shape and owner logic; the token store is the
  one the card measured. Others are a follow-up if a dry run of them finds strays.
- Running it automatically (at install or start): it is one-time, for machines that ran tests before ask 1.

## Tests
`tools.cleanup-fixture-tokens-5418.test.js`, 12 arms, also run by the Windows job (ALSO_ROOT): the plan's keep/remove
split for every kind of entry (a live agent kept at any age: fails if the roster check is removed); unknown age
never removed; links seen without following; backup copies modes and links and never overwrites; apply re-checks
and goes through revoke; port and cutoff required; no roster or an empty one changes nothing (fails if the empty
guard is removed); end to end in the test process's own throwaway store (ask 1 guarantees it is not the real one;
the test asserts so), with a display name differing from the session name, a `-discord` twin and a non-canonical
file all kept; a roster matching no file, and a missing board token, each stop it. Every guard was mutation-checked:
removing it fails an arm.

## Running it (after merge)
On each fleet Mac that ran tests before 2026-10-08: dry run with that account's board port and cutoff
2026-10-08T00:00:00Z, read the list, then `--apply`. Report counts on #5418.

## Weakest premise
That the spellings above cover every key a live agent's tokens can sit under. They match the supervisor's
`token_roster_name` and the session/key names the Windows, adopt and remote paths mint under. A key minted some
other way would look orphaned; the dry run lists every planned removal by name so a person reads it before --apply.
