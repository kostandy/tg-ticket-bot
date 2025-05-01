# Loop Tickets Bot

A Telegram bot that tracks ticket availability for shows and notifies users when new dates become available.

## Setup

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in the values:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from [@BotFather](https://t.me/botfather)
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Your Supabase project API key

4. Create tables in Supabase:

```sql
create table shows (
  id text primary key,
  title text not null,
  url text not null,
  dates text[] not null
);

create table subscriptions (
  user_id bigint not null,
  show_id text not null references shows(id),
  chat_id bigint not null,
  primary key (user_id, show_id)
);
```

## Development

```bash
npm run dev
```

This will start the bot in development mode with hot reloading.

## Deployment

1. Install dependencies if you haven't already:

```bash
npm install
```

2. Login to Cloudflare:

```bash
npx wrangler login
```

3. Build and deploy:

```bash
npm run deploy
```

4. Set up your bot's webhook URL:

```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>/webhook
```

5. Scrape shows:

```bash
npm run scrape
```
