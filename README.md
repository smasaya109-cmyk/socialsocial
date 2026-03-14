# Social Auto Publisher

Instagram / X / Threads / TikTok をブランド単位で予約・自動投稿するWebアプリの実装ベース。

## Stack
- Next.js (TypeScript)
- Supabase Postgres (RLS)
- Trigger.dev
- Cloudflare R2
- Upstash Redis
- Stripe
- Sentry

## Security Principles
- OAuthトークンはアプリ層で暗号化してDB保存（`key_version` 付き）
- 復号 + 投稿API呼び出しはWorker側のみ
- `brand_members` 起点で厳密なテナント分離
- 冪等性: `idempotency_key` + Redisロック + DB状態遷移
- R2は非公開運用、署名URLのみ利用
- 機密ログマスキング

## Getting Started
1. `cp .env.example .env.local`
2. `npm install`
3. `npm run dev`
4. `open http://localhost:3000`

## Local Commands
- `npm run dev`: 開発サーバ
- `npm run typecheck`: TypeScript検査
- `npm run lint`: ESLint
- `HOSTNAME=127.0.0.1 PORT=3001 npm run dev`: バインド先/ポート指定
- `npm run smoke:step05`: Step5スモーク（デプロイ先向け）
- `npm run smoke:step06:x`: Step6 x-providerスモーク（`PROVIDER_STUB_MODE=off` 前提）
- `npm run smoke:step06:meta`: Step6 instagram/threadsスモーク（`CONNECTION_ID` と `ASSET_ID` が必要）
- `npm run smoke:help`: smoke実行に必要な環境変数表示

## Workbench UI
- `/workbench` は Buffer風の運用UIです。
- 構成:
  - Left: Auth / Brand / Channel / Assets
  - Center: Composer（本文、日時、asset、クイック時間、テンプレ操作、プレビュー）
  - Right: Queue（status/date filter, check/retry）, Week/Month Calendar, Activity log
- 追加機能:
  - localStorage Draft保存/呼び出し
  - R2署名URL経由の asset 直アップロード（upload-url -> PUT -> finalize）
  - Queue/Sent/Failed カラムビュー
  - 一括操作（Bulk check/retry/cancel）
  - カレンダー日付へのドラッグ&ドロップで reschedule/retry
  - Cmd/Ctrl + Enter で即予約
  - プロバイダ接続カード（X/Instagram/Threadsの接続状態を可視化）
  - セットアップ進捗ステップ（Login -> Brand -> Connect -> Queue）
  - 15秒自動リフレッシュ切替（Queueの体感更新）
- 既存APIに接続して実データで動作します。

## npm Install Troubleshooting
1. 推奨順
- `npm ci`（lockfileがある場合）
- `npm install`
2. 権限エラーの対処（sudo前）
- Nodeバージョン確認: `node -v`, `npm -v`
- 所有権確認: `ls -ld . node_modules`
- 所有権修正例: `sudo chown -R $(whoami):staff node_modules package-lock.json`
3. 最終手段
- `sudo npm install` を使う場合は、実行後に所有権を戻す:
  `sudo chown -R $(whoami):staff node_modules package-lock.json`
- root所有のままにすると今後のインストールで失敗しやすくなります
4. `npm run dev` が `listen EPERM` で失敗する場合
- まずバインド先とポートを変更:
  `HOSTNAME=127.0.0.1 PORT=3001 npm run dev`
- 固定ポートしか使えない環境では、許可されたポート（例: `9002`）を指定。
- それでも不可なら実行環境側の制約（バインド禁止）です。CIで `typecheck/lint` を通し、本番はVercel等のホスティングで動作させてください。
- Step5検証はローカルではなくデプロイ先URLで実施:
  `BASE_URL=https://<your-app>.vercel.app npm run smoke:step05`

## Step5 Smoke (Deploy Target)
前提:
- `BASE_URL` はデプロイ先URL
- 認証はどちらか
1. `A_EMAIL/A_PASSWORD` + `B_EMAIL/B_PASSWORD` + `SUPABASE_URL/SUPABASE_ANON_KEY`
2. `SMOKE_A_TOKEN/SMOKE_B_TOKEN`（事前発行済みトークン）
- 任意: `INTERNAL_API_KEY`（内部APIの401/200/503確認）

実行例:
`BASE_URL=https://<your-app>.vercel.app SUPABASE_URL=... SUPABASE_ANON_KEY=... A_EMAIL=... A_PASSWORD=... B_EMAIL=... B_PASSWORD=... INTERNAL_API_KEY=... npm run smoke:step05`

