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
  plan was made (re-checked UNDER the store's lock by a new `sendertoken.revokeIfUnchanged`); a file holding any
  `launcher: 'remote'` token (review 2: a remote or paneless agent is on `/api/status` only while its heartbeat
  is fresh, so an OFFLINE one would look orphaned). Age is a file's newest sign of life: the later of its newest
  token `mintedAt` and its mtime.
- **What it may remove:** a token file matching neither list and written before the cutoff; a `*.tmp` written before
  the cutoff; a link pointing at nothing.
- **No roster, no removal:** an unreachable board, a non-OK answer, no agent list, an EMPTY agent list, no board
  token for this store, or a roster that matches NONE of the store's token files (a board serving another store)
  stops it before planning.
- **Backup first:** `--apply` copies exactly the entries it will remove (with modes; links as links) to a new
  `sendertokens.backup-5418-<time>` folder beside it, refusing to overwrite, and stops if that fails.
- A future `--cutoff` is refused. The dry run prints, per token file it would remove, its launchers and newest
  mint, so a person can see a Windows or adopted agent before `--apply`.
- Token files are removed through `sendertoken.revokeIfUnchanged` (under its lock); temps and links are re-checked
  (still a file, still a link) just before unlinking. Prints names and counts, never a token.

## Rejected
- Matching by profile files instead of the board's roster: the 10-06 inventory found fixture-looking names WITH
  profiles, so fixture profiles leaked too. The board's live roster is the only list that means "a real agent here".
- Sweeping the store's other folders in this tool: each has its own shape and owner logic; the token store is the
  one the card measured. Others are a follow-up if a dry run of them finds strays.
- Running it automatically (at install or start): it is one-time, for machines that ran tests before ask 1.

## Tests
`tools.cleanup-fixture-tokens-5418.test.js`, 14 arms, also run by the Windows job (ALSO_ROOT): the plan's keep/remove
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

## Weakest premises
1. That the board lists every agent whose token must survive. Pane agents (running or stopped) and created agents
   are listed; remote agents are kept by their launcher even offline. Left uncovered: an adopted or Windows agent
   that is offline AND not in the created roster, whose tokens carry no launcher. The dry run lists each candidate
   with its launchers and newest mint for a person to read, and the backup restores a file if one is wrong.
2. That the spellings above cover every key a live agent's tokens can sit under. They match the supervisor's
`token_roster_name` and the session/key names the Windows, adopt and remote paths mint under. A key minted some
other way would look orphaned; the dry run lists every planned removal by name so a person reads it before --apply.
