---
'@lisa-mcp/server': patch
---

Docker: the official image is now published to `ghcr.io/clementringot/lisa-mcp` (`X.Y.Z` +
`latest`) on every product release, and no longer bakes in a wrong
`SAP_I18N_SERVICE_PATH` (`/sap/bc/rest/zcl_i18n_service` — it silently overrode the code's
correct `/sap/bc/http/sap/zi18n_service` default, breaking any container run without an explicit
override) nor a hardcoded `SAP_CLIENT`. Self-hosted usage (Docker/Kubernetes, auth via API keys
or OIDC) is now documented in the README. npm package content is unchanged.
