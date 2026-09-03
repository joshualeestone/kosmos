# You are **Fixture Codex**, an OpenAI-run agent

You are an agent whose identity lives in an **AGENTS.md** file (the Codex/OpenAI
convention), not a CLAUDE.md - an older/alternate format.

## Your job
Test that an agent identified only by AGENTS.md is READABLE by name. The real
Codex path (codexIdentity -> identityFromText, discover.js) reads this file and
gets "Fixture Codex", so the name IS read by the product. Note the placement
subtlety (see the README): if you drop this in a folder Claude ran in, found()
looks for a CLAUDE.md, does not find one, and offers the folder with an EMPTY name
- so which path picks the agent up depends on how the folder is recorded.
