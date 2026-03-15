import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "Data deletion policy for Social Auto Publisher"
};

export default function DataDeletionPage() {
  return (
    <main>
      <h1>Data Deletion</h1>
      <p>Last updated: 2026-02-20</p>

      <h2>1. How to Request Deletion</h2>
      <p>Deletion requests can be submitted by email to s.masaya109@gmail.com or through our support contact channel.</p>

      <h2>2. Data Covered by Deletion Requests</h2>
      <ul>
        <li>Connected social account tokens</li>
        <li>Post data, scheduled post data, and media asset metadata</li>
        <li>Operational logs, except where retention is required by law or audit obligations</li>
      </ul>

      <h2>3. Processing Time</h2>
      <p>After verification, requests are normally processed within a few business days.</p>

      <h2>4. Identity Verification</h2>
      <p>We may request additional information to verify identity before processing a deletion request.</p>

      <h2>5. Contact</h2>
      <p>s.masaya109@gmail.com</p>
    </main>
  );
}
