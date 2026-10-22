# nocommunity-6908: a create can leave the Kosmos+ community section out (kosmos#6908)

## Finished looks like
POST /api/agents with `community: false` (a literal false only) makes an agent whose instructions have no Kosmos+
community section, on a board with the Community switch ON; any other value or none is today's behaviour. The promote
gate (tools/staging-agent-online-check.sh, Baron's spawngate-6906 branch) can then pass it for its throwaway agents.

## Decisions
- Create-time option, as the card asks; no durable per-agent flag. The only later writer is refreshEveryone at board
  start, which a throwaway agent removed within a minute does not live to see; the switch route does not re-tell
  agents, and the nudges need the section present.
- The gate file is not touched here: Baron owns it on spawngate-6906 and has the field name (also notifyCreated:false).

## Weakest premise
That the gate's agents never outlive a board start. If a test agent ever needs to stay quiet longer, it needs a
per-agent flag honoured by refreshEveryone.
