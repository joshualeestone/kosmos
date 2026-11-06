# pipe-owner-1765-v2: kosmos#1765, the board checks who holds an agent's pipe before writing to it

**Posture:** production

**Card:** kosmos#1765 (pre-beta security pass 3, Windows-native build). Rebuilds `pipe-owner-1765` (pushed 2026-10-18, never opened as a PR) on current main.

## What finished looks like (from the person's side)

1. On Windows, a message the board sends to an agent reaches that agent's own supervisor, and never a pipe another account on the PC created under the same name. The channel key and the person's words are not written to such a pipe.
2. When the check refuses, or cannot run, the person is told plainly that the message was not delivered, and nothing was typed. The board carries on.
3. Ordinary delivery still works on a normal Windows PC, at a cost of a fraction of a second per message.

## Pieces

- `engine/win32channel.js`: `serverOwnerOf` (Windows PowerShell 5.1 opens the same pipe name and reads its security descriptor owner, while the helper's own connection is open), `ownerRefusal` (pure rule: this account, Administrators or SYSTEM), and the check in `clientMain` before any write. Its own bound (`OWNER_CHECK_TIMEOUT_MS`), outside the conversation's; `say()` waits that much longer on Windows.
- `engine/win32channel.owner-1765.test.js`: the rule, refusal paths writing nothing, the real Windows owner read, and a behavioural test that the default client really runs the check.
- `engine/win32channel.test.js`: timing adjusted for the extra phase.

## Decisions

- **PowerShell, not a native call.** Node has no API for a named pipe's server owner or process id. Rejected: a native addon (new build dependency on the box and CI), the Rust connector (not present for every agent). What would change it: the per-message cost becoming visible to people, or a locked-down PowerShell being common among users.
- **Trust Administrators and SYSTEM.** Both can already read this account's channel key, so trusting them gives nothing away.
- **Fail closed.** A check that cannot run refuses. A wrongly refused message is retried; a key handed to another account is not recoverable.
- **The cost lands on the board's thread, accepted for now.** `say()` is `execFileSync`, so each message's owner check (about 0.3 to 0.5 s measured) blocks the whole board while it runs, and a burst of deliveries pays it per message. Worst case per message rises from 10 s to 17 s (8 + 2 + 7). Accepted because delivery was already a blocking call with a 10 s ceiling, the typical added cost is under half a second, and a key handed to another account is the worse failure. Rejected for this PR: caching the verdict per pipe (needs a way to tell the holder has not changed, which Node cannot read) and a long-lived checker process (a new resident process per board). Recorded as a follow-up on #1765, with the non-PowerShell check.
- **Check bound under the supervisor's idle bound.** The helper connects, then asks; a supervisor drops a silent caller after 8 s. The check is capped at 7 s and a test holds that order.

## Weakest premise

The check and the write use two connections. Safety rests on Windows not letting another account add instances to a pipe name this account holds while a handle is open (FILE_FLAG_FIRST_PIPE_INSTANCE and the default DACL), argued in the code comment and tested for a second server on the same name, but not enforced by one handle.

## Validation (Windows box)

`C:\Users\joshu\AppData\Local\Kosmos\runtime\node.exe --require ./tools/no-schtasks-preload.cjs --test engine/win32channel.owner-1765.test.js engine/win32channel.test.js`, plus the policy tests (fixture-discipline, no-name-refs-3071, engine.reachable, windows-tests-1777, win32-separator-guard, windows-coupling-audit-1732), plus a live delivery to a test agent.
