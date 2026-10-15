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
That nobody renamed the `p1` entry to exactly "Company AI policy" themselves. `p1` only comes from migration, but a person
could rename it back to that exact name; this change would then rename it again on read. Judged rare (it needs the
pre-#685 record, then a rename to that exact string), and the result is the neutral "AI policy", not a wrong owner.
What would change my mind: a way to tell a person-chosen name from the migrated one. The record does not keep one.

## Not done
- If another entry already wears "AI policy", the migrated entry keeps "Company AI policy" (the case the card is about,
  only in that rare combination). Not renamed to "AI policy (2)": inventing names is worse than keeping one.

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
read or re-read 364/364. Mutants: no rename on read (2 red), any id renamed (control red), no collision guard (red).
Mutant "new migrations named DEFAULT_NAME" survives and is EQUIVALENT: a v1 record migrates with id p1 as its only entry,
so rename on read fixes it either way.
