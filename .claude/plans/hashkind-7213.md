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

- Marks stored between #6849 and this keep `sha256:` on a normalized PDF value. They cannot be relabelled without the
  file, so `compare` handles them instead: when a `sha256:` value misses the plain bytes of a PDF, it is tried against
  the PDF fingerprint, and a match says "which an older mark labelled sha256:" (review 1). Marks from before #6849 are
  truly plain and match the plain bytes.
- An older CLI on the same board still sends a normalized PDF as `sha256:` until it updates (CLI and board ship in one
  install, so this lasts one update).

## Tests

- engine/fileprint-7213.test.js (new): labels, plain(), compare both kinds and refusals, the CLI exits, the handoff line.
- server.builtsha-6330.test.js: the board accepts `pdf-normalized:` and refuses near misses; notice wording; Mac CLI
  compare arms. tools.windows-kosmos-cli-570.test.js: Windows CLI compare arms.
- Mutations, each went red: PDF label back to `sha256:` (6 of 6 new tests red); compare ignoring the kind (2 red);
  Mac CLI passing only `$1` (the Mac test red).

## Challenge loop

- Iteration 1 (sonnet): W1 older marks (normalized hash under sha256:) read as changed through the new compare -> FIXED
  (fallback above). W2 a PDF already emptied of dates matched by hex but refused by label -> FIXED (the hex decides in
  the pdf-normalized branch). N3 orphaned handoff comment, N4 inverted assertion messages -> FIXED. N5 fixture drift is
  already controlled in tests 1 and 3 -> no change. Mutations: fallback removed (1 red), label compare (1 red).
- Iteration 2 (opus): W1 the older-mark fallback also ran for a BARE shasum value, so a date-only edit of a PDF
  approved with its date already empty passed a byte-for-byte check -> FIXED (the fallback needs the sha256: label;
  older marks always carried it). W2 the "has none" message was false for a PDF over 64 MB and for a PDF with nothing
  to leave out -> FIXED (each gets its own reason). N4 a text file matched a pdf-normalized value by hex -> FIXED
  (only a PDF can). N5 stale descriptions (tasks.js field comment, one-line help on Mac and Windows) -> FIXED.
  N3 working rules still say compare with shasum -> DEFERRED, reason: a mark between #6849 and this prints the SAME
  hex under a new label, which a reader comparing values sees; the rules' shasum line was written for pre-#6849
  marks and still holds for them; a rules change re-offers the section to every agent. Revisit if a report shows an
  agent misled by it. Mutations: bare-value fallback (1 red), PDF-only hex match (1 red), size reason (1 red).
