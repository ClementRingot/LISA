---
'@lisa-mcp/server': patch
---

Upgrade `express-rate-limit` from 7.5 to 8.7. The limiter configuration is unchanged and behaves the same for IPv4 clients. One behaviour change comes from v8's defaults: IPv6 clients are now keyed by their /56 subnet, so addresses in the same subnet share one quota. This hardens the limit against clients that rotate IPv6 addresses.
