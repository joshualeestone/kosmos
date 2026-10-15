# familypolicy-6263 (board half of kosmos#6263), stacked on familysayboard-6251

A family's policy is said as the family's, everywhere the board words an org's policy. The kind is the enrolled org's
(orgenroll.kindHere, the record's), read at the moment the sentence is made, through the same inKind rewrite as #6251.

## What changes
- engine/orgpolicy.js allows(): the three create refusals ("your company's policy does not allow ...").
- engine/policy.js: the agent's instruction block (heading, "Set by your company in its Kosmos policy") for one
  policy or a stack, and the oversize refusal.
- engine/create.js: the step label when the policies could not be added (not tested: reached only when the splice
  fails; it is the same inKind call as the others).
- server.js: the policy entry the Policies tab reads carries `kind`; web/index.html words its two lines by it.

## Decided
- A company's, and a Kosmos in no org, keep every byte (tested): the instruction block is byte-identical to #479's, so
  no company agent's file is rewritten. A family's agents get a rewritten block the first time, which they must.
- orgenroll is required inside the functions, not at the top: orgenroll reaches policy.js through orgpolicy.
- The agent-events "stopped by your company's rules" phrase is a consent-words key, already read for a family by
  familywords-6239; not touched.
- The company sign-in (remote.js) is a company's single sign-on: not a family surface.

## Tests
- engine/familypolicy-6263.test.js 3/3: a control that the sandbox record is the one read; allows() for family,
  company and no org over three refusals; the block and stack for both kinds, a company's and no org's identical.
- web.policy-company-5534.test.js: the harness passes the page's own plusOrgIn; a new driven arm for a family entry.
- web.familypolicy-6263.test.js 1/1: the card and line go through plusOrgIn; the board sends the kind.
- Mutations, each red: allows() ignoring the kind; the block ignoring it; the card ignoring it.
- The policy and create tests named by what this touches: 354/354 (with #6251's).
