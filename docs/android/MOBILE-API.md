# Mobile API v1 — Phase 2 implementation contract

Status: initial design; not implemented or production-authorized.

## Snapshot data and lifecycle
- Reuse the existing notification-checks collector in the scheduler. No extra SSH, Docker or host queries in the HTTP request or widget refresh. Preserve notification behavior and the existing monitoring history collector.
- Store at most one latest snapshot per eligible server (including virtual local); use an additive dedicated SQLite table, with server configuration revision and observedAt. Delete disabled/deleted server snapshots or exclude them immediately, prune orphan rows; never add per-refresh history. Avoid stale updates overwriting newer observations; only scheduler results publish, not manually triggered notification requests. Failure to publish is visible as stale/unavailable without changing alert semantics.
- Distinguish host reachability evidence from metric/SSL/service errors. isActive is administrative configuration, not reachability. Generic collection exception -> unknown, not offline; only explicit reachability failure evidence may yield offline (meaning unreachable by monitor, not proven powered off). Unknown metrics null, never 0. Expose last observation timestamp and freshness separately. A disabled server is disabled, not offline. A stale/disabled worker must not leave healthy indicators looking current.
- CPU/RAM/disk percentages reflect validated observations from the existing collector; confirm its parsing/measurement behavior before reuse. Expose per-server known stopped-container/important-service/SSL/backup observations, nullable if unsupported; no fabricated app totals or alert counts. No logs, SSH host, usernames, IPs, secrets or raw collector output.

## Device authorization
- Existing authenticated web session issues single-use pairing code with short TTL, server allowlist subset of current permissions, device label and owner user. Web mutating routes retain existing origin/CSRF and authentication. Codes are random high entropy (manual copy/paste, optional QR), hash at rest; atomic one-time consumption and expiration, bounded attempts and payload, no secrets in URLs or logs.
- Native pairing POST accepts only code over HTTPS. Separate explicit middleware exception for exactly this route and method; no broad public prefix. Reject malformed/oversize requests, rate limit, no session cookie generated. Use hashed random 256-bit bearer token, never issue general web JWT, store device-scoped token hash, user binding, expiry, revocation, server allowlist and force-logout version. Compare current user active/role/scope and allowlist at each read; fail closed on missing/disabled account, revoked/expired token, or invalid permissions. Existing web endpoints must never accept device tokens.
- GET /api/mobile/v1/snapshot accepts only valid scoped bearer, returns only permitted snapshot projection. Exact method/path boundary; other mobile methods/routes deny by default. No CORS wildcard, no redirects, Cache-Control: private, no-store. Never persist bearer in plain text, logs or audit; audit pairing/revocation without credentials. Bound last-access writes; revoke from web even if device offline.
- Web device management endpoints use current web session and owner checks; user can manage only own devices (admin policy must be explicitly tested if extended). No device token access. Rate limits for issue/redeem/read, atomic redemption, replay/race tests. Disable on account revocation/force logout and re-pair when expired. Android stores token using Keystore, excludes backup, erases on auth failure and clears widget on next observed revocation. An offline phone cannot know revocation instantly; cached values visibly stale.

## Proposed GET response
```json
{
  "version": 1,
  "generatedAt": 0,
  "worker": {"enabled": true, "online": true, "intervalSeconds": 60},
  "servers": [{
    "id": "local", "name": "Example", "state": "online",
    "observedAt": 0, "cpuPercent": 24, "memoryPercent": 62, "diskPercent": 45,
    "stoppedContainers": null, "failedServices": null, "expiringCertificates": null,
    "backupStale": null
  }]
}
```
Times are UTC epoch milliseconds; 0 is illustrative only, actual unobserved timestamp null. States online/offline/unknown/stale/disabled. Use a bounded response and explicit failure for excessive fleet size; never silently drop unauthorized or authorized data. No app aggregation from isActive. Version contract subject to implementation tests, no production endpoint yet.

## Gate
Unit tests for validation/freshness; DB clone additive migration; scheduler-only storage and bounded lifecycle; authorization matrix across current roles/scopes; one-time redeem race/replay and revoke/expiry; wrong-token/wrong-method isolation; no host command during GET; existing web/API/notification regression. No production credentials or real data in CI.

## Phase 3 device observation
PoC owner screenshots confirm install, home-screen widget and app launch on real Samsung device. Large widget leaves unused space and small text; require responsive compact/multi-server layouts and larger type with visible units, timestamps and state. Resize interaction and tap-to-open not independently confirmed; repeat for production APK.
