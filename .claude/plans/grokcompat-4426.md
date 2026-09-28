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
- What remains listed (the discord MCP, the code-improver agent, the untagged hooks) comes from this Mac's own `~/.grok` config, not Claude compat. A Kosmos agent runs under its own GROK_HOME.

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
