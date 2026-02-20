# Step 02: Supabase Auth + RLS Runtime Test + Worker Internal API

## Acceptance Criteria
1. 保護APIは未ログイン時に `401` を返す（`Authorization: Bearer <access_token>` 必須）。
2. `brand_members` に属する `brand_id` のみ操作可能。
3. 他ユーザーの `brand_id` は **404** で統一拒否（存在隠蔽方針）。
4. WorkerはDBへ直接アクセスしない（service roleを保持しない）。
5. Workerは `/api/internal/post/claim` と `/api/internal/post/complete` のみを使用する。
6. `/api/internal/*` は `x-internal-api-key` 必須、未指定/不一致は `401`。
7. ユーザーA/Bの手動テストで、BからAブランドへの操作が拒否される。
8. `typecheck/lint` はCI (`.github/workflows/ci.yml`) で実行できる。

## 404/403 Policy
- 方針: `404` に統一（対象ブランドや関連資源の存在を隠す）。

## Manual Smoke Test
1. Supabase AuthでユーザーA/Bを作成し、それぞれログインしてaccess tokenを取得する。
2. ユーザーAで `POST /api/brands` を実行してブランドを作成する。
3. ユーザーAで `POST /api/social-connections` を実行し、チャネル/トークンを保存できることを確認する。
4. ユーザーAで `POST /api/schedules` を実行し、予約作成できることを確認する。
5. ユーザーBで、Aの `brand_id` を使って `POST /api/social-connections` と `POST /api/schedules` を叩き、`404` になることを確認する。
6. ユーザーAで同じリクエストを再実行し成功することを確認する。
7. `x-internal-api-key` なしで `POST /api/internal/post/claim` を叩き `401` を確認する。
8. 正しい `x-internal-api-key` で `POST /api/internal/post/claim` を叩き、`claimed` のレスポンスが返ることを確認する。

## Worker Architecture
- Worker (`src/trigger/post-task.ts`) はDBアクセスコードを持たない。
- Workerは内部APIから最小データ（本文、暗号化トークン、冪等キー、プロバイダ情報）を受け取る。
- 内部APIは暗号化トークンのみ返し、平文トークンは返さない。

## Notes
- ローカル環境で依存インストール不能な場合でも、CIで `npm ci`, `npm run typecheck`, `npm run lint` が実行される。
