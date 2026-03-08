# Meta Review Checklist (Instagram / Threads)

最終更新: 2026-03-08

## 0) Go/No-Go Gate
- [ ] `/workbench` で Login -> Brand -> Connect -> Queue が動作
- [ ] `PROVIDER_STUB_MODE=success` で予約投稿フローが安定
- [ ] `PROVIDER_STUB_MODE=off` で実APIテストが実施可能

## 1) Public Site / Legal
- [ ] `GET /` が公開されている
- [ ] `GET /legal/privacy` が公開されている
- [ ] `GET /legal/terms` が公開されている
- [ ] `GET /legal/data-deletion` が公開されている
- [ ] `GET /contact` が公開されている
- [ ] Privacyにデータ収集・利用・保存期間・第三者提供・問い合わせ先を明記
- [ ] Data Deletionに削除依頼方法・削除範囲・本人確認・目安期間を明記

## 2) Meta App Configuration
- [ ] App ID / App Secret 管理が完了
- [ ] `INSTAGRAM_OAUTH_REDIRECT_URI` がMeta側と完全一致
- [ ] `THREADS_OAUTH_REDIRECT_URI` がMeta側と完全一致
- [ ] 必要permissionsが `Ready for testing` 以上
- [ ] テストユーザーが App Roles (Admin/Developer/Tester) に含まれる
- [ ] Instagram対象アカウントが Business/Creator
- [ ] Instagram対象アカウントが Facebook Page と連携済み

## 3) Env / Deploy
- [ ] Vercel Production env 設定済み
- [ ] Trigger env 設定済み
- [ ] `INTERNAL_API_BASE_URL` / `INTERNAL_API_KEY` が一致
- [ ] `PROVIDER_STUB_MODE` 切替手順が確立
- [ ] 最新コード + Trigger tasks がデプロイ済み

## 4) Functional Smoke (Real API)
### Instagram
- [ ] OAuth connect 成功 (`/api/auth/instagram/start -> callback`)
- [ ] 画像投稿が `posted`
- [ ] 動画投稿が `posted`（processing待機含む）
- [ ] 失敗時に `INSTAGRAM_*` の error_code が記録される

### Threads
- [ ] OAuth connect 成功 (`/api/auth/threads/start -> callback`)
- [ ] テキスト投稿が `posted`
- [ ] 画像投稿が `posted`
- [ ] 動画投稿が `posted`
- [ ] 失敗時に `THREADS_*` の error_code が記録される

## 5) Security / Privacy Verification
- [ ] OAuth token 平文がログに出ない
- [ ] 署名URLフルがログに出ない
- [ ] 投稿本文全文がログに出ない（マスクされる）
- [ ] 他brandアクセスで 404/403 が統一挙動
- [ ] WorkerがDB直アクセスしていない

## 6) Review Submission Package
- [ ] 審査用説明文（利用目的/ユーザーフロー）
- [ ] 操作動画（連携 -> 予約 -> 投稿結果 -> 削除依頼導線）
- [ ] テスト用アカウント/手順書
- [ ] 失敗時ハンドリング（errorMeta）説明

## 7) Rollout Plan
- [ ] 審査通過前: `PROVIDER_STUB_MODE=success` を基本運用
- [ ] 審査通過後: provider別に `off` へ段階切替
- [ ] インシデント時: `success` へ即切戻し手順あり

## Commands (Quick)
```bash
npm run smoke:step05
npm run smoke:step06:x
PROVIDER=instagram npm run smoke:step06:meta
PROVIDER=threads npm run smoke:step06:meta
```

## Notes
- Instagram `instagram_account_not_found` は、Business/Creator + FB Page連携不足が主因。
- Threads `THREADS_UNAUTHORIZED` は、無効token/未連携時の期待挙動。
