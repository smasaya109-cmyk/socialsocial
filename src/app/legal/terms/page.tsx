import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Social Auto Publisher の利用規約"
};

export default function TermsPage() {
  return (
    <main>
      <h1>Terms of Service</h1>
      <p>最終更新日: 2026-02-20</p>

      <h2>1. 適用範囲</h2>
      <p>本規約は、Social Auto Publisher の利用に適用されます。</p>

      <h2>2. 禁止行為</h2>
      <ul>
        <li>スパム投稿、違法行為、第三者権利の侵害</li>
        <li>不正アクセス、認証情報の不正利用</li>
      </ul>

      <h2>3. 料金と解約</h2>
      <ul>
        <li>プラン料金は別途定める価格表に従います</li>
        <li>解約は次回請求日前までの手続きで反映されます</li>
      </ul>

      <h2>4. 免責</h2>
      <p>SNS API仕様変更や外部障害に起因する影響について、当社は合理的範囲で対応します。</p>

      <h2>5. 規約変更</h2>
      <p>本規約は必要に応じて改定され、改定後は公開時点から有効となります。</p>
    </main>
  );
}
