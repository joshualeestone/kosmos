# hashkind-7213: label which kind of hash a fingerprint is

Card: kosmos#7213 (from the 0.7.69 five-family report, 2026-10-26). `kosmos fingerprint` and `kosmos handoff` printed a
PDF's normalized hash (#6849: its own dates and /ID left out) as `sha256:<hex>`, the label an approval's plain sha256
also carries. For one unchanged PDF the two differ (report: plain `78694167bc...` vs fingerprint `f6ddcda8...`), and a
seat concluded the file had changed.

## What changes

1. `engine/fileprint.js`: a PDF whose dates or /ID were left out prints `pdf-normalized:<hex>`. `sha256:<hex>` now
   always means the plain sha256 of the bytes (any other file, a PDF with nothing to leave out, a PDF over 64 MB).
   New `plain(p)` (plain sha256 of any file) and `compare(p, expected)`: an expected value that is bare 64-hex or
   `sha256:` is checked against the plain bytes, a `pdf-normalized:` one against the PDF fingerprint, and the answer
   names the kind. Run directly with two arguments it prints that answer, exit 0 match / 1 differs / 2 unusable.
2. `kosmos fingerprint <file> [expected]` on Mac (install/kosmos) and Windows (tools/windows/kosmos-cli.js), same usage
   text. One argument keeps its one-line output (task built reads it).
3. `kosmos handoff`: a PDF's artifact line gives both, `pdf-normalized:<hex> (plain sha256:<hex>)`.
4. Board (engine/tasks.js FINGERPRINT_RE, server.js notice, both task lists): accept and show either kind. The notice
   says `kosmos fingerprint <file> <this fingerprint>` so the next agent compares like with like.

## Decisions

- **Label by what was done, not by file type.** A PDF with nothing to leave out hashes to its plain bytes, so it says
  `sha256:`. Rejected: `pdf-normalized:` for every PDF, which would make two equal values carry two labels.
- **`pdf-normalized:` rather than the card's example `fingerprint(pdf-normalized):`.** Parentheses are awkward in a
  shell `case` and a regex, and the value has to survive being pasted. Rejected `sha256-pdf:`: it still starts with
  sha256, the thing a reader compares against shasum.
- **No doctrine change.** The tasks section of the working rules (engine/defaults.js BLOCK) still reads true (a PDF's
  fingerprint is not shasum; any other file is the plain sha256). Changing it bumps DOCTRINE_VERSION and re-offers the
  section to every agent; the notice an agent actually receives now names the compare command. WEAKEST PREMISE: that
  agents check a copy from the notice rather than from the rules. If one cites the rules' shasum line against a
  `pdf-normalized:` value, add one sentence there.
- **Files list left as is.** Its rows show the plain sha256 (engine/filehash.js), labelled "fingerprint" on screen and
  "fingerprint sha256 <hex>" on hover. A web/index.html change needs design shots and every web test; it is a separate
  follow-up if the board's word "fingerprint" is still read as the CLI's value.

## Deliberate gaps

- Marks stored before this keep `sha256:` on a normalized PDF value. They cannot be relabelled without the file; the
  working rules already say a PDF marked before may not match, and `compare` against the plain bytes settles it.
- An older CLI on the same board still sends a normalized PDF as `sha256:` until it updates (CLI and board ship in one
  install, so this lasts one update).

## Tests

- engine/fileprint-7213.test.js (new): labels, plain(), compare both kinds and refusals, the CLI exits, the handoff line.
- server.builtsha-6330.test.js: the board accepts `pdf-normalized:` and refuses near misses; notice wording; Mac CLI
  compare arms. tools.windows-kosmos-cli-570.test.js: Windows CLI compare arms.
- Mutations, each went red: PDF label back to `sha256:` (6 of 6 new tests red); compare ignoring the kind (2 red);
  Mac CLI passing only `$1` (the Mac test red).
