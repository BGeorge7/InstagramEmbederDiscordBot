# Instagram Embed Discord Bot

A Discord.js bot written in strict TypeScript. When somebody posts a supported
Instagram URL, the bot extracts the public media and replies with native Discord
image/video attachments. Albums are preserved in order and split across replies
when they contain more files than Discord accepts in one message.

This is a bot adaptation of the media-extraction approach used by
[Lainmode/InstagramEmbed-vxinstagram](https://github.com/Lainmode/InstagramEmbed-vxinstagram).
It uses the same underlying
[`snapsave-media-downloader`](https://github.com/ahmedrangel/snapsave-media-downloader)
package, without the original ASP.NET/Open Graph proxy.

## Supported Instagram links

- Posts: `/p/{shortcode}`
- Reels: `/reel/{shortcode}` and `/reels/{shortcode}`
- Legacy Instagram TV links: `/tv/{shortcode}`
- Stories and highlights: `/stories/{username}/{id}`
- Albums/carousels, including all returned photos and videos
- Username-prefixed post links such as `/{username}/p/{shortcode}`
- Mobile share-button links such as `/share/p/...`, `/share/reel/...`, and
  the older `/s/...` form
- `instagram.com`, `www.instagram.com`, `m.instagram.com`, `instagr.am`, bare
  links without `https://`, Discord angle brackets, and Markdown-wrapped links
- Instagram's `l.instagram.com` link wrapper
- Tracking parameters such as `igsh`, `igshid`, and `utm_*`

Only public, currently available media can be downloaded. Private, deleted,
age-restricted, or login-gated posts cannot be bypassed.

## One-time Discord setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and create an application.
2. Open **Bot**, create the bot if needed, and enable **Message Content Intent**
   under **Privileged Gateway Intents**. The bot cannot see Instagram links in
   normal server messages without this intent.
3. On the app's **Installation** page, enable the `bot` install scope and grant:
   **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, and
   **Read Message History**.
4. Install the bot in your server.
5. On the **Bot** page, reset/copy the bot token. Treat it like a password.

No Instagram or Meta API key is required. `DISCORD_TOKEN` is the credential the
bot needs.

## Install and run

Node.js 20.19 or newer is required. Node 24 is supported.

```powershell
npm install
Copy-Item .env.example .env
```

Open `.env` and set:

```dotenv
DISCORD_TOKEN=your-discord-bot-token
```

Run in development:

```powershell
npm run dev
```

Or build and run the production output:

```powershell
npm run build
npm start
```

The ready log looks like this (as one JSON line):

```text
{"level":"info","message":"Discord bot is ready",...}
```

Then post a public Instagram link in a channel the bot can access. The bot will
reply to that message with the video, image, or album.

To skip downloading and uploading media, set this in `.env`:

```dotenv
MEDIA_DELIVERY_MODE=link
```

In `link` mode the bot replies with each temporary direct-media URL and lets
Discord create the image/video embed. Change it back to `upload` for native
Discord attachments. Restart the bot after changing the setting.

## Configuration

All settings are optional except `DISCORD_TOKEN`.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `ALLOWED_CHANNEL_IDS` | all | Comma-separated channel/thread IDs. DMs are excluded when a list is set. |
| `MEDIA_DELIVERY_MODE` | `upload` | `upload` creates native attachments; `link` sends direct media URLs without downloading them. |
| `MAX_LINKS_PER_MESSAGE` | `3` | Maximum Instagram links processed from one Discord message. |
| `MAX_MEDIA_ITEMS_PER_LINK` | `20` | Maximum album items processed. Instagram carousels currently top out at 20. |
| `MAX_ATTACHMENT_MB` | `20` | Maximum downloaded file size. Keep this at or below the server's Discord upload limit. |
| `MAX_ATTACHMENTS_PER_REPLY` | `10` | Files in each reply; Discord allows at most 10. |
| `PROCESS_CONCURRENCY` | `2` | Discord messages processed at the same time. |
| `DOWNLOAD_CONCURRENCY` | `3` | Media files downloaded at the same time. |
| `FETCH_TIMEOUT_MS` | `30000` | Timeout for redirects and media downloads. |
| `SNAPSAVE_RETRIES` | `3` | Extractor retry count. |
| `SNAPSAVE_RETRY_DELAY_MS` | `500` | Delay between extractor retries. |
| `SNAPSAVE_PROXY` | empty | Optional HTTP/HTTPS/SOCKS proxy accepted by the extractor. |
| `CACHE_TTL_MS` | `300000` | Extraction-result cache lifetime. |
| `CACHE_MAX_ENTRIES` | `250` | Maximum cached extraction results. |
| `SUPPRESS_ORIGINAL_EMBEDS` | `false` | Suppress Discord's original Instagram preview. Requires **Manage Messages**. |
| `REPLY_ON_ERROR` | `true` | Send a short reply when media cannot be retrieved. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

Files are downloaded with strict byte and time limits. In `upload` mode, media
larger than `MAX_ATTACHMENT_MB` or rejected by Discord is silently skipped;
direct media URLs are only posted when `MEDIA_DELIVERY_MODE=link`.

## Docker

After creating `.env`:

```powershell
docker compose up -d --build
docker compose logs -f
```

The container does not expose a port; it makes an outbound Discord Gateway
connection.

## Verification

Run the complete local acceptance suite:

```powershell
npm run check
```

This performs a strict typecheck, parser/provider/downloader tests, and a clean
production build. Live Discord login is intentionally not part of automated
tests because it requires your private token.

## Token safety

- Never commit `.env`; it is ignored by Git.
- Never paste the bot token into chat, screenshots, logs, or an issue.
- If the token is exposed, reset it immediately in the Developer Portal.
- Use `ALLOWED_CHANNEL_IDS` if the bot should operate only in selected channels.

This project is intended for media that users are authorized to access and
share. Instagram and the third-party extraction site may change at any time;
errors are handled without crashing the bot, but extraction depends on those
external services remaining compatible.
