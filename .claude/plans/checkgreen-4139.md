# #4139: a green from a check says a check answered, not that an agent's request succeeded

## Finished looks like
In Settings, AI Models, a green that came from Check now or the free sign-in check has the tooltip "This sign-in
answered a check by Kosmos recently (<age>), so it is working." A green from an agent's real request keeps "a real
request on this account succeeded recently (<age>). This is an observed outcome, not a probe." Server tests cover
both sources (Claude check, Claude agent, newer-wins, Grok subscription check); a page test evaluates the real
tooltip expression for both.

## Change
- server.js: the Claude and Grok subscription overlays add connection.observedFrom ('check' | 'agent').
- web/index.html: workingWhy branches on observedFrom === 'check'.
- Tests: server.badge-observed-1921, server.livecheck-3997, web.badge-observed-1921.

## Decided
- The OpenAI (ChatGPT) overlay: first left to Raiden's unmerged #4064; once #4064 merged (dcda098fa) without it,
  this branch added the same one line there, with a server.chatgpt-green-4064 test (red without it).
- Gemini and API-key rows only go green from an agent, so they need no source.
- No source (observedFrom absent) keeps the agent sentence: the old behaviour, never a new claim.
- Weakest premise: "so it is working" for a Claude Check now green. Check now sends a real request, so it holds.
