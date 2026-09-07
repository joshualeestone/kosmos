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

## Deferred (challenge-loop iter 1)
- NIT: in the by-file importAgent path, geminiIdentity matches ANY name:+description:
  front-matter (no location signal is available there -- importAgent takes text, not a
  path) and stamps provider: 'gemini'. DEFERRED: provider is a soft HINT the create form
  lets the user change (the file's own comment says so), auto-DISCOVERY is location-scoped
  to ~/.gemini/agents, and there is no gemini-only marker in the file format to gate on.
  A user manually importing an unrelated name+description .md getting a changeable 'gemini'
  hint is acceptable and arguably correct (it is markdown+YAML-front-matter, the Gemini shape).

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
