# iosswitch-8626: switch an agent's AI provider and model natively from the iPhone (kosmos#8626)

## Goal
The iPhone agent page's AI Settings gain a native "Switch AI provider" section. It makes the board's own call
(POST /api/agent/<n>/provider) so an agent can be moved between providers from the phone alone, for the App Store
screen Josh asked for on 11-17 ("seamless switching agents between AI providers").

## Design (decided, reversible)
- Mirror the board, never invent rules. What is offered, which accounts and which models come from the board's own
  reads and filters in web/index.html:
  - providers: paintKeyedProviderOptions, plus claudeNoTarget/openaiAllDead, via the account filter below
  - accounts: fillSwitchAccounts' list filter (live check not 'none', badge not rejected/signed_out, offerable, and for
    Claude memoryShared, #5091)
  - models: fillSwitchModel (Claude from /api/roles `models`, OpenAI from /api/accounts/openai/models?dir=, others none)
  - body: changeProviderNow's {provider, account, picked, model}
  - pre-switch sentence: switchFamilyNote / switchCrossesFamily, word for word
  - after: the route's `because`, shown as is; only outcome "changed" counts as success
- Offered on the phone: anthropic, openai, google (API key), xai, alibaba. Not offered (the section says they are on
  the board): antigravity (Gemini by subscription, agy gate), meta (not offered on the board either), deepseek/glm/
  minimax (compat gates).
- Offered only for an agent the board would let you switch: isNamedOurs and not neverRecorded (paintProviderPicker's
  `usable`), and never onto its own provider (the board refuses a no-op).
- Files: ios/Kosmos/AgentInfoLogic.swift (logic, tested), ios/Kosmos/AgentInfoView.swift (the section), and
  ios/LogicTests/agentinfo/main.swift (tests). BoardClient.swift untouched (#8625 adds to its end).

## Tests
- ios/LogicTests/run-agentinfo.sh: 32 new cases, with guards that the board's page still holds each mirrored rule
  and sentence. Mutants: memoryShared filter removed, isNamedOurs gate removed, partial counted as success: each red.
- Simulator build (xcodebuild -target Kosmos -sdk iphonesimulator27.0).
- Sample render: KOSMOS_SAMPLE_AGENTS=1 KOSMOS_SAMPLE_OPEN=cleo KOSMOS_SAMPLE_INFO=ai KOSMOS_SAMPLE_SWITCH=openai.

## Card correction recorded on #8626
A switch across the Claude line keeps name, face, instructions and files but not the conversation
(create.js switchLosesConversation). The screen says so before the switch; "keeps history" is not claimed.

## Not in this branch
The live walk (a real board, Claude to another provider and back from the phone) is the card's done-when and is run
after merge/build against a real board.
