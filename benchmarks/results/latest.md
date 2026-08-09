# Baton deterministic handoff benchmark

Generated: 2026-08-09T01:37:12.903Z

Six synthetic, reproducible coding-failure fixtures compare serialized evidence with validated handoff packets. Fact retention checks goal, acceptance criteria, changed files, command exit codes, latest failure, and verification command. One fixture forces the model backend to fail.

## Summary

- Schema validity: **100%**
- Deterministic fact retention: **100%**
- Median context reduction: **87.7%**
- Minimum context reduction: **87.4%**
- Forced backend-failure cases: **1/6**

| Scenario | Fallback | Schema | Fact retention | Est. tokens | Reduction |
|---|---:|---:|---:|---:|---:|
| database-migration | no | pass | 100% | 2094 → 263 | 87.4% |
| websocket-reconnect | no | pass | 100% | 2147 → 255 | 88.1% |
| auth-boundary | no | pass | 100% | 2141 → 264 | 87.7% |
| cache-race | no | pass | 100% | 2140 → 267 | 87.5% |
| worker-crash | no | pass | 100% | 2165 → 265 | 87.8% |
| provider-outage-fallback | yes | pass | 100% | 2187 → 223 | 89.8% |

Token counts use the repository's documented four-characters-per-token estimate. This suite measures deterministic packet integrity and payload reduction, not model quality or end-to-end coding success.
