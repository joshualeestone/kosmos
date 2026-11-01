# managedread-7742: the org chart consent box when a read goes elsewhere (kosmos#7742)

Finished means: when managed settings or a provider switch nobody listed send a Claude read somewhere else, the consent box does not state what Anthropic keeps. No words change: this feeds `redirected`, which #4660's box already reads.

Decided:
- Switches by pattern: any CLAUDE_CODE_USE_ name but four read from the 2.1.316 binary that are not providers. Base URLs by pattern too, as Bedrock, Vertex and Foundry each have one. A new provider counts by default.
- Managed places from that binary: a settings file and a drop-in folder (with WSL's Windows path), a macOS profile, Windows policy keys, and settings a server hands down into the account's folder.
- A file that says so, or cannot be read, or a form not parsed here counts as sent elsewhere. Rejected: only trusting a parse, which fails towards the positive statement.
Weakest premise: that managed settings reach `claude -p --setting-sources ''` at all. Not measured, as it needs root. If they do not, a managed computer gets a vaguer box than it needed, which is the safe way to be wrong.
What would change this: a measurement on a managed Mac.
