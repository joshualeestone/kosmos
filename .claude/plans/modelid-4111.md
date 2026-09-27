# modelid-4111: a model id in a secrets file is not held (kosmos#4111)

## Problem
engine/knownsecrets.js holds every key-shaped value in a file under secrets/. A model id (gpt-4o-mini-2024-07-18)
has digits and no words, so `OPENAI_MODEL=gpt-4o-mini-2024-07-18` made it a held secret, and the guide mask then
masked the setup guide's own prose naming the model (found in #3995 gap-4 review round 25).

## Design
- parseAssignment(line) -> {name, value}; assignedValue wraps it (one parser, as before).
- isPublicName(name): a NAME with a public part (MODEL, MODELS, REGION, VERSION, ZONE, LOCALE, LANG, LANGUAGE, TZ,
  TIMEZONE) and no secret-like part (KEY, TOKEN, SECRET, PASSWORD, PASS, PWD, AUTH, CREDENTIAL(S), PRIVATE, SIG,
  SIGNATURE, SALT, COOKIE, SESSION, DSN, CERT, PEM, APIKEY).
- valuesIn: for a public assignment, hold NEITHER the line NOR its value (and not a one-line file that is one). Both
  must go: secretmask's isEnvLine walks a NAME=value line whose value is not held, which would mask pieces of it in
  prose. Other key-shaped tokens on the line (a key in a trailing comment) are still held.

## Rejected
- URL, HOST, ENDPOINT as public parts: a URL can carry a token or password; holding one costs only a masked address.
- A model-id SHAPE list (gpt-*, claude-*, gemini-*): goes stale with every new vendor and would un-hold a real key
  that happens to start the same way. The NAME is what says the value is configuration.

## Weakest premise
A secret stored under a NAME that ENDS in a public part with no secret-like part anywhere (a password in `REGION=...`)
is no longer held by value, and the mask's shape rules do NOT reliably catch it in prose: review round 1 measured a
24-character mixed-case key under MODEL_PASSPHRASE going unmasked (that NAME is now secret by its last word). The rule
is narrowed to the last part so a misnamed secret needs a NAME that says, in its last word, that it is configuration.

## Tests
- knownsecrets.test.js: public values not held (env, export, YAML, JSON, one-line file); controls: OPENAI_API_KEY and
  MODEL_API_KEY held; a key in a comment on a public line held. isPublicName table.
- secretmask.test.js: end to end through collect -> setKnownSecrets -> mask: three sentences naming the model are
  untouched; the key beside it is masked.
- All three red on origin/main's knownsecrets.js. Perturbation (hold the line, skip only the value) turns the end-to-
  end test red: the walked-line trap is guarded by the behaviour test, not only by the collector test.

## Challenge loop record
### Iteration 1 (opus): 3 WARNINGs, 3 NITs, all fixed.
- W: exact-equality exclusion missed values keyTokens cuts at ":" (Bedrock anthropic.claude-...-v1:0, OpenAI ft:...).
  keyTokens now runs on the line with the value blanked. Exact-equality perturbation turns both tests red.
- W: MODEL_PASSPHRASE, REGION_BEARER counted as public, and the plan's premise that shape rules catch such a key was
  measured false. isPublicName now requires the LAST part public (or <public>_ID/_NAME); more secret words added;
  premise rewritten.
- W: camelCase JSON names (defaultModel, modelId) were never public. Now split on camelCase.
- N: ZONE dropped (CF_ZONE_ID stays held, with a control); assignedValue comment reworded; isPublicName table widened
  (model.api-key, model-secret, modelToken, SESSION_ID, ID).
- Note: the background validation run overlapped these edits; it is discarded and rerun.
### Iteration 2 (sonnet): 1 WARNING, fixed.
- W: the value was blanked with a non-global replace, so a comment restating it on the same line held it again.
  Now every occurrence is blanked (split/join); a CHAT_MODEL line with the value restated in its comment is in the
  collector test and goes red under the single replace.
- The second background validation (val4111b) was also stopped for this edit; validation runs once, at 6j.
