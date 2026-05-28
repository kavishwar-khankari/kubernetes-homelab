# Notifications

This is the homelab notification setup as it stands today. The short version: Apprise is the main relay, ntfy stays as the self-hosted notification inbox, and Telegram is the phone-friendly copy of the important stuff.

This doc also explains the few weird parts, because notification systems always end up with a little weirdness.

## Current flow

Most apps should send to Apprise first.

```text
App -> Apprise -> ntfy
              -> Telegram
```

Some apps still send directly to ntfy. Those are covered by the bridge.

```text
App -> ntfy topic -> ntfy bridge -> Apprise telegram-only -> Telegram
```

The bridge is not meant to replace Apprise. It is a safety net for apps that only support ntfy cleanly, or for future apps where setting up Apprise is annoying.

## Pieces involved

`apprise`

Runs in the `apprise` namespace. It is the main fan-out service. It stores config files in its Longhorn PVC under `/config`.

`ntfy`

Runs in the `ntfy` namespace. It is still useful as a web/mobile inbox and as a simple target for apps that support ntfy directly.

`telegram-only`

This is an Apprise config created by the Apprise init container. It contains only the Telegram target. The ntfy bridge uses this so it does not loop back into ntfy.

`ntfy-bridge`

This is a sidecar inside the Apprise pod. It subscribes to selected ntfy topics and forwards those messages to Apprise's `telegram-only` config.

It currently listens to:

- `jellyseerr`
- `fallback-alerts`

It does not listen to `sonarr`, `radarr`, `frostbite`, or `global`, because those are Apprise-output topics. Bridging those would duplicate Telegram messages.

## What each current app does

| Source | Sends to | Key/topic | Telegram path | Notes |
| --- | --- | --- | --- | --- |
| Sonarr | Apprise | `sonarr` | Apprise -> Telegram | Test notifications show `Sonarr - Test Notification`, but real events do not include `Sonarr` in the title. That is a Sonarr/Radarr Apprise connector quirk. |
| Radarr | Apprise | `radarr` | Apprise -> Telegram | Same quirk as Sonarr. Test notifications are branded, real events are not. |
| Frostbite | Apprise | `frostbite?:title=Frostbite` | Apprise -> Telegram | Frostbite builds the Apprise URL itself, so this title override works here. |
| Jellyseerr | ntfy | `jellyseerr` | ntfy bridge -> Apprise `telegram-only` -> Telegram | The bridge rewrites the Telegram title to `Jellyseerr`, keeps the original alert text in the body, and strips simple Markdown markers like `**Description:**`. |
| Future ntfy-only apps | ntfy | `fallback-alerts` or a dedicated topic | ntfy bridge -> Apprise `telegram-only` -> Telegram | Prefer a dedicated topic if you care about the source name. |

## Decisions we made

Telegram won over WhatsApp.

WhatsApp works through Apprise only via the Meta WhatsApp Cloud API or Twilio. That means business setup, templates, verification, and possible message costs. Telegram is a bot token and a chat ID. For a homelab, Telegram is the sane choice.

Apprise is the main relay.

Apps that can send to Apprise should do that. Apprise fans out to ntfy and Telegram, which keeps the phone notification setup in one place.

ntfy stays.

ntfy is still useful. It is self-hosted, simple, and supported by apps like Jellyseerr. We are not replacing it with Telegram. Telegram is just an extra delivery channel.

The bridge is fallback-only.

The bridge exists for apps that publish to ntfy directly. It must not subscribe to topics that Apprise itself writes to, otherwise Telegram gets duplicates.

No proxy for Sonarr/Radarr titles.

Sonarr and Radarr have a slightly annoying Apprise behavior: their test notification uses a branded title, but real event notifications do not. The UI does not provide a field to change that, and the `Apprise Configuration Key` field only accepts lowercase letters, digits, and hyphens.

We could build a proxy to rewrite titles, but that is too much machinery for a cosmetic issue. Leave it alone unless it starts bothering you a lot.

## Telegram setup

Telegram uses two Doppler values:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

If the bot token ever leaks, revoke it in `@BotFather` and put the new token in Doppler.

To get a private chat ID:

