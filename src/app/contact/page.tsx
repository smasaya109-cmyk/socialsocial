import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Social Auto Publisher へのお問い合わせ"
};

export default function ContactPage() {
  return (
    <main>
      <h1>Contact</h1>
      <p>お問い合わせは以下の窓口をご利用ください。</p>

      <h2>連絡方法</h2>
      <ul>
        <li>メール: contact@example.com（仮）</li>
      </ul>

      <h2>対応範囲</h2>
      <ul>
        <li>課金・プラン変更に関する問い合わせ</li>
        <li>不具合報告、運用上の質問</li>
        <li>データ削除依頼</li>
      </ul>
    </main>
  );
}
