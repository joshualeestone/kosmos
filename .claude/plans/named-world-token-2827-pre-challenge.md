---
pre_challenge: true
method: challenge-loop
branch: named-world-token-2827
diff_hash: 3cb4861be999965ce707053c9e0b186cdc5615ba6815dff08b4c236ceb70021b
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T22:25:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviewer passes (opus). **Converged:** iteration 3 built the
full spawn-class table and found nothing unguarded.

Card #2827: a named (non-default) Kosmos world lets agents run but their board token
is refused, so reports/replies fail. engine/worlds.js redirects a named world's
data/workers/projects roots but deliberately NOT its launch env, so an agent that runs
while the board is booted into a named world presents a token that does not match the
board. Fix: enforce the documented v1 rule (named worlds do not run agents) with a
server guard `namedWorldSpawnRefusal()` (409 when worldenv.bootedWorld() is named;
null and DEFAULT_ID allow), called before every spawn.

### The class, found across three iterations (the value of the loop)

The first enumeration guarded only POST /api/agents and POST /api/team. Each blind
iteration then found one more route that installs or re-enables a runnable agent:

- Iteration 1 [BLOCKER]: POST /api/connect-agent (discover.connect -> create.installJob
  installs a launch job AND starts the agent) was unguarded. FIXED. Also raised restore
  as a WARNING; guarded it in the same commit.
- Iteration 2 [BLOCKER]: POST /api/register (register.repair -> create.installJob
  installs the missing job for every jobless agent and starts it) was unguarded. FIXED.
- Iteration 3 [CONVERGED]: built the exhaustive table of every production path that
  installs/re-enables a runnable agent's launch job and confirmed all five routes now
  call the guard:

  | spawn mechanism | route | guarded |
  |---|---|---|
  | create.createAgent (own constructor/bootstrap block) | POST /api/agents | yes |
  | team.createTeam -> create.createAgent per member | POST /api/team | yes |
  | discover.connect -> create.installJob | POST /api/connect-agent | yes |
  | register.repair -> create.installJob | POST /api/register | yes |
  | removal.restore (re-enables the launch job) | POST /api/agent/:name/restore | yes |

  Verified NON-spawns (correctly unguarded): the three /api/agent-import* routes parse
  and pre-fill the create form only; worlds.importAgents copies identity-stripped
  profile JSON (no job); /api/first-run/complete seeds a project; installSupervisor
  refreshes the boot script, starts no agent. The restart family (/restart,
  /trust-and-restart, provider/model/account change) is out of scope: restartInner
  refuses unless the agent is ALREADY running (remove.js: FOUND.NONE / !job), so it
  bounces a live job and never re-enables a stopped or removed one.

  Lesson kept: enumerating callers of the installJob PRIMITIVE alone was insufficient
  (createAgent/createTeam reach launch via their own constructor, not installJob) --
  the ROUTE enumeration is what proves completeness.

### bootedWorld vs activeWorld, placement, restore

- The guard keys on bootedWorld (the world the board actually booted into), not
  activeWorld (the registry pointer), because a switch only records activeWorldId and
  needs a restart; bootedWorld is what determines whether a spawn is actually broken.
  All three reviewers confirmed no case where they diverge in the dangerous direction.
- Each guard sits before its spawn action and matches the route's response contract
  (/api/agents, /api/team, /restore, /register use {error}; /api/connect-agent uses
  {ok:false, because}); single sendJson + return, no double-send.
- restore is correctly in scope: it re-enables the launch job for any removed agent
  (not default-world-only), so it genuinely re-runs in the current booted world.

## Validation

- New test server.named-world-spawn-2827.test.js: with worldenv.bootedWorld stubbed to
  a named id, all FIVE routes refuse (409, the named-world message; /api/agents also
  asserts no worker directory was written); with DEFAULT_ID and with null, they are
  allowed past the guard (the two controls assert not-409 AND not the named-world
  message -- genuine discriminators). 7/7 pass. The refusal is proven red-capable by
  disabling the guard (the five named-world arms red, the controls stay green).
- ~500 targeted spawn/connect/removal/register-adjacent tests pass with no regression
  (the guard does not fire in default-world sandboxes).
- Full node suite (tools/run-tests.sh): 6191 tests, one failure -- fixture-discipline
  flagged the new test for not sandboxing ~/.claude.json (its default-world control
  POSTs /api/agents). FIXED by setting AGENT_WORKFORCE_CLAUDE_CONFIG to a sandbox path
  (verified: fixture-discipline 20/20, the test still 7/7). The other 6182 tests
  passed; CI re-runs the full suite as the final gate.
- Server-only change (no web/), so the browser-check gates do not apply.
- subdir CLAUDE.md audit: passed (no CLAUDE.md touched).

## Scope

Agents already created in a named world before this fix stay broken; the guard only
blocks NEW spawns/re-enables. Acceptable for v1 (resolved by switching back to Kosmos
1) and matches the card's direction 1.

## Outstanding questions

None.
