# Plan: add-authentication

**Issue:** joshualeestone/agent-workforce#10, remote access + authentication
**Branch:** `add-authentication`
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-07

---

## ⚠️ Assumption this plan is written under

Josh was asked (Discord, 2026-08-07 10:44 CDT) to choose between:

- **(A)** close the auth hole now with a local password login, passkeys later once a real hostname exists, **or**
- **(B)** hold all auth until the domain and certificate work lands so passkeys are the first and only login anyone ever registers.

**This plan assumes (A).** If Josh picks (B), Section 3 (the credential mechanism) is
replaced wholesale by WebAuthn and this branch waits on the hostname work; everything
in Sections 2, 4, 5 and 6 survives unchanged, because the enforcement layer is
mechanism-agnostic by design.

**Not relitigated:** passkeys and the Nabu Casa relay remain the destination, per
`docs/remote-access-research.md`. This plan changes only what protects the app between
now and the hostname existing.

---

## 1. The problem, stated precisely

The app **writes** and has **no authentication of any kind**. `PUT /api/agent/:name/avatar`,
`DELETE` of the same, and `PUT /api/agent/:name/profile` all mutate state in
`~/Library/Application Support/AgentWorkforce/`. Issue #1 adds a restart button on top
of that.

It is safe today for exactly one reason: `server.listen(PORT, '127.0.0.1')`. The comment
at `server.js:137-157` already names why that is a default rather than a guarantee:
Tailscale Funnel is enabled on this machine and proxies loopback ports to the public
internet, so a route added for 4317 would publish every write endpoint **without touching
a line of this repo**.

### The finding that sets the order

**A passkey is permanently bound to the hostname it was created on.** WebAuthn credentials
carry an RP ID fixed at creation; a credential created against `localhost` cannot be
asserted against a real domain later. Two consequences:

1. Passkeys **cannot** be registered before the domain, DNS zone and wildcard certificate
   exist. "Ship passkeys" silently depends on all of that landing first.
2. Anyone who registered early would have to register again after the migration.

WebAuthn *does* work on `localhost` (it is a potentially-trustworthy origin, so no TLS is
required), which is why this looked like a shortcut on first read. The RP-ID binding is
what closes it off. This is the reason auth-first is proposed with a password rather than
with passkeys.

---

## 2. Enforcement: default-deny, mechanism-agnostic

**This section is independent of which credential mechanism wins**, and it is the
load-bearing half.

The gate must be **default-deny**: every route requires a valid session *except* an
explicit allowlist (the login page, the login endpoint, and the first-run setup endpoint).
A route added later is protected because nobody did anything, not because somebody
remembered to add it to a list.

This mirrors the project's existing instinct that **unknown must never render as healthy**
(`docs`, and the status ring behaviour). A forgotten-to-protect endpoint is the same class
of bug as an empty ring reading as healthy.

- [ ] **2.1** Add the gate at the top of the `http.createServer` handler in `server.js`,
      before any route matching.
- [ ] **2.2** Allowlist exactly: `GET /login`, `POST /api/login`, `GET /setup`,
      `POST /api/setup` (first run only), and nothing else.
- [ ] **2.3** Unauthenticated `GET` of a page route redirects to `/login`.
      Unauthenticated `/api/*` returns `401` JSON, never a redirect, so a fetch fails
      loudly instead of silently receiving an HTML login page and parsing it as JSON.
- [ ] **2.4** A test that asserts the allowlist is exhaustive: enumerate the routes the
      server answers and assert every one not on the allowlist returns 401/redirect when
      unauthenticated. **This is the test that catches a future unprotected endpoint.**

---

## 3. Credential mechanism (assumes option A)

Password set at first run, verified locally. **No new dependencies** — Node's built-in
`node:crypto` covers all of it, which keeps the "nothing of ours in the middle" promise
literally true and keeps this repo at zero dependencies.

- [ ] **3.1** New `engine/auth.js`, following the shape of `engine/store.js`
      (same app-data root, same write-then-rename discipline).
- [ ] **3.2** Store at `~/Library/Application Support/AgentWorkforce/auth.json`,
      written with mode `0600`. Contains: `scrypt` hash, per-install random salt,
      the KDF parameters used, a session-signing secret, and `updatedAt`.
      **Storing the parameters** means they can be raised later without invalidating
      existing credentials.
- [ ] **3.3** Hash with `crypto.scryptSync` (N=2^15 or higher, tuned to land near
      ~250ms on this hardware and recorded in the file). Compare with
      `crypto.timingSafeEqual`, never `===`.
- [ ] **3.4** First-run state: when `auth.json` is absent, **the app is unusable except
      for the setup screen.** It must not fall open. Refusing to serve is correct here;
      an unprotected default is what the issue exists to remove.
