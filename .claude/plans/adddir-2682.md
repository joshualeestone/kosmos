# adddir-2682: add an agent from an arbitrary folder

Card: kosmos#2682. An agent set up outside discovery's bounded roots (an orchestrator run from a shared dir, an agent in a non-standard location) is invisible to Kosmos with no way to bring it in. The only manual bring-in today is the loose-agent-FILE import (#1652), for a single downloaded `.md` file, not an existing agent FOLDER already on disk.

## The ask (Josh, via #admin)

"When a user sets up an agent in a way discovery does not reach, they should still be able to add it, for example an 'add an agent from a folder' action that points Kosmos at the agent's directory."

## Design decision (mine, per the decide-and-build ruling)

Build the FOLDER analog of the existing loose-file import (#1652), reusing its entire downstream flow:

- New endpoint `POST /api/agent-import-folder`, body `{ dir }`. It reads `<dir>/CLAUDE.md`, runs `agentfile.importAgent(text, ...)` (the same parse the file import and adoption use), and returns the same parsed shape (`name`, `displayName`, `provider`, `model`, `instructions`, `recognizedFromContent`) so the create form pre-fills identically. Like `/api/agent-import-file`, it NEVER creates the agent; the create form the operator confirms does that.
- New UI action "Add an agent from a folder" next to the existing file-import entry: a directory-path input that POSTs `{ dir }` and, on `ok`, routes the parsed material into the same create-form pre-fill the file import uses.

### Why not touch discovery scope

Discovery's bounded auto-scan is deliberately bounded for safety (it never walks the whole disk). Widening it is a separate, riskier design (the card itself flags the open question and #1938). This card's ask is a MANUAL point-at-a-folder action, so the fix is a manual bring-in path, leaving `engine/discover.js` auto-scan untouched. That also keeps this out of the engine-discovery lane.

### The safety model, and where it departs from the file import

`/api/agent-import-file` gates on scan-membership (`scan.importable.some(c => c.file === file)`) specifically to avoid reading an arbitrary server-side path. This card by definition reads a folder OUTSIDE any scan, so that gate cannot apply. The replacement guard:

- The board is loopback-only and board-token authed, so the caller is the operator on their own machine reading their own file.
- Require an ABSOLUTE, existing directory path.
- Read ONLY a file literally named `CLAUDE.md` inside that dir (not an arbitrary filename), so the read surface is agent-instruction files, not arbitrary files.
- Mirror the file import's full hardening verbatim: a platform-independent `lstat` symlink/non-file refusal, then `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (each `|| 0` for win32), `fstat` isFile + size cap on the fd, read by fd. This closes the lstat->open TOCTOU window exactly as the exemplar does.
- Require the CLAUDE.md to parse as an agent (`agentfile.importAgent` returns `ok` only when it carries a usable identity); a plain project CLAUDE.md that introduces nobody is refused with its own `because`.

Weakest premise: this reads a path the scan never vetted, a deliberate departure from the membership gate. It is bounded by loopback + auth (operator's own machine), a CLAUDE.md-only read, and the full symlink/TOCTOU hardening. If a future threat model needs more (e.g. a root allowlist), it is an additive tightening, not a redesign.

## Tests

- `server.agent-import-folder-2682.test.js`: the happy path (a temp dir with an identity-bearing CLAUDE.md parses and returns the create-form shape); a dir with no CLAUDE.md refuses; a CLAUDE.md that introduces nobody refuses; a symlinked CLAUDE.md is refused (the TOCTOU/symlink arm, mirroring the #1652 test); a non-absolute or missing dir refuses.
- Web: a runtime handler test for the add-from-folder UI action if it carries logic, plus the browser-check gate (a `Browser-check:` trailer or a docs/browser-checks touch).

## Ship

Repo `joshualeestone/kosmos`, reviewer `joshualeestone` only, squash merge-on-green. PR links the card with non-closing `Addresses #2682`.
