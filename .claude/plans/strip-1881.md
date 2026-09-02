# strip-1881: remove Book.io / Stuff.io references from Kosmos + guard reappearance

Card: `joshualeestone/kosmos#1881`. Josh, 2026-09-02 14:04/14:11 #admin: remove
every Book.io and Stuff.io reference from Kosmos, "in any way, shape, or form,"
and add a check so they cannot come back. Not in a rush; do it properly.

## Exposure (re-measured myself in this worktree, tracked files)

42 Book.io-family hits + 11 Stuff.io-family hits across 16 files: 9 plan `.md`,
3 live-code (all inside COMMENTS), 4 test files. The real exposure is that
`joshualeestone/kosmos` is a PUBLIC repo. No executable code references either
name; the served site carries none (per the card, not re-litigated here).

## The two halves

The strip is the smaller half. The DELIVERABLE is the guard: a one-time strip
regrows because people write honest incident notes naming real accounts. The
guard fails when any spelling reappears.

## Part 1 - the strip, by category

Spellings, all case-insensitive: `book-io`, `book.io`, `bookio`, `booktoken`,
`stuff.io`, `stuff-io`, `stuffio`, `$STUFF`.

### Neutral-identity scheme (consistent across all fixtures/prose)

`josh@book.io` and `josh@stuff.io` are Josh's REAL fleet accounts, and the
multi-account feature is about which account an agent runs on, so they are NOT
deleted - they are replaced with neutral example identities that preserve each
test's same-vs-different relationships:
- default / primary account (was `josh@book.io`): `agent@example.com`
- a DIFFERENT account (was `josh@stuff.io`): `other@example.com`
- a duplicate of the primary (same email, different dir): keep it `agent@example.com`
  so the duplicate-detection assertions still fire
- local-part fixtures keep their meaning, domain swapped: `recorded@book.io` ->
  `recorded@example.com`, `live@book.io` -> `live@example.com`, `sentinel@book.io`
  -> `sentinel@example.com`, `someone@book.io` -> `someone@example.com`
- `organization: 'Book'` -> `organization: 'Example'` (hygiene; not a guarded
  spelling, but it is the Book.io org name sitting beside the account)

Every fixture swap is paired with its assertion(s) on the same value so the test
meaning is unchanged (e.g. runningas.test.js:28 email + :32 assertion together).

### Comments / prose (live code + plans) - rewrite to make the point neutrally
- `engine/runningas.js:19-20`, `server.js:438,470`, `web/index.html:13505-13511,
  18117,22924`: migration/account incident write-ups. Rewrite with neutral emails
  (`agent@example.com` / `other@example.com`), keeping the technical point.
- `.claude/plans/acctdup-named.md`, `angel-modelline.md`, `whoamilive-1304.md`:
  same, prose rewrite with neutral identities.

### Tooling references -> retarget to the migrated repo
- `book-io/claude-setup` -> `joshualeestone/claude-setup` in
  `browserscope-1769-pre-challenge.md:72`, `deployguard-1669.md:32`,
  `sendertoken-1761-pre-challenge.md:77`.
- `blocked on a book-io org ruleset` (`fallback-capable-561-pre-challenge.md:17`,
  `resolver-fallback-1467-pre-challenge.md:20`, `resolver-test-1467-pre-challenge.md:21`):
  rewrite to "an upstream org ruleset" (the point is the ruleset, not the org).

### Link-preview test fixture (functional, uses book.io as an example URL)
- `web.room-761.test.js:21,23`: swap the example card to `https://example.com/`,
  title `Example`, site `example.com`. It tests link-preview rendering; the URL is
  arbitrary.

Editing the historical `*-pre-challenge.md` proof bodies is harmless: those hooks
only verify at PR-create time for the branch being created, never re-read old
proofs.

## Part 2 - the guard (the deliverable)

A node test `no-brand-refs-1881.test.js` (runs in the node suite, so it is armed):
1. Enumerate tracked files via `git ls-files` (fail loud if the list is empty - a
   broken enumeration must not pass vacuously).
2. For each file NOT in the allowlist, scan for the spellings case-insensitively;
   collect `file:line` for every hit.
3. Assert zero hits, printing every offending `file:line` on failure.
4. POSITIVE CONTROL (prove the matcher can fail): assert the regex matches each
   known sample spelling (`book-io`, `book.io`, `bookio`, `booktoken`, `stuff.io`,
   `stuff-io`, `stuffio`, `$STUFF`) and does NOT match a neutral control
   (`example.com`). A guard that cannot fail is not a guard.

### Allowlist (the dangerous part, kept minimal and explicit)
Only files whose PURPOSE is to name the forbidden patterns:
- the guard's own source (`no-brand-refs-1881.test.js`) - it contains the patterns
- this card's plan + proof (`.claude/plans/strip-1881.md`,
  `.claude/plans/strip-1881-pre-challenge.md`) - they document the cleanup
Everything else is scanned. The allowlist is a literal path set the reader can
audit, and the test refuses an allowlist entry that no longer exists (so it cannot
rot into hiding a file that was deleted or renamed).

### Wiring
Add it to `tools/run-tests.sh`'s node-test set the same way its siblings are, so
`npm test` runs it. Confirm via the existing wired-tests discipline if one covers
node tests.

## Out of scope / deferred (stated, not silently dropped)
- `~/.claude/BROWSER_TESTING.md` and other files OUTSIDE this repo are not touched
  here (the card is scoped to Kosmos = this repo). The plan prose that referenced
  the global file is retargeted, not the global file itself.
- Bare `Book` / `Stuff` / `Ebooks` as English words are NOT guarded (too generic,
  false-positive risk); only the explicit spellings above.
