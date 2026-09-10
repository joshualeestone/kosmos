# #2243 part 2: discover Gemini agents (GEMINI.md via projects.json)

## Problem

Discovery (`found()`/`foundCodex()`) walked `~/.claude/projects` and `~/.codex`. A
person whose agent files sit beside a `GEMINI.md` (the disk sibling of CLAUDE.md /
AGENTS.md) was a whole missing population. This is Renet Tilley's lane: how Kosmos
knows what an agent is, without scraping a pane. Part 1 (fresh-install verify
auto-import) is needs-operator and documented on the card; this is part 2.

## Approach

Add `foundGemini()` as the third provider path in `engine/discover.js`, the
analogue of `foundCodex()`:

1. New module `engine/geminisession.js` owns the `~/.gemini` resolution and the
   `projects.json` read, the way `codexsession` owns Codex's. `HOME` is a lazy
   arrow const honouring `AGENT_WORKFORCE_GEMINI_HOME` / `GEMINI_CLI_HOME`;
   `projects()` returns the absolute project cwds from
   `{ "projects": { "<abs-cwd>": "<name>" } }`, `[]` on missing/malformed, never
   throws. Keeping the home resolver OUT of discover.js is the faithful mirror of
   foundCodex AND keeps `found()` out of check-frozen-roots' (#1432) resolver set.
2. `foundGemini(roster)` reads each cwd's `GEMINI.md`, extracts identity via
   `status.identityFromText`, returns `{dir, name, role, instructions,
   runner:"gemini", already}` rows. Same #1500 `sandboxIsInconsistent()` refusal
   as foundCodex.
3. Wire into `found()`'s aggregation LAST (Claude then Codex win a dir collision).

## Rules

- **Never guess a name.** A `GEMINI.md` that introduces nobody is not an agent
  (skipped silent). One that INTRODUCES somebody but names nobody the parser can
  read is counted `unreadable` (foundCodex parity, #1527) so the skip is surfaced.
- **Never expose the operator's real machine under a fixture** (#1500).
- **One vocabulary.** `runner:"gemini"` uses the existing provider field; no new
  private shape.

## Tests

`engine/discover.gemini.test.js`: agent found; project with no GEMINI.md is not an
agent; a CONTROL (introduces nobody) not offered and not counted; the
discriminating twin (introduces-but-unnamed -> unreadable 1); malformed
projects.json no-throw.

## Weakest premise

`projects.json` is the only enumeration source, so a Gemini-only agent without a
`projects.json` entry is invisible. Session-history follow-up, same shape as
Codex's rollout scan; not this MVP.
