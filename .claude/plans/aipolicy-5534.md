# aipolicy-5534: the company's AI policy text reaches every agent (E0.5 slice 3)

Card: kosmos#5534, pilot contents: "company AI policy text through policy.js". Slices 1 (apply the signed policy,
#5726) and 2 (report the version, #5730 + relay #351) are done or in flight. The signed policy already carries
`ai_policy: { name, text }` (the console's editor saves it); nothing hands it to agents yet.

Finished means: on an enrolled board whose applied company policy has AI policy text, every agent's instructions carry
it, as a company-set entry in the same managed policy block as the person's own policies, at creation, at board start,
and when a new company policy is applied; and it leaves every agent's instructions when the policy is cleared (the
board leaves) or the company drops the text. The person cannot remove it from Kosmos (it is the company's).

## Design
- engine/policy.js: `companyEntry()` reads orgpolicy.current().ai_policy (text a non-empty string within TEXT_MAX, a
  name within NAME_MAX else DEFAULT_NAME) with the applied version; never stored in policy.json. `effective()` = the
  person's policies plus the company entry (company first: the company mandates it). The block composer and tellAgent
  use effective(). The provenance line for it names the company policy and its version.
- engine/create.js: a new agent gets the policy block at creation (the same splice pattern as connections). This also
  closes a gap for the person's own policies, which today reach only agents that exist when a policy is saved.
- server.js: the policy block is refreshed at boot (as connections and reports are), and after an enrollment refresh
  or a leave when the company entry changed (its name, text or version).

## Decided
- The company's text is not merged into policy.json: the person's Settings list stays theirs, and leaving clears the
  company's text with the applied policy, no second copy to forget.
- Settings does not list the company entry yet (the screen's remove would fail on it); next slice if wanted.
