import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Social Auto Publisher の個人情報保護方針"
};

export default function PrivacyPage() {
  return (
    <main>
      <h1>Privacy Policy</h1>
      <p>最終更新日: 2026-02-20</p>

      <h2>1. 収集する情報</h2>
      <ul>
        <li>アカウント情報（メールアドレス、ユーザーID）</li>
        <li>ブランド情報、予約投稿データ、素材メタデータ</li>
        <li>SNS連携に必要なOAuthトークン（暗号化保存）</li>
      </ul>

      <h2>2. 利用目的</h2>
      <ul>
        <li>サービス提供（予約・自動投稿、ブランド管理）</li>
        <li>障害対応・不正検知・運用監視</li>
        <li>課金処理、請求管理、機能改善</li>
      </ul>

      <h2>3. 保存期間</h2>
      <ul>
        <li>Free: 素材保持 7日、将来予約は 7日先まで</li>
        <li>Solo: 素材保持 90日</li>
        <li>Creator: 素材保持 180日</li>
        <li>Studio: 素材保持 365日</li>
        <li>OAuthトークン: 連携中のみ保持し、解除時に削除対象とします</li>
      </ul>

      <h2>4. 第三者提供</h2>
      <ul>
        <li>SNS API提供者（Meta, X, TikTok等）への投稿実行通信</li>
        <li>決済、メール送信、監視基盤などの外部委託先</li>
      </ul>

      <h2>5. セキュリティ</h2>
      <ul>
        <li>トークン暗号化、アクセス制御、テナント分離</li>
        <li>署名URLと機密データのログマスキング</li>
      </ul>

      <h2>6. お問い合わせ</h2>
      <p>privacy@example.com（仮）</p>
    </main>
  );
}
