# kosmos#1939: import a raw CLAUDE.md instead of a dead-end refusal

## The bug (Josh, fresh install, 2026-09-03 00:07 CDT)
He had an existing agent (Lil Nacho) that adoption did not offer, so the flow punted him to a
file browser. He picked the agent's `CLAUDE.md`, pressed "Bring it in", and it refused:
"This is not a Kosmos agent file. It has no header." The message is TRUE and the wrong
information - it names a MISSING field, so the natural reading is "my file is right, retry",
and he retried the same wrong door repeatedly. Same class as #1918: naming a field the user
cannot supply is worse than naming the wrong KIND of file and redirecting.

The card MEASURED that prepending a Kosmos header to his own file makes it import cleanly:
the content was always acceptable, only the envelope was missing.

## The flow (measured before building)
`/api/agent-import` (server.js:5487) calls `agentfile.importAgent(file, {identityFromText,
nameUsable})` and returns create-form material `{ok, name, displayName, provider, instructions}`.
It does NOT create the agent - the fourth create option hands this to the create form, which the
person confirms, then POST /api/agents does the one canonical creation. So import is a PRE-FILL.
That means the fix can be pure-backend: make importAgent return ok:true for a recognized
instructions file, and the existing ok:true form-prefill path (from #1652) handles the rest with
NO frontend change.

## The fix (option 1 from the card: recognize + bring it in)
- importAgent: a file with NO `---` header no longer refuses outright. It routes to
  `importFromInstructions`, which trusts the same signal adoption does - `identityFromText` finds a
  "You are X" displayName. If the text names an agent: the WHOLE file is the instructions, the
  display name is carried, and a machine-name SUGGESTION is derived (`suggestName`: lowercase, slug
  non-alnum to '-', trim, then the canonical `nameUsable` path-safety gate - the same gate the
  strict path uses). Returns `recognizedFromContent: true`.
- A `---` header PRESENT but not `kosmos: agent` KEEPS the strict "not a Kosmos agent file"
  refusal - it is ambiguous (botched export vs unrelated frontmatter), so it is not reinterpreted.
  This is the narrow, safe scope: only the exact reported case (no header at all) changes.
- Text that names no agent at all: the refusal now names the wrong KIND of file and points at the
  two real options, instead of "it has no header".
- server.js forwards `recognizedFromContent` (backward compatible; undefined on the export path)
  so the form can note the file was instructions and, when the derived name is empty, prompt.

## Why it is safe (the IMPORT_CONTRACT's real fear)
The contract fears a "half-applied" file leaving an agent with someone else's instructions and no
name. This path cannot: (1) it requires identityFromText to find a displayName (the file DOES name
somebody), (2) the whole file is the instructions (nothing half-parsed), (3) it feeds the create
FORM the person confirms rather than creating, (4) an underivable machine name comes back empty for
the form to require - never a nameless agent.

## Verification
- Through the real importAgent + real identityFromText/nameUsable and over HTTP: 33/33.
- Red-capable: reverting engine/agentfile.js + server.js to origin/main fails all 6 #1939 tests;
  restore -> 33/33. (Measured.)
- Updated the two sibling assertions (agentfile.import.test.js, server.agent-import-1652.test.js)
  whose "/no header/" message my change altered - not just added new tests (the vacuous-check trap).
- Full suite running.

## Weakest premise (name it)
`suggestName` gates only on `nameUsable` (path-safety), not the full `nameProblem` (format/length/
reserved), so it can pre-fill a technically-imperfect suggestion like "q" that the create form will
then ask the user to lengthen. This is DELIBERATE and consistent: import's strict path also uses
only nameUsable and defers format to the form (which runs nameProblem). Pre-filling a close
starting point the user can adjust is better than an empty field, and the form is the single place
format is enforced - duplicating nameProblem here would be the "second copy that guards less"
anti-pattern. The empty-name path still triggers for a display name with no ASCII to slug.

## Not done (out of this card's reach)
The optional on-screen explanatory sentence ("this looks like agent instructions rather than a
Kosmos agent file") is a frontend touch; the flag is now available for it, but the dead end itself
is removed by the backend change alone (the form pre-fills). Flagged in the card comment as a small
follow-up, not blocking.
