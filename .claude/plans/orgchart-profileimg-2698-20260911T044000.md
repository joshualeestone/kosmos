# Plan: org-chart avatar reflects a profile-image update (kosmos#2698)

Branch: `orgchart-profileimg-2698` off `origin/main`. Reviewer `joshualeestone` only. Beta = merge-on-green squash. No em dashes. PR body `Addresses #2698` (non-closing).

## The bug (Josh, design channel 2026-09-10)
Updating an agent's profile image reflects on the grid and list views but NOT the org-chart view, which keeps showing the old image.

## Root cause (traced, not guessed)
- All three board views render the avatar with a BARE URL `/api/agent/<name>/avatar` (grid web/index.html:13986/14003, list :33796/:34160, org `paintOrg` :19996). The avatar route sends `cache-control: no-store` (server.js:2639), so the browser never caches; a freshly-created `<img>` always refetches the current image.
- Grid and list rebuild their `<img>` elements on every poll, so each new element refetches the fresh (no-store) image and the update appears within one poll.
- `paintOrg` has an identity-skip guard (web/index.html:20039 `if (html === ORG_HTML) return;`) that avoids repainting when the generated HTML string is byte-identical, to preserve keyboard focus and avoid churn. Because the bare avatar URL never changes when the underlying image changes, the org HTML string is identical before/after an avatar update, so `paintOrg` returns early, the org `<img>` element is never recreated, never refetched, and the stale image persists until some OTHER change (an agent added/removed) forces a full org repaint.

## The fix (mirror the proven per-version-URL pattern)
The codebase already solves exactly this for the operator's own avatar: `youPicUrl()` returns `/api/you/avatar?v=' + YOU_PIC_V` (web/index.html:25324), a version that changes when the picture changes. Apply the same to agent avatars, sourced from the avatar file's mtime:
1. `engine/store.js`: add `avatarVersion(name)` returning `Math.round(mtimeMs)` of `avatarPath(name)`, or `0` if there is no avatar / any error (fs guarded). Export it. Self-contained and deterministic (mtime changes whenever `saveAvatar` rewrites the file).
2. `server.js` snapshot (~2336): emit `avatarVer: store.avatarVersion(k.name)` next to `hasAvatar`, so `/api/status` (the board payload the org view reads via `LAST`) carries the version per agent.
3. `web/index.html` `paintOrg` (~19996): build the org face img as `/api/agent/<name>/avatar?v=' + (a.avatarVer || 0)`. When the avatar changes, `avatarVer` (mtime) changes, the org HTML string changes, the identity guard detects it and repaints, the new `<img>` fetches the fresh no-store image. Fixed.

## Scope decision (documented)
Fix is scoped to the ORG view (the broken one). Grid and list already reflect the update (they recreate their imgs each poll), so I do NOT change them, which also keeps the diff disjoint from Renet's concurrent project-view work (#2699). The version field is sourced generically (`store.avatarVersion`) so grid/list could adopt it later for cache efficiency, but that is out of scope here.

## Weakest premise (verify)
That grid/list work by img recreation + no-store while org is frozen by the identity guard. Verified by reading: the avatar route is `no-store` (server.js:2639); `paintOrg` returns early on `html === ORG_HTML` (:20039) keeping the same `<img>`; the only cache-buster in the codebase for this exact class is the operator's `?v=YOU_PIC_V`. No browser-check pins the AGENT org avatar URL (only `/api/you/avatar` 404-ignores, which already tolerate a query), so `?v=` will not false-red CI.

## Tests (node-level, no interactive browser)
- `engine/store.avatarversion-2698.test.js` (new, mirrors imagetype.test.js sandbox): no avatar -> `avatarVersion` is 0; after `saveAvatar` -> equals the file's `Math.round(mtimeMs)` and is > 0; a second save with a changed mtime -> a different version; after `removeAvatar` -> 0.
- `web.org-view.test.js`: source-slice assertion that the org face img is built with the versioned URL `/avatar?v=' + ` referencing `avatarVer`, plus a control that the bare unversioned `/avatar"` form is no longer how the org face is built (regression signal, matching this file's established node-render assertion style at :448-460).
- Full node suite `bash tools/run-tests.sh` green. `/challenge-loop` to convergence. `/create-pr` (literal cd, reviewer joshualeestone, `Addresses #2698`).

## Iteration-1 refinement (challenge-loop)
A blind review caught two real BLOCKERs. (1) `hasAvatar` is emitted in THREE card-building paths, not one: my first commit added `avatarVer` only to server.js's OFFLINE card, so RUNNING agents (the normal org-chart population, built in engine/status.js's pane card ~6411 and pane-less token-known card ~5917) shipped no `avatarVer` -> `?v=0` constant -> still stale. Fixed: emit `avatarVer` at both status.js sites, gated exactly like their `hasAvatar` (pane card on `tied`, else 0), per status.js's own "every read keyed on the name needs the same gate" rule. Added status.test.js assertions on the seeded-avatar case: the tied pane card carries a real `avatarVer > 0`, the untied stranger carries 0. (2) CI's #1720 browser-check gate refuses a web/ change without a docs/browser-checks touch or a non-empty `Browser-check:` trailer; the fix carries the trailer with the reason below (behavior covered by node tests; the visible re-show needs a live avatar swap on the deployed board, which is the pending-deploy live-verify, not a static assertion). Also fixed the NIT-adjacent commit-message inaccuracy (the payload now emits `avatarVer` at all three sites, stated accurately in the new commit).

## Verification / done bar
This is a frontend change. Node tests + CI browser-checks are the author's evidence (Kosmos beta merges on green). Live-verify (open org view, change an agent's profile image, confirm the org avatar updates) waits on the next cut, like the other pending-deploy cards. Issue #2698 is self-authored-by-Josh (design-channel report) -> leave OPEN with a merged-pending-deploy comment.
