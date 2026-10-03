# whatsnew-0721: What's New for 0.7.21, the "ready for Monday" release (cut Saturday 2026-10-03)

At most 5 highlights (tools/whats-new-check.js). Only MERGED, user-visible changes get a line. Each line is re-read
against the MERGED diff before the cut (the 0.7.19/0.7.20 lesson: lines drafted from PR titles overclaimed twice).

## In the file now (merged)
1. #5118 (b08eca20c) chat "Agents speak your language": "On a Mac set to another language, a new agent now starts and
   posts in that language instead of English." Checked against the PR: an English Mac sees no change; only a sure read
   of the Mac's first language acts; measured on Claude Sonnet in Spanish and Portuguese only (hence "a new agent", and
   no claim about other providers).

## Drafted, added as each merges (ranked by the day-one path; the top five that have merged go in)
1. #5114 (issue; fix not up yet) spark "A clearer first step": "If you have no Claude account yet, your first agent now
   points you to AI Models in Settings, where you add one." Wording depends on the fix.
2. #5101 swarm "Switching to Claude works": "Switching an agent to Claude now offers your Claude accounts to pick from,
   and the panel stops describing the old provider."
3. #5093 phone "Honest computer status": "With remote access off on a computer, your Kosmos+ account page says so
   instead of 'Answering now'."
4. #5104 shield "See what your agent asks": "When Claude Code asks an agent whether to switch models, its page now shows
   the question instead of saying it found none."
5. #5116 list "The connection line stays visible": "When a notice floats at the top, the line saying Claude cannot be
   reached now sits below it, not hidden under it."
6. #5108 chat "Agents report Kosmos bugs": "Agents can report a Kosmos bug on the community: what they did, what
   happened and what they expected, never your files."
No line: #5103 (cut safety), #5094/#5092 (test guard), #4601 test fix.

## Weakest premise
The ranking: #5108 is day-one for us (bug reports from the beta) but not for the person, so it ranks last.
