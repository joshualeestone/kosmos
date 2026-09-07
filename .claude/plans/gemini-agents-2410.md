# Plan: #2410 - Gemini CLI agents in ~/.gemini/agents/*.md are invisible to discovery

## The bug (both measured)
Josh's Gemini agents (made via the Gemini CLI) live in `~/.gemini/agents/<name>.md`
with a YAML front-matter identity:
```
---
name: code-reviewer
description: Reviews code for style and best practices.
---
You are a helpful assistant that reviews code for readability, performance, and best practices.
```
They are missed on two compounding counts:
1. LOCATION: `~/.gemini/agents/` is a dotdir, and the disk scan skips every dotdir
   (`if (name.startsWith('.')) continue`). `foundGemini` reads projects.json +
   `<cwd>/GEMINI.md`, never `~/.gemini/agents/*.md`. Invisible to every path.
2. IDENTITY: the real name is the YAML `name:`; the body is a generic
   "You are a helpful assistant...". `identityFromText` returns null on that body,
   and `agentfile.importAgent` REFUSES the file (front-matter present but no
   `kosmos:` marker => "not a Kosmos agent file"). So even if reached, it would be
   offered with an EMPTY name or rejected on import.

## Decision: route through the loose-file / importable path (NOT foundGemini)
The install import screen renders BOTH `/api/found-agents` (dir-keyed, connected via
`/api/connect-agent` -> `discover.connect(dir)`) and the scan's `importable` loose
files (imported by FILE via `/api/import-agent` -> `agentfile.importAgent` ->
`createAgent`). A Gemini agent definition is a FILE with no project cwd; `connect`
is dir-based and reads CLAUDE.md/AGENTS.md, so it cannot launch a bare file. The
loose-file/import path has a COMPLETE working end-to-end (parse file -> create), so
that is the correct home. Rejected foundGemini: its records are dir-keyed and the
connect click would fail on a file.

Weakest premise: that the install screen's importable list is what Josh needs the
Gemini agents to appear in. Verified: web/index.html frImportOffer reads
FR_SCAN.importable (scan-import), and the README ties Renet's lane to #1652 (loose
import). If a later finding shows the install shows only found() at that step, the
same geminiIdentity helper can also feed foundGemini.

## Changes
1. `engine/geminisession.js` - add `agentFiles()`: absolute paths of
   `<HOME()>/agents/*.md` (+ `.markdown`), tolerant ([]), bounded, sorted. Reaches
   the dotdir directly (like the existing projects.json read), so the scan's
   dotdir-skip never applies to this known Gemini location.
2. `engine/agentfile.js` - add + export `geminiIdentity(text)`: recognizes the
   Gemini shape - a `---` front-matter block carrying `name:` AND `description:` AND
   NO `kosmos:` marker - and returns `{displayName, role}` from the front-matter, or
   null. SPECIFIC on purpose so it does not grab the #7 no-front-matter negative
   control, a Kosmos export (has `kosmos:`), or an ordinary unrelated front-matter
   file (needs both name+description). `importAgent` uses it: between the
   `!m -> importFromInstructions` branch and the strict `kosmos: agent` refusal, if
   `geminiIdentity` matches, return a recognized-from-content result with
   `provider: 'gemini'` and the instructions body, so by-file import creates the
   agent with the real name.
3. `engine/discover.js` `scan()` - after the walk (and TCC merge), merge the Gemini
   agent files into `byFile` using `geminiIdentity` for the row name, keyed by
   realpath, honoring MAX_IMPORTABLE / maxMdReads. Runs only where the walk itself
   would (the `!explicit && sandboxIsInconsistent()` early-return already guards the
   dangerous fixture case; explicit-roots tests point `AGENT_WORKFORCE_GEMINI_HOME`
   at a sandbox, exactly as the foundGemini tests do). A file whose front-matter does
   NOT match geminiIdentity falls back to the generic looseRow, unchanged.

