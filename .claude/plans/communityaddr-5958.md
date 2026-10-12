# communityaddr-5958: the first-post line is a condition the agent can check

Card kosmos#5958, item 2 of 5 ("Stale first-post line"). From the Windows agents' 0.7.38 QA (Josh, 2026-10-12 10:01).
The other items are on other branches (kosmos-community `oneaddr-5958`, kosmos-relay `digestnames-5958`).

## What the card says, and what was measured
The card: the community section "keeps saying make your first post an introduction after the agent has already
posted. Make it depend on the agent's community history."

It already did (#5023). The line is written only for an agent the post store says has no post, and the board-start
refresh drops it once there is one. What was still wrong is one level down: **an agent reads its instructions once.**
The copy it holds says "You have not posted to the community yet" for the rest of that session, including after its
first post. No rewrite of the file reaches that copy.

## The call
Word the line as a condition the agent can check, so it is true whenever it is read:

    If you have not posted to the community yet, make your first post an introduction: ...
    To check, run kosmos community status: each post you have made is a line starting "- post", whatever state
    it is in (sent, waiting, held or refused), and a comment is not a post.

## Change
- `engine/communityblock.js`: `INTRO_LINES` reworded. `INTRO_LINES_BEFORE_5958` keeps the earlier wording, because
  files written by earlier builds still carry it. The board-start refresh treats both as the introduction
  (`INTRO_LINES_EVER`): an agent that was being asked and whose post store cannot be read keeps being asked, in the new
  words, and replacing the old wording with the new is not reported as a change of rules (which would owe every such
  agent a re-read of its instructions for one reworded sentence).
- The introduction is 460 bytes now (277 before), for an agent with no post only. The existing rule still holds: at
  the size limit the introduction gives way and the agent keeps the block.

## Rejected
- **Owe the agent a re-read when its first post lands**, so its loaded copy loses the line. It interrupts a working
  agent to remove one sentence, and #5297 decided this line coming or going is never sent as a change of rules.
- **Write the line always, for every agent.** #5023 chose not to ask an agent that has posted; a condition in the
  sentence does not undo that, but dropping the store check would put the sentence in front of every agent for ever.

## Verify
- `engine/communityblock.test.js`:
  - #5958 wording: the line opens with the condition and names `kosmos community status`; the block never states
    "You have not posted" as a fact (control: the same pattern matches the wording it replaced).
  - #5958 refresh: a file carrying the earlier wording gets the new wording and `rulesChanged` is false, with no post
    and with an unreadable store; with a post, the earlier wording goes and nothing replaces it.
  - The #5023, #5171 and #5297 tests follow the new wording.
- `engine/create.test.js`: the four pins follow the new wording. 229 of 229.
- Mutants, each run, each red by name and restored:
  - the rules comparison forgets the earlier wording: red at the #5958 refresh test;
  - the keep rule forgets the earlier wording: red at the #5958 refresh test;
  - the line states it as a fact again: red at the #5958 wording test and two #5023 tests.

## Weakest premise
That an agent checks before acting on a conditional sentence. An agent that has posted may still read "make your
first post an introduction" and write a second one. The sentence names the command that answers it; nothing forces
the agent to run it.

## What would change this
A second introduction from an agent that had already posted, seen on the community after this ships.

## Known limit of the check
`kosmos community status` prints the newest 20 of an agent's posts and comments and counts the rest as "(and N
older)". An agent with one early post and 20 or more later comments sees no "- post" line. The file's own rule (the
post store) is not fooled, so that agent's file loses the line at the next refresh; only the copy it already holds
can mislead it, and only in that case.

## Review 1 (2026-10-12)
- **WARNING, taken:** the sentence sent the agent to a command without saying what to look for; status mixes posts
  and comments and shows a refused or held post in words an agent could read as "not posted". The line now says a
  post is a line starting "- post" in any state, and that a comment is not a post. The 20-item cap is stated above.
- **WARNING, taken:** the test only checked that a function existed. `engine/communitystatus.test.js` now holds the
  status output to the block's sentence: no post and no comment, a comment only, and two posts in different states.
- **NIT, taken:** the keep rule and the rules comparison derived "carries the introduction" separately. One list now.
- **NIT, taken:** the wording test's name claimed more than it can fail on. Renamed to what it checks.
- **NIT, not taken:** a comment saying the swap does not reach running agents. That reasoning is in this plan.
- **NIT, not taken:** an arm for the earlier wording at the size limit with an unreadable store. The size fallback
  is covered by the #5023 size test and the unreadable-store keep by the #5958 refresh test; the combination adds no
  new branch (the fallback body has no introduction in either wording).
