# policyhead-6270: a person's own AI policies are "Your AI policy" on every Kosmos

Card: kosmos#6270 (filed by Renet from #6263 challenge round 6; handed over by her 18:28). Stacked on
origin/familypolicy-6263 (5bb8af0dc9), which adds the family rule this widens; rebase onto main when #6263 merges.

## Change
- `engine/policy.js` `heading()`: the org's wording only when the org's policy is in the block (the family's on a
  family's Kosmos, the company's otherwise); the person's own policies alone are "## Your AI policy" / "## Your AI
  policies" on every Kosmos. Before, only a family's Kosmos did this; a company's and a Kosmos in no org headed the
  person's own pasted policy "Your company's AI policy", under a line saying "Added by the person you work for".
- `aboutPolicies()` (create's step label) follows the same rule, as its comment says it does.
- `engine/instructionreread.js`: `SECTIONS.policy` is now reached only when `policy.headingsHere()` throws (every kind
  now has four headings, so the `names.length < 2` branch is unreachable in practice); it names all four.
- Tests: the pins of the old heading in `familypolicy-6263.test.js` and `policy.test.js` follow the rule.
  Board review 3's check (the re-read line names exactly the headings a block can carry) now runs for company, no
  org, and family, replacing the "a company's line is SECTIONS.policy" pin.

## Calls
- **Accept one rewrite of every agent's policy block.** The card's weakest premise. Measured how it lands: new code
  arrives only with a board start, and the board-start sweep (server.js, "the AI policy block at boot") calls
  `syncEveryone` and then `instructionRereadOweEach(told, 'policy')`, so each agent whose block changed is rewritten
  once and owed one re-read line. No change to companyPolicySync's key is needed (Renet's third point): a running
  board never sees the new code without a restart, and the boot sweep is what carries it.
- **Kept the company's wording when the company's policy is in the block** (a stack with it, or it alone): the
  company did set it. Rejected: "Your AI policies" for every stack (it would hide that an employer's rules are
  among them).
- **headingsHere keeps all four headings for a Kosmos in no org,** including the company's two, though a no-org
  Kosmos should never hold the company's entry. Listing a heading that cannot occur costs a longer re-read line;
  omitting one that does occur (a stale entry) would send an agent to a section it cannot find.

## Weakest premise
That one fleet-wide rewrite plus a re-read line is acceptable, which #479/#685 avoided. It is reversible (a commit
puts the old heading back, at the cost of a second rewrite).

## Evidence
- `engine/policy.test.js`, `familypolicy-6263.test.js`, `policy-company-5534.test.js`, `instructionreread.test.js`,
  `instructionreread-sections-5304.test.js`: 53/53.
- `server.policy-refresh-5534.test.js`, `server.orgenroll-5531.test.js`, `orgpolicy-family-6239.test.js`,
  `create.test.js`: 273/273.
- Mutants (each asserted applied, tree restored to HEAD after): `heading()` with the old family-only rule: 6 fail;
  `aboutPolicies()` with the old family-only rule: 1 fail.
