# worldsw-restart-2454 -- Kosmos-switch restart: installed-board self-restart + booted-world marker

Card: kosmos#2454 ("0.6.47 re-test: Kosmos switch -- 'could not restart itself' + a
restart-loop when already on the target Kosmos"). Follows #2238 (the fail-safe
board-restart-on-world-switch primitive) and #1704 (multi-Kosmos).

## The two symptoms (Josh, 0.6.47 re-test)

(a) Restarting into a newly-created Kosmos gave "Kosmos could not restart itself. Quit
    and reopen Kosmos to finish switching to <name>." It should actually restart, like
    the software-update restart path, and come back on the target world.
(b) Clicking back to the Kosmos you are already on still demanded a restart -- a needless
    loop. It should recognise it is already on that world and not restart.

## One root cause

After a switch, `POST /api/worlds/active` flips the registry pointer (`activeWorldId`)
instantly, but the running board keeps SERVING the world it BOOTED into until it
restarts (world roots are applied once at boot by `engine/worldenv`). So the registry
pointer and the booted world diverge, and both symptoms fall out of that divergence.

## (a) Installed-board self-restart -- `engine/boardrestart.js`, `engine/clipath.js`

Why the existing guard was correctly false, not broken: the installed board is a launchd
`RunAtLoad` job with NO KeepAlive, and the running board is a detached grandchild (the
login job runs `kosmos start`, which daemonises node and exits). So
`canSelfRestart()`'s launchctl arm -- which needs unconditional KeepAlive AND the launchd
pid to be this process -- is fail-safe false for it. That arm was written for the DEV
board (`com.kosmos.board`, KeepAlive, `node server.js` as the job).

Fix: add a second restart path. `canSelfRestart()` now returns `via: 'launchctl'`
(dev, tried first) or `via: 'kosmos'` (installed). The kosmos path is gated on
`clipath.installedKosmosCli()` -- a positive `bin/kosmos` AND `app/server.js`
conjunction -- so a from-source `node server.js` board resolves to null and is NEVER
restarted (a stop would not bring it back). `selfRestart()` routes by `via`: a detached,
unref'd, stdio-ignored `kosmos restart` (the same CLI the update path drives) for the
installed board.

Critical env detail: `kosmos start` inherits the board's env, which carries THIS boot's
world-override keys. A switch TO the default world sets no overrides, so an inherited
`AGENT_WORKFORCE_DATA/_PROJECTS/_WORKERS` would keep the fresh board on the OLD world's
data -- the cross-world bleed `worldenv` exists to prevent. `kosmosRestart` strips exactly
those three keys so the fresh board re-derives roots from the registry.

## (b) Mark current by the booted world -- `server.js`, `web/index.html`

`GET /api/worlds` now also returns `bootedWorldId` (`worldenv.bootedWorld()`). The client
(`worldswRender`) marks the current world by `bootedWorldId || activeWorldId` (fallback
when null, e.g. a unit test), so the world the board is actually serving is the
non-clickable `aria-current` row -- you can no longer be asked to restart into the Kosmos
you are already on.

## Decisions and rejected alternatives

- Rejected `launchctl stop`/`launchctl kickstart -k` for the installed board: it is not
  the launchd process (the job exits after daemonising), so launchctl targets an
  exited job, not the board. Only `kosmos restart` (stop-by-pidfile + start) restarts it.
- Weakest premise: the live restart cannot be verified from a bot session (no installed
  board to drive; this agent does not deploy to Kosmos). Mitigation: unit-tested the
  decision logic, env-strip and detach with an injected spawner; kept the path
  conservative (no worse than today's "quit and reopen" on any uncertainty); routed the
  live verify (create+switch+reboot, and switch-back-to-default with no data bleed) to
  Angel / Mona Lisa via HEADS-UP. Not to be trusted in a release until that passes.

## Tests

- `engine/boardrestart-2238.test.js` -- kosmos path: canRestart via kosmos with no
  KeepAlive / no plist, launchctl-wins precedence, from-source -> manual, detached+unref
  spawn, env-strip (+ non-world var survives), spawn-failure reported not thrown.
- `engine/clipath-installed-2454.test.js` -- the safety gate, all four arms.
- `server.test.js` -- pointer-vs-booted divergence on `GET /api/worlds`.
- `docs/browser-checks/render-worldswitch-2238.js` Scenario I -- the current marker
  follows the booted world; the booted row is non-clickable; Scenarios A-H unchanged.
