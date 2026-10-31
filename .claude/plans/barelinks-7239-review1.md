# barelinks-7239 review, round 1 (blind CTO lens)

Branch `barelinks-7239`, HEAD 675ffd1a1d, reviewed as `git diff origin/main...HEAD`. Line numbers are the branch's
`web/index.html` unless named otherwise.

Counts: 1 BLOCKER, 3 WARNING, 5 NIT.

## [BLOCKER] The bare-address arm runs before the cited-file chip, so a listed project file loses its "Show me" chip

`web/index.html:72981-72988` (the new arm) sits above `web/index.html:73024` (the `hasNames` cited-file chip) inside
pjRichSpans' token pass.

Failure, MEASURED: `pjRichSpans('see brand.ai and requirements.in', new Set(['brand.ai','requirements.in']))`
- origin/main: `<span class="ref">brand.ai<button class="refgo" ... data-ref="brand.ai">Show me</button></span>` (and the
  same for requirements.in).
- this branch: `<a class="xlink" href="https://brand.ai" target="_blank">brand.ai</a>` (and `https://requirements.in`).

So in a project room (pjRoomBody passes PJ_DOC_NAMES), an agent citing a project file whose name ends in a listed ending
(an Illustrator `logo.ai` in a design project, `requirements.in`, `socket.io` as a folder name, `notes.dev`) used to get
an openable chip and now gets a link to a stranger's website. That is a regression of a shipped feature, and it also
contradicts the card ("file names stay plain"). pjLinkPaths already gets the order right (chip first, then pjInline),
which is why a fenced block's label keeps its chip; the token pass does not.

Fix: in the token pass, when `hasNames`, try pjCiteKey first and only fall through to the bare arm when it returns null
(move the bare block below the `hasNames` block, keeping the https arm where it is). Add a unit test with a `names` Set
holding `brand.ai` that asserts the chip and no `xlink`, and seed PJ_DOC_NAMES in the browser check's room half (see the
NIT on the check) so the painted room covers it.

## [WARNING] The endings list still links everyday file names and code members the card says stay plain

`web/index.html:72824-72826`.

MEASURED, in both pjInline and pjRich, each of these is now a link: `requirements.in`, `MANIFEST.in` (`https://MANIFEST.in`),
`Makefile.in` (Python and autotools file names; `in` is on the list), `logo.ai` / `brand.ai` (Illustrator files),
`settings.dev` / `config.dev` (Django-style settings modules), `self.me`, `list.at`, `done.it` (a sentence with the space
missed), `e.g.com`. The comment explicitly drops `info`, `store`, `page` for the same reason, so `in` is an outlier; `ai`
and `dev` are harder because real hosts use them (claude.ai, which the Kosmos band already names).

Fix: drop `in` (a real `.in` host is rare in agent text, and the false positive is a common file name). For the
endings that are both real hosts and common extensions or members (`ai`, `dev`, `me`, `at`, `it`, `no`, `co`), link
only with a stronger signal: two or more labels before the ending (`www.x.ai`, `docs.x.dev`), a path, or a port.
Put simply: a single-label host with an ambiguous ending links only with a path, a port or `www.`. That keeps
`claude.ai/settings` and `www.claude.ai` and loses bare `claude.ai`, which is the trade to decide and record. Plus the
BLOCKER's chip-first ordering for listed files. Whatever is chosen, add `requirements.in`, `logo.ai`, `settings.dev` to the look-alike
list in `web.links-everywhere.test.js` and the browser check, so the rule is pinned by what it refuses, not only by
what it accepts. Weakest premise of this finding: how often agents actually write these unquoted in prose; files in
backticks are already safe.

## [WARNING] A fenced code block's source label is now linked as a website

`web/index.html:72802` (`pjLinkPaths(label, names)`) reaches pjInline, which now runs pjBareWeb.

MEASURED: `pjBody('```Makefile.in\nx\n```', new Set(), null)` gives
`<div class="codesrc"><a class="xlink" href="https://Makefile.in" ...>Makefile.in</a></div>`. On main this label was
plain text. The label is path-shaped by construction (the code just above requires a dot or slash and no
whitespace), so it is a file name every time, never a web address. Same for `deploy.dev`, `art.ai`, and any label when
the room has no doc names (pjLinkPaths returns `pjInline(raw)` at 72522).

