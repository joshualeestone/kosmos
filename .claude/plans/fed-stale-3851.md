# fed-stale-3851: a stale federation link cannot revive on a reused project id; outside avatars leave the local tint space

Card: kosmos#3851 (two follow-ups deferred from the #3311 federation review, round 21).

## 1. A stale link on a reused id
**Call:** a link carries `project_created`, the createdAt of the project it was made for (written by the create route's owner link and the join route's member link). `fedseats.ensure` compares it with the project now at that id (`deps.projectCreatedAt`): a mismatch is a link left by an earlier project, so no seat starts, the link is forgotten, and the log says so. Posts leave only through a connected seat (`fedseats.post`), so no seat means nothing leaves.
**Rejected:** refusing to make a project while federation.json is unreadable (the create route deliberately does not let a damaged file block making projects); a folder-path identity (a folder can be reused just as an id can; createdAt is set once per project and never changes).
**Legacy links** (from before the stamp) are stamped on first sight. **Weakest premise:** a reuse that happened before this shipped is stamped as if it were the original. That needs an unreadable federation.json at the wrong moment on a Mac that already has shared projects, before this version; accepted.
**Unknown** (`projectCreatedAt` undefined: projects.json unreadable) decides nothing: no stamp, no drop.
**Tests (engine/fedseats.test.js):** stale link gives no seat and is dropped (control: without the mismatch branch it fails by name); a link stamped for this project keeps its seat; a legacy link is stamped and kept; unknown decides nothing. server.federation-3311.test.js asserts both routes write the stamp (controls: removing either write fails its test by name).

## 2. Outside rows looked like local ones
**Call:** an external row's avatar is a neutral dashed disc, never `discTint(from)`: `from` is the sender's claim, and the name's tint matched a local agent of the same name. The card offered this or "show the attested account on each row"; the second needs the edge's counterpart identity carried through to every row (a data-flow change) and is left for a follow-up if wanted.
**Browser check:** docs/browser-checks/render-fed-external-3311.js now asserts the outside avatar is not a local "Bob"'s tint and is dashed, light and dark. Control: the old tint fails all four by name.

## Round 1 review (opus): 1 WARNING, 3 NITs
- [WARNING] nothing tested the board's own projectCreatedAt (a typo there would turn the check off silently, since null decides nothing). FIXED: server.federation-3311.test.js makes a project through the route, writes a link stamped for an earlier project, and asserts fedseats.linkFor hides it and ensure drops it (a control half first: a link stamped for this project is seen). Control: the server reading `p.created` fails it by name. To make ensure reachable there, the stamp check now runs BEFORE the enrolled gate, so a stale link is dropped on an unenrolled Mac too.
- [NIT] until the next ensure pass, the room prompt, the room's `federated` flag and federateOut still read the raw link. FIXED: one `fedseats.linkFor` (null on a stale stamp) that all four server readers and fedseats.post use. The create route keeps the raw read on purpose: it clears whatever link is on the id.
- [NIT] in dark mode the outside disc took the theme's generic avatar fill (a higher-specificity rule). FIXED with a higher-specificity selector; the browser check asserts no fill in both themes. Control: the old selector fails [dark] by name.
- [NIT] the outside avatar and name kept a pointer cursor with nothing to open. FIXED; asserted in the browser check (which caught my first selector losing to `.msg:not(.you) .msg-av`).

## Round 2 review (sonnet): 1 WARNING
- [WARNING] the unstamped branch read projectCreatedAt a second time for the value it wrote, so the stamp written was not the value checked (and could be undefined). FIXED: stampOf returns { state, born } and the stamp is written from born. Test: a createdAt that answers only on its first read still stamps that value. Control (the second read) fails by name.

## Round 3 review (opus): 1 NIT
- [NIT] the stale-link test's post() assertion could not fail (post returns false with no seat either way). FIXED: before ensure runs, it asserts fedseats.linkFor hides the link and a post writes no "stayed on this computer" note, which a room read as shared gets. Control (linkFor returning the raw link) fails the test by name.

## Round 4 review (sonnet): NO FINDINGS

## Validation (first run)
Tests: 9833, 0 failed. The browser-check surface gate (#2518) then failed: the new CSS names `msg` and `msg-av`, which render-unread-edge-3743, render-dm-phone-718 and render-agentdm-3414 assert on. All three were run on this branch and pass ("all unread-edge checks passed", "all passed", "all passed"). The new rules only reach `.msg.ext` rows; unread-edge-3743 renders external rows and still passes. Recorded as per-check trailers on the next commit, as the gate asks.
