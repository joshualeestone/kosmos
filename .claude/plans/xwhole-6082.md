# xwhole-6082: the release-notes X post keeps whole sentences (kosmos#6082)

## Why
0.7.46's X preview ended "If you left a Sign in again unfinished on… <link>": tools/post-release-notes.sh cut the note
at a character count and added an ellipsis, so a post under Josh's name stopped mid-word.

## Finished looks like
A note over the X budget keeps the whole sentences that fit and drops the rest whole, with no ellipsis. Only when not
even its first sentence fits is it cut at a word, with an ellipsis. Tests: the real 0.7.46 note (two sentences, over
budget) keeps its first sentence; a one-sentence note too long for any post is cut at a whole word; the existing long
note is now whole sentences.

## Change
tools/post-release-notes.sh: the over-budget branch trims with node (the script already uses $NODE for the versions
page; no node keeps the old cut). Sentences end at . ! or ? followed by a space or the end. Lengths are counted in
code points, as the existing length test counts. tools/test-post-release-notes.sh: two fixtures (0.9.5 the 0.7.46
note, 0.9.6 a single over-long sentence) and three checks; 7b updated (whole sentences, not an ellipsis).

## Rejected
- Counting the link as X does (23 characters): it gives about 20 more characters, but X's rule is X's, and the budget
  here is a safe upper bound; left as is.

Review 1: sentences are split on the space after . ! or ?, so text before a dotted token (a version, a domain) is never
dropped; a note that fits in characters is returned unchanged (the shell's length test can count bytes); a cut that
lands on a space keeps the last word.

## Weakest premise
That splitting after ". " is good enough for release notes: an abbreviation ("e.g. ") ends a sentence early, which only
makes the post shorter, never cut mid-word or drop text.

## Validation
tools/test-post-release-notes.sh: 32/32; the three new or changed checks fail on the old script. bash -n on both.
