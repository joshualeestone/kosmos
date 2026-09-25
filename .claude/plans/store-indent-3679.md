# Stored posts keep their indentation (kosmos#3679)

Angel, 2026-09-24: `engine/chat.js` `storeText` turned every run of spaces or tabs into one
space, at the start of a line and inside ``` fences too, so an agent's code sample or nested
list arrived flat. Doctrine now tells agents rooms show fenced code (#10) and how to send
multi-line messages (#3678), so this is newly reachable.

## Measured first
- `storeText` is the one store shape for both the room (`messages.js` post) and the direct
  thread (`appendMessage`, `messageProblem`). The pane is a separate path (`cleanMessage`,
  one line) and is unchanged.
- `CONTROL` refuses a tab, so a tab cannot simply be kept.
- The room renderer (`pjProse`/`pjBody`) puts fenced code in a `<pre>`, so indentation there
  shows as soon as it is stored. Both renderers (`pjProse`, `pjRich`) drew every list item
  flat whatever its indentation, so a stored nested list would still have looked flat.

## Calls
- STORE: CRLF/CR to LF; a tab to four spaces; inside a ``` fence every line kept as written
  (trailing spaces dropped); outside, leading indentation kept, a run inside a line becomes
  one space, trailing spaces go, three or more newlines become one blank line; the ends trimmed.
- RENDER: a list item gets a depth class (`mdli-d1..3`) relative to the items above it (a
  stack of open indent widths per list, reset by a non-list line), styled as a left margin on
  all four surfaces. So two-space, four-space and tab nesting all step one level. A non-list
  line ends the list only when it is not indented under it, so a fence, table or heading
  nested in an item keeps the depth of what follows. A top-level item's markup
  is byte-identical, which the older richtext checks pin.

## Rejected
- Keeping tabs: `CONTROL` refuses them, and widening `CONTROL` would let a tab reach a pane
  path that has not been measured for it.
- Rendering nested lists as real `<ul>` trees: every list item is a span joined by `<br>`
  today, and a tree would be a renderer rewrite for one card.
- Changing `engine/you.js`'s own multiline clean: a different field with its own tests.

## Weakest premise
Indentation left on the first line ALONE is still trimmed (after the shared indent comes off),
so a message whose first line is deeper than all the rest loses that difference. That is almost
always a stray keystroke, and trimming it keeps "  hello" stored as "hello".

## Verification
- engine/store-indent-3679.test.js: the card's example round-trips; fence contents kept;
  outside collapses still happen; tab to spaces and sendable; unclosed fence; ESC still refused
  and the pane copy still one line; the direct thread record. The old `storeText` reds six of
  seven (the seventh guards the unchanged pane path).
- web.list-depth-3679.test.js: both renderers, depth 1 to 3 and the cap, numbered items, a tab,
  the CSS on every surface. `pjListDepth` returning '' reds six of seven.
- docs/browser-checks/render-richtext-room-2239.js: a Layer 1 nested arm, and Layer 2 posts a
  nested list and indented code through the real server and asserts the painted indent and the
  code's spaces. The old `storeText` reds both Layer 2 arms in both themes.

## Review pass 1 (opus)
- The first validation failed on #1732's Windows-coupling audit: the fence regex held a literal
  backtick, which that scanner reads as opening a template string, so a later comment counted as
  code. The regex spells it `\x60{3}`.
- `messageProblem` measured MAX_TEXT on the stored form, so kept indentation (a tab is four
  spaces) could refuse a DM the room accepts. It now measures the one-line form, as the room
  does; a test pins both sides, and the old check reds it.
- Stale comments fixed in render-talk.js, messages.js and the messageProblem doc.
- Recorded, not changed: the room's code-block split (`pjBody`) takes a fence only at column 0,
  while the store (and `pjRich`) accept an indented one. An indented fence in the room is kept
  verbatim by the store and drawn as prose, so it shows its spaces under pre-wrap. Bounded, and
  aligning the renderer is a separate change.
- Recorded, not changed: depth is two spaces a level, so four-space or one-tab nesting draws two
  levels deep; and an inline item's margin indents only its first line when it wraps. Both are
  presentation, and a real `<ul>` tree is the fix for either.

## Review pass 2 (sonnet)
- CONVENTION fixed: the depth rule's numbers are LIST_DEPTH_SPACES and LIST_DEPTH_MAX, and the
  test reads LIST_DEPTH_MAX to check that a style exists for every depth and for none beyond it.
- Deferred at pass 2, reversed at pass 3: the stored form's size. See pass 3.

