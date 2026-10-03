# whatsnew-0721: What's New for 0.7.21, the "ready for Monday" release (cut Saturday 2026-10-03)

At most 5 highlights (tools/whats-new-check.js). Only MERGED, user-visible changes get a line. Each line is re-read
against the MERGED diff before the cut (the 0.7.19/0.7.20 lesson: lines drafted from PR titles overclaimed twice).

## In the file now (merged; #5104 dada48e9b and #5108 e64a54a23 added 03:37, lines as reviewed in review 1)
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
- teamcopy-4554 (Mona, merged 55e84aaa7): the Team card says "agents who report to it", not "people". One word; no line (below the cut of 5).

## Re-rank 05:10 (Splinter: cap 5, ranked for a NEWCOMER on Monday). In the file now, in this order:
1. #5126 (#5114, merged; rebase-merged, product commits before 8b52b62df) "Points to the right place". Checked on main:
   engine/create.js / server.js / web/index.html carry "Settings, AI Models" (8/2/22) and "Accounts tab" 0 times; the
   refusals read "Connect a Claude account in Settings, AI Models" and "Add an OpenAI key in Settings, AI Models".
2. #5118 language (merged). 3. #5101 switch to Claude (merged 2324fe4c9). 4. #5104 safeguards question (merged).
5. #5108 bug reports (merged): HOLDS THE LAST SLOT ONLY UNTIL #5093 merges (Kosmos+ beta users on day one), then out.
Waiting: #5093 replaces #5108; #5127 ("Terminal tab" copy) and #5128 (Gemini hint skips AI Models), Mona, in flight:
when they merge, FOLD into line 1 rather than take a slot, e.g. "Instructions now point to places that exist: Settings,
AI Models, and an agent's AI Settings." (re-check against their merged text). #5116 (notice over #conn): no slot (a
newcomer has a fresh sign-in). #5124 teamcopy-4554 and #5092/#5094: no line.
Reasoning, weakest premise: #5101 above #5104 assumes a newcomer switches providers on day one more often than they meet
Claude Code's safeguards menu; both are plausible, neither measured.

## Review 2 (sonnet, blind, 05:09, the five file lines vs main): NOT CONVERGED; 2 WARNINGs, both taken (verified in code first)
- Line 1 said "Claude or OpenAI" and "cannot start": the refusals also cover Gemini and Grok (create.js expiredSignIn /
  rejected-key remedies are per provider) and the case is CREATING an agent. Now: "Creating an agent with no AI account
  now points you to Settings, AI Models, not an Accounts tab that does not exist." Title "Setup points to the right place".
- Line 2 said "a new agent": the boot sweep (server.js #5050 block) refreshes EXISTING agents too. Now "your agents".
- NITs left: #5101 title implies it was broken (it was, per Josh's live report); #5104 does not say "no buttons".

## Review 3 (sonnet, confirmation, 05:11): NOT CONVERGED; 1 WARNING + 1 NIT, both taken
- Line 2 read as a guarantee; fallbacks leave an agent in English (a full instructions file, an unsafe path). Now:
  "agents are now told your language, so they start and post in it instead of English."
- Line 1 NIT: a Gemini/Grok create with NO account is not refused at all, so "with no AI account" overclaimed for them.
  Now conditional on a refusal: "When an agent cannot be created because its AI account is missing or not working,
  Kosmos now points you to Settings, AI Models." (every refusal of that kind names it: create.js 3937-3940, 3966-3967,
  4019, 4035, 4063, 4094).
