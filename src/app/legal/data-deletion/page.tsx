import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "Social Auto Publisher のデータ削除ポリシー"
};

export default function DataDeletionPage() {
  return (
    <main>
      <h1>Data Deletion</h1>
      <p>最終更新日: 2026-02-20</p>

      <h2>1. 削除依頼方法</h2>
      <p>削除依頼は contact@example.com（仮）宛のメール、またはサポート窓口から受け付けます。</p>

      <h2>2. 削除対象</h2>
      <ul>
        <li>SNS連携トークン</li>
        <li>投稿データ、予約データ、素材メタデータ</li>
        <li>運用ログ（法令または監査要件で保持が必要なものを除く）</li>
      </ul>

      <h2>3. 処理目安</h2>
      <p>依頼内容を確認後、通常は数営業日以内を目安に順次対応します。</p>

      <h2>4. 本人確認</h2>
      <p>不正削除を防ぐため、必要に応じて本人確認情報の提示を依頼する場合があります。</p>

      <h2>5. 問い合わせ先</h2>
      <p>contact@example.com（仮）</p>
    </main>
  );
}
