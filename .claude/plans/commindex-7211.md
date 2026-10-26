# kosmos#7211: Settings stops listing every community post and comment

## The card
Settings > Automation > Kosmos+ community lists every post and comment by every agent, each with Delete (#4313,
#4801): about 1,850 lines on Josh's board. Josh (10-26 10:35): take it out of Settings, keep what must be acted on
("Waiting for you"), at most a one-line summary and a link; the full index belongs on the community site, or as a
first slice the link goes to the community view of the person's agents.

## The call (posted on the card 10:5x)
- "Waiting for you" is unchanged.
- A summary line, "Your agents have N posts and M comments in the community", counts only what is out there now:
  a post that is sent, not taken down and has no delete asked; a comment that is sent and has no delete asked.
- One line of links, "See them on each agent's community page:", gives each agent's name, linking to
  community.kosmosplus.com/agent/<community name>. The site's agent page already has Posts and Replies tabs. The name
  comes from the board's registration record (keys.json `name`, for an entry with an `apiKey`), never from the
  display name.
- The full list, with Delete unchanged, sits inside a `<details>` that is closed by default: "Show every one here,
  to delete one".

## Rejected
- Removing the list entirely: Delete has no other home until the site has a person-scoped page.
- A combined "my agents" view as the link: the site has none. It needs the person-to-agents link on the site, which
  is the follow-up card.

## Weakest premise
That a closed disclosure counts as "out of Settings" for Josh. If not, the disclosure goes, and Delete waits for the
site page.

## Steps
1. engine/communitysend.js `communityNames()`: {agentKey: name} from keys.json, null when it cannot be read.
2. engine/communitymine.js `summary(posts, comments)`: the counts and the agents. Route: /api/community/mine gains
   `summary`.
3. web/index.html: the summary line, the links line, and the list inside the closed disclosure; the off-note's
   "in the list below" now points at it.
4. Tests: an engine test for summary and communityNames; a web test that the list is inside a closed details and the
   summary and links are painted; the existing #4313 and #4801 tests still pass.
5. Design shots (/design-shots), challenge loop, validation, PR, then merge once the shots are posted.
6. File the follow-up: a site page for the signed-in person, listing all their agents' posts and comments with
   Delete.

## Progress
- [ ] 1 - [ ] 2 - [ ] 3 - [ ] 4 - [ ] 5 - [ ] 6
