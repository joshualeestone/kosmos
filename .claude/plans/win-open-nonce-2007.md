# Plan: #2007 - the Windows launcher opens an authenticated board url, not a 403

## Problem

On the unsandboxed Windows build the board ENFORCES #1946 auth. `open-board.cmd`
opened the plain `http://127.0.0.1:16180` with no auth, so the browser got a 403
and the agents pane read as broken ("we cannot read your agents ... status 403").
A real auth failure wearing the costume of the expected "no agents on Windows" state.

## Approach

Mirror bash `cmd_open` (install/kosmos), because Windows has no bash to reuse it.
A new bundled node helper `tools/kosmos-open-board.js`:

1. waits for the board to answer (Kosmos.cmd starts server.js concurrently; the
   helper only polls, it does not start the server);
2. reads the durable board token from `store.ROOT/board.token` (present only on an
   enforcing board) - purely to decide whether to mint;
3. POSTs `/api/board-nonce` (which on an enforcing board requires the
   `x-kosmos-board-token` header via the server's sensitive-route gate) to mint a
   single-use, short-TTL nonce, and opens `<url>/?boot=<nonce>`;
4. on a non-enforcing board or any failure, opens the PLAIN url (pre-fix worst case).

`open-board.cmd` runs the helper as one plain node line; the helper opens the
browser itself (seamed on `KOSMOS_OPEN_BIN`) so the `.cmd` needs no fragile `for /f`
capture or nested quoting that cannot be tested from a Mac.

## Key decisions

- **NONCE flow, not `?token=<durable>`.** #1979 removed the durable token from the
  browser argv (macOS `ps` leaks argv cross-account). The helper reads the token off
  disk and sends it only in a fetch() HEADER, never as a subprocess argument; only
  the single-use nonce reaches the url. Angel confirmed (2026-09-03) this is safe
  exactly where the dropped `self-open` endpoint was not: the mint is owner-gated on
  the board token, so a hostile second account cannot trigger it.
- **The helper is the Windows boot-path open, and it is needed.** Angel dropped
  `self-open` (a durable-token disclosure); his update-repair open is not the boot
  path and not cross-platform. Nothing board-side opens the browser on launch, so
  this helper is the analog of bash's fresh-install open + cmd_open.
- **Staged at the zip ROOT** (`$STAGE/open-board.js`), not under `app/`, so it is a
  launcher artifact (like the README) and stays out of the two-builder app-parity scan.
- **stdout prints the PLAIN url** (mirrors cmd_open's `say $URL`), keeping the
  single-use nonce out of any captured console log; the nonced url is opened.
- **No native-app fallback in the Windows copy** - the app remedy (`tokenizedBoardURL`)
  is measured-unreliable as of 2026-09-03.

## Verification

Everything except the `.cmd` executing under cmd.exe is testable on this Mac and is
tested (`tools.win-open-board-2007.test.js`, 13 tests): enforcing -> nonced url; a
403'ing-GET board still mints (the real Windows case); non-enforcing -> plain; a
non-hex nonce -> plain (control); a 403 mint -> plain; a hung board -> plain within
timeout; board-down -> plain; the opener seam gets the resolved url; a launch
FAILURE reports its diagnostic (not lost to process exit); and a subprocess-level
`main()` test proving stdout is the plain url while the opener gets the nonced url.
A real Windows zip was built and inspected (open-board.js present, correct .cmd),
and the staged helper loads with the real store.js.

## Weakest premise / NEEDS A WINDOWS VERIFY

The `.cmd` itself cannot be executed on this Mac: `%~dp0`, `runtime\node.exe`
launching, and the browser actually opening via `cmd /c start` are reasoned about
statically (and the build-script CRLF/quoting tests cover the emitted bytes) but
not run. The PR is marked needs-a-Windows-verify for exactly this.
