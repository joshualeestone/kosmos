# CLAUDE.md

This file guides Claude Code when working in the **Kosmos** repository (the app is
`agent-workforce`; the product is Kosmos: "manage a workforce of AI agents on your own
Mac"). Read it, and `~/.claude/CLAUDE.md` (the machine-wide conventions), before starting
work. Both load automatically, but a challenge-loop reviewer's Step 1 reads this file
explicitly to learn the repo's pre-PR commands and conventions.

## Commands

### Run

- `node server.js` (or `yarn start`) launches the local board (a web server). The board's
  port is derived per-OS-user, not fixed, so do not assume a specific port.
- The shipped product is a bundle (the app + a pinned Node runtime + the `kosmos` CLI)
  under `~/.local/share/kosmos`, installed via
  `curl -fsSL https://installkosmos.com/setup | sh` (runs `install/setup.sh`). There is no
  Electron; `native-app/main.swift` is the thin macOS wrapper that fronts the bundle.

### Test

- `yarn test` runs `bash tools/run-tests.sh` (the canonical runner). Do NOT invoke
  `node --test` with a bare glob directly (see Repo-Specific Conventions below).
- `yarn test:shell` runs the large shell-and-tooling suite (`bash -n` syntax checks plus
  focused tool tests); `run-tests.sh` invokes it.
- `yarn test:install` / `test:install-gate` exercise the installer.
- The `windows` CI job (#1777) runs the Windows test files on a real Windows runner:
  `node tools/windows-tests.js`, which says what it selects and how it judges. A red there is
  news a Mac run cannot give: a Windows defect, or (more often so far) a test that assumes macOS.
  Its lists, each entry with its card or reason: `KNOWN_RED` (tests expected to fail), `FLAKY`
  (not judged), `ALL_SKIP_OK` (may skip everything on the runner) and `HOST_BRANCH_EXCLUDED`
  (Windows-branching files left out).
- **Use yarn, not npm.** The scripts are also npm-runnable, but `tools/run-tests.sh` itself
  shells out to `yarn` (`yarn -s test:shell`, in its default `all` part, which is what `yarn test`
  runs locally, and in an unsharded `shell` part; CI runs sharded parts through
  tools/shell-shard.js, #4317), and its own coverage-mismatch message names
  `yarn test` the canonical helper, so yarn must be present locally. There is no
  committed lockfile or `packageManager` pin.

### Build / Lint

- **No build step for the app** (it runs from source). Release bundles are cut by
  `tools/build-*-bundle.sh` and `tools/release.sh`.
- **No linter and no type-checker.** The `type-check` and `lint-fix` scripts are intentional
  no-ops: this is plain JavaScript, not TypeScript.

## Architecture

### High-Level Structure

A single-app Node.js codebase (plain JavaScript, `node >=26`). The board is a local web
server (`server.js`) whose UI is a single committed page (`web/index.html`). The engine
(`engine/`, over 100 source modules plus their colocated `*.test.js`) holds the domain logic:
accounts, agents, chat, activity, the
board-auth model, install/update, multi-world ("Kosmos") switching, and provider sessions
(Claude Code and Codex). Tooling in `tools/` builds, releases, and gates the product;
`install/` is the end-user installer.

### Module Map

| Directory | Purpose |
|-----------|---------|
| `engine/` | Core domain logic (over 100 source modules, plus colocated `*.test.js`): accounts, agents, chat, activity, board-auth, autoupdate, worlds (multi-Kosmos), provider sessions. `engine/store.js` owns the ONE data-root derivation (`store.ROOT`). |
| `web/` | The board UI: a single committed page (`web/index.html`) plus icons and the web manifest. |
| `tools/` | Build, release, and gate scripts. `tools/run-tests.sh` is the canonical test runner; `tools/lib/` holds shared shell libs; `tools/release.sh` cuts releases. |
| `install/` | The end-user installer (`setup.sh`, the `kosmos` command, pkg scripts). |
| `deploy/` | Board/site deploy scripts (`deploy/install-board.sh`). |
| `bin/` | Runtime helpers: `bin/agent-supervisor.sh`, the Codex report bridge, etc. |
| `native-app/` | `main.swift`, the thin macOS app wrapper that fronts the bundle. |
| `docs/` | Repo docs, including `docs/browser-checks/` (rendered-surface assertions), `docs/walks/`, `docs/screenshots/`. |
| `assets/` | The Kosmos icon master and generated `.icns`. |
| `test-support/` | Test fixtures and helpers (`fake-tmux.sh`, discovery fixtures). |
| `.githooks/` | Committed git hooks (`pre-commit`, `prepare-commit-msg`). |

## Where to Find Things

| Task | Where to Look |
|------|---------------|
| Run the test suite the way CI does | `yarn test` -> `tools/run-tests.sh` |
| Change a ready-made role or a prebuilt team (#4555, #4632) | Edit it in the public repo `joshualeestone/kosmos-catalogue` (one file per role and per team; its README says how). A merge there publishes a signed `catalogue.json` that boards download when the role picker opens, and when the Team step's reads are asked for (`GET /api/teams/seeded` and `/api/teams/seeded/<key>`, #4557; the dropdown that opens that step is #4556's) (`engine/catalogue.js`). Nothing in this repo changes, except `test-support/catalogue-published/` (catalogue.json and its .sig, fetched together from Pages) when a test needs the newer catalogue. Adding, removing or renaming a BUILT-IN role in `engine/roles.js` is the exception: update the catalogue repo's `kosmos-builtin-roles.json`, then refresh `test-support/catalogue-published/` (`engine/catalogue.download-4632.test.js` fails until both agree). |
| Work on making a whole team at once (#4557) | The builder: `engine/teamseed.js` (one create spec per member, lead first; `POST /api/teams/seeded/<key>/specs`). A member's team brief is layered into its role text by create's `teamInstructions`, as the `kosmos:team` block. The screen: `#cstep-team` and the `tc*` functions in `web/index.html` (`openTeamCreate`, `tcRun`, `tcWatch`). Its checks: `engine/teamseed.test.js`, `server.teamseed-4557.test.js`, `teamcreate-structure-4557.test.js`, and the browser check `docs/browser-checks/render-teamcreate-4557.js` |
| Read a red `windows` check (#1777) | `tools/windows-tests.js` (selection, verdict, `KNOWN_RED`); it runs on windows-latest only |
| Add or change a test | Most suites are dot-namespaced at the repo root (`web.foo.test.js`); `engine/` mostly colocates in-directory. The runner (`tools/run-tests.sh`) considers every `*.test.js` in the tree (see Repo-Specific Conventions) |
| Change the board UI | `web/index.html` (single page); a committed change here needs a browser-check assertion or a `Browser-check:` trailer |
| See which browser checks a page PR runs, and why (#4119) | `node tools/bc-pr-select.js origin/main HEAD`; the PR job runs the fixed allowlist plus that selection. How a check is selected: the tool's header and `docs/browser-checks/README.md` |
| Find the data root / Application Support path | `engine/store.js` (`store.ROOT`) |
| Work on multi-Kosmos switching | `engine/worlds.js`, `engine/worldenv.js`, `engine/worldbootguard.js`, `engine/boardrestart.js`; the switch route in `server.js` (`/api/worlds/active`) |
| Work on a Kosmos's agents (named worlds) | `engine/launchidentity.js` (the world-keyed task / label / session key), `engine/worldstarts.js` (starting a Kosmos's paused and imported agents when it opens), `engine/worldimport.js` (copying agents from one Kosmos into another), `engine/outbox.js` (a kept-running agent's sends, kept in its own Kosmos until that Kosmos is open again); the routes `/api/worlds/import` and `/api/worlds/list` in `server.js` |
| Add a provider (account module or session reader) | Per-account creds + live check: `engine/claudeaccounts.js`, `engine/openaiaccounts.js`, `engine/geminiaccounts.js`, `engine/grokaccounts.js` (each an account = a directory with a key file / sign-in). Session transcript readers: `engine/codexsession.js`, `engine/geminisession.js`, `engine/groksession.js`, `engine/agysession.js` (Antigravity's conversation SQLite, read-only, #4039). A Gemini model's assumed window: `assumedGeminiWindow` in `engine/status.js`. Live auth probe: `engine/authprobe.js`. The account env var per runner is `engine/accountenv.js`; the supervisor injects a per-account key in `bin/agent-supervisor.sh`. Antigravity (`agy`, #3568, behind `AGENT_WORKFORCE_ANTIGRAVITY=1`): its Google sign-in is driven out of sight by `engine/agysignin.js` (a tmux session on its own socket; the person pastes Google's code into Kosmos, #3998; the hidden-tmux plumbing it shares with other sign-ins, such as the socket, the tmux call and the live-execution gate, is `engine/tmuxsignin.js`, #4195), and Settings lists it as a Gemini subscription row from `engine/agystatus.js`'s remembered last answer; its folder-trust pre-answer is `engine/agytrust.js`, which also holds agy's dir (`agyHome`, the one derivation); its status hooks (Working / Idle / Needs you, #4043) are written into the agent folder's `.agents/hooks.json` by `engine/agyhooks.js` (the supervisor calls it before each launch), and for agents already running at board start by `engine/agyrefresh.js` (#4353) |
| Warn before an agent's login expires | `engine/loginexpiry.js` (reads the keychain refresh-token expiry per account, keyed on CLAUDE_CONFIG_DIR set-vs-unset; per-account advisories); wired into `snapshot()` in `engine/status.js` as `loginAdvisories`; the board pill is `paintLoginAdvisories` in `web/index.html` |
| Read a Claude account's weekly usage | `engine/kosmos-statusline.js` (the status line Claude Code runs; records `rate_limits.seven_day` into `<account dir>/kosmos-weekly.json`, forward-only, prints nothing), `engine/allowance.js` (`ensureStatusLine`, merge-only wiring; `readWeekly`; the tokens-per-point calibration, `calibrate` / `readCalibration`, stored in `<account dir>/kosmos-weekly-calibration.json`); wired by `accounts.prepare` and the report-hook block of `install/setup.sh`, named on uninstall (#3946). Which account an agent is on: `status.claudeAccountDirOf` |
| Work on phone notifications | `engine/phonenotify.js` (the Mac-level switch, off by default; the notify token minted through `remote.macRequest`; the sender), `/api/phone-notify` and the needs_you / reply hooks in `server.js`, the Phone notifications control in `web/index.html` (`push-client` block). Phones receive them through the Kosmos phone apps (Josh, 2026-09-24: apps only); the coordinator pushes: `kosmos-relay/coordinator/src/notify.rs`, `push.rs` (#718). Where a tap lands: a phone's web push is handled by the COORDINATOR's worker (`kosmos-relay/coordinator/src/sw.js`, `tapUrl`), iOS by `ios/Kosmos/PushBridgeLogic.swift`, and a board-origin subscription (none today) by `web/sw.js` `boardUrlFor`; all build `?tab=detail&agent=<session>` with one rule (`TAP_SESSION`). Then `settleWantAgent` / `detailRevealTalkOnPhone` in `web/index.html` (the phone landing) |
| Work on Agent Swarms (#3564, one voice, Claude only) | The engine: `engine/swarm.js` (the settings on the profile, the lead's managed `kosmos:swarm` block, the meter that reads the lead's transcript folder and `<session>/subagents/agent-*.jsonl`, the one-minute daily-limit sweep). Paused is enforced in `chat.deliver`; Stop now's helper stop is `chat.stopHelpers`. Per project Off: `projects.swarmOffIn` / `setSwarmOn`, honoured by room posts (`engine/messages.js`), the task message route and the "you were given task N" line (`heardBy`) in `server.js`, and the Assigner (`engine/assigner.js`). Routes: `PUT /api/agent/:name/swarm`, `POST /api/agent/:name/swarm/stop`, `PUT /api/project/:id/swarm/:name`. The daily limit as a % of the weekly allowance (#3946): `dailyAllowancePct` on the profile, turned into tokens by `swarm.rederiveLimits` from each account's calibration (`calibrateSwarmAllowances` in `server.js`, run before the sweep). Tests: `engine/swarm.test.js`, `server.swarm-3564.test.js`, `server.allowance-3946.test.js` |
| Work on the setup guide (the helper bubble's agent) | Its role text: `engine/roles.js` (`setup`; `SETUP_HANDS_OFF` for settings, `SETUP_MAKES_AGENTS` for making agents, #3734). Seeding, the hosted assistant and rewriting an existing guide's role: `engine/setup-assistant.js`. Routes: `/api/setup-guide`, `/api/setup-guide/hosted`, `/api/setup-guide/page`. It makes agents with `kosmos agent create` (`install/kosmos` `cmd_agent`, and `tools/windows/kosmos-cli.js`), a one-member `POST /api/team` (#1279) that runs the member where its creator runs (`creatorRunsOn` in `server.js`). When no role fits (#4474): `kosmos agent role-draft` prints the default text and `kosmos agent create "<name>" --new-role "<label>" --from <file>` makes an agent from the agent's own text; an agent's members are vetted in `engine/team.js` `vetAgentMember` (only the fields an agent may send, never the setup role, own text only as `own`, the shared rules kept word for word). Only the Project Manager is taught the new-role form; the setup guide is not, and the server refuses a role it writes. The Project Manager role is taught the create verb too (`PM_MAKES_AGENTS`, #1279) |
| Work on the agent page's Files list (files an agent makes in a Direct Message, #3614) | The folder: `engine/dmfiles.js` (`filesDir(name)`, the one derivation, and the managed instruction block telling the agent to save there). The routes: `GET/POST /api/agent/:name/files[/open\|/reveal]` in `server.js`, reusing `projects.listFiles` / `openFile` / `revealFolder`. The page: `#d-files` under the four-pack and `paintAgentFiles` in `web/index.html`; browser check `docs/browser-checks/render-agent-files-3614.js` |
| Work on the Tasks view (every task across projects, the third top-level tab, #3559) | Where each task's work is: `tasks.taskState` (nobody / assigned / working / closed from the claim join, since #3949 `decision` from `tasks.waitingOnPerson`, an agent holding the task needing the person, and since #3951 `built` from a task's `builtAt`, set by `tasks.setBuilt` / cleared by `tasks.clearBuilt`, closing, a new part, a part put back, or an open part given to somebody; a built task is not handed out again by `engine/assigner.js`, and stops keeping busy every agent that marked it (`builtWho`), or every agent on it when the person marked it (`builtByPerson`, `builtFreesAll`; a caller the board could not name frees nobody), while another agent's open part on it still counts; since #4771 `held`, checked after closed and decision and before built, for a task on hold (`tasks.setOnHold`) or in a paused project (`paused` through `projects.edit`, carried as `projectPaused` on the row), which neither the Prompter nor the Assigner touches and an agent's instructions mark; only states the engine can prove) and `tasks.lastActivityOf` in `engine/tasks.js`. The routes: `GET /api/tasks?view=tasks` (adds `claim`, `waitingOnPerson`, `state`, `lastActivityAt`; leaves archived projects out except the one `withArchived=<id>` names; the plain `GET /api/tasks` stays the cheap list `kosmos tasks` reads), `POST /api/tasks/close` (bulk close with a note, screen-only), `POST /api/project/:id/task/:n/built` (`kosmos task built`, #3951) and `POST /api/project/:id/task/:n/hold` (`kosmos task hold|unhold`, #4771) in `server.js`. The page: `#panel-tasks`, the `tsk*` functions and `TSK_GROUPS` in `web/index.html`. The one top-level way in is the Tasks tab (#4595 took the projects rail's pill out; in the consolidated view the tab opens Tasks in the column), and it appears only at 25 tasks ever (Josh's ruling): `tasks.TASKS_TAB_MIN`, `tasks.tasksTabShown()` (a saved `tasksTabShown` flag in settings.json), `/api/status` `tasksTab`, and `tskTabGate` on the page. The project page's View-all door (`#pj-alltasks`) opens this view scoped to the project (`openProjectTasks`, #3703; the old all-tasks screen is retired), and `#tsk-new` opens the New task dialog (`openNewTask(projectId, origin)`, with the `#nt-proj` picker on All tasks); browser checks `docs/browser-checks/render-tasks-view-3559.js`, `render-alltasks.js` and `render-onhold-4771.js` |
| Work on the agents' own browser | `engine/agentbrowser.js` (the pinned Playwright MCP server, plus on a Mac the pinned `chrome-headless-shell`: install, lock, config); Windows launch wiring in `engine/win32supervisor.js` / `engine/win32launch.js`; Mac launch wiring in `bin/agent-supervisor.sh` via `engine/agent-browser-config.js`; the board's boot-time install in `server.js` (#3629, #3633) |
| Work on the Kosmos Community feed (#3485) | `engine/communitystore.js` (the posts/comments/trust data model + redaction), `engine/communitysite.js` (the read + moderation seam over the store, plus the HUMAN write seam `publishHumanPost`/`publishHumanComment`/`scrubAuthorName`), and the routes in `server.js`: public `GET /api/community/{feed,comments}` (exempted from the board-token gate via `PUBLIC_COMMUNITY_ROUTES`, so the feed is browsable with no account), board-token-gated `GET /api/community/moderation` + `POST /api/community/release` + `POST /api/community/discard` (#4525: the person's "Waiting for you" list in Settings > Automation > Community calls all three; release and discard ALSO require the screen (`isViaScreen`: an agent token or a request without a browser's headers gets 403), a stopgap until #4491), and board-token-gated HUMAN writes `POST /api/community/human/{post,comment}` (the site owns the human identity, scrubs `author.name`, and posts `trusted` through the choke). The AGENT board->feed publish choke is `engine/feedpublish.js` + `engine/feedguard.js`, reached via `POST /api/community/{post,comment}` (agent-token authenticated; since #3485 (2026-09-30) a clean agent post or comment publishes straight away and one the scrub stops is quarantined; `comment` takes the board's OWN post ids). An agent's comment on a post in the PUBLIC service (the ids `kosmos community read` shows) is `POST /api/community/service-comment` -> `feedpublish.publishServiceComment` (#4373 part B): same choke, stored as a comment row with `remotePostId` and no local postId. Sending PUBLISHED agent posts, and those published service comments (at most once, own record `comments-sent.json`), to the public community backend (kosmos-community) is `engine/communitysend.js` (#4287): the board holds each agent's key, gated on the #4288 switch, with board-token-gated `GET /api/community/sent` and `POST /api/community/delete`. The owner's list of their agents' posts, with Delete, in Settings > Automation, is `engine/communitymine.js` (#4313) behind board-token-gated `GET /api/community/mine`; their comments on community posts are `mineComments` there (#4801), whose removals are recorded in `comment-deletes.json` and sent by `communitysend.sweepCommentDeletes` |
| Work on the New Agent org chart upload (#1280, #4559) | The page: `#orgchartpick` in `web/index.html` (`parseOrgchart` for the paste box, `orgchartRows` shared with the file path, `orgchartPaint` for the editable preview with Reports to and Check this, `orgchartSendFile` for the file and its consent step). A FILE: `engine/orgchartfile.js` reads a CSV/TSV or XLSX on the Mac (no package; zip read on node's zlib with a per-part cap), and sends a picture or PDF INLINE to the person's own Claude Code with every tool off (`claude -p --tools "" --strict-mcp-config`, a JSON schema), then validates the answer. Route: board-token-gated `POST /api/orgchart/read` (a picture/PDF first answers `needsConsent` + provider; sent only with `?consent=1` from the screen). Create: `POST /api/team` with `reportsTo` per member, managers first. Checks: `render-orgchart-import-1280`, `render-orgchart-file-4559`; fixtures (synthetic names) in `test-support/orgchart-4559/` |
| Work on project webhooks (#1307: a call adds a task that waits for a person) | `engine/webhooks.js` (the store: ids, the secret held only as a sha256 hash, timing-safe `verify`, orphan sweep); the settings routes `/api/project/<id>/webhooks[/<id>[/name]]` and the unauthenticated call route `POST /hooks/<16 hex>/<43 base64url>` in `server.js` (board-token exemption, body deadline, rate limits, archived refusal, gate-log redaction); how the outside text reaches an agent, marked and quoted: `tasks.forAgent` and the two CLIs' task lists (`install/kosmos`, `tools/windows/kosmos-cli.js`); the settings section in `web/index.html` (`pjsHooks*`). The internet link (#4419): `hookPublicLink` in `server.js` adds `https://<name>.kosmosplus.com/hooks/...` to the make answer only when Kosmos Plus is on, signed in and up, the running connector wrote `admits_hooks: true` (`engine/remote.js` `status().admitsHooks`), and the address equals the enrolled name (`remote.address()`); otherwise `publicWhy` says why. The tunnel half is #4394 (relay#195) |
| Work on "is the board up": busy vs down, and agents restarting it (#4466) | `GET /api/health` in `server.js` (public, tiny, `"app":"kosmos"`); in `install/kosmos`: `healthy()` / `HEALTH_STATE` (up, down, stranger, busy) and `say_not_up` / `say_unreached` (a busy board is never told "start it"), `kosmos status` exit 4 for busy, and `agent_board_guard` (a deterrent, not access control: an agent may not start/stop/restart an answering board; the cooldown file `board.started-at`); `bin/board-watchdog.sh` (the busy grace, counted from `busy_since`, then the `KOSMOS_RECLAIM_BUSY` start). A send the board kept but whose reply was cut is not re-sent: `engine/messages.js` folds the same send inside `SEND_DEDUP_WINDOW_MS` (and one still in flight, `IN_FLIGHT_SENDS`), so both CLIs ask once more (#4580). Tests: `cli.busy-health-4466.test.js`, `server.health-4466.test.js`, `tools/test-board-watchdog-2955.sh`; the send fold: the `#4580` arms in `engine/messages.test.js`, `server.fedmsg-3311.test.js` and `tools.windows-kosmos-cli-busy-4466.test.js` |
| Change the installer | `install/setup.sh`, `install/kosmos` |
| Cut a release | `tools/release.sh`, `tools/build-*-bundle.sh` |

## Development Process and Conventions

The machine-wide `~/.claude/CLAUDE.md` carries the fleet-wide rules (worktrees, secrets,
messaging). The conventions below are the ones that govern working IN this repo, so a
challenge-loop reviewer and every agent have them in one place.

### Process applies to every change

The full process applies to every change, regardless of size. Never offer to skip a step or
call a change "too small" to plan, test, or review. Every branch requires all of:

1. A plan file in `.claude/plans/<branch>-<timestamp>.md` (even a brief one).
2. A worktree (never work in the main checkout).
3. Tests, if the change affects runtime behavior.
4. A `/challenge-loop` review to convergence.
5. A PR with code comments on the files-changed tab.

Documentation-only changes still require a plan and a `/challenge-loop` (the plan records
why; the loop can catch convention mismatches in the docs).

### Branch and commit format

- Flat branch names, no folder prefixes (`fix-switch-revert`, `worlds-boot-diag-2628`).
- Commit subject: `<branch-name> -- <message>` (single sentence, no special characters). Plan
  and issue commits are also seen as `#N: <message>`; either form is accepted.
- Never push more commits onto a branch that already has an open or merged PR; branch off
  `main` again instead.

### Plans

Plans live in `.claude/plans/<branch-name>-<timestamp>.md`, are committed and tracked (do
not gitignore them), and are checked during `/challenge-loop` (a missing plan is a
convention violation). They are durable context, not scratch files: forensic record, agent
ramp-up, audit trail.

### Coding conventions

- **Naming**: verbose and descriptive over abbreviations; function names read like a
  description of what they do.
- **Constants**: no raw domain literals; extract to `SCREAMING_CASE` with a doc comment on
  why the value was chosen. Cross-module constants go in a central place; single-file ones
  near the top of the file.
- **Comments**: prefer self-documenting code; comment business intent (the why), not
  mechanics. Do not write a comment the code already makes obvious. See Repo-Specific
  Conventions on the cost of comments that assert behavior the code does not have.
- **Defensive logging at boundaries**: a failure at an external boundary must be diagnosable
  from its log line alone. Log the request URL at debug before sending; on failure log
  status, scoping identifiers, and a redacted body. Never silently swallow an error.
- **Sensitive values**: never log secrets, tokens, passwords, or PII. Log presence
  indicators (`token_present=true`) instead. On a response that can echo a credential (a
  login or token exchange), log a structured extract and no body. Redact a body before
  logging it, cap it first, and fail closed on anything the redactor cannot delimit.
- **Diagnostic logging**: there is none in the tree today; if you add temporary diagnostic
  logging, prefix it with `DIAG_DEBUG` so it is easy to find, and remove it before shipping.

### Testing

Behavioral code changes must include tests (no size exemption). Pure config changes,
docs-only changes, and zero-behavior changes (comment typos, formatting) are exempt from the
test requirement, but never from the plan or the `/challenge-loop`. Prefer tests that
exercise real behavior end to end over heavily mocked ones; mock at external boundaries, not
at internal ones. Most suites are dot-namespaced at the repo ROOT (`web.foo.test.js`,
`install.foo.test.js`); `engine/` is the exception and mostly colocates its `*.test.js`
in-directory. The canonical runner is `tools/run-tests.sh` (see Repo-Specific Conventions for
why a bare directory glob is wrong here).

### Pull requests

- Title: `<branch-name> -- <description>`. Include a link to the plan file in the body.
- Comment every significant block on the files-changed tab: what it does and why (intent,
  tradeoffs). This is not optional; a reviewer should not have to ask.
- **Kosmos has no human reviewer.** The gate is a converged `/challenge-loop` (which writes
  the pre-challenge proof the `pre-challenge-gate` hook requires) plus green CI. An agent
  merges its own green PR rather than waiting on a person, with two holds: pause during an
  active release cut, and re-verify the PR is still `MERGEABLE` at merge time (a cut can
  change what is on `main` under you). Do not add a human reviewer to a Kosmos PR.
- Reply to every review/challenge comment and resolve all threads before merge.

### GitHub issues

Every issue links back to the plan that created it (include the plan path in the body). A PR
that addresses an issue must NOT auto-close it: reference it with `Addresses #N` (or
`Re #N`), never `Closes #N` / `Fixes #N` / `Resolves #N`. The issue stays open until the
reporter/QA verifies the change on the running app and closes it. Exception: when the PR
author IS the issue author, the author closes it themselves once the change is verified
working.

### Finishing up

Before opening a PR: hydrate comments on new and touched code where intent is not obvious;
if a touched directory has a `CLAUDE.md`, keep it accurate; update this file's Module Map /
Commands / Where to Find Things if you moved files, changed commands, or added a directory;
then run `/challenge-loop` (the pre-PR gate) and `/create-pr`.

## Stack (why it deviates from a typical service)

Kosmos is plain JavaScript on Node (`node >=26`): no TypeScript, no build step, no database
server, no cloud runtime. It runs entirely on the end user's own Mac, from source, packaged
with a pinned Node runtime. So there are no compile/type-check/migration pre-PR steps; the
one pre-PR gate is `yarn test` (which runs `bash tools/run-tests.sh`).

## Repo-Specific Conventions

These conventions currently live only as tribal knowledge and code comments. Each points at
the code that enforces or motivates it, so it is checkable rather than opinion. (Sourced
from a night in this codebase, kosmos#2616.)

1. **`node --test <explicit files>`, never a bare glob. `tools/run-tests.sh` is the
   canonical runner.** Most suites live at the repo ROOT under a dot pseudo-namespace
   (`engine.foo.test.js`, `web.foo.test.js`) while a real `engine/` directory also exists, so a
   directory-scoped glob like `engine/*.test.js` matches only the files IN that directory and
   silently misses the far larger set at the root, still exiting green on the fraction it ran.
   `tools/run-tests.sh` (its "coverage assertion" block) globs `engine/*.test.js *.test.js`, refuses to
   run unless that set matches every `*.test.js` in the tree, then runs that exact set
   (`KOSMOS_TEST_FILES`), so the count and the run cannot drift. To run only some files, use
   `tools/run-tests.sh --only <file>...` (kosmos#4929), not a bare `node --test <file>`: it keeps the suite's
   environment and guards (the dead-port phone-home URLs, the fake gh and vercel, the temp root, the --require
   guards) and skips only what belongs to the whole suite.

2. **Sandbox every root before any `require`.** Roughly two dozen modules freeze `store.ROOT`
   at require time (the ONE data-root derivation, `engine/store.js`, kosmos#1848/#1856). Set
   the `AGENT_WORKFORCE_*` root env before the first `require` of a store-using module, or
   the module captures the wrong root. `engine/worldenv.js`'s header enumerates the ~26 frozen
   modules across both capture shapes (`const BASE = store.ROOT` and
   `path.join(store.ROOT, ...)`), and `engine/updating.js` (kosmos#988) documents the
   require-ordering trap for consumers; `engine/store.js` owns the `store.ROOT` getter itself.

3. **Destructive/live actions fail closed by default; production opts in once.** A module that
   performs a real side effect (a `launchctl`/`tmux kill-session`, a delete) calls
   `engine/live-execution.js`'s `liveExecutionAllowed()` and, when it returns false, calls
   `refuseOrWarn(...)` to refuse rather than act (#1598). The flag is a module-level
   `allowed=false` that only `allowLiveExecution()` flips, and only `server.js`'s real-startup
   path calls it (`server.js` around line 10656). A `node --test` process is detected by
   `process.execArgv` containing `--test` (deliberately not an env var, which a child process
   would inherit and misfire on), so an in-process test never has live execution armed and
   `engine/remove.js`, `update.js`, `create.js`, `delete-leftover.js`, and `win32stop.js` refuse
   instead of faking success. Preserve this: gate any new destructive action behind
   `liveExecutionAllowed()` and never let it fire at module load. Enforced by
   `engine/create.live-gate-1598.test.js`, `engine/update.livegate-1726.test.js`, and
   `engine/platform-gate-wiring.test.js`.

4. **A committed `web/` change needs a `docs/browser-checks/` assertion or a
   `Browser-check: <reason>` trailer.** `tools/run-tests.sh` (its call to `kosmos_browser_check_gate`, via
   `tools/lib/browser-check-gate.sh`) refuses a branch that changes a rendered surface without
   either updating a browser-check assertion or carrying the explicit trailer, so an
   unasserted rendered surface cannot merge.

5. **Two derivations of one fact is this codebase's most-shipped defect.** When two places
   compute or state the same thing, they drift, and the drift ships silently. The measured
   instance is `one-derivation.test.js` (kosmos#1228): the staleness verdict was wrapped in
   `toldOverride` at some call sites and not others (and a route served the raw verdict), so the
   same agent could read `stale` in one place and `told` in another. Prefer one source of truth that both sites
   read; if you must duplicate, add a test that pins them equal (that test asserts the SHAPE,
   not a count, so a new caller has to be deliberate rather than merely plausible). A comment
   that asserts behavior the code does not have is the same defect in prose: state what the
   code does at the code, and put reasoning that can go stale in the commit or plan.

6. **A test never writes or deletes in the real `~/Library/LaunchAgents`.** Sandbox it with
   `AGENT_WORKFORCE_LAUNCH` before creating agents. `tools/run-tests.sh` preloads
   `test-support/launch-guard.js`, which makes the fs calls in its WRITERS table throw on the
   real folder, and `engine/create.js` writes job files through `writePlistFile`, which refuses
   under `NODE_TEST_CONTEXT` (kosmos#3605, after #3011). Enforced by
   `engine/create.launch-refuse-3605.test.js`.

7. **A page `/api` call needs its board route in the same change.** `web.api-routes-3957.test.js`
   reads the `/api/` literals in `web/index.html`'s code (and in markup built in JS strings) and
   refuses one that no route in `server.js` serves: a compared literal, or an anchored route
   regex. kosmos#3957: 0.6.96 shipped a page calling `/api/federation/invite` before the route
   merged. Its header lists what it cannot see (the HTTP method, URLs built from variables, a
   variable segment a sibling route fills, a new literal a free-segment route matches, an
   equality guard with no handler).

### This list is intentionally incomplete

The first five come from the account and removal lanes one agent happened to be in. They almost
certainly miss what the frontend and installer lanes would each put first. This section is
meant to grow: if you work in a lane not represented here and trip over a convention that
lives only in your head or a code comment, add it here (sourced to the enforcing code) rather
than leaving it tribal. Adding a convention is a normal PR, not a special event.
