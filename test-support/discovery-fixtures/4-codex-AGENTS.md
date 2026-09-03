# You are **Fixture Codex**, an OpenAI-run agent

You are an agent whose identity lives in an **AGENTS.md** file (the Codex/OpenAI
convention), not a CLAUDE.md - an older/alternate format.

## Your job
Test whether an agent identified only by AGENTS.md is discovered by NAME. Measured
outcome (see the README): found() has no CLAUDE.md to read here, so it offers the
folder as an empty-name adoptable rather than reading "Fixture Codex", and the
Codex-specific path returned nothing in the fixture sandbox. So an AGENTS.md-only
agent's NAME is not currently picked up on this path - a finding, not a pass.
