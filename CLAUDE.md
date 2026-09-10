# CLAUDE.md

This file provides guidance to Claude Code when working with the **Kosmos** repository
(the app is `agent-workforce`; the product is Kosmos: "manage a workforce of AI agents on
your own Mac"). It pairs a project portion (below) with the org auto-imported block
further down.

Read this file and `~/.claude/CLAUDE.md` (global conventions) before starting work. Both
are loaded automatically, but a challenge-loop reviewer's Step 1 reads this file explicitly
to learn the repo's pre-PR commands and conventions.

## Commands

### Run

- `node server.js` (or `npm start`) launches the local board (web server). The board's port
  is derived per-account, so do not assume a fixed port.
- The shipped product is a bundle (app + a pinned Node runtime + the `kosmos` CLI) under
  `~/.local/share/kosmos`, installed via `curl -fsSL https://installkosmos.com/setup | sh`
  which runs `install/setup.sh`. There is no Electron; `native-app/main.swift` is the thin
  macOS wrapper.

### Test

- `npm test` runs `bash tools/run-tests.sh` (the canonical runner). Do not invoke
  `node --test` with a bare glob directly (see Repo-Specific Conventions below).
- `npm run test:shell` runs the large shell-and-tooling suite (`bash -n` syntax checks plus
  focused tool tests), invoked by `run-tests.sh`.
- `npm run test:install` / `test:install-gate` exercise the installer.

### Build / Lint

- **No build step for the app** (it runs from source). Release bundles are cut by
  `tools/build-*-bundle.sh` and `tools/release.sh`.
- **No linter and no type-checker.** `type-check` and `lint-fix` are intentional no-op
  scripts: this is plain JavaScript, not TypeScript.

## Architecture

### High-Level Structure

A single-app Node.js codebase (plain JavaScript, `node >=26`). The board is a local web
server (`server.js`) whose UI is a single committed page (`web/index.html`). The engine
(`engine/`, ~300 modules) holds the domain logic: accounts, agents, chat, activity, the
board-auth model, install/update, and provider sessions (Claude Code and Codex). Tooling in
`tools/` builds, releases, and gates the product; `install/` is the end-user installer.

### Module Map

| Directory | Purpose |
|-----------|---------|
| `engine/` | Core domain logic (~300 modules): accounts, agents, chat, activity, board-auth, autoupdate, provider sessions. `engine/store.js` owns the ONE data-root derivation (`store.ROOT`). |
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
| Run the test suite the way CI does | `npm test` -> `tools/run-tests.sh` |
| Add or change a test | Colocated `*.test.js` next to the code; the runner considers every `*.test.js` in the tree (see Repo-Specific Conventions) |
| Change the board UI | `web/index.html` (single page); a committed change here needs a browser-check assertion or a `Browser-check:` trailer |
| Find the data root / Application Support path | `engine/store.js` (`store.ROOT`) |
| Add a provider session reader | `engine/claudeaccounts.js`, `engine/codexsession.js`, `engine/authprobe.js` |
| Change the installer | `install/setup.sh`, `install/kosmos` |
| Cut a release | `tools/release.sh`, `tools/build-*-bundle.sh` |

<!--
  PROVENANCE OF THE AUTO-IMPORTED BLOCK BELOW.
  Kosmos (joshualeestone/kosmos) is not yet registered in the claude-setup
  propagation pipeline (repos.json lists only book-io/* repos), so nothing
  currently rewrites this block on a sync. It is a point-in-time copy of the
  `base` profile fragment (universal org PROCESS conventions), reproduced
  verbatim so a future propagation can replace it cleanly by its markers.
  The org-default stack it names is Rust; Kosmos deliberately deviates to
  plain JavaScript and documents that in the Stack (Project-Specific) section
  after the block, per the sanctioned override pattern. Registering Kosmos in
  propagation (with a plain-JS profile, since the existing `nodejs` profile is
  TypeScript/pnpm and does not fit) is tracked as a follow-up so this block
  stops being a snapshot. See the PR that added this file.
-->
<!-- BEGIN AUTO-IMPORTED: book-io/claude-setup -->
<!-- Do not edit between these markers — changes will be overwritten on next sync -->

## Process Invariants

The full development process applies to **every change**, regardless of size or perceived complexity. Agents must never offer to skip steps or suggest that a change is "too small" to need planning, testing, or review.

Every branch requires all of the following:

1. A plan file (`.claude/plans/<branch>-<timestamp>.md`) — even a brief one
2. A worktree
3. Tests (if the change affects runtime behavior)
4. A `/challenge-loop` review
5. A PR with code comments on `/files changed`

**Why no exceptions:** Agents consistently misjudge which changes are "trivial." A one-line change that updates display text is very different from a one-line change that adds an `.unwrap()`. The process exists to catch what the author's judgment misses — and challenge-loop has repeatedly found real BLOCKER and WARNING issues in changes that appeared trivial. The cost of running the full process on a genuinely simple change is minutes; the cost of skipping it on a change that wasn't actually simple is a production incident.

**Documentation-only changes** also require a plan and challenge-loop because:
- The plan provides a forensic record of *why* the docs were changed
- Challenge-loop may catch org convention mismatches in the updated documentation

## Org-Wide Tech Conventions

New production services **should** use the org's primary stack:

- **Backend**: Rust (Rocket framework + SQLx for database)
- **Frontend**: Vue 3 with TypeScript (Composition API, Pinia for state)
- **Database**: PostgreSQL
- **All languages**: follow conventions in the language-specific style guides

This is not an absolute mandate, but a strong preference. Consistency across repos enables agents and developers to move between projects without relearning conventions, and shared tooling (deploy pipelines, monitoring, CI) is built for this stack.

**If a different stack is chosen**: integration with existing infrastructure (deploy pipelines, shared libraries, monitoring) may require additional work, which can delay feature release timelines. Consider this tradeoff before committing to an alternative. If you proceed with a non-standard stack, document the rationale in the project's CLAUDE.md.

For installation and setup of the preferred stack tools, see [dev-environment-setup.md](dev-environment-setup.md).

## Branch & Commit Conventions

### Branch Naming

- **Flat names, no folder prefixes** (e.g., `fix-cart-total`, `add-campaign-flag`, `GH-123-fix-login`)
- Every task gets its own branch and PR
- Never push additional commits onto a branch that already has an open or merged PR — create a new branch off `main` instead

### Commit Format

```
<branch-name or ticket-name> -- <message>
```

- Single sentence, no special characters
- Examples:
  - `blockfrost-to-maestro -- refactor all endpoints`
  - `add-campaign-flag -- add is_active flag to campaigns table`

## Plans

Implementation plans should be saved to `.claude/plans/` using the naming convention `<branch-name>-<datetimestamp>.md` (e.g., `blockfrost-to-maestro-20260312T1645.md`).

### Plan files are tracked in git

Plan files are **committed and tracked in version control**. They are part of the project's knowledge base — not ephemeral scratch files. **Do not add `.claude/plans/` to `.gitignore`.**

Plans serve as durable context for humans and agents alike. Gitignoring them defeats their three core purposes (forensic context, agent ramp-up, audit trail). If a plan contains sensitive information, redact the sensitive parts rather than excluding the file from version control.

### Plan Requirement

Plans are required for all work. No exceptions. Even a brief plan (a few bullet points capturing scope and approach) satisfies the requirement — but skipping the plan entirely is never acceptable, regardless of how small or simple the change appears.

**Why plans are required:**

1. **Forensic context** — When defects arise, plans let the team quickly understand why decisions were made. Instead of reverse-engineering intent from code, reviewers can read the plan that motivated the change.
2. **Agent productivity** — Future agents can ingest recent plans about a domain to ramp up quickly. A prompt like "ingest all recent plans about payments and then let's start" gives the agent weeks of decision context in seconds.
3. **Audit trail** — Every plan creates a valuable record. The cost of writing a brief plan is low; the cost of having no context when something breaks is high.

Plans are checked during `/challenge` reviews. A missing plan file for a branch is flagged as a convention violation.

### Subdirectory grouping for larger work

When a feature or initiative spans multiple branches over several days, group related plans under `.claude/plans/<feature-name>/` (e.g., `.claude/plans/coresource/add-coresource-api-20260401T1200.md`). Individual plans still follow the `<branch-name>-<datetimestamp>.md` naming convention. For standalone tasks, save directly to `.claude/plans/`.

### Which repo does the plan belong in?

Plans live in the repo that owns the code or config they describe — not whichever repo is most convenient. For the full rule (code-only vs cluster-only vs dual-scope plans, and the 2-PR absorb/cleanup pattern for moving a plan after the fact), see [`master-plans.md#plan-location-by-code-ownership`](master-plans.md#plan-location-by-code-ownership).

## Master Plans

A **master plan** is a coordinator document for initiatives that span multiple PRs, multiple repos, or a sequence of changes over several days or weeks. The individual implementation plans under the master plan are still required — the master plan just gives fresh agents (and human reviewers) a single entry point for the overall effort.

Create a master plan when any of the following apply:

- An initiative will land across more than two PRs
- Work spans multiple repos (e.g., `booktoken-web` + `infra-docs`)
- Discoveries from early PRs are likely to surface new follow-ups
- You want a reviewable backlog for the initiative without opening a full GitHub Project

Pick one of two variants up front:

- **Tracker variant** — append-only issue table; use when scope evolves as you work and new follow-ups surface during execution.
- **Roadmap variant** — phase-by-phase section; use when the full sequence is known up front.

Don't mix the two. Naming layout:

```
.claude/plans/<initiative-slug>-master[-<descriptor>]-<YYYYMMDDTHHmm>.md
.claude/plans/<initiative-slug>/                       ← required
  <branch-name>-<YYYYMMDDTHHmm>.md                     ← sub-plan 1
  <branch-name>-<YYYYMMDDTHHmm>.md                     ← sub-plan 2
```

**Every master plan MUST be paired with a same-slug subdirectory** that holds the individual plans it coordinates. The subdirectory name is the bare initiative slug — strip the `-master-*` segment and the timestamp from the master filename. This keeps the master and its coordinated plans sorted adjacent in directory listings.

**If you reach the end of an initiative with an empty subdirectory, the effort didn't warrant a master plan** — unwind it and fold the content into a regular plan or change record.

For the full convention (variant structures with canonical sections, naming examples, cross-repo citation format, plan-location-by-code-ownership rule, issue/PR traceability requirements, retrofit guidance) → see `docs/master-plans.md` in the org conventions repo (`claude-setup`).

## README Requirements

Every repo must have a human-facing `README.md` with: summary, stack table, quick start, project structure, API surface (if applicable), contributing notes, and env var documentation. `repo-setup` creates it; `repo-refresh` audits it. Update it alongside CLAUDE.md when new components ship.

## Coding Conventions

Universal rules that apply to all code in all languages. For language-specific standards, see the style guides referenced at the end of this section.

### Naming

- Prefer verbose, descriptive names over concise abbreviations
- No code golf — `getUserById` over `getUsr`
- Function names should read like a description of what the function does

### Constants

- Never use raw numeric or string literals for domain values
- Extract to `SCREAMING_CASE` constants with doc comments explaining the value and why it was chosen
- Cross-module constants go in a central `constants` file; single-file constants go near the top of the file

### Comments

The goal is self-documenting code. If functions, arguments, and constants are named descriptively, most comments are unnecessary.

**Rules:**
- Doc comments (`///` in Rust, `/** */` in TypeScript) on all public functions, structs, enums, and types
- Comment business intent, not mechanics — explain *why*, not *what*
- If the "why" is not obvious from the code, add a comment
- If the "why" IS obvious from the code, do not add a comment
- Constants explain *what* the value is; comments explain *why* it exists — both are needed when the business reason isn't self-evident

### External API Calls — Defensive Logging

All external API calls must use defensive logging:

- Log the request URL at `debug` level before sending
- Log the response (URL, status, body) on non-success at `warn` or `error` — **body redacted per §Sensitive Values, and omitted entirely at a secret-echoing boundary**
- Log transport errors with full context at `error`
- On deserialization failures (JSON parse errors from a 200 OK), log the response body at `error` before propagating — **same redaction rules.** ⚠️ A 200 OK that fails to deserialize is the *most* credential-dense body in most systems (it is the token-exchange happy path) and is not a non-2xx, so it is easy to overlook
- Never silently propagate errors with bare `?` — always add `.context()` or explicit error logging

**A failure at an integration boundary must be diagnosable from its log line alone.** You will not get a second occurrence on demand, and the upstream will not explain itself later. Status codes are rarely enough: one status covers a routing blip, an auth-state problem, and a genuine "no such thing". Log the identifiers that scope the call too — account, org, correlation, and opaque session **identifiers** (never a session token or cookie *value*, which is a bearer credential). A boundary whose URL carries no user is otherwise unattributable.

### Sensitive Values

Never log API keys, tokens, passwords, or PII. Log presence indicators only (e.g., `api_key_present=true`, `token_length=42`) — **except for upstream response bodies on failure, which are logged redacted; see below.**

#### Redact response bodies — except where a body can echo a secret

Two tiers. Which one a boundary is in depends on **what a redactor miss would cost there**:

- **Tier 1 — bodies that cannot echo a secret (most boundaries): log the body, redacted. Never exclude the path.** Exclusion is what made `book-io/ingram-drc` GH #1776 undiagnosable: a valid-credential login was refused on an upstream `404` and the only artifact that could explain it had been deliberately dropped. That choice is invisible until an incident, and then it is expensive.
- **Tier 2 — bodies that can echo a secret (login, token exchange): log a structured extract and NO body.** Status, a bounded and shape-checked error code, body length, and an allow-listed shape hint. The safety argument is structural — no path from response *body* bytes to a log field — rather than a claim that a matcher is complete. ⚠️ It covers the body, **not the URL**: both tiers log the URL, so if a boundary can carry a credential in its query string (`?access_token=`, a presigned signature) redact the URL too, or log only its path. Two more channels bypass the body rules the same way: an **error's `Display`** (formatting `{err}` embeds an upstream `code`/message with no redaction — project the safe fields instead), and **response headers** (`Set-Cookie`, `WWW-Authenticate`). And **bound every upstream-derived value you log** at either tier — a body cap does not help a `code`, an identifier, or an error string in its own field.

⚠️ **The tier turns on what the RESPONSE can contain, not what the REQUEST carries.** Nearly every outbound call carries a credential; that is not what decides it.

⚠️ **An auth failure is tier 2 wherever it occurs — including from a tier-1 boundary.** The principle, not the status code: *any* response that can echo the credential you presented gets the body-free extract. That is usually a 401/403, but upstreams also return auth failures as 400, 422, or a 200 carrying an error envelope — key on "can this body quote what I sent?", not on the number. A redactor cannot be relied on to catch it (an opaque, non-JWT token in prose is a named residual gap of tier 1), so a boundary is tier 1 for its *ordinary* failures and tier 2 for its auth failures. Without this the rule contradicts itself, since tier 1 is defined as bodies that cannot echo a secret.

**Why tier 2 exists.** `ingram-drc` first put its auth boundary in tier 1, reasoning that redaction made body logging safe anywhere. Adversarial review then found leak after leak — **more than twenty distinct paths over more than a dozen rounds**, and the shape of the failures is what matters more than the count: two leaks were **introduced by fixes for earlier ones**, two were visible only by **composing** findings each cleared in isolation, and one defect shape had to be closed **four times in four different passes**. (No exact figure is quoted here on purpose: it moved every round while that work was in flight, and a durable doc citing a moving number goes stale silently. The current tally lives with the implementation.) A deny-list over arbitrary upstream bytes does not converge, so the boundary where a miss is unrecoverable must not depend on one.

**When in doubt, tier 2** — it is the reversible choice. You can widen it later with an allow-listed field projection; a leaked credential cannot be un-logged.

**Four tier-1 obligations are stated here rather than deferred, because getting any of them wrong is a leak or an outage and the rest of the list is a click away:**

- **Cap the body before redacting**, then redact, then cap again. Redacting first *shrinks* the body and promotes past-the-cap bytes **into** the logged window; it also runs an unbounded scan on an unbounded response inside a request path, and during an outage every failing call pays it.
- **Fail closed on anything the redactor cannot delimit.** Truncating first bisects constructs, so a matcher needing a closing quote or bracket finds none. The dangerous failure is not giving up — it is giving up *and continuing*, emitting the marker beside the live value so the line **looks** redacted.
- **Fold keys to lowercase before substring-matching** — `accessToken` contains `Token`, not `token` — and allow a suffix after the fragment (`passwordHash`, `X-Auth-Key-Id`) for **long** fragments only; short whole-key names (`pin`/`sig`/`pass`) need a word boundary on both sides, or `passed:`/`passes=` over-redact.
- **Mask emails**, and treat a PII-dense body as tier 2: names and postal addresses in prose cannot be pattern-matched.

📖 **Before implementing either tier, read [`logging-failure-bodies.md`](~/.claude/docs/logging-failure-bodies.md).** It carries the fourteen tier-1 obligations — starting with **which six passes must exist** (a JSON-only redactor silently leaks every non-JSON body), then case-folding, suffix and short-fragment handling, structural values, PII, echoed credentials, truncate-then-redact, fail-closed, pass ordering, explicit `truncated`, the tier-2 rules, the **named residual risks** you are accepting, the leak-response pointer, and the testing discipline. Each obligation there exists because a leak was *measured*, and the list is not reconstructible from first principles.

**Still never logged, either tier:** credentials in any form, and request bodies on credential-bearing endpoints. PII (names, emails, addresses) must be masked where it is pattern-matchable, and a boundary whose error bodies are PII-dense belongs in tier 2 — names and postal addresses in prose cannot be matched. Account, org, session and correlation **identifiers** are not PII for this purpose and should be logged; they are what make a failure attributable.

### Diagnostic Logging

- Temporary/diagnostic logging must always be prefixed with `DIAG_DEBUG` in the message string (e.g., `log::info!("DIAG_DEBUG: ...")`)
- When you encounter `DIAG_DEBUG` lines in a file you're working on that aren't part of the current investigation, flag them for cleanup
- `DIAG_DEBUG` lines should never ship to production unless actively needed
- ⚠️ **`DIAG_DEBUG` is not an exemption from §Sensitive Values.** These lines are permitted to ship while actively investigating — i.e. they run in production, on the failure path, exactly when upstream bodies are most likely to carry a credential. Redact bodies in a `DIAG_DEBUG` line like any other, and log no body at all at a tier-2 boundary

### Language-Specific Style Guides

For detailed, language-specific coding standards, see:

- [style-guide-rust.md](style-guide-rust.md) — Rust (error handling, `.unwrap()` prohibition, async patterns, Rocket, data models)
- [style-guide-typescript.md](style-guide-typescript.md) — TypeScript / Vue 3 (`any` prohibition, component patterns, architecture separation)
- [style-guide-postgres.md](style-guide-postgres.md) — PostgreSQL (layered architecture, PgExecutor pattern, migrations, schema conventions)

## Testing Requirements

### All behavioral code changes must include tests

All code changes that affect runtime behavior **must** include tests. No exceptions based on change size — a one-line change can introduce a critical bug. If a change touches control flow, data transformation, error handling, display logic, or API responses, it requires tests regardless of how small it is.

Changes that do **not** require tests:
- Pure configuration changes (env vars, deploy manifests)
- Documentation-only changes
- Changes with zero behavioral impact (typo fixes in comments, formatting, renaming unused variables)

Note: the test exemption for non-behavioral changes does **not** extend to other process steps. Plans and `/challenge-loop` are still required for all changes, including documentation and configuration.

### Vertical-slice testing (org standard)

For code that crosses internal boundaries (API -> service -> SQL, or component -> store -> service), write **vertical-slice tests** that exercise the request through multiple layers. These cross-boundary tests catch integration bugs that isolated mocked unit tests miss.

- **Vertical-slice tests are required** for any code that orchestrates work across layers
- **Unit tests remain appropriate** for pure functions, algorithms, and conversion logic
- Mock at system boundaries (external APIs, third-party services), not at internal layer boundaries

### Why vertical-slice over mocks

Mocked tests can pass while real integrations are broken. A test that exercises the real service layer with a real database connection catches schema mismatches, transaction bugs, and query errors that a mocked test never sees.

## Pull Requests

### Title and Body

- **Title**: `<branch-name> -- <description>`
- **Body**: Fill in `.github/pull_request_template.md` (see [templates/pr-template.md](../templates/pr-template.md))
- Include a link to the plan file in the PR body

### Code Comments on PR

In the `/files changed` tab, comment every significant block of code explaining:

- **What** the block does
- **Why** it was written this way (intent, tradeoffs, decisions)

This is not optional. Reviewers should be able to understand your reasoning without asking.

### Reviewers

- Always add `gmoratorio` as reviewer — no exceptions, regardless of PR type or size
- If the project has team-based reviewers (e.g., `web-team` for frontend, `backend-team` for backend), add the appropriate team based on what changed
- 1 approval required to merge

### Merge Strategy

Prefer rebase merging (not squash, not merge commits).

### Challenge Requirement

All code changes require a `/challenge-loop` review before merge. No exceptions. This is an org-wide standard, enforced by the `pre-challenge-gate` hook.

**Process:**

1. Complete your PR (code, tests, plan file, code comments on /files changed)
2. The PR is now ready for challenge. A reviewer (human or agent) runs `/challenge` against the PR
3. All challenge findings are prefixed with `[CHALLENGE]` so readers can distinguish them from regular comments
4. If no issues are found, the challenger posts `[CHALLENGE] No issues found`
5. The PR author addresses all findings via `/defend`
6. Challenge findings must be addressed before merge, just like regular review comments

### Comment Resolution Protocol

- **Reply to every review comment** — even if the fix is straightforward. The commenter needs a notification that their feedback was addressed.
- **All comments, suggestions, and questions must be resolved before merge.** No unresolved threads.
- **Resolution**: ideally the original commenter marks the thread resolved after seeing the response. If the conversation happened offline, the PR author can resolve and leave a note explaining.

## Finishing Up

Before opening a PR, work through these steps for every file you touched.

### Code Comment Hydration

- **New code you added**: add doc comments (`///` Rust, `/** */` TS) on all new structs, enums, functions, and constants where the name alone doesn't make intent obvious. Prefer clear naming over comments, but always comment when business intent is not derivable from the code itself.
- **Existing code in same file**: scan all major blocks — if a block lacks a comment and would benefit from one, add it. If a comment exists, verify it still matches the code and update if drifted.
- Goal: slow, steady hydration — every PR leaves files slightly better documented than it found them.

### Subdirectory CLAUDE.md Maintenance

- If a touched directory has a CLAUDE.md, verify accuracy and update if drifted.
- If it lacks one and has 5+ files or non-obvious domain logic, create one from the [subdirectory template](../templates/claude-md-subdir.md).
- If you added a new directory, apply the same criteria.
- Applies to **every** directory you touched, not just the primary one.

### Docs Update Process

If your changes affect any of the following, update the corresponding docs. Docs that lag behind code actively mislead.

| If you changed... | Update... |
|---|---|
| Request flow, feature, or major behavior | Architecture docs / Architecture section in CLAUDE.md |
| Domain type or concept | Doc comments on affected types; domain glossary if new term |
| File locations (moved files, new modules/directories) | Module Map in root CLAUDE.md |
| "Where to find things" patterns (new service, SQL file, integration) | Where to Find Things table in root CLAUDE.md |
| Development workflow step (new command, build step) | Commands section in root CLAUDE.md |
| Database schema | Migration docs, Architecture Notes in relevant subdirectory CLAUDE.md |

### Execution Checkpoint

After implementation is complete and validation passes, `/execute-plan` presents a structured checkpoint to the user before starting the review loop. This is the moment for scope additions, late ideas, or follow-up items the user noticed during implementation. The checkpoint summarizes what changed, suggests post-PR follow-ups, lists outstanding items, and asks the user whether to make more changes or proceed to `/challenge-loop`. **Do not skip this checkpoint or auto-proceed past it.**

### Self-Check

Run `/challenge-loop` before opening a PR — it iteratively spawns fresh, blind challenge agents until convergence. This is the pre-PR quality gate for every branch, with no exceptions. After convergence, run `/create-pr`. (When using `/execute-plan`, this happens after the user confirms the execution checkpoint above.)

**Enforcement**: The `pre-challenge-gate` hook blocks `gh pr create` without a valid, hash-verified proof file. `/challenge-loop` generates the proof automatically on convergence. If the hook denies your PR, run `/challenge-loop`.

## Operational Feedback Workflow

When you hit a documentation gap, broken procedure, or missing information during operational work (running a procedure, on-call debugging, following a runbook), capture it in-place and fix the root cause — don't wait until after the task.

See [operational-feedback.md](operational-feedback.md) for the full workflow (capture → fix → cross-check).

## Pre-PR Checklists

**Do not rely on CI to catch these. Run them locally first.** CI is a safety net, not the first line of defense. If you push code that fails CI, you've wasted a round-trip and blocked the review.

The canonical Pre-PR command sequences plus the operating rules (fail-loud `--check`, mandatory type checking as the first TS step, migration ordering, schema-qualification) and the skip-log helper that prevents redundant runs across the multi-skill PR flow live in **[pre-pr-checklist.md](~/.claude/docs/pre-pr-checklist.md)**. Every consumer skill (`/execute-plan`, `/challenge-loop`, `/create-pr`) invokes the sequence via `scripts/lib/validation-log.sh` so the runtime behavior matches the doc.

Language-specific pre-PR commands live in each language's profile fragment (see `dist/profiles/rust.md`, `typescript.md`, `postgres.md`). Only the commands for your repo's declared profiles appear in its auto-import.

## GitHub Issues

If a repository uses GitHub Issues for task tracking:

- Every issue must link back to the plan that led to its creation
- Include the plan file path in the issue body (e.g., `.claude/plans/<branch>-<timestamp>.md`)
- This creates a bidirectional trail: plan -> issue -> PR -> code

### A PR that addresses an issue must not auto-close it (QA verifies and closes)

When a PR addresses a GitHub issue, the issue is **not** closed by the merge. Verification is a human
gate: "PR merged" ≠ "confirmed working." The issue stays open until the issue's author/reporter (QA)
verifies the change on the deployed environment and closes it.

- **Reference the issue without auto-close keywords.** Use `Addresses #N` (or `Re #N`) in the PR body —
  **never** `Closes #N` / `Fixes #N` / `Resolves #N`, which auto-close on merge and bypass QA. This
  reference is unconditional for any issue-addressing PR.
- **The issue stays open.** Never `gh issue close` from the authoring side; the reporter/QA closes it.
- **Signal QA-readiness, but only once the change is verified working.** When the change is confirmed
  working — **merged + deployed + verified** — comment on the issue tagging its **author** (the QA
  verifier) with what changed + the PR link, and add the **`ready-to-test`** label. The verification
  follows a cascade: the authoring agent verifies on the live env where it can; if it cannot directly
  test, it pauses and asks the operator to verify after deploy; if neither can practically test it,
  signaling at PR-creation time is acceptable.
- **`ready-to-test` label spec** — canonical color `006b75`, description "Ready for testing". Ensure it
  exists (create-if-missing with this spec), then apply it; an existing label is used as-is. Labeling
  must **graceful-degrade** — a label failure never fails the PR; note it for manual application.
- **Reference `--repo` explicitly** on `gh issue` / `gh label` commands so a bare issue number can't
  act on the wrong repository.

**Exception — self-authored issues (you reported it and you're fixing it).** The QA handoff exists
because a *different* person needs to verify. When the PR author **is** the issue author, there's no
one to hand off to — so the author **closes the issue themselves** once the change is verified working,
with a summary comment (no tag, no `ready-to-test` label). Closing is still verification-gated: keep the
non-closing `Addresses #N` in the body (never auto-close on merge), verify on the live env, then close.
**If a self-authored issue cannot be verified, do not silently leave it open — stop and report to the
operator (or orchestrator) for a close decision**, so self-authored issues don't pile up unclosed.

This convention is implemented by `/create-pr` (any issue-addressing PR) and `/bugfix` (its bug-fix
PRs), both of which deliver the verified signal via the shared `/watch-deploy` (merge + deploy watch)
and `/verify-live` (live-env verification verdict) skills.


<!-- END AUTO-IMPORTED: book-io/claude-setup -->

## Stack (Project-Specific)

The org-default stack in the block above is Rust + Vue/TypeScript + PostgreSQL. **Kosmos
deviates deliberately:** it is plain JavaScript on Node (`node >=26`), no TypeScript, no
build step, no database server. Rationale: the product runs entirely on the end user's own
Mac from source, packaged with a pinned Node runtime. There is no Rocket/SQLx/Vue here, and
the Rust/TypeScript/Postgres style-guide links in the block above do not apply. Follow the
universal Coding Conventions (naming, constants, comments, defensive logging, sensitive
values) from the block; ignore the language-specific Cardinal Rules for languages this repo
does not use.

## Pull Requests (Project-Specific)

Kosmos overrides the block's Reviewers rule. **There is no human reviewer on Kosmos PRs.**
The gate is a converged `/challenge-loop` (the pre-challenge proof the hook requires) plus
green CI. An agent merges its own green PR rather than waiting for a person, with two holds:

- **Hold during an active release cut** and re-verify the PR is still `MERGEABLE` at merge
  time (a cut can change what is on `main` under you).
- Everything else in the block's Pull Requests section still applies: title/commit format,
  code comments on `/files changed`, `Addresses #N` (never `Closes #N`) for issue-addressing
  PRs, and the QA-closes-not-the-merge rule for GitHub Issues.

Do not add `gmoratorio` (or any human) as a reviewer on a Kosmos PR.

## Pre-PR Checklist (Project-Specific)

The block defers language pre-PR commands to profile fragments; Kosmos has none of those.
The one pre-PR gate is:

1. `npm test` (which runs `bash tools/run-tests.sh`) must pass. This runs the full
   `node --test` suite over the exact committed test set plus the shell-and-tooling suite,
   and enforces the coverage and browser-check gates described below.

## Repo-Specific Conventions

These are the conventions that currently live only as tribal knowledge and code comments.
Each points at the code that enforces or motivates it, so it is checkable rather than
opinion. (Sourced from a single night in this codebase by April, kosmos#2616.)

1. **`node --test <explicit files>`, never a bare glob. `tools/run-tests.sh` is the
   canonical runner.** A path glob like `engine/*.test.js` does not descend subdirectories,
   so a bare glob silently runs only part of the suite and still exits green. `run-tests.sh`
   (lines ~170-207) counts every `*.test.js` in the tree as a coverage assertion and then
   runs that *same* set (`KOSMOS_TEST_FILES`), so the count and the run cannot drift.

2. **Sandbox every root before any `require`.** Roughly two dozen modules freeze
   `store.ROOT` at require time (the ONE data-root derivation, `engine/store.js`,
   kosmos#1848/#1856). Set the `AGENT_WORKFORCE_*` root env before the first `require` of a
   store-using module, or the module captures the wrong root. `engine/store.js`'s own header
   comment documents the require-ordering trap.

3. **Live execution is armed only inside `if (require.main === module)`.** An in-process
   test never satisfies that, so modules like `engine/remove.js` fail closed (they refuse to
   act) rather than performing a destructive action when imported by a test. Preserve this:
   never move live-execution side effects to module top level.

4. **A committed `web/` change needs a `docs/browser-checks/` assertion or a
   `Browser-check: <reason>` trailer.** `tools/run-tests.sh` (lines ~213-222, via
   `tools/lib/browser-check-gate.sh`) refuses a branch that changes a rendered surface
   without either updating a browser-check assertion or carrying the explicit trailer, so an
   unasserted rendered surface cannot merge.

5. **Two derivations of one fact is this codebase's most-shipped defect.** When two places
   compute or state the same thing (for example the account routes copying an enumeration but
   sharing the sentences), they drift, and the drift ships silently. Prefer one source of
   truth that both sites read; if you must duplicate, add a test that pins them equal.

### This list is intentionally incomplete

The five conventions above come from the account and removal lanes April happened to be in.
They almost certainly miss what the **frontend** and **installer** lanes would each put
first. This section is meant to grow: if you work in a lane not represented here and trip
over a convention that lives only in your head or in a code comment, add it here (sourced to
the enforcing code) rather than leaving it tribal. Adding a convention is a normal PR, not a
special event.
