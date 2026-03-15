# Reviewer Account Setup

Use a dedicated Supabase user for Meta review. Do not ask reviewers to self-register.

## Recommended setup

1. Create one review-only user in Supabase Auth.
2. Create one fixed review brand in the app.
3. Share the email and password only in the review submission notes.
4. Set public reviewer env vars so `/workbench` shows the correct guide:
   - `NEXT_PUBLIC_REVIEWER_EMAIL`
   - `NEXT_PUBLIC_REVIEWER_BRAND_NAME`
   - `NEXT_PUBLIC_REVIEWER_NOTE`

## How to create the reviewer user

### Option A: Supabase Dashboard

1. Open Supabase Dashboard.
2. Go to `Authentication` -> `Users`.
3. Click `Add user`.
4. Create a fixed reviewer email and password.
5. Mark the email as confirmed if needed.

### Option B: SQL / admin flow

Use your existing internal admin flow only if it already exists. Do not expose public sign-up just for review.

## What to share with Meta reviewers

- App login email
- App login password
- Review brand name
- Exact provider flow to test
- Public URLs:
  - `/legal/privacy`
  - `/legal/terms`
  - `/legal/data-deletion`
  - `/contact`

## Why fixed reviewer access is better

- Reviewers can replay the same steps without account creation friction.
- Your permissions explanation stays aligned with one known brand and one known workspace state.
- You avoid adding user-registration scope or extra onboarding logic only for review.
