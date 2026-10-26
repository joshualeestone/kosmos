# mdtable-7214 review, round 3 (blind, CTO lens)

Branch mdtable-7214 at 8955ae8f8f, reviewed against origin/main, with extra attention on the round 2 commit.

Method: a scratch harness outside the worktree (same boot as render-richtext-room-2239.js: real server, fixture
member, real project room) posted real room messages and measured the painted bubbles at 1280 and 393 wide. A second
scratch page ran the template round trip in Chromium, WebKit and Firefox. "Measured" below came from those runs or
from running the named check; "reasoned" came from reading the source.

## Findings

### [NIT] The 10ch floor misses a long code span wrapped in emphasis, so its column is crushed below the floor

web/index.html:7912 (`#pj-room .mdtable td:has(> .mdc-long) { min-width: 10ch; }`)

`>` matches only a code span that is a direct child of the cell. pjRichSpans holds code first and applies emphasis
afterwards, so `**`hash`**` (or `*`...`*`, `~~`...`~~`) renders `<td><strong><code class="mdc mdc-long">`. The span is
still marked long and still breaks anywhere (the class rule has no child combinator), but the floor does not apply.

Measured, real post at 393 (`| File | sha256 | note |` with `| report.pdf | **`<64-char hash>`** | matches the one we
sent |`): the hash column is 72px and the hash breaks into 20 lines, below the 80px the room check treats as the
minimum readable column, and the table still scrolls (209 / 233). The same table without the bold gets the 10ch
column (94 to 102px, 14 lines). Agents do bold a hash or a file name in a status table to mark the one that matters.

Fix: `#pj-room .mdtable td:has(.mdc-long) { min-width: 10ch; }` (descendant, not child). Cells hold only inline spans
(reasoned, from pjBody/pjRichSpans), so the wider match cannot reach anything but a code span inside emphasis.
Optionally add a bold hash cell to the 2239 phone fixture and assert its column is at least 80px.

## Round 2 findings, rechecked

- BLOCKER (two tables side by side): fixed. Measured: the 2239 check passes "two tables stack" in both themes, tops
  591 and 662 at 393. In the scratch harness a table, blank lines, then a fence also stacks, and a post that is only
  blocks (table then fence) renders `SPAN.mdtablewrap FIGURE` with nothing stray around it.
- WARNING (a rule beside a block deleted): fixed. `real()` keeps any run with a non-br element. The check counts one
  `.mdhr` in the two-table post (measured, pass).
- WARNING (12ch floor made Josh's table scroll): fixed. Measured: the 2239 check now asserts `!scrolls` for Josh's
  shape at 393 and passes; hash column 102px.
- NIT (pre loses its first blank line): fixed, and the fix holds in every engine. Measured in Chromium, WebKit and
  Firefox: template parse gives `"\nfoo"`, the doubled newline serialises as `<pre>\n\nfoo`, the second parse gives
  `"\nfoo"`, matching main. None of the three serialisers adds its own newline, so the fix does not overcorrect in
  WebKit (the iOS app's WKWebView).
- NIT (unit tests never exercise pjRoomPara): answered by the new comment at web/index.html:74791-74792 naming the
  browser check as the guard. Accepted.
- NIT (plan Built section stale): fixed, "Built (as of review round 2)" matches the code.

## Checked and found clean

- **A run that is only `<br>` plus whitespace text (reasoned plus measured).** `real()` is false (no text after trim,
  no non-br element; text nodes are not matched by `:not(br)`), so between two blocks it is emitted raw and at either
  end it is dropped. Measured: `table, blank, "   ", blank, fence, blank, "   "` renders `P SPAN.mdtablewrap FIGURE`,
  the trailing whitespace run gone, no empty `<p>`. pjBody emits nothing between a table and a fence, so nothing was
  lost there (same string main wraps in its `<p>`).
- **A post that is only blocks (measured).** Table only: `SPAN.mdtablewrap` alone. Table then fence: wrapper then
  figure. No leading or trailing `<br>`, no empty `<p>`.
- **Adjacent runs (reasoned).** `close()` merges every non-block node into one run until the next block, so two runs
  are never adjacent; a non-real run with `0 < k < last` is therefore always between two blocks.
- **Exactly 16 characters (measured).** `abcdefghijklmnop` (16) is not marked and stays on one line, 147px;
  `abcdefghijklmnopq` (17) is marked and breaks in two in a 94px column. The boundary is where the code says it is.
- **Mixed long and short code at 393 (measured).** `id | file | ok | hash` with `a1`, `kosmos-0.9.12-arm64.dmg`,
  `yes`, a hash: short codes stay whole (41px, 49px), the two long columns sit at the 94px floor, the table scrolls
  (209 / 280). At 1280 it fits (523 / 523). Scrolling here is the accepted #718 outcome when the floors cannot fit.
- **Medium-length names, 17 to 35 characters, at 393 (measured).** `render-dm-phone-718.js` breaks after `render-` and
  `phone-`, `fleet-builders-room` after `fleet-` and `builders-`: Chrome still takes the hyphen breaks first. A path
  (`docs/browser-checks/mobile-shots.js`) also breaks mid-word (`brow|ser`), since `/` is not a break opportunity;
  that is the plan's stated intent for paths, not a defect.
- **A long code span in a header cell (measured).** `| `<hash>` | note |`: the hash wraps, its column is 100px at 393,
  the table fits. th has no floor but the column was not crushed.
- **The pre newline when the pre is nested deeper (reasoned).** `querySelectorAll('pre')` covers every depth, and
  pjBody only ever writes `<figure class="codeb"><pre>text</pre></figure>` (web/index.html around 72711), so the
  first child is always the text node the fix looks at. A fenced block inside prose is `span.mdcb`, not a pre, and
  is untouched. The fix runs only on the block path; the no-block early return passes the original string through.
- **Quoted tables (measured).** A quote's table is rendered by pjBody inside `blockquote.quoteb`, not through
  pjRoomPara, so it gets no `.mdc-long` (0 in the quoted output, 2 in the same table unquoted). It still wraps: the
  quoted hash computes `overflow-wrap: anywhere`, breaks into 8 lines, and the wrapper does not scroll (193 / 193)
  inside a 233px bubble at 393. No regression.
- **Copy, search, speech, quote (reasoned from source).** `.mdc-long` is a class only; it adds no text. msgCopyText
  copies from the record when there is one and otherwise from `textContent` of a clone; speechTextOfRow reads
  `textContent` and replaces `pre`; quotes slice the stored text by offset (pjRoomBody), never the DOM. No code
  selects `.mdc` by exact class name (grep for `className === 'mdc'`, `[class="mdc"]`, `classList.contains('mdc')`:
  zero hits; `mdc-long` appears only in the new CSS and the marking line). The pre text after the round trip equals
  main's, so a copied code block is unchanged.
- **Browser check (measured).** render-richtext-room-2239.js: exit 0, "all good, 98 checks", including the five new
  review-2 assertions in both themes.
- **Unit tests (measured).** web.mention-live, web.quoteb, web.selfname-4873 (every test file naming pjRoomBody,
  pjRoomPara or mdtablewrap): exit 0, 41 tests, 41 pass, 0 fail.
- **Page errors (measured).** None in any harness run.
