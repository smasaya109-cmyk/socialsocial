import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact information for Social Auto Publisher"
};

export default function ContactPage() {
  return (
    <main>
      <h1>Contact</h1>
      <p>Please use the contact method below for support and account-related requests.</p>

      <h2>Contact Method</h2>
      <ul>
        <li>Email: s.masaya109@gmail.com</li>
      </ul>

      <h2>Supported Topics</h2>
      <ul>
        <li>Billing and subscription change requests</li>
        <li>Bug reports and operational questions</li>
        <li>Data deletion requests</li>
      </ul>
    </main>
  );
}
