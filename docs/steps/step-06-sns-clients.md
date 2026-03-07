# Step 06: SNS Client Implementation (Provider APIs)

## Goal
- `scheduled-post-dispatch` の provider stub を段階的に実APIクライアントへ置換する。
- まずは安全性と運用性を維持しながら、providerごとの送信処理を分離する。

## Scope (Phase 1)
- Provider client interface を追加
- `x` provider の最小実装を追加（投稿API呼び出し）
- 既存 stub は feature flag で残し、切替可能にする
- 失敗時は `errorCode` を分類し `complete` に返す

## Acceptance Criteria
1. dispatch は providerごとに client を選択し実行する。
2. `PROVIDER_STUB_MODE=success|fail` の既存動作を維持できる。
3. 実APIエラー時に `complete(result=failed, errorCode=...)` が必ず呼ばれる。
4. ログに token / internal key / 投稿本文全文を出さない。
5. `npm run typecheck` / `npm run lint` が通る。

## Implementation Order
1. `src/lib/providers/types.ts`
  - 共通の request/response/error 型を定義
2. `src/lib/providers/index.ts`
  - provider名から client を返す resolver を実装
3. `src/lib/providers/x/client.ts`
  - 投稿処理（最低限）
  - エラー分類（rate_limit, unauthorized, network, unknown）
4. `src/trigger/scheduled-post-dispatch.ts`
  - stub分岐の外側に provider resolver を組み込み
  - 失敗時 `errorCode` を `complete` に渡す
5. docs更新（env, manual test）

## Manual Test (Deploy Target)
1. `PROVIDER_STUB_MODE=success` で既存 smoke が通る
2. `PROVIDER_STUB_MODE=fail` で `status=failed` になる
3. x provider 実API有効時に単発投稿が `posted` になる
4. API失敗時に `failed + errorCode` が残る
5. `npm run smoke:step06:x` で `posted` または `failed(X_*)` を確認

## Notes
- Worker/Task は引き続き DB直アクセス禁止（internal API 経由のみ）。
- OAuth token は復号後もログに出さない。
- providerレスポンスはマスクして保存する。

## Progress
- Implemented:
  - Provider interface and resolver (`src/lib/providers/*`)
  - Provider placeholders for `instagram|threads|tiktok` with explicit error codes
  - X client phase1 real HTTP call path (`X_API_BASE_URL` + optional `X_API_POST_PATH`)
  - Error classification:
    - `X_UNAUTHORIZED` (401/403)
    - `X_RATE_LIMIT` (429)
    - `X_PROVIDER_UNAVAILABLE` (5xx)
    - `X_BAD_REQUEST` (400)
    - `X_PROVIDER_ERROR` (other non-2xx)
    - `X_TIMEOUT` / `X_NETWORK_ERROR`
    - `X_RESPONSE_INVALID` (success without `data.id`)
- Dispatch integration:
  - `PROVIDER_STUB_MODE=off` で provider resolver 実行
  - `success/fail` stub モードは維持
- Added reliability:
  - X access token refresh on 401 (when refresh token is available)
  - Failed post retry endpoint (`PATCH /api/schedules/:id` with `{ action: "retry" }`)
  - Ops webhook alert for `X_CREDITS_DEPLETED`
- Added smoke:
  - `scripts/smoke-step06-x.mjs`
  - 目的: deploy先で x provider の完了遷移と `errorCode` 分類を確認
  - OAuth connect automation:
  - `POST /api/auth/x/start` to generate state/PKCE and authorize URL
  - `GET /api/auth/x/callback` to exchange code and persist encrypted tokens
  - `GET /api/schedules/:id` now includes `errorMeta` for UI-safe user messaging
  - `PATCH /api/schedules/:id` supports `{ action: "retry" }` for failed posts
  - `OPS_ALERT_WEBHOOK_URL` notification on `X_CREDITS_DEPLETED`
- Added in current phase:
  - Instagram OAuth connect endpoints:
    - `POST /api/auth/instagram/start`
    - `GET /api/auth/instagram/callback`
  - Threads OAuth connect endpoints:
    - `POST /api/auth/threads/start`
    - `GET /api/auth/threads/callback`
  - Threads provider API client:
    - `POST /{threads-user-id}/threads` (create TEXT container)
    - `POST /{threads-user-id}/threads_publish` (publish)
    - error classification (`THREADS_UNAUTHORIZED`, `THREADS_SCOPE_MISSING`, `THREADS_RATE_LIMIT`, etc.)
  - Instagram provider behavior:
    - `INSTAGRAM_MEDIA_REQUIRED` を返す安全失敗（現データモデルは本文のみで media URL を保持しないため）
  - Workbench updates:
    - provider selector (`x | instagram | threads`)
    - OAuth start + connection reload for selected provider
  - Media linkage:
    - `scheduled_posts.asset_id` を追加し、`POST /api/schedules` で `assetId` を受け付け
    - internal claim が asset metadata を返却
    - dispatch がR2署名GET URLを生成して provider client に渡す
    - Instagramは `assetId` 必須（image/video対応）
    - Instagram videoは container status をポーリングしてから publish
    - Threadsは media kind に応じて `TEXT/IMAGE/VIDEO` を自動選択
  - Smoke scripts:
    - `scripts/smoke-step06-meta.mjs` を追加（provider=`instagram|threads`）
