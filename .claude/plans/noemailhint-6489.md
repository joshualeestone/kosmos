# noemailhint-6489 (kosmos#6489)

The Settings phone-notifications hint ended "If an agent has needed you for 30 minutes and nobody has answered,
Kosmos+ may also send you an email." That email is built but behind KOSMOS_NEEDS_YOU_EMAIL, off in production
(measured on the box by the push path's owner, #6487 comment 6251397328), so the sentence promised nothing that happens.

## Change
web/index.html: the sentence is removed; the rest of the hint is unchanged. New web.no-email-hint-6489.test.js: the page
must not promise the email (red on main), plus a control that the remaining hint is intact.

## Decided
Remove rather than reword ("may" already hedged it and was still untrue). Put it back with the test when the email is
switched on in production. Rejected: switching the email on (not my lane, and a product call).

## Weakest premise
That production's flag stays off. If it is switched on, this sentence must come back; the test's comment says so.
