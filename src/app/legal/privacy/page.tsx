import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for Social Auto Publisher"
};

export default function PrivacyPage() {
  return (
    <main>
      <h1>Privacy Policy</h1>
      <p>Last updated: 2026-02-20</p>

      <h2>1. Information We Collect</h2>
      <ul>
        <li>Account information such as email address and user ID</li>
        <li>Brand data, scheduled post data, and media asset metadata</li>
        <li>OAuth tokens required for connected social accounts, stored in encrypted form</li>
      </ul>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>To provide scheduling, publishing, and brand workspace features</li>
        <li>To monitor service health, detect abuse, and investigate incidents</li>
        <li>To support billing, account management, and product improvement</li>
      </ul>

      <h2>3. Retention Period</h2>
      <ul>
        <li>Free: assets retained for 7 days, future scheduling up to 7 days</li>
        <li>Solo: assets retained for 90 days</li>
        <li>Creator: assets retained for 180 days</li>
        <li>Studio: assets retained for 365 days</li>
        <li>OAuth tokens are retained only while the connection remains active and are deleted when the connection is removed</li>
      </ul>

      <h2>4. Third-Party Sharing</h2>
      <ul>
        <li>Social platform API providers such as Meta, X, and TikTok for publishing actions</li>
        <li>Service providers used for payments, email delivery, and monitoring infrastructure</li>
      </ul>

      <h2>5. Security</h2>
      <ul>
        <li>Encrypted token storage, access control, and tenant isolation</li>
        <li>Signed URL usage and masking of sensitive data in logs</li>
      </ul>

      <h2>6. Contact</h2>
      <p>s.masaya109@gmail.com</p>
    </main>
  );
}
