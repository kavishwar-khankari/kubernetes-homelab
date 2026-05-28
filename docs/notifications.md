# Notifications

## Current Flow

- `Radarr`, `Sonarr`, `Frostbite` send to Apprise.
- Apprise fans out to ntfy and Telegram.
- `Jellyseerr` still publishes to ntfy topics and is covered by the ntfy bridge.
- The ntfy bridge forwards `jellyseerr` and `fallback-alerts` to Apprise `telegram-only`.
- The bridge runs as a sidecar in the Apprise pod and reuses the ntfy token already present in Apprise's PVC-backed config.

## Telegram Setup

1. Create a bot with `@BotFather`.
2. Save the bot token in Doppler as `TELEGRAM_BOT_TOKEN`.
3. Send a message to the bot or group.
4. Use `https://api.telegram.org/bot<TOKEN>/getUpdates` to get `TELEGRAM_CHAT_ID`.
5. Save that in Doppler as `TELEGRAM_CHAT_ID`.

## Bridge Topic Policy

- Do not bridge `radarr`, `sonarr`, `frostbite`, or `global`.
- Use `fallback-alerts` for future direct-ntfy senders.
- `jellyseerr` remains bridged until it is moved to Apprise.

## Source Headers

- Sonarr Apprise config key: `sonarr?:title=Sonarr`
- Radarr Apprise config key: `radarr?:title=Radarr`
- Frostbite uses `APPRISE_CONFIG_KEY=frostbite?:title=Frostbite`
- Bridge topics render as `Jellyseerr` or `Fallback Alerts` in Telegram while keeping the original alert text in the body

## Verification

- Test Apprise fan-out with `POST /notify/global`.
- Test bridge fan-in with a message to `jellyseerr` or `fallback-alerts`.
