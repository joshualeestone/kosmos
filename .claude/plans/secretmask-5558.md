# #5558: long_token masks ordinary long path-like runs

## Done looks like
A long path of plain segments (a plan-file name such as .claude/plans/avatar-4038-20260926T1625.md, a docs path) is no
longer replaced by the mask in the setup guide's replies or in backup redaction, while every random token the detector
caught before is still caught, including a random token chopped into short slash-separated chunks.

## Built (current rule, after reviews 1-3)
engine/secretmask.js: isPlainPath(run), called from looksRandom for a run containing `/`, exported for tests. Plain =
at least two segments of at most 40 characters, every piece (split at - and _, judged WHOLE) is a number of up to 10
digits, a word of 3-12 letters with a vowel (lowercase or Capitalized), such a word then up to 4 digits, a date or
timestamp (20260926T1625, 20260913T052847Z) or x64/x86, AND at least one piece is a word. Any other piece makes the run
not plain, so it is judged by the existing rules.

## Measured (the card's sweep; FIRST version of the rule, superseded: see the review log for the current numbers): every tracked file through mask(), before and after)
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
### Review 2 (sonnet): nothing above NIT; NITs fixed: the mostly-digit rule narrowed to dates/timestamps and x64/x86 (a digit run with stray letters cut by slashes was plain); words strictly 3-12 letters; comments match the code; negative test. 128/128.

### Review 3 (opus): 1 WARNING fixed
- WARNING fixed: a number piece had no length cap and a path needed no word, so long digit runs joined to a timestamp or word passed. Numbers capped at 10 digits; a plain path needs a word. Stale LONG_TOKEN comment rewritten; plan's Built section matches the code. NITs left: plain paths still masked when a piece is vowelless, two letters, v2-style or CamelCase (over-masking, the safe direction).
- Sweep with the current rule (23:4x): long_token 253 -> 189; files changed by masking 254 -> 207; 129/129 tests.

### Review 4 (sonnet): 1 WARNING fixed
- WARNING fixed: a word only needed a vowel, so random letter pieces (goxswayqboz, irqrfyfnsxp) passed and a random path cut by slashes (17195/5669431090/goxswayqboz/irqrfyfnsxp/929574) went unmasked where main masked it. A word is now word-SHAPED: at most 3 consonants in a row (y a consonant), a sixth of its letters vowels, no q without u. Considered reusing madeOfWords' wordLike (a quarter vowels): rejected, it fails "plans" and kept 93 of 4,219 real path runs plain against 3,097 with this rule (measured over the kosmos and kosmos-relay file lists). Random letter/digit paths judged plain: about 4.5% (639 of 14,192), the named residual.
- Test '#5558 review 4': the reviewer's path masked, a real plans path left alone (control); red on the previous commit.
- Sweep (23:41 CDT 2026-10-07): long_token 254 -> 196; files changed by masking 254 -> 211; 130/130 tests.
