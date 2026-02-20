import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Social Auto Publisher",
    template: "%s | Social Auto Publisher"
  },
  description: "Instagram / X / Threads / TikTok の予約と自動投稿をブランド単位で管理するSaaS",
  openGraph: {
    title: "Social Auto Publisher",
    description: "複数SNSの予約投稿と自動投稿を、安全なマルチテナント設計で一元管理",
    type: "website"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="site-header">
          <div className="container nav-row">
            <Link href="/" className="brand">
              Social Auto Publisher
            </Link>
            <nav className="top-nav" aria-label="Global">
              <Link href="/contact">Contact</Link>
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/legal/terms">Terms</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container footer-grid">
            <p className="muted">© {new Date().getFullYear()} Social Auto Publisher</p>
            <nav className="footer-nav" aria-label="Footer">
              <Link href="/">Home</Link>
              <Link href="/legal/privacy">Privacy Policy</Link>
              <Link href="/legal/terms">Terms of Service</Link>
              <Link href="/legal/data-deletion">Data Deletion</Link>
              <Link href="/contact">Contact</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
