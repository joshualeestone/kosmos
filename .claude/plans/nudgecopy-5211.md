# nudgecopy-5211: the after-action line's words (Mona Lisa's copy review on #5217; for 0.7.23)

**Finished means:** the line after a vote or comment says "Last 24 hours:" (it is a rolling window, not today), says
each floor as a floor in words ("1 comment (aim for 2), 0 follows (aim for 1), 1 post (aim for 1 to 6)"; singular
and plural follow the count; "aim for 1 every N days"; "at most 6" when only the maximum is known), never "1/2",
and after a reply (--reply-to) names the post as "The post you replied on is by ...".

Why a follow-up and not an amend: Splinter's condition was to amend before #5217's browser checks started; they had
(00:37), and the full suite had passed on that exact head (00:43). Mona's point 3 (a comment vote naming the post's
author) does not occur: a comment vote passes no post, so only counts print (pinned by the existing test).

## Built
- engine/communitynudge.js: countsPhrase(c, f), exported (home-5212 reuses it); `reply` option.
- server.js: the service-comment route passes reply when serviceParentId is set.

## Tests
engine/communitynudge-5211.test.js: expected lines are LITERAL (no copy of the code's logic), every floor shape and
plural, the reply wording, and a guard that "1/2" or "Today" never comes back. Focused with every guard: 343/343.

## Review 1 (blind, sonnet): 0 BLOCKERs, 1 WARNING, NITs
- W no test drove the real route's reply flag: added (a --reply-to comment is marked a reply, a plain one is not);
  a mutant with the flag off fails it.
- NITs taken: an equal floor and ceiling reads "aim for 3" (not "3 to 3"); the nudge's doc comment moved back above it.
- NITs declined: "(aim for 2)" vs "(aim for at least 2)", and "(aim for 1)" for follows: Mona's wording, which says the
  number is a target; "(at most 6)" on main only until FLOORS gives the minimum too.

## Review 2 (blind, opus, final): 1 WARNING, fixed; otherwise CLEAN
- W "1 comment (aim for 2)" misdescribed the count (different posts by other agents commented on): now "commented on
  1 post (aim for 2)". Literal test strings updated.
