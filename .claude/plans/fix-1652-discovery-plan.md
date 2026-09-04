# kosmos#1652 (reopened) - discovery finds loose importable agent files

## The measured gap (reproduced, not assumed)
Josh's fresh-install test (2026-09-04): he placed sample agent .md files across
Documents/Downloads and a work folder; Kosmos found none. Reproduced with a sandbox in
`repro-1652.js` against `engine/discover.js scan()`:

| placed | found by scan()? | why |
|---|---|---|
| `Documents/susan.md` (loose, arbitrary name) | NO | scan reads only `<dir>/CLAUDE.md` (discover.js:837), never a loose .md |
| `work/leo.md` (loose, arbitrary name) | NO | same |
| `Downloads/don.md`, `Desktop/kraang.md` | NO | `SCAN_SKIP` excludes Downloads + Desktop (discover.js:662) |
| `Documents/realagent/CLAUDE.md` (proper folder) | YES (control) | correct name, scanned tree |
| `work/workers/foo/CLAUDE.md` (proper folder) | YES (control) | correct name, scanned tree |
| `Downloads/dlagent/CLAUDE.md` (proper folder, skipped tree) | NO | Downloads skipped |

So the scan serves the ADOPT-a-work-folder case (a folder whose `CLAUDE.md` introduces
somebody -> `discover.connect`). Josh's "import my existing agent" case is a LOOSE agent
file (often downloaded/shared, so it lands in Downloads) - invisible to the scan on both
axes (filename + location).

## Shipped as two stacked PRs
- **PR1 (this branch): the discovery ENGINE finds importable files + tests.** `discover.scan()`
  now returns an `importable` array; `/api/scan-agents` passes it through (verified: the route
  spreads `{ ...out }`). This is the load-bearing core of Josh's "did not try to find them"
  complaint and is provable by the engine tests + the API contract. No UI/action yet.
- **PR2 (next, same session): surface + import.** A `POST /api/agent-import-file` route that reads
  a discovered file at a path VALIDATED to be one the scan actually returned (never an arbitrary
  path from the request), feeding `agentfile.importAgent`; plus the scan-panel rendering of
  importable rows with a one-click Import action; plus a browser walk. The file-read-by-path is
  the security-sensitive part, kept in its own PR with its own review.

The split is deliberate incremental delivery, not a stop: PR2 follows immediately.

## Decision (mine, per the standing decide-it-yourself rule)
Extend discovery to also find LOOSE IMPORTABLE agent files, as a candidate kind DISTINCT from
the connect candidates, and look in the download/save locations. Concretely:

1. **`engine/discover.js`**
   - During the existing folder walk, at each visited folder, also read loose `*.md` files
     (EXCLUDING `CLAUDE.md`/`AGENTS.md`, which are folder-agent markers already handled) whose
     head passes the SAME content gate the connect scan uses - `identityFromText` names somebody
     OR `INTRODUCES` (`/^...You are /mi`). Emit them into a new `importable: [{file, name, role,
     preview}]` array on the scan result. The connect `candidates` array is UNCHANGED.
   - Add `Downloads` and `Desktop` as scan roots, SHALLOW (depth 1) and `importOnly` (they
     collect importable loose files but do NOT emit connect candidates - nobody runs an agent
     in Downloads, but a shared agent file lands there). SCAN_SKIP still excludes them as
     descended children of other roots; adding them as explicit roots is what reaches them.
   - Bounds: a `MAX_IMPORTABLE` cap and a per-folder `.md`-read cap, so a Downloads full of
     markdown cannot blow the read budget. Reuse `READ_CAP` for the head bytes.
   - Rationale for reusing the gate not widening it: the module's philosophy is that a wrong
     candidate is a one-click Skip because the screen SHOWS the preview; the same `INTRODUCES`
     gate that keeps "You are an expert in Rust" templates out of the connect scan keeps random
     README.md out of the importable list.

2. **`server.js`** - the disk-scan route is `/api/scan-agents` (NOT `/api/found-agents`, which
   serves `discover.found()` from Claude's records). It spreads `discover.scan()`'s whole result
   (`{ ...out, dismissed }`), so `importable` rides through the success path unchanged. Its error
   catch-fallback needed one line: it returned a hand-built `{ ok:false, candidates:[] }` that
   predated `importable`, so `importable:[]` + a fully-shaped `bounded` were added there for the
   same-shape-on-every-path contract the sandbox-refusal return documents.

3. **`web/index.html`** - render importable rows in the scan list with an "Import" action that
   feeds the file text into the EXISTING import flow (`/api/agent-import` -> pre-fill create),
   reusing `scanRowsHtml`'s preview pattern. A browser-check (docs/browser-checks) or a
   `Browser-check:` trailer is required by the #1720 gate for a web/ change.

4. **Tests**: engine unit tests (loose file found by content not name; CLAUDE.md/AGENTS.md
   excluded from importable; Downloads/Desktop reached importOnly; template refused; caps
   bound the walk; connect `candidates` unchanged), plus the browser walk.

## Open calls decided
- **Loose file vs folder**: importable = a FILE (import -> create a new agent); connect = a
  FOLDER (adopt an existing work dir). Kept as separate arrays/actions so `discover.connect(dir)`
  is never handed a loose file's parent.
- **Locations**: Downloads + Desktop added importOnly, because a shared/downloaded agent file
  lands there (the card's own "mail clients eat directories" point). Deep trees stay connect+import.
- **Bad/hostile file**: the import parse (`agentfile.importAgent`) already refuses what it cannot
  parse; discovery only offers the file, it does not apply it.

## Weakest premise
That Josh's "sample agent files" are loose agent-definition files (import material), not
CLAUDE.md folders. The repro shows loose arbitrary-named files are invisible on both axes, which
matches "saw none"; a properly-named CLAUDE.md folder in Documents/work WOULD have been found, so
if he saw truly nothing they were loose and/or in Downloads. Would change my mind: if his files
were CLAUDE.md folders under work/Documents that still were not found - that would be a different
bug (the scan not running on fresh install), which the repro does not show.

## Verification
Unit + browser checks here. The fresh-user-with-sample-files end-to-end is a batched
clean-machine pass (needs Josh) - label needs-operator/needs-browser, do not wait on it.
