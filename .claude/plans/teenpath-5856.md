# kosmos#5856 part 2 (app): the model step tells a teen which providers they can choose

## Finished looks like
On first run's "Choose a model." step, under "Your agents run on your own subscription, on this computer.",
a person reads that Claude and API keys are for people 18 and over, and that under 18 they can choose OpenAI,
Gemini or Grok and sign in with a subscription, with a parent's permission, age rules varying by country. Where Meta Muse is switched on, Meta Muse is
named in the same list. No age question anywhere.

## Decisions (card #5856, comments 6112773763 and 6112783264)
- No age question (rejected on the card: collects a fact about a minor we do not need, cannot be enforced).
- Ages checked at each provider's own documents (2026-10-11), consumer routes:
  - Anthropic Consumer Terms (anthropic.com/legal/consumer-terms) s.2 "Minimum age": 18+, no parental route.
  - OpenAI Terms of Use (openai.com/policies/terms-of-use, effective 2026-01-01): 13+, parent's permission under 18.
  - xAI Consumer Terms (x.ai/legal/terms-of-service): 13+, parent's permission and agreement 13-17.
  - Google Gemini Apps help (support.google.com/gemini/answer/14517446): 13+ in most countries, 18+ in the
    EEA, Switzerland and the UK with a Google AI plan.
  - Meta AIs Terms of Service (facebook.com/policies/other-policies/ais-terms, effective 2026-05-13): 13+.
- API routes are stricter (card comment 6112822691): Gemini API Additional Terms (ai.google.dev/gemini-api/terms)
  18+; xAI API under the Enterprise terms (x.ai/legal/terms-of-service-enterprise) 18+; OpenAI API not confirmed
  at source, treated as 18+. Hence "and so are API keys" and "sign in with a subscription".
- Not checked: Antigravity's own terms (Gemini on a Google subscription).
- "Age rules vary by country" because of Google's EEA/UK/CH rule.
- Meta: named only when Muse is live (frPaintMeta knows), so the list never names a provider the person
  cannot pick, and nobody has to remember to add Meta when Muse leaves preview.
- Scope: first-run step only. The setup assistant prompt (kosmos-relay) and the privacy sentence
  (chaoskosmos-site) are separate PRs in those repos.

## Steps
1. web/index.html: a <p class="fr-age" id="fr-age"> after the subscription line; list in <span id="fr-age-list">.
2. frPaintMeta sets the list text by `live`.
3. web.firstrun-model.test.js: the sentence is in the step; frPaintMeta writes both list forms.
4. Screenshot the step (headless pw-runtime), light.
5. Focused tests + file-scanning guards, challenge-loop, PR, merge on green.
