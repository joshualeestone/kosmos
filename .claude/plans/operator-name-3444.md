# Plan: #3444 — agents address the operator by name, not "operator"

Branch: `operator-name-3444` · Repo: joshualeestone/kosmos · Lane: engine / agent-instruction-template

## The card
Josh (side note, 2026-09-22, documented by his on-box agent): agents address him as
"operator" / "the person" instead of by name. The instruction template captures the
operator's name under `## Who you work for` (engine/you.js), but nothing tells an agent to
USE it when writing to the person, and every other mention says "the operator" / "the
person", so agents default to the generic word. Not a placeholder bug ("Moses" is a real
test name Josh gave). Fast-follow, not a cut blocker.

## What "done" looks like
The shared doctrine block tells every agent (new AND existing) to address the person by the
name in their "Who you work for" section, so an agent writing to Josh uses his name.

## The design decision (and why it deviates from the card's literal wording)
The card said "add one sentence to the `### How to write to them` section." I made it a NEW
`### Use their name` section instead. Reason: `missingFrom` (engine/defaults.js) matches by
HEADING — a #539 consented refresh re-offers a section to an EXISTING agent only if the agent
lacks that heading. An edit INSIDE an existing section reaches ONLY newly-created agents; a
NEW heading reaches the existing fleet. Josh's complaint is about the agents he is ALREADY
talking to (the existing fleet), and "address by name" is a pure instruction with no
runtime-discovery path (unlike v9's in-section exception). So the card's literal in-section
edit would have missed the exact population reporting the problem and failed the card's own
stated goal ("fixes it for every agent on every machine"). The version log documents this
exact delivery lesson six times (v5/6/7/8/10/11).

## What changed (3 coupled indices)
1. `engine/defaults.js` — added `### Use their name` section to BLOCK (after `### How to
   write to them`), instructing the agent to call the person by the name in "Who you work
   for", with the reasoning (general lines say "the operator" because they don't know who you
   work for; you do). No em dash.
2. `engine/defaults.js` — bumped `DOCTRINE_VERSION` 11 -> 12 and added the v12 log entry
   (with the NEW-HEADING delivery rationale + weakest premise).
3. `engine/defaults.test.js` — pinned the new composed-block fingerprint `12:
   '847c930852c49734'`.

## Verification
- Doctrine cluster GREEN: `defaults.test.js` + `doctrine.test.js` + `reports.test.js` +
  `you.test.js` + `worldimport.test.js` + `firstrun-isolation-1780.test.js` = 79/79 pass.
  Confirms: no em dash introduced, sections re-join byte-for-byte, missingFrom still correct,
  doctrineVersion propagation intact.
- `create.test.js` `runLauncher` failures are PRE-EXISTING + FLAKY (vary run-to-run: 5/3/1
  across identical-code runs), spawn `bin/agent-supervisor.sh` with a fake tmux, are provably
  independent of a doctrine-text change, and pass on CI. Proven by stashing the change: clean
  origin/main shows the same runLauncher failures.

## Weakest premise (named)
The new section assumes the operator's name is present under `## Who you work for`. `you.js`
writes that heading unconditionally, but an agent given no name has nothing to use; the
wording degrades to the generic word it replaces rather than breaking. Also: the new-heading
call is a judgment deviation from the card's literal wording — if a reviewer prefers the
in-section edit (new-agents-only), it is a one-line move, but it would not reach the fleet
Josh is complaining about.
