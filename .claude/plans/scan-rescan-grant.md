# scan-rescan-grant - re-scan the disk when file-access is granted late (Josh 0.6.42 #3/#4, half a)

## The problem

On the first-run find-agents screen (S9), agents in ~/Documents, ~/Downloads, ~/Desktop were not
shown when the macOS file-access grant landed ASYNCHRONOUSLY. The person clicks Allow on S2, the
TCC write propagates a beat later, and they have already advanced to S9, so frScanAgents ran the
TCC-free /api/scan-agents route (which skips those folders) and their agents were missing. Josh's
0.6.42 words: "it never showed me the agents on the path."

frScanAgents picks the granted /api/scan-import route only if /api/file-access-status ALREADY
reports granted when it runs. In the normal flow S2 precedes S9 and the grant is settled first, but
an async grant landing after the person reaches S9 was never retried.

## The split (with Ice Cream Kitty)

- **Half (a), this branch (front-end):** a light /api/file-access-status poll on S9 that re-runs
  frScanAgents on the not-granted -> granted EDGE, so a late grant surfaces the Documents/Downloads
  agents without a reload.
- **Half (b), Kitty's branch scan-tcc-hatch-2125b (engine):** route the granted /api/scan-import
  walk through the app-exe hatch identity so it reads correctly and fires no new prompt, and return
  `scanning: true` (partial) while the hatch is still answering. Half (a) is built against the
  EXISTING /api/scan-import (same endpoint), so it inherits (b) when it lands. The two are
  orthogonal (confirmed with Kitty). Half (b)'s `scanning:true` retry is separate future work.

## What this branch does (web/index.html)

- New state: `FR_SCAN_FULL` (did the GRANTED route DELIVER), `FR_RESCAN_TIMER` / `FR_RESCAN_GEN` /
  `FR_RESCAN_INTERVAL_MS` / `FR_RESCAN_BUSY`.
- `frArmRescanOnGrant()`: an S9-guarded, idempotent poll. On the not-granted -> granted edge it
  re-runs `frScanAgents(true)` (the granted route) and repaints. It DEFERS while focus is inside
  `#fr-fleet` (never repaints over in-progress work), RETRIES on a transient granted-scan hiccup
  (stops only when the granted route delivers), and stops after one successful flip.
- Armed from `frPaintFleet`'s create AND unknown arms (both S9 disk-scanning arms) rather than from
  frScanAgents, so a Back -> forward RETURN to S9 (where FR_SCAN is already populated) re-arms too.
- `frScanAgents(grantedHint)`: skips the redundant second file-access read when the poll already
  confirmed the grant; sets `FR_SCAN_FULL = full && scanOk` (delivered, not merely attempted).
- Retired on leaving S9 (`frGo`) and on first-run completion (`frFinish`).

## Tests

- `docs/browser-checks/render-firstrun-scan-on-grant-1652.js` (24 checks): the granted route, the
  declined/uncheckable controls, the late-grant flip re-scan, the return-to-S9 re-arm, the
  defer-while-focused + resume, the unknown arm, and the transient-hiccup retry-then-recover. Each
  guard was confirmed to red without its fix.
- `render-firstrun-import-1652.js` retires the poll after its direct frPaintFleet calls; the two
  frPaintFleet unit harnesses stub frArmRescanOnGrant.

## Decisions / rejected

- Arm from frPaintFleet, not frScanAgents: the only placement that re-arms on a return-to-S9.
- Stop only on a DELIVERED granted scan (FR_SCAN_FULL = full && scanOk): a transient hiccup must not
  foreclose the one retry. Rejected: stop on the grant edge (foreclosed on a hiccup).
- Defer (not skip) the re-scan while focus is in #fr-fleet: rejected repainting over in-progress work.
- Kept half (a) as its own branch, orthogonal to Kitty's half (b), behind the same endpoint.

## Weakest premise

The retries-forever-while-stalled case (a persistently-failing granted scan, or focus held in
#fr-fleet) keeps a light poll firing until the person leaves S9. It is bounded to S9 and retired on
exit, and Kitty's half (b) makes the granted walk reliable; documented in-code as the deliberate trade.

## Out of scope (follow-up)

kosmos#2389: the adopt-with-fleet arm never disk-scans, so an adopt-path user with ~/Documents
agents never sees them. Pre-existing #1493 gap; needs a product ruling first.

Relates to #1493 (look on the disk on every path), #1652 / #2147 (import), #4, and the
scan-tcc-hatch work.
