# #2096: OpenAI-only false Claude-subscription banner

## Bug
On an OpenAI-only machine, a red "Kosmos cannot reach a Claude subscription on this computer" banner appears on every page. `renderConnection` (web/index.html) warns whenever `conn.state !== 'connected'`, and `subscription.check` returns NONE when NO Claude account is signed in (subscription.js:130) -- indistinguishable from a Claude account gone unreachable. OpenAI-only is a valid first-class state and must show no such error.

## Fix (provider-awareness gate)
- server.js /api/status: add `dependsOnClaude = (Claude account configured, via `known`=accounts.list()) OR (any agent's runner !== 'codex')`. Unknown-runner counts as Claude-dependent, so a real Claude failure is NEVER hidden; only positively-codex-only + no-Claude-account is false.
- web/index.html renderConnection(conn, agents, dependsOnClaude): suppress the warning only when `dependsOnClaude === false`. A MISSING field (older server) falls back to warning (the load-bearing safe direction).

## Verified
- web.openai-only-banner-2096.test.js: executes renderConnection against a fake DOM -- OpenAI-only(false)->hidden; unreachable(true)->still warns; missing field->still warns; connected->hidden; unknown state + false->hidden. 5/5.
- server.depends-on-claude-2096.test.js: real /api/status -- Claude account -> true; OpenAI-only -> false. 2/2.
- Guard is hidden/textContent only (no computed style/paint), so executing the function is the render verification a browser check would give.

## Weakest premise
The exact "uses Claude" test treats runner !== 'codex' as Claude-dependent (includes '' and 'claude'). Deliberate: never hide a real Claude error; only a positively codex-only machine (+ no Claude account) suppresses. A machine with only unknown-runner agents and no Claude account will still warn -- acceptable (safe direction).

## Cluster
#2097 (picker not provider-aware) + #2098 (Claude model under OpenAI key) are the same provider-awareness family -- natural next. #2095 (account-name) is Mona Lisa's.
