# Rich-text rendering in agent dialogue (#2067) — web-board render half

Branch: `richtext-render-2067`. Owner: Mona Lisa (design/content). Addresses #2067 (non-closing).

## Goal / done-condition

Josh (2026-09-03, unprompted): agents already write bold, headings, bullets and
emoji (it is why they read well in Discord), but the same agents produce a "wall
of text" inside Kosmos. Render what they already produce.

Done = bold, italic, a heading, lists, quotes, code and emoji render in the two
agent-dialogue ROW surfaces that today only escape+autolink — the per-agent talk
thread and the project message row — safely, with recognised markdown markers
(block markers and closed inline pairs) never leaking as raw markup, and never
becoming an HTML-injection surface. (An unclosed inline marker stays literal, as
standard markdown leaves it.) Design was already settled
(installkosmos.com/design/rich-text-dialogue + the #2067 card comment); this is
the build.

## What I changed

- **New `pjRich(text)` + `pjRichSpans(seg)` in `web/index.html`** (after `pjInline`).
  A restricted-markdown renderer: bold, italic, strikethrough, inline code,
  fenced code block, one heading size, unordered + ordered list rows, blockquote,
  horizontal rule, emoji, and the pre-existing bare-URL autolink. Markdown
  `[text](url)` renders as its TEXT only (never a clickable anchor).
- **Wired `pjRich` into the two escape-only row surfaces**: `dmRow` (talk thread
  / operator DM, `.dm-b`) and `pjMsg` (project message row, `.pj-msg-text`).
  Left `pjInline` unchanged.
- **CSS** for `.mdh/.mdc/.mdcb/.mdq/.mdli/.mdhr` scoped to both surfaces, theme-aware.
- **Committed headless browser-check** `docs/browser-checks/render-richtext-2067.js`
  (registered in the runner + README), and test updates for the new contract.

## Key decisions (call / rejected / weakest premise)

1. **Render-side only; no `engine/chat.js`/store change.** The store keeps raw
   text; markdown is applied at display. Rejected pre-rendering in the store:
   out of my design/content lane and collides with the live #2107 chat.js edit.
2. **A NEW `pjRich`, not markdown inside `pjInline`.** `pjInline` is also called
   per-token by `pjLinkPaths` (the rich `pjBody` path), and per-token markdown
   would split `**bold text**` and leak the markers. So the shared leaf stays
   as-is; only the two direct-`pjInline` row sites move to `pjRich`.
3. **Inline output, `<br>` breaks.** `.dm-b` is `pre-wrap` but `.pj-msg-text` is
   not, so breaks are explicit `<br>` (source `\n` consumed) to be container-
   agnostic. No block elements (they would fight pre-wrap and double breaks).
4. **Escape-first, zero HTML passthrough.** Every text run is `esc()`'d; only a
   fixed whitelist of tags this function emits reaches the DOM. A `<script>` or
   `onerror` payload renders as inert text.
5. **Links an agent authored stay plain text.** A clickable agent-authored link
   is a navigation risk for a non-technical reader; bare-URL autolink (pre-
   existing) is unchanged. Josh can flip `[text](url)` to clickable later.
6. **Weakest premise:** render-all-as-markdown means literal asterisks in prose
   (e.g. "5 * 5") can style unexpectedly. Judged rare for agent output and
   strictly better than leaking raw markers; the store owner can later add a
   stored is-markdown flag (the card's migration call). I am render-side only.

## Scope boundary (flagged, not silently assumed)

This is the two ROW surfaces. The project-ROOM activity thread
(`pjRoomBody` → `pjBody` → `pjLinkPaths`) already renders fenced blocks,
filename "Show me" chips and server quotes but has no inline markdown; giving it
bold/italic needs a careful refactor of the per-token `pjLinkPaths` path and
gets its own PR. The native pane full-render, notify-strip and Discord relay are
separate surfaces with their own owners.

## Verification

- `docs/browser-checks/render-richtext-2067.js` (headless, both themes): calls
  the shipped `pjRich` across markdown/degrade/XSS inputs (plain text
  byte-identical to `esc`; `<script>`/`onerror` stays inert; markers never leak),
  then paints the real talk thread with a markdown agent message and asserts the
  DOM + computed CSS. 90 assertions, green.
- `web.links-everywhere.test.js` / `web.agent-answers.test.js`: lift lists
  updated to include `pjRich`/`pjRichSpans`; links-everywhere + escape contract
  hold for the rewired rows.
- Full `tools/run-tests.sh` green (run inside the worktree, alone).

## Trap hit while building (worth recording)

A literal `<script>` in the pjRich doc comment became the file's LAST
`<script>` occurrence, and several test harnesses locate the page's last script
block via `lastIndexOf` of that literal open tag — so ~37 unrelated tests failed
by slicing the page from my comment. Fix: name those tags in prose only, never
as literal markup, anywhere in a page comment. (Same class as the selector test
reading a markdown `#hashtag` input as a CSS id — build such literals so the
scanner cannot mistake them.)