Fix: give pjLinkPaths (or the codesrc call) a way to skip the bare arm, for example a second parameter
`pjInline(text, { bare: false })`, used from pjLinkPaths; message prose still gets bare links. Add a unit case for a
fenced block labelled `Makefile.in`.

## [WARNING] A bare address as a markdown link target is shown plain

`web/index.html:72950-72960`: the `[label](url)` handler links only `https?://`; anything else is held as text.

MEASURED: `pjRich('[site](example.com)')` gives `site (example.com)` with no anchor, while the same address bare in a
sentence is now a link. Agents write `[the dashboard](meridianworks.kosmosplus.com)` routinely; this is the card's
own example in the form a markdown-writing agent most often produces it, and it renders as the one place the address
is dead.

Fix: in that handler, `const web = /^https?:/.test(u) ? u : pjBareWeb(u)`; if `web`, hold an anchor with
`href="' + web + '"` and the shown text `u`. Unit case: `[site](example.com)` has `href="https://example.com"`.

## [NIT] Quadratic token regexes now run on the fast path and in pjInline

`web/index.html:72843` (`/^(\(?)(.*?)([.,;:!?)\]]*)$/`) and `web/index.html:73085-73086` (`.replace(/[.,;:!?)\]*~]+$/, '')`).

MEASURED, one token of N dots then a letter: branch pjInline/pjRich take 14 ms at 5,000, 195 ms at 20,000, about
1,200 ms at 50,000; origin/main takes 0 to 1 ms for all, because any text without a marker took the `esc` fast path.
The same shape already exists on main's slow path (MEASURED: main pjRich with an `*b*` marker plus the same token,
1,233 ms), so this widens an existing weakness rather than adding a new one, and the trigger is a single 20k-character
punctuation run. Repaints happen on every poll, so one such message would stall the thread each time.

Fix (cheap): skip tokens longer than, say, 2,048 characters in the bare checks (no real address is that long), or
replace the lazy-plus-trailing-class split with a linear trailing-punctuation scan.

## [NIT] Quotes, angle brackets and possessives around an address defeat it; a closing quote splits an entity

MEASURED: `"example.com"`, `'example.com'`, `<example.com>`, `example.com's`, `_example.com_` stay plain.
`pjRich('see example.com/a" now')` gives `<a href="https://example.com/a&quot">example.com/a&quot</a>; now`: the
trailing-punctuation peel takes the `;` of the escaped `&quot;`, so the link carries a `"` and a stray `;` is shown after
it (the https arm has the same pre-existing behaviour). Not a security problem (see Clean). Fix: peel a leading and
trailing `&quot;` / `&lt;` / `&gt;` / `'` as whole units, both in pjInline and in the token pass.

## [NIT] A closing parenthesis inside a path is cut off

MEASURED: `en.wikipedia.org/wiki/Foo_(bar)` links to `.../Foo_(bar` with `)` outside. Pre-existing for https:// too.
Fix: only peel a trailing `)` when the core has no unmatched `(`.

## [NIT] README row is wrong and garbled

`docs/browser-checks/README.md:665`: says "Reds on main (4)"; MEASURED 7 FAIL lines against origin/main's
`web/index.html` (the plan says 7). And "The room half is in the room bubble body (pjRoomBody) is read the same way." is
two sentences fused. Fix: "Reds on main (7). The room half reads a room bubble body (pjRoomBody) the same way."

## [NIT] The browser check's room half cannot see the room-only interplay

`docs/browser-checks/render-barelinks-7239.js` room block: calls `pjRoomBody(..., { id: 'p', agents: [] })` with
PJ_DOC_NAMES as the page leaves it, and appends the HTML to a synthetic div. So the cited-file chip (the BLOCKER) and the
@mention chip are never in play, and the room path is the one where they live. Fix: set `PJ_DOC_NAMES = new Set(['brand.ai'])`
and pass one agent, put `brand.ai` and `@april` in the text, and assert a chip, a mention span and no xlink on either.
Painting through paintRoom would be stronger but is not required (reasoned: paintRoom draws bubbles through
pjRoomBody).

## Checked and found clean

