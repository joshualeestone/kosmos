# #4514 token-door name boundary

Finished means a token-door file can supply exactly the provider and service token variables the engine declares, plus
the supervisor's Gemini and Grok key doors, but cannot invent process controls or override Kosmos launch state. A shipped
supervisor test must prove a broad planted set is absent from the provider environment and argv, the log names every
refused variable but never its value, ordinary doors still work, missing inventory fails closed, and the setup-guide
Gemini and Grok key behavior is unchanged.

Decision after review: use an exact allowlist read from `engine/tokendoors.js` SPECS at every launch, plus the two
provider-key names GEMINI_API_KEY and XAI_API_KEY which this supervisor already owns. I first chose a narrow denylist to
avoid inventory drift. Sonya's real-provider probe disproved that model: NODE_OPTIONS executed code, and planted door
files overrode the minted sender token, HOME, provider config and board port. The engine can publish its installed list
directly, meeting the original plan's change condition without duplicating the service inventory in shell. A missing or
invalid inventory fails closed for machine-global doors. Per-account Gemini and Grok key files remain trusted separate
inputs.

Weakest point: GEMINI_API_KEY and XAI_API_KEY are still named in shell because they are provider launch inputs outside
today's SPECS. I would move them out of this exception if their machine-global writers become ordinary token-door specs.
