# Plan: #3444, agents address the operator by name, not "operator"

Branch: `operator-name-3444` · Repo: joshualeestone/kosmos · Lane: engine / agent-instruction-template

## The card
Josh (side note, 2026-09-22, documented by his on-box agent): agents address him as
"operator" / "the person" instead of by name. The instruction template captures the
operator's name under `## Who you work for` (engine/you.js), but nothing tells an agent to
USE it when writing to the person, and the general lines say "the person" / "whoever you
report to", so agents default to the generic word. Not a placeholder bug ("Moses" is a real
test name Josh gave). Fast-follow, not a cut blocker.

## What "done" looks like
The shared doctrine block tells every agent (new AND existing) to address the person by the
name in their "Who you work for" section, so an agent writing to Josh uses his name.

## The design decision (and why it deviates from the card's literal wording)
The card said "add one sentence to the `### How to write to them` section." I made it a NEW
`### Use their name` section instead. Reason: `missingFrom` (engine/defaults.js) matches by
HEADING, so a #539 consented refresh re-offers a section to an EXISTING agent only if the
agent lacks that heading. An edit INSIDE an existing section reaches ONLY newly-created
agents; a NEW heading reaches the existing fleet. Josh's complaint is about the agents he is
ALREADY talking to (the existing fleet), and "address by name" is a pure instruction with no
runtime-discovery path (unlike v9's in-section exception). So the card's literal in-section
edit would have missed the exact population reporting the problem and failed the card's own
stated goal ("fixes it for every agent on every machine"). The version log documents this
exact delivery lesson six times (v5/6/7/8/10/11).

## What changed (coupled indices)
1. `engine/defaults.js`, added `### Use their name` section to BLOCK (after `### How to
   write to them`), instructing the agent to call the person by the name in "Who you work
   for", with the reasoning. The reference is conditional ("If you were given their name")
   so it degrades safely. No em dash.
2. `engine/defaults.js`, bumped `DOCTRINE_VERSION` 11 to 12 and added the v12 log entry (with
   the NEW-HEADING delivery rationale and weakest premise).
3. `engine/defaults.test.js`, re-pinned the composed-block fingerprint for version 12, and
   added a #3444 delivery test (content pin + legacy-delivery + discriminating control,
   modelled on the #1253 delivery test) so the mechanism the design rests on is guarded, not
   just the fingerprint.

## Verification
- Doctrine cluster GREEN: `defaults.test.js` + `doctrine.test.js` + `reports.test.js` +
  `you.test.js` + `worldimport.test.js` + `firstrun-isolation-1780.test.js`. Confirms: no em
  dash introduced, sections re-join byte-for-byte, missingFrom still correct, doctrineVersion
  propagation intact, and the new section is delivered to a legacy agent.
- `create.test.js` `runLauncher` failures are PRE-EXISTING and FLAKY (vary run-to-run: 5/3/1
  across identical-code runs), spawn `bin/agent-supervisor.sh` with a fake tmux, are provably
  independent of a doctrine-text change, and pass on CI. Proven by stashing the change: clean
  origin/main shows the same runLauncher failures.

## Weakest premise (named)
The new section points at the `## Who you work for` section, which is not always present.
`you.js` tellAgent splices that block only when the operator record is `saved` (which
`problem()` gates on a non-empty name) and removes it otherwise, so an agent with no record
has no such section. The shipped prose is written conditionally so the absent-section case
degrades to the generic word rather than pointing at nothing. Also: the new-heading call is a
judgment deviation from the card's literal wording; if a reviewer prefers the in-section edit
(new-agents-only), it is a one-line move, but it would not reach the fleet Josh is complaining
about.

## Challenge-loop note
Iteration 1 (opus) surfaced two prose NITs (an overstatement of "the operator", and an
unconditional presence assertion); both fixed. Iteration 2 (sonnet) surfaced three WARNINGs a
single-model loop would have shipped: em dashes in THIS plan file, a v12 log comment that
mischaracterised the you.js gating, and the missing delivery test. All three fixed here.
