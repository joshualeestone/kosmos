# kosmos#1652 (reopened) PR2 - surface + import the discovered agent files

## Where PR1 left off
PR1 (#2141, merged) made `discover.scan()` also return an `importable` array of loose agent
`.md` files a person downloaded or was sent, and added Downloads/Desktop as shallow importOnly
scan roots. `/api/scan-agents` already passes `importable` through. Nothing yet SHOWS them, so
Josh's fresh-install test ("Kosmos did not see any of them") is not closed until they are
surfaced and importable in one click.

## What PR2 adds
1. **`server.js` - `POST /api/agent-import-file`** (loopback-only, same as `/api/agent-import`;
   NOT in REMOTE_AGENT_ROUTES so remoteWriteGuard refuses a remote peer). Body `{file: <path>}`.
   - 🛑 The path is NEVER trusted. The route reads ONLY a path the current scan itself returned
     in `discover.scan().importable` (membership check against the scanCache, else a fresh scan).
     discover.scan() already realpath-dedups and refuses symlinks, so a member path is inside the
     scanned roots by construction.
   - On top of membership: an `lstat` regular-file guard (a symlink swapped in AFTER discovery -
     TOCTOU - is refused, not followed) and a size cap before the read. Both are required:
     membership proves the path was legitimate at scan time, the lstat proves it still is at read
     time.
   - Then `agentfile.importAgent(text, ...)`, returning the SAME shape as `/api/agent-import`, so
     the create form pre-fills identically.
2. **`web/index.html` - the import panel (`#importpick`)** gains the "or choose one below" list
   the placeholder already promised: `#import-found`, populated from `/api/scan-agents`'s
   `importable` when the import radio is chosen. Each row shows name / title / path / a read-only
   preview (SHOW the file, do not assert - the same rule the scan panel keeps) and a single
   Import action. Clicking reads it by path (the route above) and hands the parsed result to the
   SAME `finishImport` the paste/choose path uses (extracted from `importLoad` so the two entry
   points cannot drift in how they map a file onto the create form).
3. Placement rationale: this is the CREATE-flow import option (the card's "fourth option: import
   my existing agent"), distinct from the board's "We found agents on your computer" scan panel,
   which ADOPTS existing work FOLDERS (`discover.connect`). Import material (a loose file -> a NEW
   agent) and adopt material (a work folder) stay separate surfaces.

## Tests
- `server.agent-import-1652.test.js` (extended): the by-path route - POSITIVE (a discovered file
  reads + parses), and three SECURITY arms: an arbitrary path (`/etc/passwd`) is refused on
  membership before any read; a non-agent `.md` in the scanned root is not importable so its path
  is refused; a path swapped to a symlink after discovery is refused by the lstat guard. Scan is
  pointed at a controlled root via AGENT_WORKFORCE_SCAN_ROOTS.
- `web.import-found-1652.test.js` (new): the row markup (path/name/role/preview/Import action,
  nameless stand-in, HTML escaping) run for real, plus the wiring (populate reads
  `/api/scan-agents` importable, import posts `/api/agent-import-file`, both paths share
  finishImport, the click handler + container are present).
- `docs/browser-checks/import-agent-flow.js` (extended): asserts the import panel carries the
  `#import-found` container (the PR2 wiring), headless. The create-form FILL end-to-end is already
  exercised by this walk since both the paste and found paths route through finishImport.

## Open calls decided
- **Read-by-path vs re-pick**: a discovered file is read server-side (path-validated) so import is
  one click, rather than making the person re-select it through the OS dialog (which the existing
  "Choose a file" button already covers for a file they know the location of).
- **Membership vs a path allow-prefix**: validated by exact membership in the scan's importable
  set, not by "is it under a scanned root" - the latter would import a non-agent file or a file
  the gate excluded. The set is the authority.

## Weakest premise
That reading a discovered file by a path validated against the scan is safe. The two guards
(membership + lstat-at-read) are both tested, including the TOCTOU symlink swap. What would change
my mind: a path that is a scan member yet resolves outside the roots at read time without the
lstat catching it - which discover.scan()'s own realpath+symlink refusal makes unreachable for a
member, and the lstat backstops regardless.

## Verification
Route + web + browser-check assertions here. The fresh-user-with-sample-files end-to-end (place
files, open create, import one, agent runs) is a batched clean-machine pass (needs Josh);
needs-operator, do not wait on it.
