# Fix #2702 -- `kosmos room` accepts any project id and reports it as empty

## Problem (reproduced, agent-observed)

`kosmos room <id>` treats an UNKNOWN project id as an empty room instead of rejecting it, so a
typo or a hyphenated-name guess is indistinguishable from a genuinely empty room. Its two sibling
commands already reject the same bad id:

- `kosmos room definitely-not-a-real-project-xyz-2702` -> exit 0, "Nothing has been said in this room yet."
- `kosmos post <same> x` -> exit 1, "there is no project by that name, so there is no room to post into."
- `kosmos react <same> m1 emoji` -> exit 1, "there is no project by that name."

(Exit codes read without a pipe; `| head` eats the real status, the same trap the reporter hit.)

## Root cause

The room-read route `GET /api/project/<id>/room` (server.js, the `roomThread = pathname.match(/^\/api\/project\/([^/]+)\/room$/)` block) filters `messages.record().rows` by `m.project === id` and NEVER checks the project exists. An unknown id matches zero rows: the `?as=text` arm prints "Nothing has been said in this room yet." (exit 0), the JSON arm returns empty `rows`. The sibling WRITE routes (`/api/post`, `/api/react`, and the operator room-post/react routes) all reject an unknown project with "there is no project by that name," using `projects.get(id, roster)` for existence.

## Fix (smallest change that matches the siblings)

### 1. server.js -- validate existence in the room-read route
After decoding `id` (right after the existing `if (id === null)` guard, before building `rows`), check project existence with a PURE, roster-free, side-effect-free predicate:

```js
if (!projects.readAll().some((p) => p.id === id)) { <reject> }
```

- **Why `readAll().some(...)`, not `projects.get(id, roster)`:** `get()` routes through `describe()`, which heals `everSeen` and can `writeAll()`. This is a READ path; a write side-effect on a room read would be a real defect. `readAll()` is the pure registry read that `get()` itself calls, and is already exported.
- **Reject shape, matching siblings:**
  - `?as=text` (the CLI): respond `200`? NO -- respond `404` with `content-type: text/plain; charset=utf-8` and the body `there is no project by that name`, so cmd_room prints the sentence (not "empty") AND can detect the 404 to exit non-zero.
  - JSON (the web): `sendJson(res, 404, { error: 'there is no project by that name' })`, matching the sibling react route's 404.
- **CRUCIAL distinction:** existence, never post-count. A real project with zero posts still returns the normal empty-room `200` (as=text "Nothing has been said in this room yet." / JSON empty rows). Only a truly-absent id gets the 404. `readAll().some(id)` gives exactly that: a seeded/empty-but-real project is in `readAll()`.
- Wrap the `readAll()` call defensively (it reads the registry from disk): on a throw, do NOT 404 (that would turn a transient read fault into a false "no such project"); fall through to the existing best-effort room read, which already handles an unreadable store. The existence check is a guard that fails OPEN toward the current behavior, never toward a false rejection.

### 2. install/kosmos -- cmd_room exit parity
Today cmd_room passes the body straight through `kosmos_curl` (curl without `-f` returns 0 on a 404, so exit stays 0). Change it to capture the HTTP status and exit 1 on a 4xx, printing the body either way, so it matches cmd_post/cmd_react (exit 1 on "no project by that name"):

- Use `curl -w '\n%{http_code}'` (or a `-w` to a separate stream) to capture the status alongside the body; print the body, and if the status is >= 400 `exit 1`.
- Keep the existing transport-failure arm (`if ! kosmos_curl ...` -> "We could not reach Kosmos to read that room" exit 1) -- a 404 is a reached-but-rejected case, distinct from unreachable.
- bash 3.2 under `set -euo pipefail`: use the `|| rc=$?` capture form cmd_post documents (a bare `body=$(...)` assignment aborts the process on a curl failure). Follow the exact pattern cmd_post/cmd_msg use for capturing body+rc.

### 3. Regression test
Add a node test on the room-read route (match the existing server-route test pattern -- find how the room-read route or /api/post is tested):
- UNKNOWN project id -> `404` and body/error contains "there is no project by that name" (both the JSON arm and the `?as=text` arm).
- REAL project with ZERO posts -> still `200` + the empty-room response (the exists-but-empty case). This arm is load-bearing: a fix that 404s every empty room would pass a test that only checks the unknown-id 404.
- If a shell/integration harness exists for install/kosmos, add the CLI exit-1 assertion; otherwise the server test covers the core (the CLI change is a thin status-check over the server's 404).

## Checklist
- [ ] 1. server.js room-read route: pure existence check (`projects.readAll().some`), 404 + "there is no project by that name" for as=text (text/plain) and JSON; fail-open on a readAll throw; keep 200 empty-room for a real empty project.
- [ ] 2. install/kosmos cmd_room: capture HTTP status, exit 1 on 4xx, print the body, keep the unreachable arm; bash-3.2 `|| rc=$?` care.
- [ ] 3. Regression test: unknown-id -> 404 (+ text arm), real-empty-project -> 200 empty-room. CLI exit-1 assertion if a harness exists.
- [ ] 4. Full node suite + (web unaffected, but run) browser-checks as the CI chain requires; `/challenge-loop` to convergence (model-alternated); PR (reviewer joshualeestone, squash, merge on green), body carries a NON-closing `Addresses #2702`. No em dashes.

## Notes / weakest premise
- Weakest premise: that no web caller legitimately requests a room for a non-existent project id and relies on the old empty-200. The web board only renders rooms for projects in its roster (which exist), so the 404 is not hit in normal web use, and the JSON 404 shape matches the sibling routes so any caller handles it consistently. If a web path is found that reads a room for a maybe-deleted project, it should treat 404 as "gone," which is correct.
- The `?as=text` 404-with-body is deliberate: the CLI has no JSON parser (bash 3.2) and needs the human sentence in the body; a 404 lets cmd_room set a non-zero exit. curl without `-f` prints a 404 body, so the sentence still reaches the user.
