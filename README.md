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
- `npm run smoke:help`: smoke実行に必要な環境変数表示

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

## Step docs
- `docs/steps/step-01-foundation.md`
- `docs/steps/step-02-auth-rls.md`
- `docs/steps/step-04-assets-r2.md`
- `docs/steps/step-05-scheduling.md`
- `docs/steps/step-06-sns-clients.md`
