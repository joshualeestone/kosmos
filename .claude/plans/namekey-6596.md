# namekey-6596 (board): a key the connector names under the shipped list is not offered (kosmos#6596 follow-up)

Pairs with kosmos-relay namekey-6596, where the connector names a key it refuses for not being on the list it was
handed. Under the shipped list (production, a verified set shipped) the board's Accept is refused anyway
(acceptOfferedKey), so `withKeyChange` does not offer it there: the refusal stays an ordinary error, its words shown as
the connector wrote them (they end with the key, with nothing to press).

## Test
engine/acceptkey-6596.test.js: the connector's own words naming a key; with no shipped list it is offered (control),
under the shipped list it is not. Arm: the suppression removed reds that test only.
