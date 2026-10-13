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
page; no node, or an empty or failed answer, keeps the old cut). The note reaches node after `--`, so a leading dash is
text. A note that fits in code points is returned unchanged (the shell's length test can count bytes). A sentence ends
at . ! or ?, optionally a closing quote or bracket, a space, and a capital or digit next; e.g., i.e., etc., vs., Mr.,
Mrs., Dr., approx., incl. and No. (either case, before a closing quote too) never end one. When no whole sentence fits,
the cut keeps whole words and drops a trailing comma or colon before the ellipsis.
tools/test-post-release-notes.sh: fixtures for the 0.7.46 note, a dotted version and domain, curly apostrophes under a
C locale, an abbreviation, U.S. before a lowercase word, a leading dash, and an over-long sentence; 7b updated.

## Rejected
- Counting the link as X does (23 characters): it gives about 20 more characters, but X's rule is X's, and the budget
  here is a safe upper bound; left as is.

## Weakest premise
That the abbreviation list and the capital-or-digit rule cover our release notes. A shape outside them (an abbreviation
not listed, before a capital) ends a sentence early, so a post could stop on it: shorter, unmarked, never mid-word. The
notes are written by us and the list is easy to extend; this is accepted rather than chased further. Also: X weighs
emoji and CJK characters as two and a link as 23, which the code-point budget does not model.

## Validation
tools/test-post-release-notes.sh: every arm passes (37 PASS lines at the last fix); each new or changed check fails
with its fix removed or on the old script. bash -n on both.
