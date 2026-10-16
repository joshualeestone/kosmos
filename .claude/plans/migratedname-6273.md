# #6273: a migrated #479 policy is no longer named "Company AI policy"

## Problem
A policy saved before #685 (the #479 single record) migrates under `DEFAULT_NAME = 'Company AI policy'`. With two or
more policies the stacked block shows that name as a `###` heading. That tells every agent a company owns a policy the
person pasted themselves.

Every entry in policy.json is the person's own: the company's policy is never stored there (it comes from
`companyEntry()`), and `problem()` only accepts a `pasted` or URL source.

## Change (engine/policy.js only)
1. `MIGRATED_NAME = 'AI policy'`: the name a newly migrated v1 record wears (`entriesOf`).
2. Rename on read: in `read()`, an entry renamed ONLY when all three hold:
   - its id is `MIGRATED_ID` (`p1`, the fixed id only migration produces);
   - its stored name is exactly `DEFAULT_NAME`;
   - no other entry already wears `MIGRATED_NAME` (case-insensitive, the rule add/rename use).
   It is not persisted on read; the next mutation persists it, the same lazy pattern the v1 migration uses. The next
   sync (syncEveryone) hands agents the corrected heading.
3. `DEFAULT_NAME` keeps its other job: the fallback name of the company's real policy (`companyEntry`), where
   "Company AI policy" is true. It is not changed.

## Rejected
- Changing `DEFAULT_NAME` itself: it would also rename the company's real policy fallback.
- Renaming any entry named "Company AI policy": an entry with a random id was named by the person.
- Rewriting policy.json on read: read stays side-effect free, as the v1 migration is.
- Touching the block rendering (blockBody / stackedBody): #6270 (policyhead-6270, PigeonPete) is rewriting those lines.
  This change stays in the read path, whose lines that branch does not touch.

## Weakest premise
Originally: that nobody renames p1 back to exactly "Company AI policy". Review 1 showed that case was real and worse than
rare: the page said "Renamed" and the rename reverted on the next read. Fixed: persist() now writes version 3, and the
rename on read applies only to a record written before #6273 (version 1 or 2). Once this build has written the record,
p1's name is whatever the person last chose, including "Company AI policy".
Remaining premise: that no v2 record holds a "Company AI policy" on p1 that the person chose BEFORE this build. That
needs the pre-#685 record, then a rename to that exact string, both before this ships. It is renamed once, to the
neutral name, and a rename back then sticks.

## Not done
- A company policy NAMED "AI policy" (any case) beside the renamed entry gives two near-equal headings (review 3).
  Rejected fix: skipping the rename when the company's policy wears that name, because the next save would then keep
  "Company AI policy" for good in a version-3 record, the false owner next to a real one. Kept: both headings, each
  with its provenance line ("Set by your company in its Kosmos policy." / "Added by the person you work for on ..."),
  pinned by a test. read() stays independent of company state. Weakest premise: that an agent reads the provenance
  line, not only the heading.
- A downgrade to an older build that then saves writes version 2 again; back on this build, a p1 the person had renamed
  to "Company AI policy" is renamed to "AI policy" once more (review 2). Accepted: it needs a downgrade plus a save,
  happens once, and a rename back then sticks.
- If another entry already wears "AI policy", the migrated entry keeps "Company AI policy" WHILE that clash holds. Not
  renamed to "AI policy (2)": inventing names is worse than keeping one. Review 5 found a save during the clash wrote
  version 3 and froze the old name for good; now read() reports renamePending and every save keeps the record at
  version 2 while p1 still holds the old name, so the rename applies once the clash is gone. A rename of p1 to any
  other name moves it off DEFAULT_NAME, so it saves as version 3 (the person's choice); a rename to the SAME name saves
  nothing (review 7), so it cannot settle the old name. Review 7 also pinned renaming the clashing entry away
  (mutant "rename always saves v3" red). The same-name no-op is an EQUIVALENT mutant for the version (the unchanged p1
  keeps renameStillPending true); it stays to skip a pointless write and agent sync. Review 6: a re-ingest of p1 during a clash is
  pinned too (stays version 2). Kept: assertion messages describe the failure, so "the record is not marked..." is
  right as written.

## Why this overrides the #685 model
The DEFAULT_NAME comment records Josh's #685 model: the policy that predates names "is simply the company's". That held
while no company policy existed. Since #5534 the company's real policy arrives separately and falls back to the same
name, so a stack could hold two "### Company AI policy" headings, one owned by no company (test added). The change is
reversible copy; the model's author can overturn it by renaming MIGRATED_NAME back.

## Tests
engine/policy.test.js: the migration test now expects MIGRATED_NAME; a new test covers rename on read (p1 renamed and
persisted by the next mutation, the stacked heading reads "### AI policy", a person's own "Company AI policy" with a
random id untouched, no rename when "AI policy" is taken), plus the company fallback still DEFAULT_NAME
(policy-company-5534 test, unchanged).

MEASURED: the #6273 and migration tests 3/3; both policy test files 15/15; the 13 test files that touch the policy name,
read or re-read 364/364. Mutants: no rename on read (2 red), any id renamed (control red), no collision guard (red), no version guard (the
rename-back arm red, review 1). Review 2: a version-4 record is not treated as old (arm added). Review 3: only a real number counts as a
version (a hand-edited "3" or [3] reads as old, the safe direction).
Mutant "new migrations named DEFAULT_NAME" survives and is EQUIVALENT: a v1 record migrates with id p1 as its only entry,
so rename on read fixes it either way.
