import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of service for Social Auto Publisher"
};

export default function TermsPage() {
  return (
    <main>
      <h1>Terms of Service</h1>
      <p>Last updated: 2026-02-20</p>

      <h2>1. Scope</h2>
      <p>These terms apply to the use of Social Auto Publisher and its related services.</p>

      <h2>2. Prohibited Conduct</h2>
      <ul>
        <li>Spam publishing, unlawful conduct, or infringement of third-party rights</li>
        <li>Unauthorized access or misuse of authentication credentials</li>
      </ul>

      <h2>3. Fees and Cancellation</h2>
      <ul>
        <li>Plan pricing follows the applicable pricing page or billing agreement</li>
        <li>Cancellations take effect according to the billing cycle and cancellation timing</li>
      </ul>

      <h2>4. Disclaimer</h2>
      <p>We will respond reasonably to issues caused by external platform API changes or third-party service outages, but we cannot guarantee uninterrupted availability.</p>

      <h2>5. Changes to These Terms</h2>
      <p>These terms may be updated as needed, and revised terms become effective once published on this page.</p>
    </main>
  );
}
