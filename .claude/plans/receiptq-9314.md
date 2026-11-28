# receiptq-9314: a Codex patch path ends at its own string's quote (kosmos#9314)

## Finished looks like
A Codex exec script's `*** Add|Update|Delete File: <path>` line inside a '-string or a backtick string that ends right
after the path is read without the closing quote; a "-string still reads a name with an unescaped ' whole; and a test
that holds on every host checks an escaped drive-letter absolute path is read as one file, never `C:` or the folder.

## The change (engine/receipt.js)
codexPatchPaths replaces the one regex that read a path up to a newline or a `"`. Inside a JavaScript string only its
own quote must be escaped, so the quote that opens the PATCH's own string is the only quote that ends a path. That quote
is the character just before the nearest `*** Begin Patch` above the line, so a quoted key (`{'patch': "..."}`), a
comment, or another call before it does not decide it, and a patch built in a variable keeps its own quote. With no
quote there, `"` is assumed, as main did. The Begin Patch marks are found once, in order, so it is linear (20,000
headers in 2.6 ms; the first version of this, keyed on `tools.apply_patch(`, took 1.6 s and misread a quoted key as `it`,
review 1). A path that ran on into code (a quote then `)` `;` `+` `}` `,`, as a patch built in pieces does) or holds a
template's `${` is left out, never shown as a file name. Review 2: the path is consumed (the header search resumes
after it), so a one-line script is not re-scanned per header (was 711 ms at 2,000 headers and out of memory at 32,000;
now 22 ms at 100,000); and a header past the close of its Begin Patch's string uses main's `"`, never that string's quote
(`'*** Begin Patch\n' + "*** Update File: it's.md"` read `it`). Review 3: the close of each Begin Patch's string is
cached per quote kind, so openers that alternate between ' and " stay linear (one shared entry took 6.3 s at 8,000
repeats; now 6 ms); the ran-on rule applies only where the quote was assumed, so `notes 'a', b.md` in a "-string is
kept as main kept it; and a path that swallowed further headers is left out.

Rejected: stopping at every `'` and backtick (the card's own warning): a real file name can hold a `'`, and in a
"-string it is written unescaped, so `bo's.md` would be cut to `bo`. Rejected after review 1: the first quote after
`tools.apply_patch(` (a quoted key or comment comes first).

## Tests (engine/receipt-5153.test.js, the Codex arm)
- c2d `'`-string, c2e backtick string, each ending right after the path: read `single.md`, `tick.md`. On main they read
  `single.md'});` and ``tick.md`);`` (measured by running the test against main's receipt.js).
- c2f a "-string with an unescaped `'`: `bo's.md` whole.
- c2g an escaped `C:\Users\kay\drive.js`: one file, folders kept, never `C:` or the agent's folder, on every host.
- c2h one script: a quoted key (`q'key.md`), two calls with different quotes (`first.md`, `sec'ond.md`), a patch passed
  by name (`named.md`), a patch built in pieces and a template `${dir}` (both left out). On main: `named.md'; await ...`,
  `cat.md' +` and `${dir}/tpl.js` are listed.
- c2i a split patch (`'...Begin Patch\n' + "...it's-split.md..."`): `it's-split.md`, not `it`.
- c2j `notes 'a', b.md` in a "-string: kept.
- One-line scripts, 32,000 headers and 16,000 alternating escaped openers: read in under 3 s (about 60 ms here); the
  32,000-header path swallowed every later header, so no file is listed.

## Weakest premise
Neither case has been seen in a real Codex transcript (the card says so); both are reasoned from the script being a
JavaScript string. A patch whose Begin Patch line is not at the start of its own string (it is built in pieces) gets the
assumed `"`; such paths are usually caught by the ran-on rule and left out, not read wrong. The opener is the one
character before `*** Begin Patch`, so two shapes read it wrong: a patch whose own text mentions `'*** Begin Patch` inside
a "-string gives later headers `'` (`it's.md` would read `it`), and a string that starts with a newline before Begin
Patch is read as "no opener" and gets the assumed `"`. Both are contrived, and neither reads worse than main.
