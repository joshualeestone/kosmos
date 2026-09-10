# Plan: #2129 one-click trust-and-restart fallback route

## Problem

#2129 is the catastrophic fresh-macOS failure: a Kosmos-spawned agent stops on
the runner's directory-trust prompt (Claude Code's "Quick safety check" / codex's
"Do you trust the contents of this directory?"), which a non-interactive TUI
cannot answer (Enter picks the default "No, exit" and ends the session). It has
recurred three times (#2144, #2173, #2382).

The keystone fix #2382 (merged) makes a fresh agent trust its own folder
AUTOMATICALLY, by keying the trust write on `fs.realpathSync.native` — the
on-disk spelling the runner actually looks up. That closes the known cause.

This route is the INSURANCE for the causes that fix cannot reach: a silent trust
write failure, or a runner that changes its trust format. In those cases the
agent still lands on the terminal menu, and today there is no in-app way out.

## Goal

A one-click escape: given an agent stuck (or at risk) at the trust menu, write
the trust key for its own folder+account and restart it, so it comes back past
the menu — with no hand-answered terminal prompt. This is Josh's "one click to
trust".

## Design

New route `POST /api/agent/:name/trust-and-restart` in `server.js`:

1. Read the agent's launch job (`create.readJob`) for its runner and account dir.
2. Write the folder-trust key for the agent's OWN folder, per runner, using the
   CREATE PATH's own writers — unchanged — so the escape and the create-time
   write can never disagree about the on-disk spelling (the #2382 property):
   - Claude: `require('./engine/trust').trustFolder(folder, {configDir, createIfAbsent:true, agentDefaultAccount:!configDir})` (native-realpath keyed).
   - codex: `create.trustCodexFolder(folder, job.configDir, !job.configDir)`.
3. Restart the agent (`removal.restart(clean, 'restart')`).

The trust write is BEST-EFFORT and NON-GATING (as on the create path): a failed
or refused write still restarts, because the restart is the half that unbricks
the agent. Its result rides back in `trusted`; the restart's outcome is the
route's verdict. With no job there is no folder to key on, so the write is
skipped and restart gives its own friendly refusal.

Cause is the honest generic `'restart'` (the board renders "Restarting agent"
from it); a dedicated `'trust'` cause would need a matching frontend sentence
(disruption.CAUSES is a frontend-rendered token) and is left as a frontend
follow-up.

## What is explicitly out of scope (routed elsewhere)

- The View-Agent "Trust and restart" BUTTON (web/index.html, Angel's lane, needs
  the shared browser to verify). Routed to Angel with the exact route contract;
  copy from Mona Lisa. Rides 0.6.44 with the button.
- Codex-side trust-gate DETECTION in status.js (currently only Claude's gate is
  detected) — a separate follow-up.

## Test strategy

`server.trust-restart-fallback-2129.test.js` drives the route over HTTP in a
sandbox that seals BOTH providers' config roots, so the default-account arm (the
fresh-user catastrophe itself) cannot touch a real ~/.claude.json or ~/.codex.
Four arms, each with a discriminating control and each verified red under a
matching perturbation:
- Claude default-account: the trust key written is the NATIVE realpath.
- codex: a trusted `[projects."…"]` block is written for the folder.
- best-effort/non-gating: a soft trust-write failure (symlinked config) STILL
  restarts.
- no job: the route answers (no crash), skips the trust write, surfaces the
  restart's friendly refusal.

## Decisions

- Single native-keyed writer reused from the create path, not a re-implementation
  — the whole point is that the escape and the create-time write agree.
- Best-effort trust, non-gating restart — a failed trust write must not withhold
  the restart, or the escape leaves the agent as stuck as before.
- Split at the surface boundary: engine route here (this PR); button in Angel's
  frontend lane.
