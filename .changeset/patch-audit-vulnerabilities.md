---
'@lisa-mcp/server': patch
---

Security: patch all 9 npm audit advisories (7 high, 2 moderate) — `undici` 8.7.0 → 8.10.0 (response
desynchronisation, CRLF injection, cross-user information disclosure), `axios` 1.17.0 → 1.19.0
(proxy bypass, prototype pollution, DoS), `hono` / `@hono/node-server` (XSS, ReDoS, path traversal
in serve-static), `ip-address` 10.2.0 → 10.5.0, plus dev-only `fast-uri`, `js-yaml`, `nanoid` and
`postcss`. Lockfile-only: every advisory was fixable inside the existing semver ranges, so no
dependency range changed and there is no breaking change. This release rebuilds the published
artifacts (npm tarball and the ghcr Docker image) against the patched tree. `npm audit` now reports
0 vulnerabilities.
