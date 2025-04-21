#!/bin/bash

if [ -f ".dev.vars" ]; then
  export $(cat .dev.vars | xargs)
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_BOT_SECRET" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_SECRET must be set"
  exit 1
fi

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d "{\"url\":\"https://tg-ticket-bot.spaser15.workers.dev/webhook\",\"secret_token\":\"$TELEGRAM_BOT_SECRET\"}"
