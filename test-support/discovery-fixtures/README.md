# Discovery test fixtures (kosmos#2003)

A variety set of test agent markdown files for exercising Kosmos discovery/adoption
by hand. **Every fixture ships with its expected outcome**, because without that,
"Kosmos did not pick it up" cannot be told apart from "Kosmos correctly ignored it",
and those need opposite responses.

Scatter these yourself (documents folder, a work folder, home, wherever). For each
one the table says WHERE it has to be for its outcome, WHAT it represents, and
whether discovery SHOULD find it. The committed test `engine/discover.fixtures-2003.test.js`
reads these same files and asserts the measured outcome, so this table cannot rot
silently: if discovery changes and a shape's behaviour flips, that test reds.

## How placement maps to a discovery path (this is half of what is being tested)
- **A folder Claude has run in** (there is a session under `~/.claude/projects` whose
  `cwd` is that folder) -> `found()` reads that folder's `CLAUDE.md`.
- **A folder Claude has NEVER run in** (no session records it) -> `found()` is blind to
  it; only the **disk scan** (#1938) reaches it.
- **No instruction file at all** in a folder Claude ran in -> offered as *adoptable*
  with an empty name.
- To use a fixture, copy it into a folder as `CLAUDE.md` (or `AGENTS.md` for #4).

## The fixtures and their MEASURED outcomes

| # | file | put it where | represents | should discovery find it? | measured |
|---|------|--------------|------------|---------------------------|----------|
| 1 | `1-kosmos-created.md` -> `CLAUDE.md` | a folder Claude has run in | a Kosmos-CREATED agent (carries `kosmos:*` blocks) | **found by NAME; NOT adoptable** | found() lists it as a NAMED agent (found().agents), NOT in the adoptable set - consistent with #1938 (a cleanly-named agent is never adoptable). The `kosmos:*` markers do NOT change that. found() flags `already` = whether it is currently running. What the adopt UI does with a found-but-not-running named agent is a separate flow this set does not measure. |
| 2 | `2-current-agent.md` -> `CLAUDE.md` | a folder Claude has run in | standard current-format agent (**positive control**) | **YES, by name** | found() -> named agent `Fixture Nova`. If this is not found, discovery is broken. |
| 3 | *(no file)* | a folder Claude ran in, with **no** CLAUDE.md | an agent with no instruction file (#1531) | **YES, as adoptable** | found().adoptable (offered, empty name). |
| 4 | `4-codex-AGENTS.md` -> `AGENTS.md` | a folder Claude has run in | a Codex/AGENTS.md agent (alternate format) | **name IS readable via the Codex path** | The real Codex path (`codexIdentity` -> `identityFromText`) reads `Fixture Codex` from AGENTS.md. But if the folder has a Claude session record and no CLAUDE.md, `found()` looks for a CLAUDE.md, does not find one, and offers the folder EMPTY-name. So WHICH path picks it up depends on how the folder is recorded - not a claim that the name cannot be read. |
| 5 | `5-handwritten-lowercase.md` -> `CLAUDE.md` | a folder Claude has run in | hand-written, lowercase name (#1493) | **YES, as adoptable (empty name)** | found().adoptable via unnamed-intro: "You are pip" introduces somebody but names nobody readable -> offered with an empty name, never a guess. |
| 6 | `6-second-profile-agent.md` -> `CLAUDE.md` | a folder Claude has **never** run in (e.g. a second `.claude-work1` profile) | the disk-scan population (#1938) | **YES, by SCAN only** | scan() candidate; invisible to found() (no session record). |
| 7 | `7-not-an-agent.md` -> `CLAUDE.md` | any folder | agent-ish doc with **no** "You are" line (**negative control**) | **NO - must be ignored** | absent from found/adoptable/scan. The load-bearing must-NOT-find: a discovery that offered everything would pass every other row but fail this one. |
| 7b | `7b-you-are-an-expert.md` -> `CLAUDE.md` | a folder Claude has run in | template "You are an expert ..." (**over-eager case**) | **offered - documented, not desired** | found().adoptable: it opens with "You are", so it is OFFERED with an empty name though it introduces a ROLE, not a person. A known false-positive shape (three such files measured on real machines). |

## Findings worth Josh's attention (the fixtures earned these)
- **#1**: a cleanly-named Kosmos-created file is found as a NAMED agent, NOT in the adoptable
  set (consistent with #1938 - a cleanly-named agent is never adoptable); the `kosmos:*` markers do
  not change that classification. found() flags whether it is currently running (`already`). Whether
  the adopt UI re-offers a found-but-not-running named agent is a separate flow this set does not
  measure - do NOT read #1 as an adoptable-set re-offer.
- **#4**: which discovery path picks up an AGENTS.md agent depends on the folder's records -
  the Codex path (`codexIdentity`) reads the name, while `found()` (looking for a CLAUDE.md)
  offers the folder empty-name. Not a claim that the name cannot be read.
- **#7 vs #7b**: a doc with no "You are" is correctly ignored, but "You are an expert X"
  is offered - the boundary between ignore and over-eager is exactly that one line.

## Constraint
All fixtures here are FRESH synthetic files. The hard constraint (Splinter): do NOT touch or
substitute the preserved REAL files on Casey's machine - the real Lil Nacho files kept as the
live #1938 evidence, and Casey's real second profile. The fresh stand-ins for those shapes are
#1 (the Kosmos-created / #1938 Lil-Nacho shape), #5 (the #1493 hand-written lowercase-name case,
Josh's sister - named `pip`, deliberately not `lilnacho`), and #6 (the Casey second-profile
shape). None is an original.
