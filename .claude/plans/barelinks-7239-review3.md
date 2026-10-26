# barelinks-7239 review, round 3 (blind CTO lens)

Branch `barelinks-7239`, HEAD caab43ab7b, reviewed as `git diff origin/main...HEAD` (origin/main fetched: the branch is
0 commits behind and `git merge-tree --write-tree origin/main HEAD` exits 0). Line numbers are the branch's
`web/index.html`.

Counts: 0 BLOCKER, 0 WARNING, 2 NIT.

Round 2's fixes hold (details under "Checked and found clean"). The two NITs are both about edges the round 2 fixes
reach but do not fully cover; neither needs to block the card.

## [NIT] The bare arm's chip check matches a web address with a path by its last segment, and skips the `..` guard

`web/index.html:73062` (`const key = hasNames ? pjCiteKey(bare.core, names) : null;`).

pjCiteKey matches any trailing run of path segments and its own comment (72480) says a `..` segment "was refused before
this is called"; the original chip arm honours that (73045 `!core.includes('..')`), the new bare arm does not. So a bare
address with a path whose last segment is a listed project file becomes a Show me chip for the local file instead of a
link, and a `..` path now chips too.

MEASURED, `pjRichSpans(text, new Set(['brand.io','notes.md','README.md','secret.md']))`:
- `see example.com/../secret.md now`: branch `<span class="ref">example.com/../secret.md<button ... data-ref="secret.md">`;
  origin/main plain text. The naked token skips the first chip arm because of `..`, then the bare arm chips it with no
  guard.
- `see "github.com/o/r/blob/main/README.md" now` and `(…README.md)`: branch chips the local `README.md`; origin/main
  plain. So in a project with a README, an agent quoting a GitHub page sends the reader to the local file, where the
  card's intent is a link.
- `see github.com/o/r/blob/main/README.md now` (naked): chips on both main and branch, because the first chip arm runs
  before the bare arm. Pre-existing, recorded so it is chosen rather than missed.

Harm is small: the chip key is always a listed name, so this is never traversal or an outside site, only the wrong
target. Hence NIT.

Fix: in the bare arm, chip only when the address has no path (`!bare.core.includes('/')`, which keeps round 2's dressed
`brand.io` and the bare-name subfolder rule) or when `key === bare.core` (a folder actually named like a host). Optionally
apply the same "host with a path links unless the whole path is listed" rule in the first chip arm to settle the naked
case too. Unit case: `"github.com/o/r/blob/main/README.md"` and `example.com/../secret.md` with those names give an
`xlink`, no `.ref`; `**brand.io**` still gives the chip (CONTROL).

## [NIT] A markdown link label that only CONTAINS an address is still a second link, sometimes to a different place

`web/index.html:72987` (`lb && !lb.lead && !lb.tail ? hold(label) : label`).

Round 2's fix holds the label only when the whole label is the address. Any dressing lets the token pass link it.
MEASURED through pjRich:
- `[**example.com**](https://e.com)` gives `<strong><a href="https://example.com">example.com</a></strong> (<a href="https://e.com">…)`.
- `[example.com.](https://e.com)` and `[see example.com](https://e.com)`: same shape, two links, two destinations.
- origin/main: the label is plain in all three.

The exact form (`[example.com](https://example.com)`) is fixed, and that is the common one, hence NIT.

Fix: treat the label as text that is never autolinked: e.g. run the label through a local version of the emphasis
replacements and `hold()` the result, or mark label tokens so the bare arm skips them. Unit case: the three inputs above
give exactly one anchor each.

## Checked and found clean

- Decode-split-escape round trip, REASONED then MEASURED. Every caller of pjRichSpans and pjRich (41462, 41537, 41799,
  68930, 72659, 72710, 72720, 72722, 72723, 73167 to 73176, 78449) passes raw text, so the token is `esc()` output and
  the only entities in it are the four esc makes. The decode is one left-to-right pass, so `decode(esc(r)) === r` for
  every r, including a typed `&amp;`, `&lt;` or `&#39;` (they come back as typed, and `&#39;` is never decoded, since
  esc never makes it). Each piece is then `esc()`'d, so the output is what esc would give for the same characters.
  MEASURED by a fuzz (scratch harness lifting the real functions from the branch and from origin/main): 354,548 random
  messages built from addresses, entities (`&amp;`, `&#39;`, `&lt;`, `&quot;`), quotes, curly quotes, `'s`, brackets,
  parens, emphasis marks, backticks, markdown links and newlines, with and without doc names. Visible text (tags and the
  Show me label stripped, `<br>` as a newline, emphasis marks ignored) is identical to origin/main in every run: 0 diffs.
- Held spans and the emphasis pass, MEASURED: a second fuzz of 400,000 renders (189,524 anchors) found 0 anchors not of
  the exact shape `<a class="xlink" href="https://…" target="_blank" rel="noreferrer noopener">`, 0 bare `&` in an anchor
  tag, 0 tags outside `a/em/strong/s/br/code/span/button`, 0 `<img`/`onerror`/`onmouseover`, and 0 leaked U+FFFC
  placeholders. By hand: `*x*`, `_x_`, `__x__`, `~~x~~`, `**x example.com** y` and `*see example.com*` wrap the held link
  correctly; a trailing `_` stays outside. The lead and tail are escaped text with no `*`, `_` or `~` added, so the
  emphasis regexes see what they saw on main.
- Held label (round 2): `hold(label)` only fires when pjBareSplit accepts the whole label, and pjBareWeb's pattern
  excludes U+FFFC, so a label holding a code-span placeholder can never be held inside another hold (REASONED, and the
  fuzz included code spans in labels with 0 leaks).
- Dressed cited file gets a chip, MEASURED: `**brand.io**`, `(brand.io)`, `"brand.io"`, `brand.io's` give the `.ref` chip
  and no `xlink`. `**notes.md**` and `(notes.md)` render exactly as on origin/main (`notes.md` has no web ending, so the
  bare arm never sees it), so no existing chip behaviour changes; only host-shaped names change, from plain text to a
  chip. No existing test asserts the old plain form: the renderer suites below pass.
- Unit tests, MEASURED: `node --test` over web.agent-answers, web.dialog-md-2701, web.links-everywhere,
  web.list-depth-3679, web.mention-live, web.pjbody-fence-3685, web.quoteb, web.selfname-4873: exit 0, 97 tests, 97 pass.
  server.test.js lifts pjRichSpans without pjBareSplit (10053 to 10151), so the `typeof` guard keeps it on main's path
  (REASONED, not run).
- Browser checks, MEASURED: `render-barelinks-7239.js` exit 0, 14 PASS; `render-richtext-room-2239.js` exit 0, 84 PASS;
  `render-docs-subfolders-2245.js` exit 0, "14 passed, problems: none".
- Round 2 perf NIT, MEASURED (pjRich, ~100 KB messages, no address): 200 tokens of 511 dots 2.1 ms (origin/main 0.1),
  200 paren-heavy tokens 2.5 ms, 200 `'s` runs 0.1 ms, 200 511-character label runs 0.5 ms, one 100 KB token 0.9 ms.
  Round 2 measured 399 ms for a comparable input. Fixed.
- pjInline and pjLinkPaths: no hunk in the diff, byte-identical to origin/main (MEASURED by `git diff`); the unit test
  confirms pjInline and pjLinkPaths labels never link.
- The 512 cap: a bare address longer than 512 characters stays plain while pjBareWeb accepts up to 2048. Bare (no
  scheme) addresses that long are rare and the https:// arm is uncapped, so no change asked (REASONED).
