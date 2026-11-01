# agentlist-7748: small CLI gaps from feedback (kosmos#7748)

1. `kosmos agent list`: every agent, its role, running or not. A new GET /api/agents/list answers three fields per agent and joins AGENT_TOKEN_ROUTES, because a Windows agent holds no board token and /api/status carries far more than an agent needs. Rejected: reading /api/status from the CLI.
2. `kosmos project create` on a missing folder prints the command that makes it, on both CLIs. Rejected: the board making the folder, which would let an agent's request create a folder anywhere on the computer.
3. `kosmos agent roles` groups by the catalogue's group, and `kosmos agent roles <word>` narrows by key, label or group. A word that matches nothing exits 1. The line format changes: rows are indented under a heading.
4. `kosmos connections` exiting non-zero: NOT reproduced and not changed. rc=0 on 0.7.81 on a plain run, with `| head -1`, and on six runs with stdout closed early (`| true`). On reading, the only non-zero exits follow an unreachable board or an unreadable answer, and each prints its own line. Would change my mind: a report with the shell, the output and the exit status.
5. GitHub and Vercel: `connectionsHeld` now reads the tool's own file (engine/signedin.js), gh's hosts.yml and Vercel's auth.json, with no call to either service. A file holding a sign-in reads connected, "signed in with its own tool". No file stays "not known without a live check", because a tool can keep its sign-in elsewhere.

Words live once in engine/clilists.js, which both CLIs run.

Weakest premise: a file holding a sign-in says nothing about whether the service still accepts it. A token row has the same limit and says so; so does this line ("Settings > Connections checks it when opened").
Not measured: Windows paths in engine/signedin.js for gh and Vercel are from their documentation and code, not from a Windows box. They fail to "not known".