- [ ] **3.5** Minimum password length enforced server-side (not only in the browser),
      and the error text says what to do rather than naming a rule number.

### Migration promise recorded now

When passkeys land, the password is **demoted to recovery**, not deleted. That is what
makes losing a phone survivable, and it means nothing built here is thrown away.

---

## 4. Sessions

- [ ] **4.1** Signed session cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`.
      Value is an opaque random id plus an HMAC over it using the secret from 3.2.
- [ ] **4.2** ⚠️ **`Secure` cannot be set yet.** The server speaks plain HTTP on
      loopback, and a `Secure` cookie would simply never be sent, breaking login in a
      way that looks like a wrong password. It is set the moment TLS lands in the
      hostname slice. **Recorded here so it is not discovered as a bug later.**
- [ ] **4.3** Expiry: absolute (e.g. 30 days) plus idle timeout. Values in one named
      constant, not scattered literals.
- [ ] **4.4** Changing the password invalidates every existing session by rotating the
      signing secret.
- [ ] **4.5** `POST /api/logout` clears the cookie and drops the session.

---

## 5. Attack surface that auth alone does not close

- [ ] **5.1** **CSRF.** `SameSite=Strict` covers most of it, but `PUT /api/agent/:name/avatar`
      accepts arbitrary `content-type`, which is exactly the shape that can be driven
      cross-origin. Add an `Origin`/`Sec-Fetch-Site` check on all state-changing methods
      and reject anything not same-origin. Cheap, and belt-and-braces beside `SameSite`.
- [ ] **5.2** **Login brute force.** In-memory failed-attempt counter with an increasing
      delay, keyed per-install (there is one account). No lockout — locking the only
      account out of a machine nobody is sitting at is worse than the attack.
- [ ] **5.3** Do not distinguish "no password set" from "wrong password" in the response
      text once setup is complete.

---

## 6. Surfaces and copy

- [ ] **6.1** First-run setup screen: one field, one confirm, plain language. Follows
      `docs/apple-style-reference.md`.
- [ ] **6.2** Login screen, same treatment.
- [ ] **6.3** Sign-out control in the existing settings panel (`web/index.html:268`).
- [ ] **6.4** ⚠️ **Rewrite the block comment at `server.js:137-157`.** It currently ends
      "Local only. It writes, and it has no login yet." That sentence becomes false with
      this branch, and a stale security comment is worse than none, because the next
      reader trusts it.
- [ ] **6.5** Update `README.md` for the first-run step.

---

## 7. Repo hygiene (folded in, since this branch touches the repo anyway)

- [ ] **7.1** Run `/repo-setup`. This repo has **no `CLAUDE.md`**, no `.claude/settings.json`,
      no PR template, and no plans directory. It is the only active repo in the fleet
      without recorded conventions, which is why this plan is the first one it has held.

---

## 8. Tests

Existing pattern: `node --test engine/*.test.js`, no framework, no dependencies. Match it.

- [ ] **8.1** `engine/auth.test.js`: hash/verify round trip; wrong password rejected;
      `timingSafeEqual` used on equal-length buffers; setup refuses a short password;
      password change rotates the secret.
- [ ] **8.2** Session tests: valid cookie accepted; tampered HMAC rejected; expired
      session rejected.
- [ ] **8.3** **The allowlist-exhaustiveness test from 2.4** — the most valuable test here.
- [ ] **8.4** CSRF: cross-origin `PUT` rejected with a valid session cookie present.
- [ ] **8.5** `npm test` stays green and dependency-free.

---

## 9. Explicitly out of scope for this branch

Named so the branch does not sprawl, and so the next agent does not think they were missed:

- The relay, SNI routing, QR pairing (the from-anywhere slice).
- The wildcard DNS zone and certificate, and the `plex.direct`-style same-network hostname.
- Passkeys / WebAuthn.
- Binding to anything other than `127.0.0.1`. **This branch adds auth and no reachability.**
  That direction is always safe; the reverse never is.
- Issue #1's restart button, which now has a gate to sit behind.

---

## 10. Definition of done

1. `npm test` green, still zero dependencies.
2. No write endpoint reachable without a session, proven by 2.4's test rather than by inspection.
3. First run cannot be skipped, and cannot leave the app open.
4. The security comment in `server.js` describes what is now true.
5. `/challenge-loop` run to convergence, proof file committed.
6. Screenshots of setup and login in the PR and posted to Discord.
7. PR opened with `joshualeestone` as reviewer, linking `Addresses #10` (non-closing —
   #10 is not finished by this branch, only made safe to continue).
