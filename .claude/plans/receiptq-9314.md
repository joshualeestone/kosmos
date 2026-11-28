# receiptq-9314: a Codex patch path ends at its own string's quote (kosmos#9314)

## Finished looks like
A Codex exec script's `*** Add|Update|Delete File: <path>` line inside a '-string or a backtick string that ends right
after the path is read without the closing quote; a "-string still reads a name with an unescaped ' whole; and a test
that holds on every host checks an escaped drive-letter absolute path is read as one file, never `C:` or the folder.

## The change (engine/receipt.js)
codexPatchPaths replaces the one regex that read a path up to a newline or a `"`. Inside a JavaScript string only its
own quote must be escaped, so the opener (the first quote after the nearest `tools.apply_patch(` before the line) is the
only quote that ends the path. With no opener there (a patch built elsewhere and passed by name), `"` is assumed, which
is what main did. The next-line filter accepts the opener where it accepted `"`.

Rejected: stopping at every `'` and backtick (the card's own warning): a real file name can hold a `'`, and in a
"-string it is written unescaped, so `bo's.md` would be cut to `bo`.

## Tests (engine/receipt-5153.test.js, the Codex arm)
- c2d `'`-string, c2e backtick string, each ending right after the path: read `single.md`, `tick.md`. On main they read
  `single.md'});` and ``tick.md`);`` (measured by running the test against main's receipt.js).
- c2f a "-string with an unescaped `'`: `bo's.md` whole.
- c2g an escaped `C:\Users\kay\drive.js`: one file, folders kept, never `C:` or the agent's folder, on every host.

## Weakest premise
Neither case has been seen in a real Codex transcript (the card says so); both are reasoned from the script being a
JavaScript string. The opener rule can be wrong when a script holds two apply_patch calls and the patch text for the
second was built before the first; that case falls back to the nearest call's quote.
