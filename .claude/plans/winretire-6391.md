# #6391: Windows uninstall retires the PC at the coordinator before deleting the Kosmos+ key

**Branch:** `winretire-6391` · **Card:** kosmos#6391

## The defect

Uninstalling Kosmos on a paired **Windows** PC and choosing "also delete data" deletes the
folder holding `<dataDir>\remote` (the Kosmos+ key) and reports "deleted your agents' chats and
settings". The PC is **never retired at the coordinator**: its address stays on the account and
stays listed on the other computers. With the key gone it can never sign the retire, so only the
account page (subject to its one-day `recently_online` rule) or a signed-in phone can remove it,
and the same name cannot be signed in again meanwhile.

The **Mac** uninstall already does this right: `install/setup.sh` retires first
("RETIRE THIS MAC AT THE COORDINATOR WHILE IT CAN STILL SPEAK (#793)",
`kosmos-tunnel retire --state-dir ...`), then deletes `remote/`, and says which happened. The
Windows path (`engine/win32uninstall.js`, `tools/windows/KosmosLauncher.cs`,
`tools/windows/kosmos-cli.js`) had **no retire anywhere** — confirmed by grep on origin/main,
with a positive control (the three files exist and are 45K/221K/178K; `retire` = 0 in all three).

## The fix (engine/win32uninstall.js)

The data deletion is `deleteAllExcept(dataDir, keptDirs, rm)`, and `remote\` is inside `dataDir`
and not a kept root, so it goes with the rest. So the retire must run **right before that call**,
and only in the branch where the delete is actually committed (refusal == null, dataDir on disk).

1. New `retirePc(o)` helper: the caller resolves the connector (`AGENT_WORKFORCE_TUNNEL_BIN`
   override, else `app\bin\kosmos-tunnel.exe` beside the engine dir — #583/#4597) and passes it;
   if it is on disk, `retirePc` runs `kosmos-tunnel.exe retire --coordinator <url> --state-dir
   <dataDir>\remote` via `spawnSync` with a generous timeout (`RETIRE_TIMEOUT_MS` = 60s, matching
   remote.js's `retireHere()`; env-overridable via `AGENT_WORKFORCE_RETIRE_TIMEOUT_MS`),
   `windowsHide:true`, `stdio:'ignore'`, no shell. Returns `{told}` and **never throws**: no
   connector, a spawn error, a timeout, or a non-zero exit are all `told:false`.
2. In `uninstall()`, inside the committed-delete branch: compute `remoteDir = dataDir\remote`,
   check the key is held with the **holdsKey pair** (`mac_id` + `mac_key`, matching
   engine/remote.js), and only then retire. On success push a `done` line that **names Kosmos+**
   ("...its Kosmos+ address is retired..."); on failure push a `notes` line that also names
   Kosmos+ ("...may still show on your account page until you remove it there."). A PC that never
   held a key says nothing about Kosmos+. The data is deleted either way (best-effort retire).
   Coordinator URL is inlined env-or-default exactly as the Mac sibling does.

## Why the touched file is only win32uninstall.js

The card names three files because that is where a retire was searched for and found absent. The
delete-data logic lives only in `win32uninstall.js`; the launcher (`.cs`) and `kosmos-cli.js` just
invoke it with `--root`/`--delete-data`/`--port`. So the fix belongs in the engine half.

## Tests (engine/win32uninstall.retire-6391.test.js)

Two layers, deliberately:

- **Portable `retirePc()` unit tests — run on every platform, Mac CI included.** retired (exit 0),
  timed out (ETIMEDOUT + kill signal), failed (non-zero exit), no connector (nothing spawned), and
  a thrown spawn (swallowed). Plus an args/shape assertion (the `retire` verb, `--state-dir`,
  `--coordinator`, a positive timeout, `windowsHide`, no `shell`). These are where "retired /
  timed out / failed / no key" is actually EXERCISED.
- **Windows-only `uninstall()` wiring tests** (the `WINDOWS_FOLDERS` skip, like every folder arm in
  `win32uninstall.test.js`): retire runs **before** the key is deleted (a fake reads the key on
  disk when called), the Kosmos+ sentences, a never-paired PC stays silent (incl. partial-key
  `mac_id`-only / `mac_key`-only controls), keeping the data does **not** retire (never strand a
  kept key), and a refused delete does **not** retire.

## Windows verification — what I could and could not run from a Mac

- **Ran on this Mac:** the 5 portable `retirePc` unit tests (pass), the existing
  `win32uninstall*.test.js` suites (no regression, 0 fail). The `retire` decision logic is
  therefore exercised in CI.
- **Could NOT run from a Mac:** the `uninstall()` integration arms. They are Windows-only because
  `store.dataRootFor('win32', ...)` produces Windows-joined paths that are only nested folders on
  Windows — the same reason every folder arm in the existing suite skips off Windows. They will
  execute on a Windows run. I did **not** run an actual `Kosmos.exe --uninstall` on a Windows box.

## Weakest part of my own reasoning

The `uninstall()` wiring (retire at the right point, right sentences) is proven only on Windows
and skips in the Mac CI, so CI greens on the portable layer alone. I mitigated by making the
ordering + no-strand behavior explicit Windows-only tests and by keeping the retire decision
(`retirePc`) fully portable-tested. A reviewer with a Windows box should run the suite there once.
