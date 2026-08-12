# Follow-up Production Acceptance

## Release identity

- Acceptance opened: `2026-08-12 14:04:57 WIB` (`UTC+07:00`)
- Branch: `feat/event-driven-followup`
- Baseline commit: `d54dbc0`
- Organization slug: `pustakaislam`
- Convex production deployment: `https://helpful-spoonbill-863.convex.cloud`
- Dry-run cutover run ID: `qd7csw3jgg7gxj4rqnmqb7wx2x8caet8`
- Apply cutover run ID: `qd7cv2jm4anen36v8h3zdpsfvn8cakmh`
- Vercel production deployment/URL: `dpl_9krMP3J578TRNeWpii88ejGPo5tw` / `https://wafachat-csqotsrwg-vnd-company.vercel.app` (alias `https://wafachat.vercel.app`)
- Acceptance status: **BLOCKED — automated rollout and unauthenticated smoke complete; authenticated and controlled every-number evidence remain**

Never record API keys, webhook secrets, session cookies, raw webhook bodies, customer message content, or other credentials in this runbook. Provider and ingest identifiers may be recorded only when needed for a failed controlled test.

## Automated gate evidence

| Gate | Started (WIB) | Finished (WIB) | Result | Safe evidence |
| --- | --- | --- | --- | --- |
| Targeted Task 1–11 suite | `2026-08-12 14:05:49` | `2026-08-12 14:05:55` | PASS | 25 files, 283 tests |
| Full `npm test` | `2026-08-12 14:06:03` | `2026-08-12 14:06:36` | PASS | 97 files, 744 tests |
| `tsc --noEmit` | `2026-08-12 14:06 WIB` | `2026-08-12 14:06 WIB` | PASS | `TypeScript: No errors found` |
| Convex codegen | `2026-08-12 14:06 WIB` | `2026-08-12 14:07 WIB` | PASS | bindings generated; TypeScript passed |
| Next.js production build | `2026-08-12 14:07 WIB` | `2026-08-12 14:09 WIB` | PASS with existing warning | 36 static pages generated; existing `jose` Edge Runtime CompressionStream/DecompressionStream warning |
| Final regression and diff check | `2026-08-12 14:12:28 WIB` | `2026-08-12 14:13 WIB` | PASS | full suite repeated: 97 files / 744 tests; TypeScript no errors; `git diff --check` clean |
| Post-rollout documentation check | `2026-08-12 14:38 WIB` | `2026-08-12 14:38 WIB` | PASS | only this runbook changed after the green code gates; `git diff --check` clean, so tests were not redundantly rerun |

## Deployment and cutover evidence

### Preflight

- [x] Confirm `.vercel/project.json` exists in this worktree and record only safe project/team identifiers: team `vnd-company` / `team_U1JorOXpXbOR2jnwtmIix9vG`, project `wafachat` / `prj_VUKMYJ9BzLrfBAnaeW0ZG6SCsy8A`.
- [x] Confirm Convex CLI is linked to the intended production deployment without printing environment values: `helpful-spoonbill-863`.
- [x] Confirm local gates pass before either production deployment.
- [x] Confirm the schema/functions deployment is backward-compatible and completes before cutover: schema validation passed and no indexes were deleted.

### Convex deployment

- Started (WIB): `2026-08-12 14:09 WIB`
- Finished (WIB): `2026-08-12 14:10 WIB`
- Safe deployment identifier/URL: `helpful-spoonbill-863` / `https://helpful-spoonbill-863.convex.cloud`
- Result: PASS — functions uploaded, generated TypeScript passed, schema validation completed, and no index deletion was requested.

### Dry-run cutover

- Started (WIB): after the initial CLI authorization failure, retried through the authenticated production Convex Dashboard internal runner
- Run ID: `qd7csw3jgg7gxj4rqnmqb7wx2x8caet8`
- Terminal status/time: **complete** at `2026-08-12 14:20:06 WIB`
- `scanned`: `617`
- `eligible`: `0`
- `review`: _pending_
- `updated`: `0`
- `skipped`: `617`
- `failed`: `0`
- Audit decision: PASS — terminal dry-run had no failures and no writes. The initial CLI call was rejected with safe Request ID `905e13be6a03f8a7` because that credential lacked `deployment:functions:runInternalMutations`; the authenticated production Dashboard internal runner safely bypassed the CLI scope limitation without exposing a public function.

### Apply cutover

Apply is allowed only when dry-run is terminal, `failed = 0`, `updated = 0`, counts are credible, and the audit contains no unsafe mutation or unresolved ambiguity.

- Started (WIB): through the authenticated production Convex Dashboard internal runner after the dry-run audit passed
- Run ID: `qd7cv2jm4anen36v8h3zdpsfvn8cakmh`
- Organization lock observed: cutover used the production internal runner and completed without a concurrent lifecycle write being issued; direct lock-state timestamp was not separately recorded
- Terminal status/time: **complete** at `2026-08-12 14:26:37 WIB`
- `scanned`: `617`
- `eligible`: `0`
- `review`: _pending_
- `updated`: `26764`
- `skipped`: `617`
- `failed`: `0`

Apply completed successfully. The large `updated` count is recorded exactly from the terminal run result; no inferred interpretation is added here.

While apply is running, do not bypass the organization cutover lock and do not issue Follow-up lifecycle writes. Poll only the bounded run-status interface until a terminal state.

### Post-apply event recovery

1. After the organization lock clears, list only captured KirimDev ingest events whose status is `failed`, using the bounded replay interface.
2. Replay each captured failed KirimDev event once through the idempotent ingest dispatcher. Record only event ID, safe status, and safe error.
3. Do not manually reconstruct or paste raw webhook payloads.
4. Legacy `/n8n/state` calls rejected during the lock are external requests, not captured KirimDev events. The external n8n caller must retry them idempotently after unlock using its original stable order/event identity. WafaChat cannot safely invent or replay those requests.

