# Plan: discovery test-fixture set with stated + verified outcomes (kosmos#2003)

## The ask (Josh, 07:56 CDT)
A variety of test agent markdown files, indicating identity in different ways, that Josh scatters
himself (documents, work folders, home) to see whether Kosmos discovers them automatically.

## The one design rule (the whole value)
EVERY fixture ships with its expected outcome, stated. Without it, "Kosmos did not pick it up"
cannot be told from "Kosmos correctly ignored it", and those need opposite responses. And the set
MUST include at least one must-NOT-find fixture, or a discovery that offers everything
indiscriminately passes every other row.

## What I built
- `test-support/discovery-fixtures/` - 7 shapes (+ a 7b over-eager case), each a real markdown file
  a person can scatter, plus a README table: file / where to place it / what it represents / should
  discovery find it / MEASURED outcome. Shapes drawn from real cases, not invented:
  1 Kosmos-created (kosmos:* blocks); 2 current-format (positive control); 3 no-instruction-file
  (#1531); 4 Codex/AGENTS.md; 5 hand-written lowercase name (#1493); 6 second-profile/disk-scan
  (#1938); 7 must-NOT-find doc (negative control); 7b "You are an expert" (documented false-positive).
- `engine/discover.fixtures-2003.test.js` - reads the SAME files a person scatters (no second copy
  of the content), constructs each shape in a hermetic sandbox (AGENT_WORKFORCE_CONFIG_ROOT/DATA,
  mkdtemp), and asserts each measured outcome via the real discover.found()/scan(). So the README
  table cannot rot silently; if discovery changes and a shape flips, this reds and names the shape.

## Method (measured, not assumed - per the stale-card caution)
I ran each shape through discover.found()/scan() BEFORE stating an outcome. Findings the fixtures
surfaced: (#1) re-adopt suppression rides the runtime roster (alreadyIn), NOT the file's kosmos:*
markers - a scattered Kosmos file whose agent is not running is re-offered; (#4) an AGENTS.md-only
agent's name is not read on this path. Both are stated as findings, not passes.

## The load-bearing assertion
#7 (a doc with no "You are" line) must be ignored everywhere. I verified it is ARMED: adding a
"You are ..." line makes #7 red (discovery over-offers), restored to green. #7b (a "You are an
expert" template) IS offered, so the ignore/over-eager boundary is exactly that one line.

## Constraint honored
Fixtures #1 and #5 are FRESH files in the Lil-Nacho / hand-written shapes - NOT the preserved real
Lil Nacho files on Casey's machine (the live #1938 evidence).

## Weakest premise
That the measured outcomes are stable across discovery changes. That is exactly why the committed
test asserts them: a change that flips a shape reds the test and names it, which is the anti-stale
mechanism this card is about. The negative control being armed is what makes the green meaningful.
