# grokcompat-4426: Kosmos grok agents stop loading the person's Claude Code setup

Card: #4426 (claimed pigeonpete, night shift 2026-09-28).

## Call
Turn off every grok claude-compat cell at both grok launch sites, not only hooks:
- the Mac supervisor's grok arm (`-e` on the tmux session);
- the Windows keyed turn env (`win32keyed.turnEnv`).

The list lives once in JS (`GROK_CLAUDE_COMPAT_OFF`). A test pins the supervisor's `-e` list equal to it, because the supervisor is shell and cannot import it.

## Measured (grok 1.0.41, this Mac)
- Today's launch (hooks off only): 84 live `[claude]` entries in `grok inspect`, including `~/.claude/Claude.md` (~13.7k tokens) and every `~/.claude` skill.
- With the four extra cells off: 0 live, 96 `[disabled]`.
- Grok's docs say "generic top-level CLAUDE.md stay recognized" with `agents=false`. So I measured rather than assumed: the home `~/.claude/Claude.md` IS disabled.
- What remains listed (the discord MCP, the code-improver agent, the untagged hooks) comes from this Mac's own `~/.grok` config, not Claude compat.
  - Out of scope here: a PER-ACCOUNT agent runs under its own GROK_HOME.
  - A DEFAULT-account agent runs under the person's `~/.grok`, so what they configured there still applies. That is grok's own home, not Claude's.

## Review round 1 (opus, blind): 0 BLOCKERs, 2 WARNINGs, 4 NITs
- WARNING: a running grok agent is adopted at board start with its old env. KEPT, disclosed: it takes effect at the agent's next launch. A relaunch-on-upgrade path for grok (like #4353 for agy) is a bigger change than this card. Noted in the supervisor comment and on the PR.
- WARNING: comments said "AGENTS.md and its own hooks only", but a plain CLAUDE.md in the agent's folder still loads. Fixed the wording in win32keyed.js and the supervisor.
- NIT: "84" read as a standing fact; now worded as a snapshot. Fixed.
- NIT: my plan said every agent has its own GROK_HOME; a default-account agent does not. Fixed.
- NIT: create.js "only its own report hooks" had the same caveat. Fixed.
- NIT: the test regex would count a commented-out `-e` line; hooks '0' vs 'false'. KEPT: '0' was already in use and was measured working (the report hook still fires, 0 live [claude] hooks); a comment inside the tmux command line is not realistic.

## Rejected
- A per-agent opt-in to keep the person's Claude setup: nobody has asked for it, and it is reversible later.
- Writing `[compat.claude]` into the account's config.toml: env already wins over config.toml, and a file edit would touch a home the person may also use by hand.

## Weakest premise
That nobody wants their Claude setup inside Kosmos's grok agents. That is a product call; turning it off is reversible.

## Tests and mutants
create.test.js and win32keyed.test.js: 233/233 pass. Three mutants were each applied (count 1), went red, and were restored by hash:
- M1: the supervisor drops the rules cell (1 fail).
- M2: the JS list drops the mcps cell (2 fail).
- M3: the Windows env goes back to hooks-only (1 fail).