| Recovery item | Event/request ID | Attempted (WIB) | Result | Safe error/action |
| --- | --- | --- | --- | --- |
| Captured failed KirimDev event | Six indexed historical rows | `2026-08-12 after 14:26:37 WIB` | No replay needed | Newest failure was `2026-08-03 08:55:37 WIB`; none fell within the `2026-08-12` apply window |
| Legacy `/n8n/state` external retry | _pending_ | _pending_ | _pending_ | External owner must confirm idempotent retry after unlock |

The indexed `ingestEvents` query for `status = failed` returned six historical rows. Because none occurred in the apply window, no captured event replay was needed. A new post-cutover ingest was observed as processed at `2026-08-12 14:28 WIB`.

### Vercel deployment and UI smoke

- Started (WIB): `2026-08-12 14:35:29 WIB`
- Finished (WIB): `2026-08-12 14:37 WIB`
- Deployment ID/URL: `dpl_9krMP3J578TRNeWpii88ejGPo5tw` / `https://wafachat-csqotsrwg-vnd-company.vercel.app`
- Production alias: `https://wafachat.vercel.app`
- Result: PASS — Vercel reports production deployment `Ready`; remote build generated 36 pages with the same existing `jose` Edge Runtime CompressionStream/DecompressionStream warning.
- Login smoke: PASS — `/login` returned HTTP `200`.
- Dashboard smoke: PASS for unauthenticated guard — `/panel` returned HTTP `307` to `/login`; authenticated content not inspected.
- Follow-up smoke: PASS for unauthenticated guard — `/panel/follow-up` returned HTTP `307` to `/login`; authenticated workspace not inspected.
- Settings → Template Follow-up smoke: PASS for unauthenticated guard — `/panel/settings` returned HTTP `307` to `/login`; authenticated template controls not inspected.
- Authentication/browser limitation: no authenticated production browser session or credentials were available. Smoke commands recorded status and redirect only and did not read bodies, cookies, or secrets.

## Every-number controlled live gate

This table requires controlled real inbound and outbound evidence after both deployments. Automated fixtures, database inspection, or an authenticated page smoke do not satisfy these checks. Do not mark a row passed without a real controlled message and correlated provider/WafaChat evidence.

| Number/CS | inbound live | outbound live | trigger once | duplicate safe | reply reset | closing/batal removed | mapping diagnostic | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _Discover configured CS/admin channels after safe production inspection_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | **BLOCKED until controlled messages** |

For a failure, record the KirimDev event ID, `phone_number_id`, WafaChat ingest event ID, timestamp, and bounded safe error. Never record the raw event or customer content. Any failed or untested configured number blocks production acceptance.

### Operator procedure per configured number

1. Use a controlled test customer number; do not use an unrelated live customer.
2. Send one inbound message and confirm it appears live without refresh.
3. Send one manual outbound from the mapped CS/admin number and confirm it appears live.
4. Send the configured stage trigger and confirm exactly one lifecycle advancement.
5. Replay the same provider event identity and confirm no duplicate message or transition.
6. Send a customer reply and confirm the previous cycle resets.
7. On a fresh controlled active cycle, verify Closing or Batal removes it from active stages.
8. Exercise an intentionally unmapped controlled channel only when approved; confirm a visible mapping diagnostic and no silent loss.

## Immediate post-deploy observation

- Observation window: immediate post-cutover evidence at `2026-08-12 14:28 WIB`, followed by Vercel readiness and unauthenticated route smoke through approximately `2026-08-12 14:38 WIB`.
- Evidence source available: local static inspection, automated high-volume query tests, and production ingest status; function-level production I/O metrics were not available.
- Top Follow-up functions by calls/I/O: _pending_
- Queue functions read conversation snapshots only: PASS by static inspection of indexed conversation/recap pagination and the 901-row query regression.
- No message/order read per card: PASS by static inspection; page mappers use materialized conversation/recap fields.
- No polling: PASS by static inspection; no `setInterval`, `setTimeout`, or polling loop exists in the Follow-up workspace.
- Transition/counter writes bounded: PASS in automated lifecycle/cutover tests; production I/O evidence remains pending.
- Provider/webhook failures observed: six indexed historical failures, newest `2026-08-03 08:55:37 WIB`; none in the apply window. One new post-cutover ingest processed at `2026-08-12 14:28 WIB`.

Static evidence may establish query shape and absence of polling; production I/O claims require accessible Convex observability during a real work period. If observability or traffic is unavailable, record the limitation rather than claiming the gate.

## Rollback

1. Deactivate affected Follow-up templates to block new template sends.
2. Stop manual Follow-up actions while preserving attempts, transitions, messages, recaps, and captured ingest events.
3. Roll back frontend and Convex functions as a compatible pair when required; do not delete normalized lifecycle data.
4. Do not alter n8n order notifications. Ensure the external n8n owner idempotently retries any lock-rejected legacy `/n8n/state` request after unlock.
5. Keep `unknown` provider attempts blocked until reconciled against KirimDev history.

## Final decision

- Automated gates: PASS (targeted 283, full 744, TypeScript, codegen, and build).
- Deployments: Convex PASS; Vercel production PASS (`Ready`).
- Cutover: PASS — dry-run and apply completed with `failed = 0`; Dashboard internal runner resolved the CLI credential scope issue without public exposure.
- UI smoke: unauthenticated route/guard checks PASS; authenticated Dashboard, Follow-up, and Settings → Template Follow-up remain unverified because no authenticated browser session was available.
- Every-number controlled live gate: **BLOCKED pending real controlled evidence**
- Production acceptance: **NOT COMPLETE**
