# #4649: the new outside-sharing routes are behind the federation switch (Splinter's 0.7.23 question)

Splinter asked whether everything new in #5266 is behind the federation switch, OFF on live. It was not, at the route
level. federationLiveNow() only told the page whether to show the screens. The plan's `federation_invites_live` field
was never built (it belongs to the switch-on step). No page called the new routes (Pete's screens are unmerged), but
someone at the screen could call them by hand and reach the coordinator.

## Call
GET /api/federation/members, POST /remove, POST /withdraw, and POST /invite with `project` (an existing project) answer
404 "Sharing a project with people outside this computer is not turned on yet." unless federationLiveNow() (the
coordinator's /v1/meta federation_live, or the operator override AGENT_WORKFORCE_FEDERATION_LIVE=1). The check comes
before anything is signed. federation_live is false on the live coordinator (read from login.kosmosplus.com/v1/meta,
2026-10-04 ~11:40 CDT).

## Not changed, stated
The pre-#4649 routes (POST /invite with project_ref from the create screen, /verify, /join, /own-code) are ungated on
the server, as they have been since #3311: only the page hides their screens. Gating them is a separate decision
(they shipped in every release since), raised on #4649.

Review round 1 (opus): the old ungated paths, reachable by hand only since their screens are hidden, now carry two
#5266 side effects. The owner's room gets "<label> joined." / "Someone joined from outside." when a member pins, and
the member's room gets the join note from /join. Both are one local room line, with no coordinator call. Stated, not
gated, with the old routes' posture.

## Tests
server.fedmembers-4649.test.js: with the switch OFF, all four answer 404, nothing is signed, and no owner link is
recorded. CONTROL: the create screen's invite still works. Switched back on, the same request works. Each route's 404 is
asserted by the gate's own sentence (review round 1: a never-shared project 404s on Remove/Withdraw without it).
Mutations removing the Members gate, and the Remove gate, each red it. The other route tests run with the switch on. Focused: server.fedmembers-4649,
server.federation-3311 and server.guide-secrets-3769, 56/56.
