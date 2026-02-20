# Step 05: Single-run Scheduling (delay) + Sweeper + Step4 Fixes

## Scope
- 予約作成時に `tasks.trigger(..., { delay })` で単発実行を登録
- 実行taskは内部API `claim -> complete` 経由（DB直アクセスなし）
- 5分ごと sweeper が `due-list` を回収して再enqueue
- Step4修正:
  - internal key 未設定時の 500 回避（503）
  - upload-url 容量チェック競合ガード（brand単位ロック + pending含む集計）
- listen EPERM の運用手順を README に明記

## Acceptance Criteria
1. 予約作成で Trigger run が作られ、`scheduled_posts.trigger_run_id` が保存される。
2. dispatch task は `POST /api/internal/post/claim` でclaimし、claim不可なら正常終了。
3. dispatch task は provider stub 実行後 `POST /api/internal/post/complete` を呼ぶ。
4. 冪等性は `claim + idempotency lock` で二重完了を防止する。
5. due-list API 経由で sweeper が5分ごと回収する。
6. internal auth 未設定は 500 でなく 503/401 を返す。
7. upload-url の同時実行でも容量上限すり抜けを防止する。
8. README に `HOSTNAME/PORT` 指定と EPERM の環境制約が明記されている。

## Manual Smoke Test
1. `POST /api/schedules` で2分後を指定し作成（`triggerRunId` 保存確認）
2. 指定時刻後に dispatch 実行で `posted` or `failed` へ遷移
3. 同一postを複数enqueueしても1回のみcomplete
4. due状態（`scheduled_at` 過去, status=`scheduled|queued`）を作り sweeper を待つ
5. `INTERNAL_API_KEY` 未設定で internal API -> `503`
6. upload-url を同時2リクエストで実行し、上限超過のすり抜けがないこと
7. `HOSTNAME=127.0.0.1 PORT=3001 npm run dev` を試す

## Deploy Smoke (Step5.5)
- ローカルで `listen EPERM` が出る環境は、デプロイ先URLで `npm run smoke:step05` を使って検証する。
- 例:
  `BASE_URL=https://<your-app>.vercel.app SUPABASE_URL=... SUPABASE_ANON_KEY=... A_EMAIL=... A_PASSWORD=... B_EMAIL=... B_PASSWORD=... INTERNAL_API_KEY=... npm run smoke:step05`
- GitHub Actions では `Smoke Step05` (`workflow_dispatch`) から手動実行できる。

## Gate To Step6
Step6へ進む前に以下を満たす:
1. `smoke:step05` が成功
2. A/B分離の404が確認済み
3. delay実行で `posted` or `failed` まで遷移確認済み
4. upload-url競合時の上限すり抜けが無い
