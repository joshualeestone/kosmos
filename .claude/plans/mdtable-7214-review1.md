# mdtable-7214 review, round 1 (blind, CTO lens)

Branch mdtable-7214 at f30bd66e87, reviewed against origin/main (merge-base b085909327).

## Findings

### [BLOCKER] The new `.mdc { overflow-wrap: anywhere }` rule reverses the #718 table ruling on three surfaces the card never touched, and crushes short code columns

web/index.html:7910
`.dm-b .mdtable .mdc, .pj-msg-text .mdtable .mdc, .msg-b .mdtable .mdc, .tkdetail .mdtable .mdc { overflow-wrap: anywhere; }`

`overflow-wrap: anywhere` sets an inline's min-content to one character. Once every code span in a table can shrink to one character, the table no longer has a reason to be wider than its box, so `.mdtablewrap` never scrolls. Instead the column is squeezed and each identifier is chopped into pieces. That is the #718 failure ("crushed to a letter per line instead of scrolling inside .mdtablewrap", comment at web/index.html:7090) brought back for code cells. `.msg-b` matches DM bubbles too, and `.pj-msg-text` and `.tkdetail` are the project message list and task detail. None of them is part of this card.

Measured with a scratch harness that boots a board from each tree. The fixture is a 6-column table whose cells are `` `install-agent` ``, `` `refresh-token` ``, `` `kosmos-open` ``, `` `workforce` ``, `` `sessionName` `` and `` `fleet-builders` ``, rendered through pjRich. "Rects" is how many line fragments each code span breaks into:

| surface | base: wrapper scroll / rects | branch: wrapper scroll / rects |
|---|---|---|
| real DM (`#d-dmthread .msg .msg-b .msg-bd`, 340px) | 258px scroll / 2,2,2,1,1,2 (breaks only at the hyphens) | 0 / 5,5,5,4,5,5 |
| `.pj-msg-text`, 300px | 226px / 2,2,2,1,1,2 | 0 / 4,4,4,3,4,4 |
| `.tkdetail`, 300px | 226px / 2,2,2,1,1,2 | 0 / 4,4,4,3,4,4 |
| room bubble at 393px (agent post) | table spilled to 526px (the original bug) | 0 / 9,9,8,7,8,10 line fragments |

So `install-agent` shows as roughly two characters per line on a phone in the room, and about three in a desktop DM. A path in a code span (`/Users/.../notes/2026-10-26.md`) goes from scrolling to wrapping in three pieces on pj-msg-text and tkdetail.

Failure scenario: an agent DMs a table of command names or ids in code spans. Today it scrolls with every name whole. After this branch every name is chopped mid-word.

Why nothing caught it: render-dm-phone-718.js ("no table cell is narrower than its longest word") passes 88/88 on the branch (measured), because none of its table cells holds a code span.

The comment at web/index.html:7103 ("on desktop a cell holding a long unbroken token now scrolls with its table instead of breaking mid-token") is now false for code spans.

Fix: scope the rule to what the card needs, and give it a floor so it cannot crush a column. One way:
- Room only: `.msg-b:not(#d-dmthread *) ...`, or better, a class on the room's bubbles. At the least, keep it off `.pj-msg-text`, `.tkdetail` and the DM thread.
- Plus a floor: `.mdtable td:has(> .mdc) { min-width: 12ch }` or similar, so a long hash wraps inside a column of reasonable width while a table of short identifiers still overflows and scrolls in `.mdtablewrap`, as #718 ruled.
- Add a code-span table to render-dm-phone-718.js and to the room check so the "narrower than its longest word" assertion covers code cells. Use a floor at the min-width, not at the full token, so a hash can still wrap.

If the intent really is to wrap code everywhere, say so on the card, get the reversal of #718 ruled, and update the 7103 comment.

### [WARNING] Every room post with a fenced code block changes appearance, which the plan does not claim and the design shots do not show

web/index.html:74783-74785 (pjRoomPara matches `pre`, `figure` and `div`), styling at 7358-7359, 7380 and 11628.

The plan says "every other body stays a <p>, as before". But a fenced code block emits `<figure class="codeb"><pre>` and `<div class="codesrc">`, so every post with a code fence now goes into `div.msg-p` too. That is likely the most common shape of agent post. Before, the parser split it into `P FIGURE.codeb P`, and the text after the fence sat loose in `.msg-bd`. Measured differences (base vs branch, room bubble):

- Text after a code block: 13px goes to 15px, in light and dark, desktop and phone.
- The path label above a block (`.codesrc`): 13px goes to 15px.
- Code text colour in the person's own bubble, light: rgb(20,22,26) goes to rgb(74,79,87) (now `--k-ink-2` from `.msg.you .msg-p`).
- Code text colour in dark, both sides: rgba(255,255,255,.92) goes to #ffffff.

Most of this is arguably a fix: the text after a fence used to be smaller than the text before it. But it is an unreviewed visual change to a high-traffic shape, and the light-mode `.you` code text going grey reads as an accident, not a choice.

