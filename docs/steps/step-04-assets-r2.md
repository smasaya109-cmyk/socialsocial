# Step 04: Assets on R2 (Presigned URL + Cleanup + Plan Limits)

## Flow
1. `POST /api/assets/upload-url`
2. Client uploads file directly to R2 with returned `put_url` (APIサーバはファイルを中継しない)
3. `POST /api/assets/finalize`
4. `GET /api/assets?brand_id=...` で素材メタデータ一覧
5. `GET /api/assets/:id/download-url` で短期 `get_url` 取得

## Acceptance Criteria
1. `media_assets` はRLSで `brand_members` 起点の分離を維持する。
2. `upload-url/finalize/download-url/list` の全APIは `requireUser` を要求する。
3. 他ブランドへのアクセスは `404`（存在隠蔽）で統一する。
4. R2バケットは非公開前提、アップロード/ダウンロードは署名URLのみ。
5. 署名URLは短期（10分）で、アップロード時の `Content-Type` を固定する。
6. プラン容量制限（Free 1GB等）を超える `upload-url` は `409` を返す。
7. `expires_at` はプラン保持期限（Free 7日, Solo 90日, Creator 180日, Studio 365日）で設定する。
8. `POST /api/internal/assets/cleanup` は `x-internal-api-key` 必須。
9. 毎日ジョブ（Trigger.dev schedules.task）が内部API経由で期限切れ削除を実行する。
10. ログにトークン/キー/署名URLフルを出さない。

## Plan Limits
- Free: 1GB, 7日保持
- Solo: 50GB, 90日保持
- Creator: 200GB, 180日保持
- Studio: 1TB, 365日保持

## 404 / 409 Policy
- 権限不足: `404`
- 容量超過: `409`

## Manual Smoke Test
1. Aユーザーで `POST /api/brands` し、`brand_id` を取得
2. Aで `POST /api/assets/upload-url`（1MB画像）を実行
3. 返却された `put_url` へ `PUT` し、`POST /api/assets/finalize`
4. `GET /api/assets?brand_id=...` で `uploaded` を確認
5. `GET /api/assets/:id/download-url` で短期URL取得
6. BユーザーでAの `brand_id` を使い `GET /api/assets?brand_id=...` -> `404`
7. Freeで `size_bytes` を1GB超で `upload-url` -> `409`
8. `expires_at` を過去にしたテストデータを用意し `POST /api/internal/assets/cleanup` を実行
9. DBの `deleted_at` とR2オブジェクト削除を確認

## sudo後始末（運用軽量化）
確認:
- `ls -ld node_modules .next package-lock.json`
- `ls -ld ~/.npm`

復旧（必要時のみ）:
- `sudo chown -R $(whoami):$(id -gn) node_modules .next package-lock.json`
- `sudo chown -R $(whoami):$(id -gn) ~/.npm`

理由:
- root所有が残ると、以後 `npm install` / `npm run dev` がsudo必須になり運用負荷が上がるため。
