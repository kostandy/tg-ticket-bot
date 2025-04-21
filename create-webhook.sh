#!/bin/bash

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_BOT_SECRET" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_SECRET must be set"
  exit 1
fi

WORKER_SUBDOMAIN=$(wrangler whoami | grep "Account ID" | cut -d " " -f 3)

if [ -z "$WORKER_SUBDOMAIN" ]; then
  echo "Error: Failed to get Cloudflare account ID"
  exit 1
fi

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d "{\"url\":\"https://tg-ticket-bot.$WORKER_SUBDOMAIN.workers.dev/webhook\",\"secret_token\":\"$TELEGRAM_BOT_SECRET\"}"

echo "Webhook setup complete"
