# rich-text-tasks-3122: support rich text in task bodies (#3122)

**Branch:** `rich-text-tasks-3122` (off origin/main). **Card:** kosmos#3122 (Josh-requested 2026-09-15).
Full scope decision is on the card (issue-comment); this is the build record.

## The change

Task content was plain text. This enriches the task DESCRIPTION/body (`detail`) to render restricted
markdown, by reusing the existing XSS-safe renderer `pjRich` (already used for agent-dialogue,
#2067/#2239/#2701) rather than adding any dependency.

- **web/index.html render site** (openTaskPage): `det.textContent = t.detail || ''` ->
  `det.innerHTML = t.detail ? pjRich(t.detail) : ''` (kept `det.hidden = !t.detail`). Comment states
  the invariant: `t.detail` only ever reaches innerHTML THROUGH pjRich, never raw.
- **web/index.html CSS**: the `.md-*` treatment rules (headings/tables/code/quote/list/hr, previously
  scoped to `.dm-b`/`.pj-msg-text`/`.msg-b`) now also include `.tkdetail` (the task-body element's
  class), so the markdown renders styled on the task surface, not just structurally. The block's
  header comment is updated to list the task body as a fourth surface.
- **docs/browser-checks/render-richtext-2067.js**: added a realistic multi-line task-body input to
  the Layer-1 pjRich battery + two assertions (markdown renders AND the embedded `<script>` stays
  inert). Documents that #tk-detail depends on this pjRich guard, and satisfies the #1720 gate.

## Scope (decided per Josh's standing decide-and-continue ruling)

Enrich `detail` only. Title (`sentence`) stays plain (a 200-char label). Comments (`said`/taskchat)
are a deferred follow-up (they render through a concatenated who+text phrase, needing more surgery;
noted on the card). No post-creation edit path for `detail` exists today (only create writes it); the
create textarea already accepts free text, so users author markdown there. Storage is unchanged
(markdown is plain-text-compatible, degrades gracefully, no stored-HTML XSS risk).

## Why it is XSS-safe

`pjRich` is escape-first: it `esc()`'s every text run BEFORE emitting any tag, emits only a fixed
whitelist of tags it itself produces, reduces `[text](url)` to its text (no author-controlled href,
no `javascript:` vector), and only autolinks bare `http(s)://` tokens off the already-escaped string.
render-richtext-2067.js's Layer-1 battery already proves this against `<script>`/onerror/jsLink/
attr-break payloads; this change reuses that exact function verbatim, and the new task-body assertion
extends that guard to a detail-shaped input.

## Tests / verification

- web.task-page.test.js passes (13/13) with the render change (it lists tk-detail as an id, does not
  assert its textContent, so the textContent->innerHTML swap is compatible).
- render-richtext-2067.js extended (task-body input + inert assertion); `node --check` clean. NB: this
  is a Playwright browser-check, run in CI / on a console machine, NOT runnable in this night-shift
  bot session (no Playwright) -- same constraint as every browser-check here.
- The full node suite + test:shell should be run in the challenge-loop.

## Weakest premise (browser-gated)

That pjRich's output (inline spans joined by `<br>`, tuned for chat bubbles) LOOKS good in the
`#tk-detail` `<p>` surface. The structure is safe (escape-first) and the CSS extension styles it, but
"renders well" (headings/lists/tables/code in a description paragraph) is a VISUAL judgment that needs
a claude-fe / CI browser pass to confirm, not just node tests. Like #3052/#3081, the behavioral
"looks right" verify on the task surface is browser-gated; this bot session cannot run it. The safety
(XSS-inert) and the wiring (reuses pjRich) are covered; the visual polish awaits a browser pass.

One STRUCTURAL case in that browser-gated set, named explicitly (blind-review finding, iter 2):
`#tk-detail` is a `<p>`, whereas the other pjRich surfaces are `<div>`/`<span>`. If a `detail`
contains GFM table syntax, pjRich emits a real `<table>` (inside a `.mdtablewrap` that is
`display:inline-block`), so `det.innerHTML` would nest a `<table>` inside a `<p>`. Reasoned-through
(not measured): assigning via `.innerHTML` uses HTML5 FRAGMENT parsing with `#tk-detail` as the
context element, which is NOT pushed onto the parser's open-elements stack, so the document-parsing
"a `<table>` auto-closes an open `<p>`" rule cannot fire; the table nests as a child of the `<p>` in
the DOM, and being `inline-block` it flows in the pre-wrap paragraph. So it very likely renders fine,
but it is unmeasured here. The browser pass that verifies the visual should include a `detail` with a
table (a `#tk-detail`-painted check with a table input is the stronger guard, a good browser-session
follow-up). If it ever misrenders, the cheap fix is to make `#tk-detail` a `<div>` (matching the
other surfaces); deferred rather than done now because changing the tag is itself browser-gated
(other `.pj-desc`/`.tkdetail` layout could assume a `<p>`), trading one unmeasured case for another.
