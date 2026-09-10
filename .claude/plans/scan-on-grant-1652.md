# scan-on-grant-1652: load found agents onto screen 9 after the file-access grant

## The problem
Kosmos's first-run flow could tell a person "create your first agent" while their
agent folders sat in ~/Documents (or Downloads/Desktop). Cause: the auto scan
(`/api/scan-agents` -> `discover.scan()`) is deliberately TCC-free (#2125) and
skips those folders, so a fresh install never walks them and never fires the
macOS permission prompt as an ambush. The person's agents were invisible.

An earlier fix added a "Look in my Documents and Downloads" link (#2267). Josh's
0.6.39 fresh-account test rejected it (#5 / #2339, merged): "There is no link to
appear, even. It just pulls them in." He ruled the fix belongs in DETECTION:
once the Screen 2 file-access permission is actually granted, a full scan of
those folders should run and any agents load onto Screen 9 -- no link.

The precondition for that ruling was Kitty's #2347 (merged 2026-09-06 12:52 CT),
which makes the Screen 2 grant real (the native app fires the macOS TCC prompt
via `/api/file-access-prompt` and writes `file-access-status.json`). This branch
wires the DETECTION half.

## The change
`frScanAgents()` in web/index.html:
- Fetch `/api/file-access-status` first.
- If the grant is POSITIVE (`checkable:true && granted:true`), fetch
  `/api/scan-import` (`discover.scan({importScan:true})`), which reaches the TCC
  folders. Otherwise fetch the bare TCC-free `/api/scan-agents`, exactly as before.
- Both routes answer with `candidates` (agent FOLDERS with a CLAUDE.md the board
  has no record of), so the existing `frScanOffer` -> `frPaintScan` path renders
  them on Screen 9 ("We found N agents on this computer.") with no other change.

Two adjacent comments updated to record the now-wired behavior (and to correct
the ruling's loose "frPaintFound": never-recorded disk agents are scan
CANDIDATES, so `frPaintScan` is the accurate painter). The find-agents-link
removal comment near `#new-agent` updated to point at the new wiring.

New self-boot browser-check `docs/browser-checks/render-firstrun-scan-on-grant-1652.js`
(7/7): GRANTED -> import scan used and candidates render on Screen 9; CONTROLS
(declined, uncheckable) -> bare scan, the import scan never fires without a grant.
Wired into `tools/browser-checks.sh`, README indexed. The check carries a top-level
crash catch (added after an iteration-1 challenge NIT so a launch/spawn throw is not
a silent "no FAIL line"), so it contributes two reason-grep finding-emit sites (the
`bad()` helper and the catch) and one catch/launch site: EXPECTED_SITES 57->59,
EXPECTED_CATCH_SITES 34->35.

## Decisions
- **The grant gate is load-bearing, not a convenience.** The import scan walks the
  TCC folders, which is exactly what fires the macOS prompt. Running it
  unconditionally would reintroduce #2125's fresh-install ambush. So it fires only
  on a positive grant. Rejected: always running the import scan on Screen 9.
- **Ordering makes the gate clean.** Screen 2 precedes Screen 9, and this scan
  fires only from Screen 9's create empty-state, so the grant verdict is settled
  before the route is chosen. No re-scan-on-grant-transition machinery needed.
- **Painter is frPaintScan, not frPaintFound.** These folders have no board record
  (that is why they were invisible), so they are scan candidates. The ruling named
  frPaintFound loosely; frPaintScan is correct for never-recorded disk agents.
- **Scope: folder candidates only this pass.** The import scan also returns loose
  `importable` FILES (a bare agent .md in Downloads/Desktop). Those still route
  through the create form's import mode; surfacing them on Screen 9 would need a
  new name+connect UI in the first-run flow and is deferred as a separable
  follow-up. The dominant #1938/#1078 case (agent folders in ~/Documents) is
  handled here.

## Weakest premise
The self-boot browser-check verifies the FRONT-END route selection and rendering
with stubbed network responses; it does not exercise the real macOS TCC
prompt -> grant -> disk-walk. That end-to-end path is an operator fresh-install
pass (needs-operator on #1652, rides #2243). If the real grant does not flip
`/api/file-access-status` to `granted:true` in the fresh-install timing the way
the stub assumes, the bare scan would run and no agents would load -- safe
(no ambush, same as today) but the ruling would be unfulfilled. What would change
my mind: an operator trace showing the grant lands but Screen 9 still shows the
create empty-state.
