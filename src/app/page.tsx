import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Landing",
  description: "ブランド単位で Instagram / X / Threads / TikTok の予約投稿を一元管理"
};

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <h1>複数SNSの予約投稿を、ブランド単位で安全に自動化</h1>
        <p>
          Social Auto Publisher は Instagram / X / Threads / TikTok
          を連携し、投稿予約から自動配信までを一つの画面で管理するWebアプリです。
        </p>
        <div className="cta-row">
          <Link href="/contact" className="btn primary">
            導入相談（Coming soon）
          </Link>
          <Link href="/legal/privacy" className="btn">
            Privacy Policy
          </Link>
        </div>
      </section>

      <section>
        <h2>主な価値</h2>
        <div className="card-grid">
          <article className="card">
            <h3>ブランド境界の分離</h3>
            <p>`brand_members` 起点の認可とRLSで、テナント境界漏れを防ぎます。</p>
          </article>
          <article className="card">
            <h3>予約から自動投稿まで</h3>
            <p>日時指定とワーカー実行で、人的オペレーションを減らします。</p>
          </article>
          <article className="card">
            <h3>安全な連携情報管理</h3>
            <p>OAuthトークンは暗号化保存し、復号はサーバ側処理に限定します。</p>
          </article>
        </div>
      </section>
    </main>
  );
}
