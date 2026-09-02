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

### What is not scanned (the dangerous part, kept minimal and explicit)
See the "Scope correction before merge" section below for the final model, which
this section defers to: the guard EXCLUDES the `.claude/plans/` prefix (the
migration-narrative surface) and keeps a one-entry allowlist for the guard's own
source (which necessarily contains every pattern). The allowlist is
existence-checked so it cannot rot into hiding a renamed file, and the scoping is
self-tested in both directions. Everything outside `.claude/plans/` and the guard
source is scanned.

### Wiring
It is a top-level `*.test.js`, so `tools/run-tests.sh:103`
(`node --test engine/*.test.js *.test.js`) already runs it - no run-tests.sh edit
needed. Confirmed armed by `tools.every-test-runs.test.js`.

## Out of scope / deferred (stated, not silently dropped)
- `~/.claude/BROWSER_TESTING.md` and other files OUTSIDE this repo are not touched
  here (the card is scoped to Kosmos = this repo). The plan prose that referenced
  the global file is retargeted, not the global file itself.
- Bare `Book` / `Stuff` / `Ebooks` as English words are NOT guarded (too generic,
  false-positive risk); only the explicit spellings above.

## Challenge-loop (converged, 2 clean blind passes)

Both blind passes returned zero BLOCKER/WARNING/CONVENTION - the guard was
verified non-vacuous and correct in both directions (matches every spelling
including the escaped form, rejects neutral English), armed by the `*.test.js`
glob, and the fixture swaps confirmed to preserve same-vs-different account
relationships (291/291 across the four affected test files). NITs applied:
- neutralized the link-preview description ("Ebooks you own." was Book.io's
  tagline; not a guarded spelling, done for Josh's "any way, shape, or form").
- raised the `git ls-files` floor from >100 to >1000 (near the ~1400 real count)
  so a PARTIAL enumeration also fails, not only an empty one.
- widened the negative-control list (facebook, audiobook, bookkeeping, ...) to
  self-document the no-false-fire guarantee.
NIT deferred with reasoning: `/\$stuff/i` matches `$stuff` as a substring (so a
rare `$stuffed` would trip), kept deliberately because it also catches real refs
like `$STUFF_BALANCE` that a word boundary would miss; the tree is clean today.
The line-based scan's wrap-span limitation is documented in the guard itself.

## Scope correction before merge: the guard must not red on the migration itself

Splinter flagged the forward risk that decides whether this guard survives the
month: the migration LEGITIMATELY generates book-io references in
`.claude/plans/` - every challenge-loop proof about the repoint names the repo it
repointed away from, and more such plans are landing (the dist plans, Baron's
work). A guard that scans those reds on honest migration work, and a guard that
reds on legitimate content is the guard someone disables.

So the guard now EXCLUDES `.claude/plans/` (internal dev-process notes, not the
public product surface Josh's ruling is about) and scans EVERYTHING else - code,
tests, web/, docs, README, tools, .github, non-plan .claude/ config - where a
brand string is a real leak. Chosen over Splinter's narrower "product dirs only"
option because this still catches a leak in README/docs/tools that a
named-dirs scope would miss. The scoping is self-tested (a control asserts a
.claude/plans/ path is exempt and a code/config/doc path is scanned) and
perturbation-proven both ways (book-io planted in a plan does NOT red; planted in
server.js DOES). The existing plan strips stay - the tooling refs I retargeted to
joshualeestone/claude-setup are correct regardless of scope.
