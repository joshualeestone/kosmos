# Plan: #2706 scaffold a brief stub in the project folder on creation

## The card

Found by the Mortal Kombat fleet "Kosmos Inside Out" dogfood (2026-09-10, measured).
Creating a project and staffing agents onto it scaffolds NOTHING for them - no brief,
no goal, no definition of done; the folder and room are empty. Agents land with nothing
to read and default to talking (the root cause of the "wall of questions -> Kosmos shut
the room" episode Josh saw).

FIX (Josh's words): on project creation, drop a short brief stub in the project folder
(even two fields: Goal, Done-looks-like) that BOTH the operator and the agents see - a
shared source of truth instead of a chat message that scrolls away.

## What existed

- A project IS a folder on disk (`engine/projects.js` module doctrine). Kosmos points a
  project at an existing folder, or `makeFolder` makes one when none is given.
- `create()` validated the folder and wrote the project RECORD (`writeAll`), but wrote
  NOTHING into the folder itself. The only folder-adjacent writes were the projects.json
  store and the once-ever welcome-seed flag, both under the store root, never the folder.
- The "we will not create one" note in the module is about an AGENT's instructions file,
  a different concern; it does not forbid a project brief.
- The membership message an agent gets already includes `Its folder is \`<folder>\`.`, so
  an agent put on a project already knows where to look.

## The change (engine/projects.js only)

- `seedBriefStub(folder, { name, description })`: writes `BRIEF.md` into the folder.
  - **No-clobber** is the load-bearing rule: the write uses the `wx` flag (write only if
    absent), so a folder that already holds the person's own BRIEF.md is left untouched.
    Kosmos adopts existing folders, and overwriting would destroy the person's words - the
    opposite of the shared source of truth this card gives them.
  - **Best-effort**: any failure (read-only folder, a race) is swallowed and returns false,
    exactly like `markWelcomeSeeded`, because the project already EXISTS from `writeAll` and
    a missing stub is a smaller harm than a failed creation.
- `briefStubContent({ name, description })`: markdown, `# <name>` + `## Goal` +
  `## Done looks like` + a one-line footer. The Goal is seeded from the create-form
  description when present (so what the person already typed persists into the folder rather
  than scrolling away in chat); both fields otherwise carry a fill-in prompt so an agent
  never lands on a blank.
- `create()` calls `seedBriefStub(given, { name: title, description: desc })` AFTER the
  record is written and before returning.
- Exported `BRIEF_STUB_FILENAME`, `briefStubContent`, `seedBriefStub` for tests.

## Decisions

- **Filename `BRIEF.md`** at the folder root. Purpose-clear, discoverable (the membership
  message already points at the folder), low collision risk with a user's own files. A
  user's existing `README.md` is a different name and is never touched.
- **Two fields only** (Goal, Done-looks-like), per Josh's "even two fields". Not more - the
  smallest shape that turns "empty folder" into "a thing to read".
- **Discovery reuses the existing membership message** (`Its folder is <folder>`) rather
  than adding a new "read BRIEF.md" line. Keeping scope to the card's explicit ask, and
  #2708 just refined that message. A louder explicit pointer is a possible small follow-up.
- **Every create gets the stub, including the welcome "Getting started" seed.** No special
  case. The welcome project has no agents staffed, so the stub is harmless-but-idle there;
  excluding it would add a branch for no real gain. Flagged below as the weakest premise.

## Weakest premise

Whether the welcome "Getting started" seed should also get a BRIEF.md. It is written there
today (no special-case), which is harmless (no agents land in it) but slightly incongruent
(its Goal becomes the welcome blurb). If Josh wants it excluded it is a one-line
`made.via !== 'kosmos'` guard. Left for josh-review.

## Verification

- New `engine/projects.brief-stub-2706.test.js`: stub written with Goal/Done headings, Goal
  seeded from the description (with a control proving the seeding is real and the
  no-description case carries a prompt), the no-clobber rule (existing brief preserved
  byte-for-byte and mtime unchanged), best-effort (creation survives a failed write), and
  the return-value contract.
- Existing projects suites stay green (projects.test.js 136, subprojects 20, open-why 6,
  server.projects 152) - the BRIEF.md side-effect breaks no folder-listing or
  empty-folder assertion.

## Not done

- No change to the membership message (already points at the folder).
- No "brief pending / shared hold" coordination - that is #2707's card.
