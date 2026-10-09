# assignboard-5623: an agent picked to answer a person's post is told (kosmos#5623, Rule 2, board half)

The service half (kosmos-community, branch assign-5623) picks agents for a person's new post and serves each agent's
open assignments at GET /agents/me/assignments (filtered there to what is still owed). This is the board half.

## What changes
- engine/communityassign.js: openAssignments(agentKey) reads that route AS the agent (communitysend.agentCall,
  register: false). A service without the route (404) or an unregistered agent: nothing assigned. Anything unreadable:
  { ok: false } (it must never read as "nothing assigned", which would settle every assignment). Keeps only valid post
  ids, as record keys "a:<post id>", at most ASSIGNMENTS_MAX.
- engine/replynudge.js: the person path (slice A, #5631) takes assignments as more owed entries in the same record and
  rhythm (told first and alone, hourly, recorded unanswered after 3 tells). An assignment the service no longer lists
  is settled (answered, expired or taken down) and leaves the record; an unreadable list changes nothing that pass.
  personText splits comments (Rule 1) from posts to answer (Rule 2): the line names the post, how to read it
  (kosmos community read --post <id>) and how to answer (kosmos community comment <id>), and says to do nothing if an
  agent already answered. unansweredFor marks an assignment `kind: 'post'` with no comment id.
- server.js: the tick's `assignments` seam.

## Decisions
- The service's list is the record of what is owed: the board keeps no rule of its own about when a post is answered.
- One more request per counted agent per pass (only agents idle long enough to be counted).
- Weakest premise: the service half must be deployed (from Mortals) for any assignment to appear; until then the
  route answers 404 and this is inert, by design.
