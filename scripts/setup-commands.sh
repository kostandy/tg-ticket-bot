#!/bin/bash

if [ -f ".dev.vars" ]; then
  export $(cat .dev.vars | xargs)
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN is not set"
  exit 1
fi

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setMyCommands" \
     -H "Content-Type: application/json" \
     -d '{
       "commands": [
          {
           "command": "posters",
           "description": "Показати всі збережені вистави"
         },
         {
           "command": "upcoming",
           "description": "Показати вистави з доступними квитками"
         },
         {
           "command": "subscribe",
           "description": "Підписатися на сповіщення про квитки. Використання: /subscribe <ID вистави>"
         },
         {
           "command": "unsubscribe",
           "description": "Відписатися від сповіщень про квитки. Використання: /unsubscribe <ID вистави>"
         }
       ]
     }' 