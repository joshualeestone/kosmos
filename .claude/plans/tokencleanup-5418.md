# tokencleanup-5418: #5418 ask 2, the one-time cleanup tool

Addresses #5418 (ask 2). Ask 1 (PR #5452, merged 1683b0f3e) made it impossible for a test process to reach the real
data root. This adds the tool for the records test runs had ALREADY left in a real sender-token store (on one fleet
Mac, measured 10-06: 22 entries, 17 matching no agent and dated 08-28 to 09-08, one dangling symlink, two stray temps).

## The tool: `tools/cleanup-fixture-tokens-5418.js`
- Dry run by default; `--apply` to change anything. `--port` and `--cutoff` are required, never assumed (the board
  port is per account; the cutoff is the date before which a stray record can only have come from a test run).
- **What it keeps, always:** any token file whose agent is on the RUNNING board's roster (`GET /api/status`, the
  same list the board uses, removed agents filtered) or in the board's removal records, at any age; anything written
  on or after the cutoff; anything that is not a token file, a temp or a link; a link whose target exists.
- **What it may remove:** a token file matching neither list and written before the cutoff; a `*.tmp` written before
  the cutoff; a link pointing at nothing.
- **No roster, no removal:** an unreachable board, a non-OK answer, no agent list, or an EMPTY agent list stops it
  before planning (an empty roster would make every file a candidate).
- **Backup first:** `--apply` copies the whole folder (files with their modes, links as links) to a new
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
`tools.cleanup-fixture-tokens-5418.test.js`, 9 arms, also run by the Windows job (ALSO_ROOT): the plan's keep/remove
split for every kind of entry (a live agent kept at any age: fails if the roster check is removed); unknown age
never removed; links seen without following; backup copies modes and links and never overwrites; apply re-checks
and goes through revoke; port and cutoff required; no roster or an empty one changes nothing (fails if the empty
guard is removed); end to end in the test process's own throwaway store (ask 1 guarantees it is not the real one;
the test asserts so).

## Running it (after merge)
On each fleet Mac that ran tests before 2026-10-08: dry run with that account's board port and cutoff
2026-10-08T00:00:00Z, read the list, then `--apply`. Report counts on #5418.

## Weakest premise
That a token file with no roster agent is never needed. A board briefly offline at the moment of a launch is the
case: the tool needs the board UP to read its roster, so a stopped board stops the tool rather than orphaning
anything, and the cutoff excludes anything written recently.
