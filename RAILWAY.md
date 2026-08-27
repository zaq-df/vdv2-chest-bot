# VDV2 Chest Bot on Railway

## Local test

1. Copy `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN` and `GUILD_ID`.
3. Run:

```bash
npm start
```

## Railway setup

1. Create a new Railway project from this folder or from your GitHub repo.
2. Add these Variables:

```text
DISCORD_TOKEN=your_discord_bot_token
GUILD_ID=your_server_id
DATA_DIR=/data
CHEST_MAX_OPENS=5
CHEST_TIMEOUT_MINUTES=5
CHEST_AUTO_MINUTES=120
```

3. Add a Railway Volume mounted at `/data` if you want coins to survive redeploys.
4. Railway will run `npm start`, which starts `vdv2-chest-bot.js`.
5. In Discord, run `/setchestchannel channel:#your-channel` once. The bot saves that channel in `/data`.

## Discord permissions

Invite the bot with `bot` and `applications.commands` scopes.

Recommended bot permissions:

- Send Messages
- Embed Links
- Use External Emojis
- Moderate Members

`Moderate Members` is needed only for trap timeouts. The bot role also needs to be above the members it should timeout.

## Commands

- `/spawnchest` - manually spawn a chest
- `/coins` - check your balance or another member balance
- `/mycoins` - check only your own balance
- `/leaderboard` - show saved top VDV2 Coins balances
- `/addcoins` - admin coin adjustment
- `/removecoins` - admin coin adjustment
- `/setcoins` - admin exact balance set
- `/setchestchannel` - admin channel setup for automatic chests
- `/setchesttimer` - admin timer setup in minutes
- `/exportcoins` - admin backup export
- `/restorecoins` - admin backup restore
- `/rebuildcoins` - admin recovery from old chest summary messages

The default automatic interval is `CHEST_AUTO_MINUTES=120`, so one VDV2 chest is sent every 2 hours. You can change it without redeploying by running `/setchesttimer minutes:240`. Set `SPAWN_CHEST_ON_START=true` if you want a chest posted when Railway starts the bot.

The default embed image is bundled at `assets/vdv2chest.png`. You can override it with `CHEST_IMAGE_URL` if you prefer a hosted image URL.

The default coin emoji is `🪙`. If you set `COIN_EMOJI` in Railway Variables, that value overrides the default.