1. Message the bot with `/start`.
2. Send any normal message, like `test`.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. Copy `message.chat.id`.

For the current private chat, keep the value only in Doppler as `TELEGRAM_CHAT_ID`.

## Apprise config files

The Apprise init container edits PVC-backed config files at startup.

It adds the Telegram URL to existing configs such as:

```text
radarr.cfg
sonarr.cfg
frostbite.cfg
global.cfg
```

It also creates:

```text
telegram-only.cfg
```

`telegram-only.cfg` should contain only Telegram. Do not add ntfy there. The bridge posts to this config, and adding ntfy would create a loop or duplicate behavior.

## Sonarr and Radarr UI settings

Use plain config keys.

Sonarr:

```text
Apprise Server URL: https://apprise.techtronics.top
Apprise Configuration Key: sonarr
Apprise Stateless URLs: empty
```

Radarr:

```text
Apprise Server URL: https://apprise.techtronics.top
Apprise Configuration Key: radarr
Apprise Stateless URLs: empty
```

Do not put `?:title=Sonarr` or `?:title=Radarr` in the configuration key field. The UI will reject it, and it is not how the Sonarr/Radarr Apprise connector works.

## Future app rules

If the app supports Apprise, use Apprise.

Create a config key for the app in Apprise, then point the app at:

```text
https://apprise.techtronics.top
```

Use a simple lowercase config key:

```text
myapp
```

If the app supports only ntfy, use a dedicated ntfy topic when possible.

Good:

```text
jellyseerr
backup-alerts
uptime-alerts
```

Less useful:

```text
fallback-alerts
```

`fallback-alerts` is okay for quick setup, but a dedicated topic gives the bridge a better source name for Telegram.

If a new direct-ntfy topic should go to Telegram, add it to the bridge config in `manifests/apprise/notification-scripts.yaml`.

Do not bridge topics that Apprise already writes to.

Avoid these:

```text
sonarr
radarr
frostbite
global
```

Those already go through Apprise to Telegram. Bridging them would double-send.

## What you need to do now

Keep these UI values in Sonarr and Radarr:

```text
sonarr
radarr
```

Do not try to force title prefixes through the Apprise key field.

Check Telegram after a real Sonarr/Radarr event. If the notification arrives, the setup is working, even if the title says `Series Deleted` instead of `Sonarr - Series Deleted`.

If Telegram stops working, check these first:

1. Doppler still has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
2. The Apprise pod is `2/2 Running`.
3. The Apprise logs show `Delivered Notification(s)` for the right key.
4. The bridge sidecar has no `Command failed` logs.

## Smoke tests

Test Apprise fan-out:

```bash
curl -X POST https://apprise.techtronics.top/notify/global \
  -H "Content-Type: application/json" \
  -d '{"title":"Homelab Test","body":"Apprise fan-out works","type":"info"}'
```

Test the bridge path by publishing to `fallback-alerts` from an authenticated ntfy client.

Expected result:

```text
Apprise test -> ntfy + Telegram
fallback-alerts test -> Telegram through telegram-only
```

## Known annoyances

Sonarr/Radarr real alerts are not branded.

This is not our config mistake. Their Apprise integration sends real event titles like `Series Deleted`, while the test path sends `Sonarr - Test Notification`. It is odd, but harmless.

Bridge messages may have a different shape.

For direct ntfy messages, the bridge uses the ntfy topic as the Telegram title and puts the original title/body into the Telegram body. It also strips simple Markdown markers like `**Description:**` because Telegram was showing them as raw text. That is intentional. It makes the source visible without needing every direct-ntfy app to support Apprise.

The bridge is best-effort.

It is good enough for homelab alerts. It is not a guaranteed message queue. If you need hard delivery guarantees later, use a real queue or alerting pipeline. That is not needed right now.

## Do not overbuild this

The current setup is practical:

```text
Apprise for fan-out
ntfy for local/self-hosted notifications
Telegram for phone alerts
bridge for direct-ntfy leftovers
```

That is enough. The Sonarr/Radarr title thing is cosmetic. Do not add a proxy just for prettier titles unless it becomes genuinely annoying.
