# barelinks-7239 review, round 2 (blind CTO lens)

Branch `barelinks-7239`, HEAD 871bca399f, reviewed as `git diff origin/main...HEAD` (origin/main fetched; the branch is
0 commits behind and `git merge-tree` is clean). Line numbers are the branch's `web/index.html`.

Counts: 0 BLOCKER, 1 WARNING, 4 NIT.

## [WARNING] A cited project file in quotes, parens, bold, italics or with 's is now a link to a stranger's website

`web/index.html:73057` (the bare arm in pjRichSpans' token pass), with the chip check just above it.

Round 1's BLOCKER fix holds for the naked token only. The chip check matches `core`, which peels the tail but not a
lead and not `'s`, so any wrapped spelling misses the chip and falls through to the bare arm, and pjBareSplit (which
does peel wrappers) links it.

MEASURED, `pjRichSpans(c, new Set(['brand.io','site.com']))`:
- `see brand.io now`: chip (fixed, as round 1 asked).
- `see "brand.io" now`, `see (brand.io) now`, `see **brand.io** now`, `see _brand.io_`, `see <brand.io>`,
  `see brand.io's logo`: each is now `<a class="xlink" href="https://brand.io">brand.io</a>`.
- origin/main, same inputs: plain text every time (`<strong>brand.io</strong>`, `&quot;brand.io&quot;`, ...).

So in a project room an agent that writes `**socket.io**` or `(brand.io)` about a folder or file in the project sends the
reader to an outside site, which is the round 1 BLOCKER's harm in its commonest dressed form: agents bold file names
routinely. Only names with a listed, unambiguous ending are exposed (io, com, net, org, de, tv, ...), which narrows it,
hence WARNING rather than BLOCKER.

Fix: in the bare arm, when `hasNames`, decode `bare.core` (the same `&amp;|&lt;|&gt;|&quot;` decode the chip uses) and
run pjCiteKey on it first; when it names a listed file, return
`bare.lead + hold(<the same ref chip markup, core>) + bare.tail` instead of a link. That also gives wrapped cited files
the chip they never had. Unit case: `**brand.io**` and `(brand.io)` with `brand.io` in names give a `.ref` chip and no
`xlink`; extend the browser check's room text with `**brand.io**`.

## [NIT] The trailing-punctuation peel still splits `&amp;` and `&lt;`, so a stray `;` is shown

`web/index.html:72849` (pjBareSplit's tail pattern) on escaped text from pjRichSpans.

Round 1 asked for entities to be peeled as whole units; `&quot;` and `&gt;` now are, `&amp;` and `&lt;` are not, so the
tail takes their closing `;`. MEASURED in Chromium through pjRich and pjRoomBody, then parsed by the DOM:
- `see example.com/a& now` shows `see example.com/a&; now` (link text `example.com/a&`, then a `;` that was never typed).
- `see example.com/a< now` shows `example.com/a<;`.
- `x example.com/a&. y` shows `example.com/a&;.`.
The href is still well formed and safe (the HTML parser decodes `&amp` and `&lt` without a semicolon), so this is a
visible typo, not a security issue; the https:// arm has the same pre-existing behaviour. Inputs are rare.

Fix (also simplifies the function): make pjBareSplit raw-text only. In pjRichSpans decode the token first, split the
raw token, and `esc()` lead, core and tail on the way out (href `esc(bare.web)`), exactly as pjInline already does. The
token has no U+FFFC at that point (checked on the line above), so nothing held is disturbed. The `&quot;`/`&lt;`/`&gt;`/
`&#39;s` alternatives can then go from both patterns.

## [NIT] The fast path now does quadratic work on every dotted message, per repaint

`web/index.html:73111` (the fast-path guard) and `web/index.html:72849` / `72851` (the unanchored tail pattern and the
`)` loop that re-splits the core each turn).

The 2048 cap bounds one token, not a message. MEASURED (node, lifted functions): one 2040-character dot token costs
about 8 ms in pjBareSplit; a message of 50 such tokens costs 399 ms in pjRich with no address in it at all, where
origin/main returned `esc(raw)` in 0.4 ms (same input). With an address added it costs 773 ms; origin/main's slow path
on the same tokens costs 197 to 242 ms, so the branch roughly triples an existing weakness and moves it onto the path
every plain message takes. Pathological input only (about 100 KB of punctuation runs), hence NIT; repaints run it on
every poll.

Fix: scan the tail with a backwards character loop (linear) instead of the unanchored `(...)+$` regex, count `(` and
`)` once instead of re-splitting inside the while loop, and lower the token cap to something like 512 for the fast-path
probe only.

## [NIT] pjInline's bare arm is unreachable from the page

`web/index.html:72864` and the bare branch below it.

MEASURED by grep: pjInline's only callers in `web/index.html` are the five calls in pjLinkPaths (72522 to 72554), and all
five now pass `{ bare: false }`. So the bare arm, the `opts` parameter and the widened fast-path test in pjInline exist
only for `web.links-everywhere.test.js`, whose `pjInline` assertions read as coverage of a message surface that does not
use them. Not wrong, just dead weight on the most-shared render helper.

Fix: drop the bare arm and `opts` from pjInline (pjLinkPaths then needs no change at all), and drop the pjInline half of
the unit test, keeping the pjRich and pjRichSpans halves. Or, if the arm is meant for a future caller, say so in the
comment.

## [NIT] A markdown link whose label is the address is now two links, and a few code names still link

`web/index.html:72987` (`label + ' (' + shown + ')'`): the label is left as text, so the token pass now bare-links it.
MEASURED: `[example.com](https://example.com)`, the commonest form agents write, renders
`<a>example.com</a> (<a>https://example.com</a>)`; on origin/main the label was plain. With a label like
`docs.example.com` and a longer target the two links go to different places. Fix: when the label itself is a bare
address (pjBareSplit(label) covers the whole label), hold it as plain escaped text.

Also MEASURED, still linked (judgement calls, recorded so they are chosen rather than missed): `hello.world`, `this.io`,
`app.settings.dev` (a subdomain counts as the stronger sign, so a three-part Django settings module links), `e.g.com`,
`1.2.3.com`; and a path's trailing `_` and `'s` go outside the link (`example.com/foo_bar_` links to `.../foo_bar`,
`example.com/it's` to `.../it`), where the https:// arm keeps a trailing `_` on purpose. Curly quotes and a trailing
ellipsis (`“example.com”`, `example.com…`) stay plain. None needs a change for this card.

## Checked and found clean

- Round 1 fixes, MEASURED: naked cited file keeps its chip (`see brand.io now`, and `docs/brand.io`); `requirements.in`,
  `logo.ai`, `settings.dev`, bare `claude.ai` stay plain while `claude.ai/settings` and `www.claude.ai` link;
  pjLinkPaths labels (`Makefile.in`, `deploy.dev`, `example.com`) never link; `[site](example.com)` links to
  `https://example.com` and `[x](claude.ai)` does not; `(en.wikipedia.org/wiki/Foo_(bar))` keeps its `)` inside and the
  outer one outside; `"example.com"`, `<example.com/path>`, `example.com's` put the wrapper outside the link.
- Unit tests, MEASURED: `node --test web.links-everywhere.test.js web.pjbody-fence-3685.test.js web.agent-answers.test.js`
  exit 0, 29 tests, 29 pass.
- Browser check, MEASURED: `render-barelinks-7239.js` exit 0, all 14 PASS on the branch; the same check against
  origin/main's `web/index.html` (scratch copy) exit 1 with 7 FAIL, matching the README row.
- Href and markup safety, MEASURED in Chromium (pjRich and pjRoomBody, output parsed by the DOM): `example.com/"onmouseover=alert(1)`,
  `"><img src=x onerror=alert(1)>.com`, `x.com/&quot;y`, `example.com/&#39;x`, `example.com/a"b` produce no img, no
  onerror/onmouseover attribute, every anchor has exactly 4 attributes, and the quote sits inside the href value as
  data. The scheme is always the literal `https://`. Lead and tail are only ever taken from the token's ends, so they
  cannot move a quote into the href; they can take characters off an address's end (the `_` and `'s` in the last NIT),
  never off its host. A host cannot hold `&`, so no entity can be split at the lead.
- ReDoS, MEASURED: pjBareWeb on 1,020 labels and on a 2,000-character label run: under 0.1 ms (labels are dot-delimited,
  so `(?:label\.)+` cannot backtrack across them). pjBareSplit's lead pattern is anchored and linear; its tail pattern is
  quadratic but capped (worst 10 ms per token at the cap, `)` loop 20 ms at 1,000 parens), covered by the NIT above.
  No exponential case found.
- Surfaces, MEASURED in Chromium: tables (`| a | example.com |` links in the cell), bullet and numbered lists, headings,
  block quotes, `**bold**`, `_italic_`, `~~strike~~` around an address, an address beside a code span, and code spans
  holding an address (not linked) all render through pjRich and pjRoomBody without a page error. @mention chip and the
  cited-file chip in the room: the browser check's room half (PASS). Task detail (68930), project list (41799), DM rows
  (41462, 41537, 78437) all call pjRich, REASONED from grep, so they inherit the same results.
- Fast path vs slow path, REASONED: the fast-path probe runs pjBareSplit on raw tokens and the slow path on escaped ones;
  every disagreement found only changes which path renders text with no link in it, whose output is the same escaped
  text, so no link is lost or gained by the probe.
