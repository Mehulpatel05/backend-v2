# 🚀 Nearhood Backend V2 (Cloudflare Workers + D1 + R2)

High-performance, serverless backend with strict per-user folder isolation across Cloudflare D1 (SQL) and Cloudflare R2 (Media Storage).

---

## 📁 Architecture & User Isolation

### 1. Cloudflare R2 Object Storage (Per-User Directory Tree)
Every upload is strictly isolated under the user's handle:
```text
users/@{handle}/
├── profile/        # avatars, banners
├── feed/           # post photos, videos
├── bazar/          # shop logos, listing photos
├── chat/           # 1-on-1 DM attachments, voice notes
└── audio/          # custom ringtones & sounds
```

### 2. Cloudflare D1 SQL Relational Database
- `users`: User identity & handles
- `devices`: Multi-device hashed session tokens
- `profiles`: Public display names, bio, avatar R2 path, FCM tokens
- `feed_posts`, `feed_likes`, `feed_comments`: Community feeds
- `bazar_shops`, `bazar_listings`, `bazar_saved`: Bazar marketplace
- `chats`, `chat_messages`: 1-on-1 direct conversations & unread counters
- `friend_requests`, `friendships`: Friends & social graph
- `notifications`: Push & in-app alerts

---

## 🛠️ Quick Start & Deployment

### 1. Install Dependencies
```bash
cd backend_v2
npm install
```

### 2. Create Cloudflare D1 Database & R2 Bucket
```bash
# Create D1 Database
npx wrangler d1 create nearhood-d1

# Create R2 Bucket
npx wrangler r2 bucket create nearhood-media
```
*(Copy the generated `database_id` into `wrangler.toml`)*

### 3. Run Database Migrations
```bash
# Local development migration
npm run db:migrate:local

# Production Cloudflare D1 migration
npm run db:migrate:prod
```

### 4. Run Locally
```bash
npm run dev
```

### 5. Deploy to Cloudflare
```bash
npm run deploy
```

---

## 📡 API Endpoints Matrix

### Auth & Profiles
- `POST /api/v2/auth/send-otp`
- `POST /api/v2/auth/verify-otp`
- `POST /api/v2/auth/claim-handle`
- `GET  /api/v2/auth/me`
- `GET  /api/v2/profile/:handle`
- `PUT  /api/v2/profile`

### Per-User Media Storage
- `POST /api/v2/media/upload?folder=profile|feed|bazar|chat|audio`
- `GET  /api/v2/media/file/*`

### Bazar Marketplace
- `GET    /api/v2/bazar/listings`
- `POST   /api/v2/bazar/listings`
- `GET    /api/v2/bazar/my-listings`
- `DELETE /api/v2/bazar/listings/:id`
- `POST   /api/v2/bazar/shops`
- `GET    /api/v2/bazar/saved`
- `POST   /api/v2/bazar/saved/:id`

### 1-on-1 Direct Chats
- `GET  /api/v2/chats`
- `GET  /api/v2/chats/:chatId/messages`
- `POST /api/v2/chats/send`
- `POST /api/v2/chats/:chatId/read`

### Feed & Interactions
- `GET    /api/v2/feed/posts`
- `POST   /api/v2/feed/posts`
- `POST   /api/v2/feed/posts/:id/like`
- `GET    /api/v2/feed/posts/:id/comments`
- `POST   /api/v2/feed/posts/:id/comments`
- `DELETE /api/v2/feed/posts/:id`
