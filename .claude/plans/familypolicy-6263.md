# familypolicy-6263 (board half of kosmos#6263), stacked on familysayboard-6251

A family's policy is said as the family's, everywhere the board words an org's policy. The kind is the enrolled org's
(orgenroll.kindHere, the record's), read at the moment the sentence is made, through the same inKind rewrite as #6251.

## What changes
- engine/orgpolicy.js allows(): the three create refusals ("your company's policy does not allow ...").
- engine/policy.js: the agent's instruction block (heading, "Set by your company in its Kosmos policy") for one
  policy or a stack, and the oversize refusal.
- engine/create.js: the step label when the policies could not be added, through policy.aboutPolicies (round 5).
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

## Round 1 (opus) fixes
- On a family's Kosmos the heading names the family only when the family's policy is in the block; the person's own
  policies alone are "## Your AI policy" / "## Your AI policies" (a child's pasted policy is never said to be the
  family's). Any other Kosmos keeps its heading byte for byte. Tested both kinds and no org; red without the rule.
- companyPolicySync's record includes the kind, so the same text re-tells the agents when a record gains a family
  kind; a company gaining its kind re-tells nothing (server.familypolicy-6263.test.js, red without the kind).
- kindHere sits above oneAtATime with its own comment (it had split pendingKind from its doc); it returns null for no
  kind as its comment says. create.js reads orgenroll once.
- Kept (NIT): WROTE_WHY ("Kosmos updated the company AI policy") is the instruction file's history note; the source
  pin of the server's kind beside the driven page arm; one enrollment read per block (a sync is not hot).

## Round 2 (sonnet) fixes
- The sync key holds the kind with or without the family's own policy, so joining or leaving a family re-tells the
  agents whose block holds only the person's own policies (tested both ways, a company join as the control; red with
  the key keyed on the entry alone).
- A block reads the kind once and passes it to its heading and every line (blockBody, stackedBody, the oversize check).
- Kept (NIT): DEFAULT_NAME "Company AI policy" (a #479 migration name); the create step label's inKind is untested.

## Round 3 (opus) fixes
- The re-read line owed after a policy change names the headings this Kosmos's blocks carry (policy.js headingsHere,
  from heading() itself): a family's agent is sent to "Your family's AI policy" or "Your AI policy" and the plurals,
  never to a heading its file lacks; a company's and no org's line is unchanged. Tested against every block shape; red
  without it.
- server.js uses orgenroll.kindOf for the kind it sends and keys on (one mapping).
- Narrowed, as the code does: in a stack that holds the family's policy the heading is the family's, over the person's
  own entries too; each entry's own line still says who added it ("Added by the person you work for").

## Round 4 (sonnet) fixes
- companyPolicySync's three log lines go through inKind too (they are the operator's terminal, but the same sentence).
- orgenroll.kindNow() is the one 'family'/'company' mapping server.js uses for the page and the sync key.
- Kept (NIT): the create step label untested (reached only when the splice fails); policySection's fallback.

## Round 5 (opus) fixes
- create's step label follows heading()'s rule (policy.aboutPolicies): the family's only when the family's policy
  is in force, else "your AI policies"; a company's and no org's unchanged. Tested for every case and that create.js
  routes through it; red when the rule is dropped.
- policySection's comment says what it does (names the family's headings and "Your AI policy"; the file has one).
- companyPolicySync requires orgenroll once.
- Kept (NIT): /api/org and the join answer map the kind inline (familysayboard-6251's lines, not this branch's).
