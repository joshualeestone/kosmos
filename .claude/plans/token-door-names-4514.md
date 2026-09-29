# #4514 token-door name boundary

Finished means a token-door file can still supply ordinary provider and service token variables, but PATH, BASH_ENV,
ENV, SHELLOPTS, every DYLD_* name and every LD_* name are refused before the private handoff. A shipped supervisor test
must prove each refused name is absent from the provider environment and argv, the log names the refused variable but
never its value, ordinary doors still work, and the setup-guide Gemini and Grok key behavior is unchanged.

Decision: use a narrow denylist after the existing environment-name syntax check. I rejected an exact allowlist because
the token-door contract deliberately makes a new service one engine row rather than a second supervisor edit; duplicating
all service names here would turn every future door into a fail-closed launch regression. I rejected a suffix allowlist
because valid service credentials do not share one reliable suffix and a hostile name can add a harmless-looking suffix.
The denylist names shell startup controls and both macOS and ELF loader namespaces from the card. It does not try to be a
general environment-variable policy.

Weakest point: a denylist cannot anticipate every future runtime-specific startup variable. I would change this call if
token doors become user-defined rather than the finite engine specs, or if the engine can publish one installed allowlist
without restoring the two-file drift this design avoids.