Vercel env 例:
- `INTERNAL_API_BASE_URL=https://<your-app>.vercel.app`
- `INTERNAL_API_KEY=<strong-random-key>`
- `TRIGGER_SECRET_KEY=<trigger-key>`
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_REGION`

Step6へ進む条件:
1. `npm run smoke:step05` が成功
2. A/B分離の `404` を確認
3. delay実行で予約投稿の状態遷移（`posted|failed`）を確認
4. upload-url 競合で上限すり抜けがないことを確認

Step5.5 実績（2026-02-23, deploy target）:
- `A/B isolation ok (404)`
- `internal due auth check ok (200)`
- `upload race ok statuses=200,409`
- `schedule status=posted`
- `step05 smoke passed`
- 判定: Step6へ進行可

Step6 着手（初期）:
- Provider client layer を追加（`src/lib/providers/*`）
- `scheduled-post-dispatch` に `PROVIDER_STUB_MODE=off` 時の provider resolver 分岐を追加
- 既定値 `PROVIDER_STUB_MODE=success` のため、既存 smoke 挙動は維持

## Provider Status (Current)
- X:
  - 予約実行フロー（queue -> processing -> posted/failed）は動作確認済み。
  - `PROVIDER_STUB_MODE=success|fail` の場合は stub 実行（`providerPostId=mock_*`）。
  - 実API投稿を使うには `PROVIDER_STUB_MODE=off` かつ有効なXトークン/設定が必要。
- Instagram:
  - OAuth連携（`/api/auth/instagram/start` -> `/api/auth/instagram/callback`）は実装済み。
  - `scheduled_posts.asset_id` を使った画像/動画投稿フローに対応（asset必須）。
  - 動画は `video_url` + 処理完了ポーリング後に publish。
  - 画像は `media_publish` が早すぎるケースに備えて短時間リトライします。
- Threads:
  - OAuth連携（`/api/auth/threads/start` -> `/api/auth/threads/callback`）は実装済み。
  - `PROVIDER_STUB_MODE=off` で Threads API (`/threads` -> `/threads_publish`) による実投稿を実行します。
  - `TEXT/IMAGE/VIDEO` を asset有無で自動選択します。
  - video は container status をポーリングしてから publish します。
- TikTok:
  - APIクライアントの枠のみ。実投稿は未対応。

## X OAuth Auto Connect
- `POST /api/auth/x/start` (auth required)
  - body: `{ "brandId": "<uuid>" }`
  - response: `{ authorizeUrl, state, expiresIn }`
  - `authorizeUrl` をブラウザで開いてX同意へ進む。
- `GET /api/auth/x/callback`
  - Xからの `code/state` を受け、サーバ側で token exchange を実行。
  - `social_connections` に暗号化保存して連携完了。
- Required env:
  - `X_CLIENT_ID`
  - `X_CLIENT_SECRET`
  - `X_OAUTH_REDIRECT_URI` (X consoleに登録したcallbackと完全一致)
  - optional: `X_OAUTH_SCOPE`

## Meta OAuth Auto Connect (Instagram / Threads)
- `POST /api/auth/instagram/start` / `GET /api/auth/instagram/callback`
- `POST /api/auth/threads/start` / `GET /api/auth/threads/callback`
- Required env:
  - `META_CLIENT_ID`
  - `META_CLIENT_SECRET`
  - `INSTAGRAM_OAUTH_REDIRECT_URI`
  - `THREADS_CLIENT_ID`
  - `THREADS_CLIENT_SECRET`
  - `THREADS_OAUTH_REDIRECT_URI`
  - optional: `INSTAGRAM_OAUTH_SCOPE`, `THREADS_OAUTH_SCOPE`
- 補足:
  - callback URL はMeta Appの有効なOAuthリダイレクトURLに完全一致で登録してください。
  - Threads投稿には `social_connections.provider_account_id`（Threads user id）が必要です。

## Media Asset Linking (Instagram)
- 予約作成API `POST /api/schedules` は `assetId` を受け付けます。
- Instagram接続で予約する場合は `assetId` が必須です。
- dispatch時にWorkerが `asset.object_key` から短期署名GET URLを生成し、Instagram Graph APIに渡します。
- 署名URLは短期・ログはマスクされます。
- 動画処理向けに署名URL TTLが足りない場合は `R2_DOWNLOAD_URL_TTL_SECONDS` を延長してください。

## Operations: Credits / Retry
- `GET /api/schedules/:id` は `errorMeta` を返します。
  - 例: `X_CREDITS_DEPLETED` の場合、ユーザー向け説明と `retryable` が取得可能。
- `PATCH /api/schedules/:id` で再送:
  - body: `{ "action": "retry" }`
  - 任意で `scheduledAt` を指定可能。
  - 失敗投稿(`status=failed`)から新規予約を作成して再enqueueします。
- `OPS_ALERT_WEBHOOK_URL` を設定すると、`X_CREDITS_DEPLETED` 発生時に運用通知を送ります。
- X provider は `401 + refresh_tokenあり` の場合、access token自動更新を試行して再投稿します。

## Step docs
- `docs/steps/step-01-foundation.md`
- `docs/steps/step-02-auth-rls.md`
- `docs/steps/step-04-assets-r2.md`
- `docs/steps/step-05-scheduling.md`
- `docs/steps/step-06-sns-clients.md`
- `docs/review/meta-instagram-threads-review-checklist.md`
