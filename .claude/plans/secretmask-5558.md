# #5558: long_token masks ordinary long path-like runs

## Done looks like
A long path of plain segments (a plan-file name such as .claude/plans/avatar-4038-20260926T1625.md, a docs path) is no
longer replaced by the mask in the setup guide's replies or in backup redaction, while every random token the detector
caught before is still caught, including a random token chopped into short slash-separated chunks.

## Built
engine/secretmask.js: isPlainPath(run), called from looksRandom for a run containing `/`. Plain = at least two
segments, each at most 40 characters, every piece (split at - and _, then into word and number pieces) is a number, a
word with a vowel (lowercase or Capitalized), or a short piece with one or two letters and at least as many digits
(3p, x64, a timestamp's T1625). Any other piece (Lm, Rt, K7MDENG, bPxRf...) makes the run not plain, so it is judged
by the existing rules.

## Measured (the card's sweep: every tracked file through mask(), before and after)
- long_token hits 241 -> 178; files changed by masking 253 -> 202.
- Every run no longer masked was listed and read: plan-file paths, docs paths, a list of HTTP status codes, git short
  shas joined by slashes, an Android emulator path, a vendor path. None a credential. A first version also passed a
  chopped random token (Lm3p/Rt6w/Xy9k); tightened (a word needs a vowel; a short piece needs digits >= letters).

## Decided
- Only the generic long_token heuristic changes; the specific provider patterns and the known-secret fragment index
  run as before (the card's worry about `/api/sk-.../` is covered by the sk- pattern, and a path starting with `/` was
  already exempt).
- Weakest premise: some real paths with vowelless pieces (sdk, pkg, msvc) stay masked: over-redaction, the safe
  direction.
- Not fixed here (pre-existing, noted on the card): an AWS-style secret with a single digit group is not caught by
  long_token (digits in fewer than two places).

## Tests
engine/secretmask.test.js '#5558': three plain paths kept; a chopped token masked; a random token masked (control);
a random segment inside a path masked. Full secretmask.test.js 126/126.

## Review log
### Review 1 (opus): 1 WARNING fixed
- WARNING fixed: random lowercase-and-digit tokens behind a path prefix (keys/prod/<32 chars>) passed as plain, up to 7.5% of fuzzed samples: the fallback split peeled a random chunk into word-like parts, `y` counted as a vowel, and single letters were words. Now each piece between - and _ is judged WHOLE: a number; a word of 3-12 letters with a real vowel; a word then up to 4 digits (win32); or a mostly-digit piece (at most 2 letters, 1-2 digit groups, starting with a digit or x+digit). The reviewer's fuzz (20,000 per shape, 10 shapes): 0 new leaks except 1 in 20,000 for a token chopped into eight 5-character lowercase chunks (named residual: an unusual credential shape).
- Test: isPlainPath (exported for tests) never judges a path ending in a seeded random token plain (1,500 tokens, 16-32 chars), with a plain-path control. Two first drafts of this test were wrong (a generator drawing only nine characters, then a question this change does not control); recorded.
- Repo sweep after: long_token 249 -> 183 (base count moved as main moved).
