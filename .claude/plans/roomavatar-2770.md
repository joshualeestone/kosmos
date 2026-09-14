# roomavatar-2770: room message avatars go stale after a profile-image update

Card: kosmos#2770 (filed by April from #2762). Same class as #2698 (org chart, MERGED) and #2762 (project member faces, April's OPEN branch).

## The defect

`pjRoomRow` (web/index.html) drew a message sender's face with a **bare** avatar URL:

```js
'<img src="/api/agent/' + encodeURIComponent(m.from) + '/avatar" alt="">'
```

The room thread is painted through `paintThreadInto` → `setLive`, and `setLive` skips the repaint when the new HTML is byte-identical to the last (`if (el.__lastLive === html) return`). The avatar route is `no-store`, so the `<img>` would refetch the current picture **if it were recreated**, but a bare URL is byte-identical after a picture change, so the skip fires, the `<img>` is never recreated, and the room keeps the old face.

## The fix (render-only, no engine change)

Version the sender avatar URL with `?v=<avatarVer>`, exactly as the merged #2698 org-chart fix does.

The sender's version is **not** on the project member row: `p.agents` (from `projects.describe`) carries `hasAvatar` but not `avatarVer`. So the version is read from `LAST` (the board snapshot, `data.agents`), whose cards DO carry `avatarVer` (`engine/status.js:5920`, `store.avatarVersion`). This is the same source the org chart versions its own avatars from (`web/index.html:19979/20068`), so the two surfaces stay coherent.

New helper next to `pjRoomRow`:

```js
function pjAvatarVer(from) {
  const c = (LAST || []).find((a) => a && a.sessionName === from);
  return (c && c.avatarVer) || 0;
}
```

Used in the agent-avatar branch: `.../avatar?v=' + pjAvatarVer(m.from) + '"`.

The operator's own picture branch already versions correctly (`youPicUrl()` → `/api/you/avatar?v=' + YOU_PIC_V`), so only the agent branch changes.

## Why option 2 (LAST lookup), not option 1 (engine payload)

The card weighed two producers. Option 1 (carry the sender's `avatarVer` in the room/member payload) is an engine change and would overlap `projects.js`, which April's in-flight #2762 already touches. Option 2 (client reads `LAST`) is self-contained in `web/index.html`, ships now with no cross-branch dependency, and mirrors the already-merged org-chart fix. Chosen.

## Weakest premise (stated, per the decide-and-document rule)

A sender **not currently on the board** resolves to no `LAST` card and falls back to `?v=0`, so that one row stays stale. This is the status quo for exactly that row (with no card, there is no newer version in hand to show), never a regression. If it later matters, option 1 (engine payload) closes it, but that is a separate card and a separate lane.

## Tests / guard

`web.avatarver-room-2770.test.js` (new):
1. Source-slice of `pjRoomRow`, read out of the build: asserts the sender img emits `?v=' + pjAvatarVer(m.from)` and the bare `/avatar" alt=""` has not crept back. This slice would have RED on the original bare URL (control real by construction).
2. Source-slice of `pjAvatarVer`: asserts the helper reads `LAST`, matches the sender by `sessionName`, reads `avatarVer`, and has a `|| 0` fallback (so a sender with no card or no version resolves to 0, never undefined). A runtime eval was rejected because a mock `LAST` would hand-build a card keyed on the session name, which the fixture-discipline gate forbids, and a real `avatarVer` above 0 only exists once an avatar file is saved.

## Browser-check gate

Satisfied by a `Browser-check:` commit trailer. The defect is deterministic markup (a URL query param), fully pinned by the source-slice node test above. There is no layout/paint/geometry dimension a browser render would add. Swept for existing checks pinning the old bare room URL: `render-projects.js` and `render-busy-line.js` touch `.msg-av` for existence/style only (the disc-fallback branch), never the img src, so no false-red. (Other room browser checks, `render-thread.js`, `render-found-undo.js`, `render-adopt-1531.js`, reference only the operator's own `/api/you/avatar`, not the sender img, so they are unaffected too.)

## Ship

Repo `joshualeestone/kosmos`, reviewer `joshualeestone` only, squash merge-on-green. PR links the card with non-closing `Addresses #2770`.
