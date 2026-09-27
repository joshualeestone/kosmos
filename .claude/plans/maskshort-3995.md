# maskshort-3995: #3995 gap 4, a held key cut into chunks of three characters or fewer with words between

Card: #3995 (gap 4, from #3935's review round 34). Gaps 1 to 3 merged in #4061.

## Measured before
Held Zq8vLm3pRt6wXy9kHb2nWc4d written "Zq8 and vLm and 3pR and ..." showed in full: no word walk starts under
OPENING_LEN = 4, no run reaches FRAGMENT_LEN, no run is long enough for the catch-all.

## Change (engine/secretmask.js), as first reworked in review round 3 (later rounds below)
- shortChunkSpans: a second, stricter walk. It starts at a run of two or three characters (glue taken off) that
  begins a walked form the text can spell at all (a word break over the text's runs, memoised); advances only on runs
  that are exactly the form's next characters, each within SPLIT_REACH x the form's length (non-space) of the last
  run that advanced it; and masks only a WHOLE form with at least SHORT_WALK_MIN_KEYLIKE pieces that are not plain
  words or numbers, piece by piece (the piece, not a label glued to it), and only from the latest start. Its own
  budget; over it, the reply is withheld, as for the word walk.
- knownByShort: walked forms by their first 2 and 3 characters, not hex forms, and a form with its own - or _ also
  without them.

## Decided
- Completion only, no partial masking: completion is the defence against ordinary text.
- No key-like start rule (removed in round 1): it masked word passwords and missed many keys. Cost is controlled by
  spellability, false masks by the key-like-piece count, hex by leaving hex forms out of the short index.

## Weakest premise
- SHORT_WALK_MIN_KEYLIKE = 2 separates a random key from a password made of words by counting pieces that are not
  plain words. A password made of words with two mixed pieces (for example two ordinals written oddly) spelled by
  ordinary text would still be masked there. What would change it: a real guide reply that trips it.

## Not covered (also in the file)
- One character per chunk; chunks of two with fewer than two key-like pairs (round 12); a single-case key whose chunks
  read as words (round 4); anything hex in short chunks;
  see the file's own Not covered list, which is kept current.

## Review round 1 (Opus), what changed
- BLOCKER fixed: the key-like start let a Titlecase two-letter word ("My", "Up", "Go") start a walk, so a held
  password made of words (MyPassword123) was masked out of the ordinary sentence that spells it. The start rule is
  gone; instead a completed walk whose every piece is a plain word or number (all lower, all upper, Titlecase, or
  digits) masks nothing. Tested with four such passwords; red without the rule.
- The start gate was also the cost control, and it left 14 to 33 percent of random keys uncaught (80 percent of hex
  forms, which start with digits). Cost is now controlled by spellability instead: a walk starts only when the rest
  of the form can be spelled from runs present in the text (a word break, once per form and opening, and the viable
  forms once per opening). The #3769 cost tests pass; a reply naming eyJ 100 times with ten held JWTs is unchanged.
- Glue on short chunks is taken off (_Zq8_, p0=Zq8, part-Zq8). Tested; red without it.
- The walk's block no longer sits between nonSpaceIn's comment and nonSpaceIn. Stale comments on OPENING_LEN and in
  "Not covered" reworded; the start-rule limit removed from "Not covered", two real limits named (every chunk a plain
  word or number; a first chunk of four or more followed by short chunks far apart).
- The mixed-chunk assertion now sees the last chunk (word-boundary match).
- My own test bug: the lowercase fixture was 23 characters, so its split dropped the last two and could never be
  assembled. It is 24 now, and asserts it splits whole.
- Deferred NIT: the first path to reach a position wins (as in the word walk); a coincidental path can leave a real
  chunk unmasked in a partial way.

## Review round 2 (Sonnet), what changed
- BLOCKER fixed: a label glued AFTER a short chunk (Zq8-part0) hid it; shortPieces now offers the part before the
  first = - _ as well as after the last. Tested; red on the previous commit.
- BLOCKER fixed: a held 2ndFloorLounge was masked out of "the 2nd ... Floor ... Lounge" (an ordinal is not all one
  case). Ordinals count as plain words, and a completed walk masks only when at least SHORT_WALK_MIN_KEYLIKE (2)
  pieces are not plain words. Tested; red on the previous commit.
- Only the piece is masked, not a label glued to it (as the word walk's pieceSpan does). Tested.
- The spellability check's inner steps are charged, one unit per 16 (chunksOf), and the budget's comment says what
  it was measured against. The #3769 cost tests pass (charging every step withheld them).
- Deferred NIT: shortPieces offers one head and one tail per separator, not PIECE_VARIANTS_MAX of each; a chunk under
  OPENING_LEN with several labels glued on both sides is not tried every way.

## Review round 3 (Opus), what changed
- BLOCKER fixed: hex forms (0-9 a-f only) were in the short index, and a numbered guide's lone letters and digits
  spell them all, so every lone digit walked against every held value's hex and the reply was withheld. Hex forms are
  left out (named in Not covered). Tested with 100 held values and a 200-line numbered guide.
- A form with its own - or _ is also indexed without them (the word walk skips them; this walk does not). Tested.
- Only the latest start that completes a form at a given run is masked, so an earlier mention of its first
  characters no longer masks a "1" and a "2" on the way. Tested.
- The spellability check tries only the lengths some run has and is charged by the characters it slices.
- Not covered now names one character per chunk and all-lowercase keys; this plan's stale sections rewritten.
- Deferred NIT: a chunk ending in base64 padding (Zq8=) is tried only as written.

## Review round 4 (Sonnet), what changed
- plainWordRun judged a word by case shape alone, so "zqv" was a plain word and an all-lowercase random key had no
  key-like pieces and leaked in full. It now uses wordLike's calibrated vowel test for single-case letters (under three
  characters still counts as plain). Tested: an all-lowercase key in chunks of three is masked; MyPassword123 and
  2ndFloorLounge are still left in their sentences. Red on the previous commit.
- Not covered restated: one character per chunk, chunks of two, a single-case key whose chunks read as words, and a
  chunk glued to a label by + or / alone.
- Noted (inherited from pieceSpan, no exploit found): the piece's position in its run is found by endsWith/indexOf, so
  a run holding the same piece twice could mask the wrong one.

## Review round 5 (Opus), what changed
- A reply listing single characters ("A B C ... 0 1 2") made every form spellable and each lone character walked,
  so it was withheld with about 50 held values. A short walk now starts only from two or three characters (one still
  continues a walk). Tested with 200 held values; red without the rule. The cost: a key whose first chunk is one
  character is not caught (Not covered).
- Not covered stated precisely: a raw hex token (not only hex encodings), a long first chunk followed by short ones
  once the text runs past SPLIT_REACH times the key's length, and chunks of two only for a single-case key.
- Noted: iOS17iPadOS17 is masked out of "Update to iOS 17 or iPadOS 17" (two mixed pieces), matching what main already
  does for such values with a longer opening; the weakest premise's shape, recorded.
- Deferred NIT: the first path to reach a position wins, which can leave a real chunk visible (3 characters, adversarial).

## Review round 6 (Sonnet), what changed
- BLOCKER fixed: the hex exclusion tested the value before its own - and _ were taken out, so a UUID-shaped secret
  entered the short index once stripped, and with 2,000 held a numbered list was withheld again. Each form is tested
  now. Tested with 2,000 distinct UUIDs; red on the previous commit. (My first version of that test passed on the
  previous commit too: its hex generator used the low bits of a generator whose low bits repeat every 16, so the values
  were nearly identical. It uses high bits now and asserts the values are distinct.)
- The short index holds only 2- and 3-character openings (nothing read the 1-character entries); its build no
  longer scans each list for duplicates.
- The all-lowercase test asserts every chunk is masked (completion is all or nothing).
- Not covered: a key both single-spaced and cut into short chunks (the short walk does not read the spacing copy).

## Review round 7 (Opus), what changed
- A reply listing its characters (so every form is spellable) and naming a shared opening many times (eyJ, with JWTs
  held) was withheld: each start scanned and charged every run in reach. The walk now visits only runs that ARE the
  form's next piece: the text's pieces are indexed by string with their run positions, and from each reached point
  the few lengths the text has are looked up and the next occurrences within reach are binary-searched. Cost follows
  matches, not runs in reach. Tested with 20 held JWTs; red on the previous commit.
- Every path is followed, so a coincidental run reaching a point first no longer leaves the real chunk visible
  (the deferred first-path NIT; probed: the real vLm is masked, the noise v and Lm stay readable).
- Stale comments and this plan's Change section say two or three characters; Not covered says letters-only for
  chunks of two, and names base64 padding on a short chunk (Zq8=).
- Noted, the weakest premise measured: S3EC2K8s2024 is masked out of "Deploy to S3, then EC2, then K8s in 2024"
  (three mixed pieces). A password made of tech tokens with digits is indistinguishable from a key by this rule.

## Review round 8 (Sonnet), what changed
- BLOCKER fixed: a short chunk with a label glued on both sides in one run (x0-Zq8-y0, var_Zq8_tmp0) was never tried;
  shortPieces offered only the part before the first separator and after the last. It now offers every part between
  = - _. Tested for both shapes, labels kept readable; red on the previous commit.
- The budget is declared before canSpell, which charges it (it worked only by call order). canSpell's position
  parameter no longer shadows the piece index.

## Review round 9 (Opus), what changed
- A reply naming a JWT header's own short chunks after a character list was withheld: each mention of the shared
  opening re-walked every form. Starts now run latest first and share one set of explored points per form, so work
  per form is bounded by its points, not its mentions (a point a later start explored can only complete where that
  start already did, which the latest-start rule keeps). Tested with 20 held JWTs; red on the previous commit.
- Not covered now says an abandoned first try followed by a full retry shows (only the latest start is kept).
- Deferred NITs: when a chunk appears twice, once as noise, the noise copy can be the one masked (3 characters of a
  retyped chunk); reach is measured run end to run start here and lastAt to run end in the word walk (both per gap).

## Review round 10 (Sonnet), what changed
- BLOCKER fixed: a held value made of labels (Q1Q2Q3Q4Q5Q6, V1V2...) was masked out of ordinary prose about quarters or
  versions: one letter with one or two digits (or the other way round: 4K, 3D) was not a plain word. It is now.
  Tested with both; red on the previous commit. The cost: a random key's 2- or 3-character chunk of that shape
  (about 2 percent of 3-character chunks) no longer counts toward the key-like pieces.
- Every copy of a completed key's piece between its first and last chunk is masked, not only the copy on the path the
  search kept (the deferred rounds 9 and 10 case: a repeated chunk left the real copy showing). The copies are the
  key's own characters. Tested; red on the previous commit.

## Review round 11 (Opus), what changed
- The copies-between rule masked ordinary words when a key chunk was one ("is", "in", "the"): about 1.2 percent of
  random keys cut in twos with filler. Extra copies are masked only for pieces that are not plain words; the comment
  that said "hides nothing else" was wrong and is corrected. Tested; red on the previous commit.
- Mixed-case units and platform names (GHz, kHz, dBm, mAh, kWh, iOS, iPadOS, macOS ...) count as plain words, so a held
  value made of them is not masked out of a spec line. Tested; red on the previous commit.
- The shared explored-set comment names the queued-not-expanded residual. This plan's stale lines corrected.

## Review round 12 (Sonnet), what changed
- BLOCKER fixed: every two-character piece counted as a plain word (the under-three shortcut, and the label rule for
  any letter with a digit), so a key cut into chunks of two leaked in full about half the time (105 of 300 random
  24-character keys on the previous commit; the plan's own example key among them). Now two letters are plain only with
  a vowel (My, Up, Go, In), and a label only with an UPPERCASE letter (Q1, 4K; 8v and 3p are key text). Measured after:
  0 of 300 in twos, 0 of 300 in threes. The word-password, label (Q1Q2...), unit and numbered-guide tests all still pass.
- Not covered in the file restated to the real boundary for chunks of two.
- The budget comment records round 12's large crafted input: 2.4s here against 1.5s on main, not withheld, inside the
  word walk's documented range.
- Deferred NIT: the unit list is an enumeration.

## Review round 13 (Opus): two WARNINGs deferred as the plan's stated trade-off, with measured rates
- Deferred, false mask: a held passphrase built from vowel-less tech tokens (SSH, VPN, npm, src, cd, PDF, x86) has
  two or more key-like pieces, so ordinary prose that spells it is masked (SSHkeyforVPNaccess out of "Add your SSH
  public key, and for the VPN, request access"). main leaves it alone.
- Deferred, leak: an uppercase-and-digit key in chunks of two shows in full about one time in ten (60 of 599), since
  its vowel pairs, labels and digit pairs all read as plain; in threes, 0 of 600. Named in the file's Not covered.
- Why deferred rather than fixed: both come from the one rule that separates a random key from a password made of
  words, and every change measured so far trades one for the other (a share-of-pieces rule would leak about 13 percent
  of mixed-case keys in twos). A better separator needs something this walk does not have (for example a judgement of
  the held value itself at index time). What would change it: a real guide reply hitting either case.
- Noted NITs: every copy of a vowel-less key chunk (npm) between the key's first and last chunk is masked, on the safe
  side and only next to a real key; reach is per gap with no total cap (contrived dense single characters can assemble
  a key over thousands of characters; real minified JS was unaffected); a one-character first chunk is the largest
  remaining hole of the targeted shape (documented).

## Review round 14 (Sonnet), what changed
- A short chunk glued to a label by + or / alone (Zq8+part0, Zq8/part0) was never tried: shortPieces now splits on
  = _ - + and /, as the word walk's pieceVariants does. Tested; red on the previous commit. Twos and threes still 0 of
  300 shown; the cost tests pass.
- Not covered no longer lists base64 padding (Zq8=; round 8's split already takes it off) or + / glue; a test pins both.

## Review round 15 (Opus), what changed
- Two chunks joined in one run after the first (3pR/t6w, with / + - _ =) were never tried together: shortPieces now
  offers runs of up to four consecutive parts joined, each piece carrying where it sits in its run. Tested for all five
  separators; red on the previous commit.
- A piece is masked where it sits in its run, not at the first place its letters appear (t6wx/t6w/q masked the label).
  Tested.
- Found on the way, my own: joined parts let a walk assemble through a guide's own mention of a public prefix
  ("starts with sk-ant-api03") and mask it (two #3935 tests went red). Each short-index form now records how long its
  KNOWN public head is (sk-, xai-, ghp_, github_pat_ and the like; a licence key's own - is not a head), and pieces
  wholly inside it are used to assemble but not masked, as the word walk leaves a public prefix readable. My first try
  (keeping such forms out of the short index) broke keys with their own -; reverted.
- Noted NIT: the round-14 padding arm guards regressions only (it passed before round 14 too).

## Review round 16 (Sonnet), what changed
- A chunk written twice inside one run (3pR-3pR) showed its second copy: shortPieces kept only the first place a piece
  sat, and the copies rule skips the run the match came from. Every place is kept now, and a piece that is not a plain
  word is masked at every place in its run. Tested for all five separators; red on the previous commit.
- The SHORT_PUBLIC_HEAD comment no longer claims the same set as shapeHint (it is the subset publicHeadCut can measure).

## Review round 17 (Opus), what changed
- BLOCKER fixed: the search ends on the shortest path, so a key repeated regrouped (2nW/c4d, Zq8vLm 3pRt6w, one
  line with -) or retried after an abandoned first try left the chunks off the path showing (6 to 21 characters).
  Once a form completes, every run from one reach before its first chunk to its last that holds a non-plain slice of
  the form (past its public head) is masked. Tested with four shapes; red on the previous commit. Plain words nearby
  stay (the round-3 test now checks the ordinary "1" and "2" and allows the earlier Zq8, the key's own chunk).
- Not covered: an abandoned first try is masked when a retry follows within reach; a partial try never completed is not.
- The budget comment records round 17's long-value measurement (2,000 held values of 400 to 1,000 characters on 8,000
  random short tokens: withheld, crafted; realistic texts unchanged).
- The round-8 test asserts every label survives, not one.
- Deferred NITs: a public head measured by publicHeadCut can reach into secret characters (sk-proj- with _ early,
  main's shared rule); version and architecture strings are the deferred round-13 trade-off.

## Review round 18 (Sonnet), what changed
- BLOCKER fixed (introduced by my round-17 fix): the nearby-run rule masked any run holding any slice of the key, so
  an ordinary "c4" between the chunks ("White played c4") was masked. Both off-path rules (nearby slices and repeated
  copies) now need three characters or more: a two-character slice of a key is an ordinary token as often as not.
  Tested; red on the previous commit. The cost, named in Not covered: a repeated, regrouped or abandoned copy's
  TWO-character chunks can show (at most two characters each).

## Review round 19 (Opus), what changed
- BLOCKER fixed: shortPieces deduped each place with a scan of the list, so a run of one part repeated thousands of
  times (a pasted solid-colour base64 image, 0-0-0-...) took quadratic time before any budget was charged (21s on
  128KB). A Set of places now. Tested: 32,000 characters of /wAA under 1.5s CPU, unchanged; red on the previous commit.
- The nearby-slice rule masked an ordinary acronym before the key that spanned two of its chunks ("TLS" across EFT and
  LSU). A slice must now line up with the key's own cuts at one end at least; cuts include every separator inside a
  joined piece on the path. Tested; the round-17 regrouped-repeat shapes still pass.
- Not covered quotes the measured rate for uppercase-and-digit keys in threes (about one in two hundred), not "0 of 600".
- The budget comment is rewritten as the unit plus a list of measurements.

## Review round 20 (Sonnet), what changed
- BLOCKER fixed: shortChunkSpans built every run's pieces before anything could match, and none of it was charged,
  so a large paste of slug-like tokens sharing nothing with any held value cost 16s against main's 5s at 5.3MB,
  growing with size and never withheld. It now returns at once unless some 2- or 3-character token in the text opens a
  short-indexed form (a walk can only start from one), and the build and the masking after a completion are charged to
  the budget (past it: withheld). Measured on a 16,000-token slug log with 50 held keys: about 950ms CPU on the
  previous commit, about 400ms now.
- The round-20 test is a guard against a blow-up (relative to the same log with hex held values, which the short index
  leaves out), NOT a test that fails on the previous commit: on this loaded Mac the two differ by less than the noise
  at a size a unit test can afford. The fix rests on the measurement above and on round 20's 5.3MB figures.
- NIT noted: nearPieces rescans the form per candidate (bounded by the form's length; now charged per run).

## Review round 21 (Opus), what changed
- BLOCKER fixed (introduced by my round-20 gate): the gate tested only alphanumeric 2-3 character tokens, but the walk
  starts from shortPieces openings, which can hold + / = - _ (A+b, Q/x). A key whose second character is one of those
  was never walked (about 3 to 5 percent of base64 keys). The gate now tests openings as shortPieces makes them: short
  runs as written and trimmed, each part between separators, and joins of neighbouring parts of three characters or
  fewer. Tested with A+b, Q/x and Q=x keys; red on the previous commit.
- The gate's comment says a common word opens it ("AI" with a Google key held), so the build's cost still grows with a
  long reply of short runs (charged; a 3.5MB reply of 1.4M runs is withheld where main shows it in 16s).
- Noted NIT: the round-20 cost test exercises only the no-opener path.

## Review round 22 (Sonnet), what changed
- BLOCKER fixed (from my round-15 head rule): SHORT_PUBLIC_HEAD matched a bare sk- / sk_ / rk_ and then trusted
  publicHeadCut ("wherever the next - falls"), so a held sk-Ab3-... showed its own Ab3. The head is now an exact,
  known vendor prefix (sk-ant-api03-, sk-proj-, sk-or-v1-, sk_live_, ghp_, xai-, github_pat_ ...) and exactly its length.
  Tested; red on the previous commit.
- The masking loops after a completion stop as soon as the budget is spent (withheld), not only at the end.
- My own test mistake, caught: I asserted a named sk-ant-api03- prefix stays readable next to a chunked key; main masks
  it the same way (the word walk), so the assertion was removed and the test keeps what this change is about.
- Deferred NITs: canSpell recomputes for from = 2 and 3 separately (at most twice the work); nearPieces' alignment
  accepts any aligned occurrence of the slice in the form (errs toward masking).

## Review round 23 (Opus), what changed
- BLOCKER fixed: a vendor key given WITHOUT its prefix, its body starting with - or _ (p-Yj08..., t_QCf...), was never
  walked (5 to 17 percent of such keys): the prefix-less form is cut at the last - or _ in the first 16 characters,
  inside the body. After a known vendor prefix, the body is now indexed as a form of its own (head 0), with and without
  its separators. Tested with sk-ant-api03 and sk-proj keys; red on the previous commit.
- Off-path copies are also masked up to one reach after the key's last chunk (a regrouped repeat after it showed).
- Not covered gives the reason for no partial-try rule in the short walk (short pieces alone are ordinary tokens), and
  SHORT_PUBLIC_HEAD's comment ties it to PATTERNS.

## Review round 24 (Sonnet), what changed
- BLOCKER fixed (a gap in my round-23 fix): a vendor key whose body is hex (sk-proj-3f9a...) given without its prefix
  leaked, because the body form met the hex exclusion. A vendor body is walked even when hex: its prefix says it is a
  key, and it is one form per held value. Hex encodings and raw hex values stay out (the numbered-guide case).
  Tested; red on the previous commit.
- The vendor-prefix match is computed once per value (it was computed twice); the copies loop is charged to the budget.
- Already deferred, confirmed with repros: DNSoverTCPandUDP01 masked from prose (round 13); 200,000 repeats of a key's
  opening withhold the reply (round 21).

## Review round 25 (Opus): no leak in the targeted case, no new withheld reply; two WARNINGs, both named and routed
- Deferred and routed: a held value shaped like configuration (a model id, gpt-4o-mini-2024-07-18, held from a
  secrets file) is masked out of prose that names the model. It is the SHORT_WALK_MIN_KEYLIKE trade-off (round 13),
  and changing the plain-word rule again reopens the chunks-of-two leak (round 12). Its root is knownsecrets holding a
  model id at all: filed as #4111. Named in Not covered.
- Named in Not covered: a chunk with a number glued straight onto it (0Zq8, Zq80) shows, as on main.
- The round-23 test says why it allows one chunk to show.
- Outside this branch, filed as #4112: a reply naming sk-ant-api03- many times is withheld with many Anthropic keys held
  (main too).
- Noted: the cost tests are time-based, like the existing #3769 ones.

## Review round 26 (Sonnet): one BLOCKER-rated finding deferred as the stated trade-off, now stated as a certainty
- A value made wholly of label-shaped groups (A12B34C56..., A1B2C3...), cut into them, is never masked by the short
  walk: every group is a plain label by the round-10 rule, which exists so a held Q1Q2Q3Q4Q5Q6 is not masked out of a
  sentence about quarters. The two are structurally identical, so no piece rule separates them. Kept the round-10 rule
  (ordinary text is protected); Not covered now names this as EVERY time for that shape, not a sampled rate, and a
  test pins it. What would change it: evidence that such keys are held and written in their groups in guide replies.

## Review round 27 (Opus), what changed
- A held hex vendor body (OpenRouter's sk-or-v1-<hex>) was assembled out of hex-dense numbered text, hopping gap by gap
  across about a hundred lines, masking tokens and line numbers (round 24 let vendor hex bodies in; round 3's reason for
  keeping hex out applies to them too). A hex form now completes only within SPLIT_REACH x its length in all, not per
  gap; a real chunked key fits easily. Tested with five held keys and five fresh random texts: red 3 of 3 runs on the
  previous commit, green 3 of 3 now.
- My round-21 test's escape was wrong ('\\\\$&' built A\\+b, which never matches A+b), so its first-chunk assertion
  could not fail; corrected and checked against unmasked text.
- Not covered names chunks and words joined into one run by - _ or / (main leaks it too).
- NITs noted: shortHead keyed by form string (two values with the same form would share a head; not reachable
  realistically); the round-26 test asserts a known limit on purpose, as its message says.

## Review round 28 (Sonnet), what changed
- No leak, false mask or slowdown found. The one WARNING: five gap-4 fixtures held vendor-prefixed fake keys as single
  literals (sk-ant-api03-..., sk-proj-...), which a secret scanner reads as real keys; they are built with j(...) now,
  as the rest of the file's fakes are. (One on main, outside this change, is left alone.)

## Review round 29 (Opus), what changed
- A held value that is itself hex (a 32-hex token) leaked every time in short chunks; the stated reason (the numbered-
  guide case) was about hex ENCODINGS, and round 27's total-span cap is what makes walking hex safe. A value that is
  hex exactly as held is now walked; encodings stay out, and so does a UUID's dash-stripped form (my first version let
  it in and the round-6 test went red). Tested: 32-hex tokens in threes masked; a 300-line hexdump and a 500-line
  numbered list of hex tokens with 50 held unchanged; red on the previous commit.
- Not covered states the uppercase-and-digit rates by key length (round 29's measurement: in threes 5 percent at 16
  characters, 3 at 20, 0 at 32), not one figure.
- Noted NITs: a one-character first chunk (documented; cost reason stands); ordinary-text cost about 1.5x main over the
  repo's own source (identical output).

## Review round 30 (Sonnet), what changed
- BLOCKER fixed (from my round-27 fix): the total-span cap on hex forms made a hex key with ordinary prose between its
  chunks leak in full (49 of 50 random 32-hex keys given as "Step N: xx"); "a real chunked key fits easily" had only
  been checked with a one-word filler. Replaced by the real distinction: a hex form's walk may skip at most
  SHORT_HEX_SKIP_MAX (3) hex-looking runs between two pieces (a dump or numbered hex list skips many; prose skips words).
  Measured after: 0 of 50. The round-27 hex-dense test passes three runs of three; the new test is red on the previous
  commit. Not covered names the residual (several multi-digit numbers between hex chunks).
