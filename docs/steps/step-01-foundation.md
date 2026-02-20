# Step 01: Secure Multi-tenant Foundation

## Scope
- Next.js(TypeScript)の最小アプリを作成
- Supabase Postgres向けのマルチテナントスキーマとRLSを作成
- OAuthトークン暗号化保存（`key_version`付き）のアプリ層を実装
- Trigger.dev Workerでのみ復号して投稿処理する骨組みを実装
- Redisロック + DB状態遷移の二重投稿防止土台を実装
- R2署名URL前提の非公開素材管理テーブルを実装

## Acceptance Criteria
1. `supabase/migrations/20260219_001_init.sql` に以下が定義されている
- `brands`, `brand_members`, `social_connections`, `media_assets`, `scheduled_posts`, `post_deliveries`, `idempotency_keys`
- すべて `brand_id` 境界を持つ（必要箇所）
- RLS有効化済み、`brand_members` を基点に `select/insert/update/delete` ポリシーがある
2. OAuthトークンは `social_connections.access_token_enc` / `refresh_token_enc` に暗号化文字列で保存される
- 平文トークン保存カラムなし
- `key_version` 必須
3. 復号処理は Worker用コードにのみ存在し、API Route/UIから直接呼ばない構成になっている
4. 自動投稿処理で以下の防止が入っている
- `idempotency_key` 必須
- Redis `SET NX EX` ロック
- `scheduled_posts.status` 遷移（`scheduled -> processing -> posted/failed`）
5. ログはマスク関数経由で、トークン・署名URL・本文全文をそのまま出さない

## Quick Test
1. 型チェック
- `npm run typecheck`
2. Lint
- `npm run lint`
3. SQL確認（手動）
- マイグレーション内で `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` と `CREATE POLICY` を確認
4. 暗号化往復（手動）
- REPL等で `encryptSecret` → `decryptSecret` が一致すること
5. 冪等ロック（手動）
- 同一キー2回で2回目が `false` になること