- XSS, href breakout, MEASURED in Chromium: an anchor built exactly as the branch builds it, with
  `href="https://example.com/x&quot;onmouseover=alert(1)&lt;b&gt;"`, parses to one href attribute (attributes
  `class, href, target`), the value containing the literal `"` and `<b>`; no new attribute. Also the split-entity
  form `href="https://example.com/a&quot"` decodes to `a"` inside the value. Character references cannot end an
  attribute value. pjInline escapes both href and text with esc (which covers `& < > "`, MEASURED by reading esc at
  23053), and the scheme is always the literal `https://`, so no `javascript:` path. REASONED plus measured.
- pjRich's core is already escaped and pjBareWeb's host part is `[A-Za-z0-9-]` only, so an entity can only sit in the
  path, where it stays escaped in both href and text. MEASURED `example.com/a&b=1` gives `href=".../a&amp;b=1"`.
- Placeholder sentinel: pjBareWeb's path class excludes U+FFFC and the host cannot hold it, so a token with held code
  in it (`` example.com`/x` ``, `` `foo`.example.com ``) is not linked and no placeholder lands in an attribute. REASONED
  from the regex; the code-span case MEASURED in the unit test (`run \`example.com\` now` has no anchor) and a fenced
  block MEASURED plain in both pjRich and pjBody.
- Look-alikes the card names: `notes.md`, `0.7.70`, `store.ROOT`, `Kosmos.app`, `logger.info`, `a@b.com`, IPs
  (`192.168.1.1`, `127.0.0.1:8080`), `localhost:3000`, `arr.at(-1)`, `i.e.`, `e.g.`, `done.Next`, `EXAMPLE.COM` all stay
  plain. MEASURED.
- Wanted forms link: `www.example.com:8080/x?q=1#f`, subdomains, `(example.com)`, `**example.com**` (bold wraps the
  link), trailing `. , ? )` kept outside, `GitHub.com`. MEASURED.
- Fast path consistency: the fast-path predicate peels the same lead and tail as the slow path, and markers that would
  differ (`*`, `~`) already force the slow path. REASONED. Non-link text through pjInline's new split path is
  `esc` per token, which concatenates to `esc(raw)`. REASONED.
- Guarded `typeof pjBareWeb === 'function'`: pjBareWeb is a top-level function declaration in the same script, so in
  the page the guard is always true; it only matters for lifted tests. The real call sites are pjInline, the token
  pass and the fast path; every message renderer reaches one of them (dmRow 41462, room/rows 41537, 41799, 78412,
  task detail 68930 via pjRich; room bubbles via pjBody/pjRichSpans; codesrc via pjLinkPaths). No real caller is left
  unwired. MEASURED by grep of call sites.
- Kosmos band (`m.kind === 'kosmos'`, 41416) keeps its vendor-only https linkifier and does not get bare links: correct,
  it quotes screen text. The composer mirror (pjMentionHighlightHTML, 77442) is input, not a message. Link previews
  (server `withPreviews` / `unfurl.firstLink`) stay https-only, so a bare address gets a link but no preview card; I
  think that is right (the board should not fetch a guessed host), and it is not in the card's ask. REASONED.
- Native: Mac `createWebViewWith` (native-app/main.swift:4498) sends an http(s) target=_blank to `NSWorkspace.shared.open`
  outside connect mode; Windows `OnNewWindowRequested` (tools/windows/KosmosLauncher.cs:4137) opens a non-board address
  with `OpenInPersonsBrowser`. No native change needed. REASONED from source.
- iPhone decision: `ios/Kosmos/BoardLogic.swift:450` runs NSDataDetector over the bubble text, keeping web links only,
  so bare addresses already link there. Agree with not changing it on this card; the http-vs-https and `logger.info`
  differences are honestly recorded in the plan. REASONED from source (did not run the iOS app).
- New browser check: `cd <wt> && HEADED=0 node docs/browser-checks/render-barelinks-7239.js` exit 0, 12 PASS. Against
  origin/main's `web/index.html` (scratch copy) exit 1 with 7 FAIL lines, so it can fail. MEASURED.
- Wiring: `render-barelinks-7239` in gated.txt and the README; `tools.browser-checks-wired.test.js` +
  `browser-checks-pr-select-4119.test.js`: 42 pass, 0 fail, exit 0. MEASURED.
- Unit tests: `web.links-everywhere.test.js` 11 pass, exit 0; all 14 root test files that mention pjRich, pjInline,
  pjBody, pjRoomBody, pjLinkPaths or dmRow (`grep -lE`): 508 pass, 0 fail, exit 0. MEASURED. Lower bound: a test that
  reaches these renderers by another name was not selected.
