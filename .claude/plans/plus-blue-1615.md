# Plan — #1615 in-app Kosmos Plus tab whole-app-blue reskin

**Spec of record:** `~/work/Josh-Brain/Projects/kosmos-plus-BLUE-SKIN-PACKAGE-for-Angel-2026-09-06.md`
(Mona Lisa, design lead, 2026-09-06), which consolidates `kosmos-plus-firststep-exact-copy-spec.md`
and `kosmos-plus-onswitch-gate-1615-design-spec.md`. Source of the look:
`kosmos-relay/deploy/www/kosmosplus/design/first-step.html`.

## What finished looks like
When the Kosmos Plus tab is on screen the whole app takes the first-step blue ground; leaving the
section or the tab reverts it and tears the canvases down (no leak, no off-screen CPU). State 1 is
the immersive blue HOME (hero + value grid + privacy note, link-only). States 2/3 keep every wired
id and gain the blue card frame. Guard strings preserved. Full suite green + a browser check pins it.

## Decisions
- **Whole-app blue** (Mona's ruling), via `body.plus-active` overriding both token systems
  (`--k-*` and `--label/--bg`). Chosen because setting the palette ON body wins for the whole content
  subtree by inheritance (nearest ancestor), beating the `:root`/dark/custom-theme cascade without a
  specificity fight or `!important`. Content-pane-only was the named fallback; not needed — the token
  override is clean and the render check confirms no leak.
- **State 1 stays link-only.** `web.plus-tab.test.js` forbids `<button>/<input>/<select>` in the
  state-1 slice, so the mock's "Join" button is rendered as a styled `<a>` (the existing wired
  `#plus-site-link`). "Sign-up is not open yet" kept (guarded, still true — Stripe in sandbox).
- **Canvases** ported verbatim in behaviour from first-step.html (`#plus-stars` ambient drift,
  `#plus-mark` the wordmark resolving over 1.5s), namespaced `plus-*`, honouring reduced-motion,
  mounted/torn-down by `syncPlusChrome()` keyed on the same predicate as the #743 tick
  (`URL_TAB==='settings' && SETTINGS_SEC==='plus'`).
- **Guard strings:** no price, no hostname (link href from JS/KOSMOS_SITE), "this computer" not
  "this Mac". Wiring (the #1615 enrolled gate) unchanged.

## Weakest premise
That overriding both token systems on `body.plus-active` recolours every visible surface. Verified by
the render check (computed `body` background is blue on enter, reverts per-theme on leave) and by
eyeballing light+dark screenshots (nav + sidebar + content all blue). Any surface painted directly on
`<html>` would escape; none is (only `html { scroll-padding-top }`).

## Scope note
State 2/3 reskin is CSS-only card framing over the existing wired markup (lowest risk); the visual
weight lands on state 1, as Mona specified. The `.dsec:focus-visible` outline reads as a card frame
on blue — that is pre-existing app focus behaviour, not introduced here.
