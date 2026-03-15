# Meta Review Submission Template

最終更新: 2026-03-14

## 1) App Overview
Social Auto Publisher is a web application for scheduling and automatically publishing branded social media posts across connected channels. Users create a brand workspace, connect their social accounts, upload media assets, and schedule posts for future delivery.

## 2) Primary User Flow
1. User signs in.
2. User creates or selects a brand workspace.
3. User connects Instagram or Threads through OAuth.
4. User uploads an image or video asset.
5. User creates a scheduled post with caption, media, and publish time.
6. At the scheduled time, the server-side worker publishes the post and records the result.

## 3) Permissions Requested
### Instagram
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management`

Purpose:
- Read the connected Instagram business account.
- Publish scheduled image and video posts on behalf of the user.

### Threads
- `threads_basic`
- `threads_content_publish`

Purpose:
- Read the connected Threads profile.
- Publish scheduled text, image, and video posts on behalf of the user.

## 4) Data Handling
- OAuth access tokens are encrypted before being stored in the database.
- Tokens are never returned to the browser after connection.
- Token decryption and provider API calls only occur in the server-side worker.
- Logs redact tokens, signed URLs, and long content bodies.
- Media assets are stored in a private bucket and accessed only through short-lived signed URLs.

## 5) Data Deletion
Data deletion instructions are available at:

- Privacy Policy: `https://socialsocial-three.vercel.app/legal/privacy`
- Terms of Service: `https://socialsocial-three.vercel.app/legal/terms`
- Data Deletion: `https://socialsocial-three.vercel.app/legal/data-deletion`
- Contact: `https://socialsocial-three.vercel.app/contact`

Primary support email: `s.masaya109@gmail.com`

## 6) Verified Test Results
### Instagram
- OAuth connect: success
- Image scheduled publish: success
- Reels scheduled publish: success

### Threads
- OAuth connect: success
- Text scheduled publish: success
- Image scheduled publish: success
- Video scheduled publish: success

## 7) Reviewer Test Notes
- The app is currently in testing mode and reviewer/test users must be added to app roles where required.
- Instagram publishing requires a Business or Creator account connected to a Facebook Page.
- After connecting an account, the reviewer can create a scheduled post from `/workbench`.
- Reviewer app login email: `reviewer.meta@socialsocial.app`
- Reviewer brand: `Meta Review Brand`
- Reviewer password is shared only in the review submission notes and not exposed in the public UI.

## 8) Permission Justification Text
### Instagram permissions
- `instagram_basic`: required to identify the connected Instagram business account that will receive scheduled content.
- `instagram_content_publish`: required to publish scheduled image posts and reels on behalf of the connected account.
- `pages_show_list`: required to enumerate the Facebook Pages available to the logged-in user so the correct Instagram business account can be resolved.
- `pages_read_engagement`: required during the account resolution flow to read the Page-linked Instagram business account metadata.
- `business_management`: required to complete the business account connection flow for publishing features.

### Threads permissions
- `threads_basic`: required to identify the connected Threads profile used for scheduled publishing.
- `threads_content_publish`: required to publish scheduled text, image, and video posts on behalf of the connected Threads account.

## 9) Suggested Demo Script
1. Open `/workbench`
2. Sign in with the reviewer account
3. Select `Meta Review Brand`
4. Connect Instagram or Threads if not already connected
5. Upload media when testing Instagram image, Instagram reels, Threads image, or Threads video
6. Schedule a post 2 minutes in the future
7. Wait for status to change from `queued` to `posted`
8. Confirm delivery record and provider post id
9. Open Privacy Policy, Terms of Service, Data Deletion, and Contact pages
