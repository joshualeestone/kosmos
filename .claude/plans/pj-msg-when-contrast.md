# pj-msg-when-contrast - lift the project-message timestamp out of the WCAG AA dark-contrast floor

0.6.55 staging cut blocker, routed by Baron Draxum (render-check owner = me).

## Problem

`docs/browser-checks/render-thread.js` enforces WCAG AA (4.5:1 for small text) on
every visible string in the thread, in both themes. The project-message timestamp
`.pj-msg .pj-msg-when` ("You just now", built at web/index.html:37869) uses
`--label-3`, which in dark (`rgba(255,255,255,0.47)`) lands at 4.48:1 against the
thread background - just under the 4.5 floor.

Latent pre-existing failure: prior 0.6.55 cut attempts died at step 3 (a heartbeat
paneless leak, since fixed as #2718), so step 3b (the headless page checks) had
never run. The CSS is stable in git; this is not introduced by that change.

## Fix

Scope `.pj-msg-when` up to `--label-2` (dark `rgba(255,255,255,0.62)` = 6.65:1)
in BOTH dark selectors the file uses: the `@media (prefers-color-scheme: dark)`
`:root:not([data-theme="light"])` block (system dark) and the
`:root[data-theme="dark"]` block (explicit toggle), matching the file's existing
pattern (e.g. `.pjpill.attn` appears in both). Do NOT move the global `--label-3`
token, which would shift every tertiary label in the UI. Light `--label-3` already
clears AA and is left unchanged, so only the broken (dark) mode is touched.

Rejected: moving `--label-3` globally (shifts the whole UI); a uniform
`--label-2` for pj-msg-when in both modes (changes light appearance where nothing
is broken); an ad-hoc rgba between the two tokens (non-idiomatic - the file uses
label tokens).

## Files

- `web/index.html` - two scoped dark overrides for `.pj-msg .pj-msg-when`.

## Verification

Contrast computed with render-thread.js's own `contrast()`/`over()`/`luminance()`
functions: `--label-3` dark = 4.47, `--label-2` dark = 6.65 (clears 4.5 with
margin). Then run against the product's own instrument -
`docs/browser-checks/render-thread.js` against a booted `thread-server.js`, both
themes: "dark: every visible string in the thread clears WCAG AA" passes; all
checks passed.

## Browser-check gate

Only the coarse #1720 gate applies (`pj-msg-when` is not a mapped #2518 surface
token). Satisfied by a `Browser-check:` trailer noting the change is covered by
the existing render-thread.js WCAG-AA assertion (which this fix makes pass); no
assertion change is needed because the check already asserts it.

## Weakest premise

That the backed-out dark thread background (~[39,39,39]) used for the contrast
computation matches what the check measures. Mitigated by running the actual
render-thread check, which measures the real rendered background and passed.