Fix: either say it on the card and add a room code-block screen to the design shots, or pin the code block's own colour (`.codeb pre { color: var(--k-ink) }` plus the dark twin) so the block does not inherit the paragraph tint.

### [WARNING] No check guards a crushed code column, and the room table check runs only at 1280

docs/browser-checks/render-richtext-room-2239.js:233-241 and 257-259

The new edge check is clamped by `Math.min(table right, wrap right)`, so once the table is in its wrapper it measures the wrapper, not the content. The plan admits it cannot fail at this width. The only live guard is `tableWrapped`. Nothing asserts what the `.mdc` rule changed: that a cell is not narrower than a sane floor, at phone width.

Fix: add a 393px pass, and assert a minimum width for code cells (or a maximum number of line fragments per code span) using a short-identifier table, not only the 64-character hash.

### [NIT] The pjRoomPara comment calls its list "the HTML parser's list", but the list is incomplete

web/index.html:74783-74784

The HTML spec's list of start tags that close a `<p>` also includes `li`, `dd`, `dt`, `center`, `dir`, `listing`, `plaintext` and `xmp`. pjBody emits none of these today: list items are `span.mdli`, a rule is `span.mdhr`, a heading is `span.mdh` (measured, see below). So this is not a live bug. But the comment promises completeness, and a future `<li>` from pjBody would silently bring the defect back.

Fix: add the missing names, or reword the comment to "the ones pjBody can emit, plus the rest of the block set".

### [NIT] The quote margin selector carries two redundant arms

web/index.html:8612

`.msg .msg-p + .quoteb + :is(p, .msg-p)` and `.msg p + .quoteb + .msg-p` are both subsets of `.msg .quoteb + .msg-p` and `.msg .quoteb + p`, which are already in the list.

Fix: `.msg .quoteb + :is(p, .msg-p) { margin-top: 10px; }` (keep the old `.msg p + .quoteb + p` only if something relies on it, and nothing visible does).

## Checked and found clean

- **Selectors and JS that read a room post's `<p>` (measured by grep, read by hand).** CSS: `.msg p` and `.msg.you p` (light, dark and the forced twin) all have `.msg-p` twins; `.msg .quoteb + p` is covered. There are no `.msg-bd > p`, `p:first-child` or `p:last-child` rules on messages. JS: msgCopyText (web/index.html:75000) and speechTextOfRow (76011) both include `div` in their separator selectors, so copy and read-aloud still break lines. Room search filters rows on data (pjRoomFilterRows), not on DOM `<p>`. pjReplyGist reads the record text. pjMentionHighlightHTML works on the composer, not on rendered posts. The only `closest('p')` (34760) is unrelated. render-projects.js:582 reads `.msg p b` on a plain post, which stays a `<p>`.
- **The pjRoomPara regex (measured, node on the extracted function).** Escaped text `&lt;table&gt;` stays `<p>`; an `href` containing `table` stays `<p>`; `<picture>` and `<code class="mdc">p</code>` stay `<p>` (the `\b` holds); `<pre>`, `<figure>`, `<header>`, `<TABLE>` and the `mdtablewrap` table go to `div.msg-p`. Reasoned: every `<` in pjBody output is a real tag, because esc() escapes `<`, `>`, `&` and `"` in text and attributes, so the regex cannot be fooled by user text.
- **Other surfaces that put pjBody or pjRich output in a `<p>` (reasoned plus grep).** The only `<p>` host is `#tk-detail` (`<p class="pj-desc tkdetail">`, web/index.html:17611), filled with `det.innerHTML = pjRich(...)`. Fragment parsing with a `<p>` context does not put that `p` on the open-element stack, so a table cannot close it. Not affected by the parser defect. The DM rows and `.pj-msg-text` (a span) have no `<p>`. pjRoomBody has two callers (74480 pending, 76425 row), and both go through pjRoomPara. The blockquote path puts pjBody inside `<blockquote>`, which may hold a table.
- **Parser effect (measured).** Room DOM on base: `P TABLE.mdtable P` (the wrapper left empty), with the table at 526-611px. Branch: `DIV.msg-p` with the table in `.mdtablewrap`, at 523px desktop and 209px phone. A plain-word table on a phone scrolls (wrapper scroll 242px) and keeps words whole.
- **Unit tests (measured).** web.room-phone-718, web.quoteb, web.codebox-3942, web.dialog-md-2701, web.selfname-4873, web.mention-live, web.room-761: 75/75 pass, exit 0. web.quoteb's `<p>...</p>` assertions still hold, because those bodies have no block.
- **tools/sync-forced-theme.js --check (measured):** exit 0.
- **render-richtext-room-2239.js (measured):** exit 0. The 4 new kosmos#7214 checks pass in light and dark (spill -12px).
- **render-dm-phone-718.js (measured):** exit 0, 88 PASS. It is blind to the BLOCKER above: it has no code-span cell.
- **No em dashes (measured):** 0 in added lines, for the literal character and for its HTML and escape spellings, with a positive control that returned 1.
- **Not re-measured:** the plan's mutation claim (the wrapper check goes red with pjRoomPara forced to `<p>`). Reasoned consistent with the base DOM above, where the table is outside its wrapper.
