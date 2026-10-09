# Plan: Node Play Developer API upload tool (#4090 piece 2)

## Goal / Done when
A dependency-free Node tool, `android/tools/play-upload.js`, that uploads a signed AAB
to the Play Developer API internal track, with a `--dry-run` that does everything except
commit. It reads the service-account key ONLY via `secrets-map.sh path <target>`, never
prints the token or key, and is unit-tested against a stub server. Offline tool: nothing in
this PR runs it against real Play. Branch + PR, normal gates.

## API flow (androidpublisher v3)
1. OAuth2 token: build an RS256 JWT (header+claim, `scope
   https://www.googleapis.com/auth/androidpublisher`, `aud`=token_uri, iss=client_email,
   1h exp) signed with node:crypto `createSign('RSA-SHA256')` using the SA JSON's
   `private_key`; POST to `token_uri` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
   → `access_token`. The token is held in memory only, never logged.
2. `edits.insert`  POST applications/{pkg}/edits → `editId`.
3. `edits.bundles.upload`  POST to the MEDIA endpoint
   `/upload/androidpublisher/v3/applications/{pkg}/edits/{editId}/bundles?uploadType=media`
   with the AAB bytes (Content-Type application/octet-stream) → `{ versionCode }`.
4. `edits.tracks.update`  PUT .../edits/{editId}/tracks/{track} with
   `{ track, releases: [{ status, versionCodes: [versionCode] }] }`. track defaults to
   `internal`; status defaults to `completed` (`--status draft` for a draft).
5. Commit vs dry-run:
   - normal: `edits.commit`  POST .../edits/{editId}:commit.
   - `--dry-run`: `edits.validate` POST .../edits/{editId}:validate, then `edits.delete`
     DELETE .../edits/{editId}. Never commits, so nothing is published.

## CLI + injection (testability and security)
- `run({ argv, env, fetchImpl, resolveKeyPath, now, log })` exported; CLI entry under
  `if (require.main === module)`. Defaults: `fetchImpl=globalThis.fetch`,
  `resolveKeyPath` = `execFileSync(secretsMap, ['path', target])` (target
  `play-upload-service-account`, overridable with `--key-target`), `now=Date.now`,
  `log` = a writer that the tool only ever hands non-secret strings.
- Args: `--aab <path>` (required), `--package` (default io.kosmos.app), `--track`
  (default internal), `--status completed|draft` (default completed), `--dry-run`,
  `--key-target <t>`. Unknown/missing args exit non-zero with a clear message.
- SECURITY INVARIANTS (asserted by tests): the access token and the key bytes are never
  passed to `log`; the SA key is read only through the resolver; a non-2xx response fails
  loudly without echoing the token; `--dry-run` issues validate+delete and NEVER commit.

## Tests (android.play-upload-4090.test.js, stub server, node:test)
A node:http stub scripts the token endpoint + the edits endpoints and records the calls.
The test generates a throwaway RSA keypair, writes a stub SA JSON, and points
`resolveKeyPath` at it so the JWT actually signs and the stub can accept it. Arms:
1. normal run: insert → upload (bytes match the AAB) → tracks.update (internal, completed,
   the returned versionCode) → commit. Asserts the exact call sequence and bodies.
2. `--dry-run`: same up to tracks.update, then validate + delete, and NO commit (control:
   assert the commit path was never hit).
3. `--status draft`: the track release status is `draft`.
4. security: capture everything handed to `log`; assert neither the access token nor any
   key material appears; a 403 from the stub fails non-zero without printing the token.

## Scope / non-goals
- No new dependencies (node:crypto, global fetch, node:fs, node:http, node:child_process).
- Nothing is uploaded to real Play in this PR; the real `play-upload-service-account`
  credential is filed separately via /add-secret when handed the key, and the tool resolves
  it only at real-run time.