## Review pass 3 (opus)
- BLOCKER fixed: `/ +$/` backtracks on a long run of spaces that ends in text (quadratic; 17 s on
  200k spaces here). Trailing spaces now come off with a loop, and so do trailing blank lines
  (`/\n+$/` had the same shape on a fence full of blank lines). A timing test covers spaces,
  tabs and newline runs; the old regex reds it.
- WARNING fixed: trimming the whole message took indentation off the first line only, so a
  block indented as a whole drew its second item as nested. The indentation every line shares
  now comes off first.
- WARNING fixed: the stored form has its own ceiling, STORE_GROWTH (4) times the one-line limit,
  on the DM path and the room post path, so a thread read on every poll stays bounded. (Pass 4:
  agent-to-agent `send()` records the one-line form, so it has no stored-form ceiling.)
- WARNING fixed: a fence line must have no backtick after the opening three, in the store and in
  pjRich, so an inline ```span``` line does not open a fence.
- Duplicate of the recorded pjBody column-0 difference: skipped.
- NIT fixed: the storeText doc no longer claims `\n` is the only control character left.

## Review pass 4 (sonnet)
- WARNING fixed: the ceiling had also been put on `send()`, which records `cleaned`, not the
  stored form, so it could refuse a short message for indentation nobody keeps. Removed there.
- WARNING fixed: a stale `.dm-b` comment still said storeText collapses space runs.
- Recorded, not changed: `quotedSegments` matches an earlier post by its one-line form inside the
  stored text, so a requote of a post with a fence or nested list is not tagged. That is its
  documented fail-safe direction (an unmatched quote is simply not styled).

## Review pass 5 (opus)
- WARNING fixed: the final trim only took ASCII spaces and newlines, so a DM of only a
  non-breaking space (or U+FEFF, U+3000) passed as non-empty and typed a bare Enter. The ends
  are trimmed with the built-in `trim()` again, after the dedent; `\f`/`\v` at the ends go as
  before. Tested for each character.
- WARNING fixed: the stored-form ceiling had reused "keep it to 10000 characters", a limit the
  message is under. It has its own sentence about indentation.
- WARNING fixed: fences follow CommonMark: three or more backticks, no backtick after them, and
  a fence closes only on a bare run at least as long, in the store and in pjRich. So ````md can
  hold a ``` example, and a ```js line inside a fence is content. Four-backtick fences render
  as code again in pjRich (the pass-3 regex had stopped matching them).
- NIT fixed: the timing budget is 3 s (the quadratic case took about 17 s), so a busy machine
  does not flake it.
