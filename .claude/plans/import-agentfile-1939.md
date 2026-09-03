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

## The derived-name gate (revised after challenge iteration 1)
`suggestName` gates the DERIVED name on the full `create.nameProblem` (format, length, reserved
words, the `-discord`/`kosmos-connect` traps), not merely `nameUsable` (path-safety). A guess that
would bounce on confirm (a reserved word, a `-discord` name, a one-char name) returns '' so the form
asks, rather than pre-filling a name that gets rejected - which would reintroduce a mild version of
the confusing rejection #1939 removes. This is an intentional ASYMMETRY with the strict export path,
which only path-safety-checks its name: an export name is USER-DECLARED (pre-fill what they chose,
let the form validate), a suggestion is a GUESS (only offer one that will pass). `nameProblem` is
injected optionally; `suggestName` falls back to `nameUsable` when a caller does not pass it, so the
change is backward compatible. It is NOT a second copy of the format rules - it calls the one
canonical `create.nameProblem`.

## Weakest premise (name it)
The instructions path treats the WHOLE file as the body, including any stray/unterminated `---`
fence. That is deliberate (the file is the user's own instructions and identityFromText still finds
the agent), and a path-unsafe `name:` inside an unclosed fence is never read (the machine name is
derived from the "You are X" line, which slugs to path-safe `[a-z0-9-]`). The residual is cosmetic:
an agent imported from a CLAUDE.md that happened to carry unrelated frontmatter keeps those lines in
its instructions. Acceptable - it is what the person picked, and the create form shows it before
they confirm.

## Not done (out of this card's reach)
The optional on-screen explanatory sentence ("this looks like agent instructions rather than a
Kosmos agent file") is a frontend touch; the flag is now available for it, but the dead end itself
is removed by the backend change alone (the form pre-fills). Flagged in the card comment as a small
follow-up, not blocking.
