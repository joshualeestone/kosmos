# Plan: #1760 hardening -- pin the store data root 0700 + message files 0600

## Source

My own #1760 pre-beta audit finding (message-store at-rest slice), REFRAMED honestly
after a challenge-loop review: the message log / spill files are written at the
default mode, and a NON-default data root (`AGENT_WORKFORCE_DATA`/`AGENT_WORKFORCE_HOME`
outside macOS's already-0700 ~/Library) can be world-readable to other local accounts.

CORRECTION to my original slice: it claimed `store.ROOT` is "NOT explicitly chmod'd
0700". That was incomplete -- `boardauth.js:332` (`mkdirSync store.ROOT mode:0700`)
and `:348` (`chmodSync store.ROOT 0700`) ALREADY pin the root 0700 on board startup.
So on a running board the root IS owner-only. This change's real added value is
therefore (1) extending the 0700 pin to ALL store-write contexts -- including a CLI
write (`kosmos feedback`) that creates the store before any board runs, which
boardauth's startup path does not cover -- and (2) the message-file 0600, which is
genuinely new (the message files were at default mode). It ships as defense-in-depth
plus the new message-0600, NOT as fixing an unprotected root. Splinter approved
building it (small, safe, reversible; staging-first deploy, Josh-gated).

## Change (small, reversible, best-effort)

- `engine/store.js` `ensure(dir)`: after `mkdirSync`, `chmodSync` the data root to
  0700 (computed via `dataRootFor` WITHOUT the legacy migration `root()` runs, so
  ensure stays side-effect-free beyond the dir it makes). Every store write goes
  through `ensure`, so any write pins the root owner-only. Idempotent + best-effort
  (a read-only root / race / non-POSIX platform is not fatal). Mirrors filelock.js,
  which already chmods its lock dir owner-only.
- `engine/messages.js`: the message LOG (`appendLog`) and the two spill writes pass
  `{ mode: 0o600 }` -- owner-only on create. Defense-in-depth; the 0700 root is the
  load-bearing traversal barrier.

## Test

`engine/store.mode-hardening-1760.test.js`: a store write (writeProfile -> ensure)
pins the data ROOT to 0700, with a CONTROL that ROOT is a SUBDIR of the mkdtemp
sandbox (so the 0700 is ensure()'s doing, not the mkdtemp default). Discriminates:
remove the chmod and the app subdir is the umask default (~0755) and the assertion
reds.

## Out of scope

- The COORDINATOR systemd `UMask=0077` hardening is a separate tiny PR in kosmos-relay.
- The curl-install codesign hardening is a separate PR routed to Splinter for review.
- No behavior change beyond file/dir modes; the default data root (inside ~/Library)
  is already 0700, so this only tightens the non-default-root case.
