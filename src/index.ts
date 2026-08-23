import "dotenv/config";

import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";

import { createMessageHandler } from "./bot/messageHandler.js";
import { loadConfig } from "./config.js";
import { InstagramProvider } from "./instagram/provider.js";
import { createLogger, errorContext } from "./logger.js";
import { MediaDownloader } from "./media/downloader.js";
import { createLimiter } from "./utils/asyncLimiter.js";

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Invalid bot configuration",
        error: message,
      }),
    );
    process.exit(1);
  }
}

const config = loadConfigOrExit();
const logger = createLogger(config.logLevel);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
  allowedMentions: { parse: [], repliedUser: false },
});

const provider = new InstagramProvider(
  {
    retry: config.snapSaveRetries,
    retryDelayMs: config.snapSaveRetryDelayMs,
    ...(config.snapSaveProxy === undefined
      ? {}
      : { proxy: config.snapSaveProxy }),
    redirectTimeoutMs: config.fetchTimeoutMs,
    cacheTtlMs: config.cacheTtlMs,
    cacheMaxEntries: config.cacheMaxEntries,
  },
  logger,
);

const downloader = new MediaDownloader(
  {
    maximumBytes: config.maxAttachmentBytes,
    timeoutMs: config.fetchTimeoutMs,
    concurrency: config.downloadConcurrency,
  },
  logger,
);

const handleMessage = createMessageHandler({
  config,
  provider,
  downloader,
  logger,
});
const limitProcessing = createLimiter(config.processConcurrency);

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setPresence({
    status: "online",
    activities: [
      { type: ActivityType.Watching, name: "for Instagram links" },
    ],
  });
  logger.info("Discord bot is ready", {
    user: readyClient.user.tag,
    guildCount: readyClient.guilds.cache.size,
  });
});

client.on(Events.MessageCreate, (message) => {
  void limitProcessing(() => handleMessage(message)).catch((error: unknown) => {
    logger.error("Unexpected message handler failure", {
      messageId: message.id,
      ...errorContext(error),
    });
  });
});

client.on(Events.Error, (error) => {
  logger.error("Discord client error", errorContext(error));
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection", errorContext(error));
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down Discord bot", { signal });
  client.destroy();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

try {
  await client.login(config.discordToken);
} catch (error) {
  logger.error("Discord login failed", errorContext(error));
  process.exitCode = 1;
}
