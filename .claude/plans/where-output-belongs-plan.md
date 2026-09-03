# Plan: doctrine says where an agent's output belongs (kosmos#1943)

Branch: `where-output-belongs` · Repo: joshualeestone/kosmos (local checkout `~/work/agent-workforce`)

## Problem

Card #1943: two agents on two machines each invented a folder for their output
(one made up `work/worker/<name>/findings/<date>/`) or left it as a chat
artifact, and the operator placed the files by hand both times. The
operating-defaults instruction block (`engine/defaults.js`) never stated where a
file belongs, so an agent with nowhere named chose somewhere.

## Diagnosis (full version is the card #1943 comment, signed "Renet Tilley")

The card's premise is partly stale. The project-folder infrastructure already
exists:

- `engine/projects.js`: a project IS a folder on disk; each project carries a
  stat-checked `folder`.
- `engine/projects.js:tellAgent` already splices each project's folder path into
  a member's instruction file (`blockBody` emits `- **<name>**: `<folder>``),
  with a three-state TOLD/COULD_NOT/NOT_TRIED result.

So "Done #1" (tell members their folder) is largely built. The remaining gap is
"Done #2": the doctrine block has no section stating where output BELONGS. Its
`### When your work reaches outside your own folder` section is about
TCC/permissions, not "project work goes in the project folder, own work goes in
your own folder, nothing invented."

## Design decisions

1. **A new `### ` heading, not an edit inside an existing section.** `missingFrom`
   matches by heading line, so a new heading reaches agents that ALREADY exist
   (the two that hit this), while an edit inside a held section reaches only
   newly created agents. This is the exact version 5/6/7 delivery lesson in the
   `DOCTRINE_VERSION` log; getting it wrong would heal none of the fleet.
2. **State three things or the rule does not answer the report:** project work to
   the project folder, own work to the own folder, and nothing invented / nothing
   left only in the chat. The reported failures were an invented path AND a
   chat-only artifact, so both are named.
3. **Degrade gracefully on the weakest premise.** `tellAgent` is three-state, so
   where it COULD_NOT write the path, the path is absent. The copy closes with
   "one short question for them, not a licence to guess" so a missing path becomes
   a question, not a made-up path. The own-folder-path case (never explicitly
   written into instructions) falls through the same fallback.
4. **Ceremony:** bump `DOCTRINE_VERSION` 7 to 8, add a version-log entry, re-pin
   the composed-block sha256 fingerprint. `defaults.test.js` enforces the pairing.
5. **Rejected:** editing the existing outside-folder section (would not reach
   existing agents); adding new folder-creation infrastructure (already exists);
   a plan file as the design of record (the Renet Tilley brief mandates the card
   comment, which is why this plan file is a thin pointer to it).

## Changes

- `engine/defaults.js`: new `### Where the files you make go` section;
  DOCTRINE_VERSION 7 to 8; version-log item 8; PINNED re-pinned to
  `8e5de18bfdef3631`.
- `engine/defaults.test.js`: `#1943` content pin (names the rule's phrases) and a
  delivery test (a legacy agent is offered the new section; a complete agent is
  offered nothing as the control). Both perturbation-verified in-session.

## Verification

- `node --test engine/defaults.test.js` (13 tests) green; full `bash
  tools/run-tests.sh` green; subdir-CLAUDE.md audit clean; no em/en dash in the
  composed block.
- Controls proven able to fail: removing the heading reds the delivery +
  fingerprint tests; changing a body sentence reds the content test.
