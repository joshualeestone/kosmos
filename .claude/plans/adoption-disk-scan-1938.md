# Plan: disk-scan agent adoption (kosmos #1938)

## The gap (already reproduced; full diagnosis in the kickoff)
`discover.found()` walks ONLY `status.configRoots()/projects/*` — the folders Claude's
own records say it has run in. An agent whose folder is not in those records (fresh
machine, cleared records, created under a different account) is invisible to every
downstream offer, so a person with real agents lands on "Create your first agent."
The card's original wording ("a correctly-named agent is never offered") does NOT
reproduce; a named agent Claude HAS run in is already offered. The real fix is a
COMPLEMENTARY disk scan for the folders `found()` cannot reach.

## What I build
1. **Engine `discover.scan()`** — a HARD-BOUNDED file-scan for `CLAUDE.md` files under a
   fixed set of sensible roots, deduped against everything `found()` already knows, and
   against `alreadyIn` and `declined()`. Each candidate carries `{dir, name, role,
   preview}` — `preview` is the first bytes of the file so the screen can SHOW it and ask
   "is this one of yours?" rather than assert. Complementary to `found()`; `found()` is
   left exactly as is.
2. **Server route `GET /api/scan-agents`** — read-only, never 500s for a state question
   (same contract as `/api/found-agents`), returns the scan result plus `dismissed`.
3. **Web screen** — first-run (the `create` empty-state path) AND a Settings/board panel:
   one row per candidate, the file shown in a read-only preview (a read-only variant of
   the `#create-instr` textarea), **Add** (reuses `/api/connect-agent`) or **Skip**
   (reuses `/api/found-agents/decline`) per row. No forked class names; mirror the
   `fr-foundrow` / `fr-adoptrow` shape so the existing document-level handlers reach it.

## Hard scan bounds (the security surface — this is the point)
- **Roots**: a fixed `{dir, maxDepth}` list under `os.homedir()`, existing dirs only.
  `$HOME` itself is scanned SHALLOW (depth 2); known project parents (`work`, `projects`,
  `Projects`, `Developer`, `src`, `code`, `Documents`, `Kosmos`) DEEP (depth 5). NOT the
  whole disk. Test override: `AGENT_WORKFORCE_SCAN_ROOTS` (colon-separated), mirroring
  `AGENT_WORKFORCE_CONFIG_ROOT`.
- **Depth cap** per root; **directory-visit cap** (`MAX_DIRS`) and **candidate cap**
  (`MAX_CANDIDATES`) — the walk STOPS when either is hit and says so in `bounded`.
- **Skip**: `node_modules`, `.git`, every dotdir, and a name skip-set for the macOS home
  noise (`Library`, `Applications`, `Music`, `Movies`, `Pictures`, `Downloads`, `Public`,
  `.Trash`).
- **No symlink escape**: never descend a symlinked directory (`lstat`), never read a
  symlinked `CLAUDE.md`.
- **Byte cap**: read only the first `READ_CAP` (= discover's 4000) bytes of each
  `CLAUDE.md`, used for BOTH the identity read and the preview. No unbounded reads.
- **Sandbox guard**: with no explicit `AGENT_WORKFORCE_SCAN_ROOTS`, honour
  `status.sandboxIsInconsistent()` — a fixture must not walk the operator's real home.
- **Inclusion signal**: reuse the EXACT `identityFromText` / `INTRODUCES` discriminator
  discover already uses. Named -> carries the name; introduces-but-unnamed -> empty name,
  the screen asks. Do NOT widen it (the "You are an expert in Rust" false-positive class).

## Decision I own (root set) — Josh's per the kickoff, decided here per the standing rule
"Decide everything yourself; do not bring a Kosmos decision to Josh." I ship the root set
above. A wrong root is a candidate the person Skips in one click (the preview makes it
cheap), and the set lives in one function so it moves in one place. Weakest premise: if a
person's agents live directly in `~/<name>/CLAUDE.md` outside the curated parents, the
$HOME depth-2 arm still reaches `~/<name>/CLAUDE.md` (depth 1). Deeper non-standard
layouts would be missed; that is the documented expansion point.

## Tests (each control can return the dangerous answer; all sandboxed, real dir never touched)
- Engine: a CLAUDE.md agent whose folder is NOT in the Claude-records population appears
  in the scan; a folder already in `found()` / `adoptable` / `declined` / `alreadyIn` does
  NOT double-list; `node_modules`/`.git`/dotdir CLAUDE.md is skipped; the walk stops at the
  depth cap and at the count cap (bounded flags set); a symlinked dir is not descended and
  a symlinked CLAUDE.md not read; a non-introducing CLAUDE.md (project instructions) is NOT
  listed; the preview carries the file bytes, capped. Positive control: a plain readable
  candidate IS listed (so an all-empty fixture cannot pass the absences).
- Browser (committed headless, runnable via `~/work/pw-runtime`): the preview renders the
  file content per row; Add wires to the connect path; Skip persists like decline. A
  `docs/browser-checks` entry so the #1720 web-change gate is satisfied.

## Gotchas
- pre-challenge-gate hard-requires this plan file AND a `-pre-challenge.md` proof; recompute
  the proof hash after any edit here.
- Never `cd <dir> && <tool> <relative-path>` (kosmos#1923 wedge). Absolute paths / `git -C`,
  quote every glob. This rule goes in any subagent prompt.
- Challenge-loop with the diff INLINE in the reviewer prompt so a subagent cannot wedge.
