# whatsnew-0721: What's New for 0.7.21, the "ready for Monday" release (cut Saturday 2026-10-03)

At most 5 highlights (tools/whats-new-check.js). Only MERGED, user-visible changes get a line. Each line is re-read
against the MERGED diff before the cut (the 0.7.19/0.7.20 lesson: lines drafted from PR titles overclaimed twice).

## In the file now (merged)
1. #5118 (b08eca20c) chat "Agents speak your language": "On a Mac set to another language, a new agent now starts and
   posts in that language instead of English." Checked against the PR: an English Mac sees no change; only a sure read
   of the Mac's first language acts; measured on Claude Sonnet in Spanish and Portuguese only (hence "a new agent", and
   no claim about other providers).

## Drafted, added as each merges (ranked by the day-one path; the top five that have merged go in)
1. #5114 (Mona, branch aimodels-5114 @ 72c7eff72; merges CI-starved on its validation) spark "Points to the right
   place": "When an agent cannot start without a Claude or OpenAI account, Kosmos now sends you to Settings, AI Models,
   where you add one." Checked against the branch: every refusal and remedy now names "Settings, AI Models" (was "the
   Accounts tab", which does not exist); covers Claude and OpenAI wording.
2. #5101 swarm "Switching to Claude works": "Switching an agent to Claude now offers your Claude accounts to pick from,
   and the panel stops describing the old provider."
3. #5093 phone "Honest computer status": "A computer with remote access off now reads \"Remote access off\" on your
   Kosmos+ account page, not \"Answering now\"." (Caveat for the ENTRY, not the line: a computer already off when it
   updates can read "Answering now" until its next check-in, up to 12 hours.)
4. #5104 shield "See what your agent asks": "When Claude Code asks an agent whether to switch models, its page shows the
   question, not \"cannot find the question\"."
5. #5116 list "The connection line stays visible": "When a notice floats at the top, the \"cannot reach a Claude
   subscription\" line now sits below it, not hidden under it."
6. #5108 chat "Agents report Kosmos bugs": "Agents can post a Kosmos bug report to the Kosmos+ community and are told to
   leave out your files, logs and screens."
No line: #5103 (cut safety), #5094/#5092 (test guard), #4601 test fix.

## Weakest premise
The ranking: #5108 is day-one for us (bug reports from the beta) but not for the person, so it ranks last.

## Review 1 (sonnet, blind, 03:10, against the PR diffs): NOT CONVERGED; 4 WARNINGs, all taken
- #5093 "says so" -> the page's own words "Remote access off"; the 12-hour upgrade caveat goes in the entry.
- #5104 "found none" -> the app's "cannot find the question".
- #5116 named the line by the app's real text.
- #5108 OVERCLAIM: "never your files" is only a prompt instruction, not enforced -> "are told to leave out"; "Kosmos+ community".
- #5101 NIT ("the panel" vague) left. #5114 line since rewritten from Mona's branch (after this review): re-review at cut.
