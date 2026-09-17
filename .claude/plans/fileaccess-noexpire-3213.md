# Plan: #3213 - file-access status pill cannot hold 'granted' (staleness while idle)

Branch: fileaccess-noexpire-3213
Card: joshualeestone/kosmos#3213
Owner: PigeonPete (state-reporting / staleness lane; routed by Splinter, lane beats mod-7==0)
Coordinated with: Angel (filer/scoper) - she handed off the claim and confirmed the approach.

## The bug
`GET /api/file-access-status` returns `checkable:false` ("the file-access reading is stale;
the app is not currently maintaining it") ~5min after the last fire, while `nativePresent`
stays true (the app IS running). So the S2 Access pill cannot HOLD "granted" - once the
staleness window passes it reverts to "can't check" even though the app is up and folders
are granted. Surfaced by the #3188 board-read (0.6.74), filed separately by Angel.

## Root cause
`engine/fileaccessstatus.js` treats a reading older than `STALE_AFTER_MS` (5min) as
`checkable:false`. But the native app writes `file-access-status.json` ONLY on-demand and
MUST NOT write it periodically: the file-access probe IS the macOS permission prompt
(permflood-2125), so an automatic re-probe would burst prompts. So an aged verdict under a
LIVE app is stale-by-design, not stale-because-the-app-is-gone - but `read()` could not tell
the two apart because it did not know whether the app process was up.

## Fix (engine-only, no native change, no new probe)
Pass the existing `nativePresent` signal (already computed in the route from a11y-writer
freshness, prompt-free) into `fileaccessstatus.read(opts)`. In the STALE branch only, when
`nativePresent` is true, HOLD the existing verdict (return checkable:true + the real granted
value + the original `at`) instead of expiring it. When `nativePresent` is false the app is
gone, so the aged reading genuinely cannot be trusted -> keep the honest "cannot check".

- engine/fileaccessstatus.js: `read(opts)` reads `opts.nativePresent`; stale check becomes
  `> STALE_AFTER_MS && !nativePresent`. Placed AFTER the ENOENT / no-verdict / no-time
  guards, so it only ever extends an EXISTING valid reading, never manufactures one.
- server.js /api/file-access-status route: compute `nativePresent` first, pass
  `{ nativePresent }` into `read()`.

## Approach gate (Angel, confirmed)
- Periodic/automatic refresh is OUT (permflood-2125 prompt-burst). Not added.
- The no-expire-while-nativePresent engine fix is SUFFICIENT + SAFE for #3213 as filed and
  does NOT need a native change.
- The separate async-probe-timing concern (first write is granted:false if enumerate returns
  before the user answers the TCC prompt; a native post-click re-probe) is NOT #3213 - it
  stays with #3188 (native).

## Caveats (Angel), both handled
(a) Never manufacture a verdict: ENOENT / no boolean granted / no readable time still return
    checkable:false even with nativePresent=true. Satisfied structurally (the fix lives only
    in the stale branch, past those guards). Tested in all three shapes.
(b) A mid-session grant REVOCATION would not be re-detected under no-expire. Acceptable only
    if consumers are acquire-only, not revocation-monitors. VERIFIED by grep: the only
    product consumers of /api/file-access-status are the S2 pill poll (index.html:44701) and
    the scan-on-grant EDGE detector (~47400-47511, acts on not-granted -> granted, takes the
    granted route). No consumer acts on granted -> not-granted. Acquire-only posture holds.

## Verification
- engine/fileaccessstatus.test.js (+5 tests): stale+nativePresent HELD (checkable:true, real
  verdict) with a NON-VACUOUS CONTROL (same aged input expires with nativePresent:false);
  holds a stale NOT-granted verdict too (no granted bias); caveat-a in all three shapes;
  fresh unaffected; backward-compat (no opts = fail-safe). 12/12 green.
- Route consumers green: server.fileaccess-present-2347, native-app.perm-prompts-2189,
  web.firstrun-a11y-1214 (all pass after the route reorder).
- No web/ file changed, so no browser-check trailer required.
- Buildable + verifiable on this headless box (engine-only); no native box needed.

## Weakest premise
That `nativePresent` (a11y-writer freshness) is a trustworthy "app process is up" proxy for
the file-access writer specifically. It is the same presence signal the S2 gate already trusts
for exactly this purpose (#2347), and both grant seams are written by the same native app, so
if the a11y writer is fresh the file-access writer's process is up too. If the two writers
could diverge (a11y maintained but file-access writer dead), a held verdict could outlive the
app - but that is the same assumption the existing gate already makes, not one this adds.
