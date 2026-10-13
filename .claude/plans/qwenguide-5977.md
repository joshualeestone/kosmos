# kosmos#5977 follow-up: the agents' guide says Qwen can be connected on a Mac

## Change
engine/connections.js (the provider guide every agent is given) listed Alibaba Qwen as coming soon and not
choosable, although #6064 put it in Settings, AI Models, Add a provider on a Mac and 0.7.47's What's New leads
with it. Found by Baron before the 0.7.47 cut. The guide now says how Qwen connects on a Mac:
- Codex pointed at an address.
- Ollama on this computer: Kosmos does not install Ollama. It offers Download Qwen, or Set up Qwen.
- Any OpenAI-compatible server, with a key only if that server asks for one.
- Codex must already be there.
- The address is checked when saved, and an address that does not answer yet is still saved.

Off a Mac, Qwen stays in the coming-soon sentence.

## Evidence
- engine/connections.test.js pins the coming-soon sentence and the Mac line. It reads the button names, the
  Windows label and the server's Codex refusal from the shipped files. The old line put back reds it.
- Every test requiring connections plus web.settings-agy-3874: 289/289.

## Review
1. opus: 1 warning (the guide implied Kosmos installs Codex for Qwen; the server refuses instead) and 1 concern
   (an unanswered address is still saved), both fixed; the nit (pin the Windows claim) taken.