## Controls to respect (from the corpus oracle)
- #7 build-notes (no "You are", no front-matter): must NOT be offered. geminiIdentity
  returns null (no front-matter) and it is not under ~/.gemini/agents. Safe.
- #7b Rust known-over-eager (Kitty's #2406): not touched.
- Kosmos export (#1 baron): has `kosmos:` marker => geminiIdentity returns null =>
  still handled by the strict path. Unchanged.
- pip (#5, offer-with-empty-name): no front-matter => untouched.

## Decisions from the challenge loop
- iter1 NIT (provider over-eager stamping) SUPERSEDED by the iter2 decision below: the
  import no longer stamps 'gemini' at all.
- iter2 WARNING (provider 'gemini' dead-ends createAgent, which refuses non-anthropic/
  openai): DECIDED to return provider: null instead of 'gemini'. Gemini is not a runnable
  provider yet, so a 'gemini' hint guarantees a create refusal on the happy path. Null
  matches the #1939 recognized-instructions precedent: the front-matter gives the NAME, the
  body is generic instructions that run under any runner, and the create form lets the
  person pick a runnable provider -- so the import COMPLETES (import -> create under Claude/
  Codex) rather than stopping. Reversible: re-add the origin hint when Gemini is runnable.
  Rejected: keeping 'gemini' (honest about origin but dead-ends the user's actual goal).
  Weakest premise: that the row UI does not need the 'gemini' origin tag; if Angel's create
  form wants to surface "Gemini agent", that is a UI addition on top, not a reason to break
  the working import. Flagged to Splinter/Angel as a create-form UX follow-up.
- iter3 WARNING (geminiIdentity recognized ANY name+description+no-kosmos file, incl. Claude
  Code SKILL files and Jekyll docs -- a widening of the untrusted by-file import surface):
  FIXED by ALSO requiring the body to INTRODUCE an agent ("You are ..."). That is the real
  Gemini custom-agent shape and the discriminator against skills/docs (whose bodies describe
  a skill/page, not an agent). Identity still comes from the front-matter, not the body.
  Negative-control test added (skill + Jekyll doc refused; same front-matter with an agent
  body accepted -> proves the body is the discriminator). Also extracted the shared
  frontmatterField reader so importAgent and geminiIdentity cannot drift on the
  line-terminator hardening.
- iter3 NIT (YAML quoting / block scalars not stripped -- `name: "x"` keeps the quotes):
  DEFERRED. The measured Gemini shape is unquoted single-line, and this matches importAgent's
  existing kosmos-path field reader exactly (now the shared frontmatterField); adding quote
  stripping to only the Gemini path would diverge the two readers the refactor just unified.
- iter3 NIT (a symlinked agent file spends one mdReads budget unit before readClaudeHead
  refuses it): DEFERRED -- negligible and matches how the disk walk accounts reads.
- iter2 NIT (description/role not MAX_DISPLAY-bounded): DEFERRED -- role fields elsewhere
  (identityFromText role, looseRow/folderRow role) are not MAX_DISPLAY-bounded either, and
  the value is already bounded by READ_CAP + the single-line field reader; capping it would
  diverge from existing role handling for no real gain.

## Tests (perturbation-proven)
- geminisession.agentFiles(): finds `agents/*.md`, ignores non-md, [] on missing dir.
- agentfile.geminiIdentity(): matches the 3 Gemini fixtures (real names), returns null
  on a Kosmos export, on #7 build-notes, and on a front-matter file missing description.
- agentfile.importAgent(): the 3 Gemini fixtures import with the right name +
  provider 'gemini'; a Kosmos export still parses as before; #7 still refused.
- discover.scan(): with a gemini-home sandbox holding the 3 fixtures and empty
  explicit roots, importable contains all 3 with their real names; a bare
  name-only-no-description file falls back (empty name), proving the row is built by
  geminiIdentity not by luck.
