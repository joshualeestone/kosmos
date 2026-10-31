# mdtable-7214 review, round 2 (blind, CTO lens)

Branch mdtable-7214 at 2c43009966, reviewed against origin/main. Scope: the whole branch diff (web/index.html pjRoomPara
and the two #pj-room table rules, render-richtext-room-2239.js, mobile-shots.js room-table-7214).

Method: a scratch harness (outside the worktree) boots the board from the worktree, opens a real room, and either posts
real messages or paints pjBody output into a clone of a real agent bubble twice, once as main does
(`'<p>' + pjBody + '</p>'`) and once through the branch's pjRoomPara, at 1280 and 393 wide. Everything marked
"measured" below came from that harness or from running the named check.

## Findings

### [BLOCKER] Two tables in one post now render side by side and read as one table

web/index.html:74792-74794 (flush drops a run with no text) together with web/index.html:7897-7898
(`.msg-b .mdtablewrap { display: inline-block; ... }`).

A post with two tables separated by a blank line produces `<span class="mdtablewrap">...</span><br><br><span
class="mdtablewrap">...</span>` from pjBody. The run between them is only `<br><br>`, so flush() drops it, and the two
inline-block wrappers end up adjacent with nothing between them. They sit on the same line.

Measured, real posts in a real room ("Two tables\n\n| a | b |...\n\n| c | d |...\n\nend"):
- 1280: wrappers at left 795 and 848, both top 464. 393: left 194 and 247, both top 570.
- On main the same post stacks them (both left 848, tops 381 and 464).
- Screenshot: the two 2-column tables paint as one 4-column table, headers `a b c d`, row `1 2 3 4`. A reader cannot
  tell there were two tables. This is the most common multi-table shape an agent writes (a status table, then a
  results table).

The same happens for a table directly followed or preceded by any other inline-block thing with only blank lines
between, but two tables is the one that changes meaning.

Fix: do not drop a whitespace-only run that sits BETWEEN two blocks. Emit its markup raw (the `<br>`s, not wrapped in
a `<p>`), which reproduces main's spacing and stacking; only drop such runs at the start and end of the body. Or give
the room wrapper `display: block; width: fit-content` (`#pj-room .msg-b .mdtablewrap`), which stacks them but loses
the blank line main had. Add a two-table post to render-richtext-room-2239.js asserting the wrappers' tops differ.

### [WARNING] A horizontal rule next to a block is silently deleted

web/index.html:74793 (`if (run.textContent.trim() || run.querySelector('img'))`)

A rule is `<span class="mdhr"></span>`: no text and no img, so a run holding only a rule (and its `<br>`s) is
treated as empty and dropped. Measured, `.mdhr` count main vs branch:
- fence, `---`, fence: 1 vs 0
- text, table, `---` at the end: 1 vs 0
- text, fence, `---` at the end: 1 vs 0

Failure scenario: an agent separates sections with `---` between two code blocks, or ends a post with a table and a
rule. The rule disappears with no trace.

Fix: keep a run when it has text OR any element other than `<br>`: `run.textContent.trim() ||
run.querySelector(':not(br)')`. That also covers the img case and any future textless inline (an icon chip).

### [WARNING] The 12ch floor widens every short code cell, so Josh's own shape now scrolls on a phone, and small tables that fitted now scroll

web/index.html:7910 (`#pj-room .mdtable td:has(> .mdc) { min-width: 12ch; }`)

`min-width` applies whatever the content length, so a cell holding `ok` is forced to 113px (12ch plus padding).
Measured, wrapper clientWidth vs scrollWidth, branch with the floor vs the same branch with the floor disabled:

| table | width | with floor | floor off |
|---|---|---|---|
| Josh's shape (file name + hash, both in code spans), real post | 393 | 209 / 228: scrolls 19px | fits, 209 |
| 3 columns of `ok`/`no`, real post | 393 | 209 / 341: scrolls | fits, 124 wide |
| 8 columns, a word then 7 code flags | 1280 | 523 / 820: scrolls on desktop | fits, 314 |
| 4 cols, code ids + words + a path + a hash | 393 | scrolls, 420 | fits, 209 (hash in 22 pieces) |

So the card's exact shape on an iPhone 15 still needs a sideways scroll (the file-name cell matches `td:has(> .mdc)`
too, and two 113px floors exceed the 209px bubble). The card comment ("Josh's table fits without a scrollbar, on a
phone too") is no longer true. The check passes because it asserts spill, piece counts and a minimum column width,
never that Josh's table does not scroll.

Fix, pick one and say it on the card:
- Apply the wrap and the floor only to long code spans. pjRoomPara already holds the parsed body, so it can tag a
  table `.mdc` whose text is longer than about 12 characters (`mdc-long`) at no extra parse cost, and the CSS becomes
  `#pj-room .mdtable .mdc-long { overflow-wrap: anywhere }` plus `td:has(> .mdc-long) { min-width: 12ch }`. Short
  flags then size to their content, and the short-names table still keeps names whole.
- And/or lower the floor so two long-code columns fit a phone bubble (10ch measures about 97px a cell, two fit in
  209px and still pass the check's 80px floor).
Add an assertion that Josh's shape does not scroll at 393 (`scrollWidth <= clientWidth + 1`), or, if scrolling is the
accepted outcome, correct the card.

### [NIT] A code block that starts with a blank line loses it

web/index.html:74797 (`out += n.outerHTML` for a `figure.codeb`)

The parser drops one newline right after `<pre>`. main parses pjBody's string once; the branch parses it in the
template and again when the serialised string is set as innerHTML, and Chrome's serialiser does not add the newline
back. Measured: a fence whose code starts with two blank lines shows `"\nfoo"` on main and `"foo"` on the branch.
Rare and cosmetic, but it changes code content.

Fix: when a block is or holds a `pre` whose text starts with `\n`, emit `<pre>\n` before it (the standard guard), or
have pjBody always write `<pre>\n` so both parses eat the guard and keep the content.

### [NIT] The unit tests that load pjRoomBody never exercise pjRoomPara

web/index.html:74785-74788 against web.quoteb.test.js:39-41

web.quoteb.test.js stubs `document` with a Proxy, so `document.createElement('template')` returns the proxy and
`[...t.content.childNodes]` is empty. pjRoomPara therefore always returns `'<p>' + html + '</p>'` there. Measured: that
harness renders a table post as `<p>x<br><br><span class="mdtablewrap"><table ...></span></p>`, the exact defective
shape. Nothing fails today, but no unit test can see a regression in pjRoomPara; only render-richtext-room-2239.js can.

Fix: none required if the browser check is the accepted guard. Say so in the pjRoomPara comment, or add a small jsdom-
free unit test of the splitting rule by passing pjRoomPara a minimal fake template.

### [NIT] The plan's "Built" section describes the round-0 approach

.claude/plans/mdtable-7214.md, "## Built"

It still says a block body goes in `div.msg-p` and lists `.msg .mdtablewrap { overflow-wrap: normal }`, neither of
which is in the branch. The Review section describes the real approach. The card's design-shot comment also still says
"A post that holds a table ... is no longer a paragraph". Fix: rewrite Built to match, and update the card when the
shots are retaken.

## Round 1 findings, rechecked

- BLOCKER (`.mdc` wrap on DMs, .pj-msg-text, .tkdetail): fixed. The rule is `#pj-room` only (web/index.html:7909-7910).
  render-richtext-room-2239 short-names table at 393: pieces [2,2,1,1,1,2], table scrolls (measured). The floor it
  added is the new WARNING above.
- WARNING (div.msg-p restyled every code-fence post): fixed by the new approach. Code blocks stay where main put them.
  Measured: fence post `P FIGURE.codeb P`, path label `.codesrc` 13px as on main. The one change is the words after a
  fence: 13px on main, 15px now, matching the words before it. The plan names this; it is consistent, not an accident.
- WARNING (no phone pass, clamped edge check): fixed. A 393px pass exists and asserts wrapper, spill, pieces and a
  column floor. It does not assert "does not scroll" (see WARNING above).
- NIT (block list incomplete): fixed, the list matches the parser's.
- NIT (redundant quote selectors): gone with the CSS revert.

## Checked and found clean

- **Post shapes, main vs branch, 1280 and 393 (measured, cloned real bubble).** Plain post with a mention, a file
  name and a link: identical markup and line positions. Heading + list + rule + text: identical (one `<p>`, no block).
  Josh's shape: main `P TABLE P` with a 7px spill at 393, branch `P SPAN.mdtablewrap P`, spill 0. Table only: main had
  two empty `<p>`s around a loose table, branch is just the wrapper (bubble 15px shorter). Table first / last / tight
  (no blank lines): the text lines land within 2 to 6px of main. Fence only: main `P[0] FIGURE P[0]`, branch `FIGURE`,
  same height. List then table then list: list items kept, in order. No page errors in either width.
- **Quote path (measured).** pjRoomBody with a server quote and a table in the following prose renders
  `P BLOCKQUOTE.quoteb SPAN.mdtablewrap P`, table inside its wrapper. The quote body itself still goes through pjBody
  inside the blockquote, which may hold a table.
- **XSS (measured plus reasoned).** A post with `<img onerror>`, `<script>` in a code span, `"><svg onload>` in a code
  cell, `<b>` in a header cell, a `javascript:` markdown link and a URL with `"`, `&` and `<`: the branch output keeps
  every one escaped (`&lt;img`, `&lt;script&gt;`, `&quot;` in the href, `&amp;amp;` for a literal `&amp;`), the
  javascript: link stays text. Reasoned: pjBody escapes all text and attributes, so the template holds only pjBody's
  own whitelist of tags; a template's content is inert (no script runs, no image loads during the parse); and
  outerHTML re-escapes `&`, `<`, `>` in text and `&`, `"` in attributes, so the round trip cannot turn text into markup.
- **Nested blocks (reasoned from pjProse/pjBody source).** pjBody only ever emits a table, figure or codesrc div at
  the top level of its output; cells, headings and list items hold pjRichSpans only. So checking top-level nodes is
  enough, and no `<p>` run can carry a block descendant that would re-close it.
- **Performance (measured, in page).** 2000 calls of pjRoomPara: 13 to 20ms (about 8 microseconds a post), against
  35 to 59ms for 2000 pjBody calls on a plain post. The template parse is a fraction of the render it wraps; not a
  concern on a long room.
- **Readers of a room post's `<p>` (grep plus run).** msgCopyText and speechTextOfRow add separators after `p` and
  `div` and read tables as before. Browser checks that locate `.msg-bd p`: render-room-msgbox-2806.js run on the
  branch, exit 0, 202 PASS, "all passed". render-unread-edge-3743, render-msgref-4631 and render-room-reply-3745 were
  not re-run by me (the branch's trailer says they pass); their `.msg-bd p` lookups fall back to `.msg-bd`.
- **render-richtext-room-2239.js (measured):** exit 0, 92 checks, all 8 kosmos#7214 lines pass in light and dark.
- **No em dashes in added lines (measured):** 0 for the literal and the entity and escape spellings, positive control 1.