- Recorded, not changed: the ROOM's code-block split (`pjBody`) is a third fence reader:
  column 0 only, exactly three backticks, and it accepts a backtick in the info string. Where it
  disagrees with the store, stored text is kept (inside a fence by the store's reading) or
  collapsed (outside), and the room draws it by its own reading. Bringing pjBody onto the same
  rule is a room-renderer change of its own.
- Recorded: every tab is four spaces, not the next tab stop; and depth reads raw indentation on
  surfaces the store never touched (a task's detail, an agent reply).

## Review pass 6 (sonnet)
- WARNING fixed: the room's stored-form bound reused "that is a document", which is false for a
  short post with deep indentation. It has its own sentence, and the bound is MAX_BODY itself on
  the stored form: the size one post's record could reach before indentation was kept, so the
  room log (which keeps every post in full, spilled or not) grows no larger per post than it
  could before. `storeText` now runs once per post. Room tests: indentation kept in the record,
  and the refusal names indentation; the old wording reds it.
- NIT fixed: the store's closing fence allows only spaces after the run, as pjRich does.
- Duplicate: pjBody's fence rule, already recorded above; filed as a follow-up card.

## Review pass 7 (opus)
- WARNING fixed: the dedent counted only ASCII spaces while the final trim strips Unicode
  whitespace, so a leading byte-order mark or non-breaking-space indentation (rich-text
  pastes) made siblings look nested. A leading BOM is dropped and each line's leading run of
  spaces and non-breaking spaces becomes spaces before the dedent. Tested, including a
  non-breaking space inside a line being left alone; removing the conversion reds it.
- NITs fixed: the fence comment says which CommonMark rules it follows; the stored-size
  refusals say "indentation and spacing", since a fence's blank lines or alignment runs count.
- Recorded, not changed: a fence's own indentation is not removed from its content lines
  (CommonMark does that); the store and pjRich agree. And pjRich's list regex is the old shape
  with a capture added; its behaviour on a long space run before a line separator predates this.

## Review pass 8 (sonnet)
- WARNING fixed: a line of only non-ASCII whitespace (a full-width space, common in CJK text)
  counted as content, splitting a collapsed paragraph break and pulling the shared indent to
  zero. Blank now means no visible character, whatever the whitespace. Tested; the old check
  reds it.

## Review pass 9 (opus)
- WARNING fixed: the room's stored-form bound at MAX_BODY refused posts of plain blank lines the
  room accepted before (the old store already kept `\n\n`), and its comment was wrong. It is
  STORE_GROWTH times MAX_BODY, as the DM path is; a room test pins the old blank-line post.
- WARNING fixed: depth was absolute (two spaces a level), so tab or four-space nesting skipped
  a level. It is now relative to the enclosing item, in both renderers; tests for two-space,
  four-space, tab, stepping back out, and blank lines versus a paragraph. The per-line list
  check is an inline regex, because other tests lift these renderers without the page's
  constants.
- NITs fixed: the fence comment says CommonMark-like and names the differences;
  `messageProblem` checks the one-line length before building the stored form; the test header
  names the surfaces that really skip the store.
- Recorded: the first-line trim also applies when the first line is a fence opener, so an
  indented opener over a column-0 closer loses its spaces while its code keeps theirs. It
  renders the same.

## Review pass 10 (sonnet)
- Fixed (raised as a BLOCKER; a rendering defect in the card's headline case): the depth stack
  reset on any non-list line, so a fence, table or heading nested under an item flattened the
  next sibling. It now resets only on a non-list line that is not indented under the list.
  Tested for all three in both renderers; the old reset reds them.
- NITs fixed: why STORE_GROWTH is four; why the browser check's indent threshold is 8px.

## Review pass 11 (opus)
- WARNING fixed: a line of only `\f` or `\v` counted as blank and was dropped, so a message
  main refused was accepted. Blank excludes those two, so CONTROL still refuses them. Tested.
- WARNING fixed: three existing test files lift the renderers without `pjListDepth`, and passed
  only because none of their fixtures had a list line. `pjListDepth` now holds its own constant,
  every lift list that has `pjRichSpans` also lifts `pjListDepth`, and a test checks those
  lists so the next one cannot drift.
- NITs fixed: the depth helper and test headers describe the relative rule and the indented
  reset; the fence bullet names the rules that apply inside a fence too; a DM test pins that
  deep indentation under the one-line limit is still accepted up to the ceiling.
- Recorded: `.mdli` is an inline span, so a long nested item's wrapped lines return to the left
  edge. A real list structure is the fix.

## Review pass 12 (sonnet)
- WARNING fixed: a fourth file, server.test.js's `bodyFn`, lifted pjProse without pjListDepth.
  Lifted there too, and the self-check now sweeps every test file that lifts a renderer by name
  instead of naming three, with a control that it finds the known ones. Removing the new lift
  reds it.
- Recorded, not changed: the reset compares a non-list line's indent with the outermost level,
  so text indented under an outer item but not the inner one keeps the inner levels open.

## Review pass 13 (opus)
- WARNING fixed: pjRich's new closing-fence regex did not match a line ending in `\r`, so CRLF
  text (a task's detail is stored raw) drew everything after a fence as code. Both renderers
  split on `\r?\n`. Tested; the old split reds three arms.
- WARNING fixed (outside the diff, made reachable by it): the room's quote path trimmed with
  `/^\s+|\s+$/g`, which backtracks on a long space run inside the text, and the store now keeps
  such runs in fences. It uses `trim()`, which strips the same characters in linear time.
- NITs fixed: STORE_GROWTH is described as a chosen bound, not a measured ratio; the storeText
  doc says where the fence rules come from and that the final trim can take a control
  character off an end.
- Rejected: tilde (`~~~`) fences. The store and pjRich both read backtick fences only, and
  agree; adding tildes is a separate change to both.
- Recorded, not changed: the stored-form ceiling can refuse a heavily tab-indented message main
  accepted. The refusal names the reason, and the bound keeps a thread read on every poll small.

## Review pass 14 (sonnet)
- Deferred, with reasoning: blank lines at the very end of an unclosed fence are trimmed with
  the message's ends. They carry nothing at the end of a message; the doc now says so.
- WARNING fixed: a few words plus millions of blank lines passed every one-line gate and then
  cost the store's line walk about half a second. The raw text is capped before the store runs
  (STORE_GROWTH squared times MAX_TEXT on the DM path, four times the stored ceiling in the
  room). DM and room tests; removing either cap reds its test.
- WARNING fixed: the linear quote-path trim now has a timing test in web.quoteb.test.js; the old
  regex reds it.
