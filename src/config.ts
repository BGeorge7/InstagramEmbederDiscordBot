import type { LogLevel } from "./logger.js";

export interface BotConfig {
  discordToken: string;
  allowedChannelIds: ReadonlySet<string>;
  mediaDeliveryMode: "upload" | "link";
  maxLinksPerMessage: number;
  maxMediaItemsPerLink: number;
  maxAttachmentBytes: number;
  maxAttachmentsPerReply: number;
  processConcurrency: number;
  downloadConcurrency: number;
  fetchTimeoutMs: number;
  snapSaveRetries: number;
  snapSaveRetryDelayMs: number;
  snapSaveProxy?: string;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  suppressOriginalEmbeds: boolean;
  replyOnError: boolean;
  logLevel: LogLevel;
}

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const INTEGER_PATTERN = /^\d+$/u;

function integerFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = environment[name]?.trim();
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }

  if (!INTEGER_PATTERN.test(rawValue)) {
    throw new ConfigurationError(`${name} must be a whole number.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function booleanFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean {
  const rawValue = environment[name]?.trim().toLowerCase();
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }

  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new ConfigurationError(`${name} must be either true or false.`);
}

function logLevelFromEnvironment(environment: NodeJS.ProcessEnv): LogLevel {
  const value = environment["LOG_LEVEL"]?.trim().toLowerCase() ?? "info";
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }

  throw new ConfigurationError(
    "LOG_LEVEL must be debug, info, warn, or error.",
  );
}

function mediaDeliveryModeFromEnvironment(
  environment: NodeJS.ProcessEnv,
): "upload" | "link" {
  const value =
    environment["MEDIA_DELIVERY_MODE"]?.trim().toLowerCase() ?? "upload";
  if (value === "upload" || value === "link") return value;
  throw new ConfigurationError(
    "MEDIA_DELIVERY_MODE must be either upload or link.",
  );
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BotConfig {
  const discordToken = environment["DISCORD_TOKEN"]?.trim();
  if (discordToken === undefined || discordToken === "") {
    throw new ConfigurationError(
      "DISCORD_TOKEN is missing. Copy .env.example to .env and add the bot token.",
    );
  }

  const maxAttachmentMb = integerFromEnvironment(
    environment,
    "MAX_ATTACHMENT_MB",
    20,
    1,
    500,
  );
  const proxy = environment["SNAPSAVE_PROXY"]?.trim();

  return {
    discordToken,
    mediaDeliveryMode: mediaDeliveryModeFromEnvironment(environment),
    allowedChannelIds: new Set(
      (environment["ALLOWED_CHANNEL_IDS"] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== ""),
    ),
    maxLinksPerMessage: integerFromEnvironment(
      environment,
      "MAX_LINKS_PER_MESSAGE",
      3,
      1,
      10,
    ),
    maxMediaItemsPerLink: integerFromEnvironment(
      environment,
      "MAX_MEDIA_ITEMS_PER_LINK",
      20,
      1,
      20,
    ),
    maxAttachmentBytes: maxAttachmentMb * 1024 * 1024,
    maxAttachmentsPerReply: integerFromEnvironment(
      environment,
      "MAX_ATTACHMENTS_PER_REPLY",
      10,
      1,
      10,
    ),
    processConcurrency: integerFromEnvironment(
      environment,
      "PROCESS_CONCURRENCY",
      2,
      1,
      20,
    ),
    downloadConcurrency: integerFromEnvironment(
      environment,
      "DOWNLOAD_CONCURRENCY",
      3,
      1,
      10,
    ),
    fetchTimeoutMs: integerFromEnvironment(
      environment,
      "FETCH_TIMEOUT_MS",
      30_000,
      1_000,
      120_000,
    ),
    snapSaveRetries: integerFromEnvironment(
      environment,
      "SNAPSAVE_RETRIES",
      3,
      0,
      10,
    ),
    snapSaveRetryDelayMs: integerFromEnvironment(
      environment,
      "SNAPSAVE_RETRY_DELAY_MS",
      500,
      0,
      30_000,
    ),
    ...(proxy === undefined || proxy === "" ? {} : { snapSaveProxy: proxy }),
    cacheTtlMs: integerFromEnvironment(
      environment,
      "CACHE_TTL_MS",
      300_000,
      1_000,
      86_400_000,
    ),
    cacheMaxEntries: integerFromEnvironment(
      environment,
      "CACHE_MAX_ENTRIES",
      250,
      1,
      10_000,
    ),
    suppressOriginalEmbeds: booleanFromEnvironment(
      environment,
      "SUPPRESS_ORIGINAL_EMBEDS",
      false,
    ),
    replyOnError: booleanFromEnvironment(
      environment,
      "REPLY_ON_ERROR",
      true,
    ),
    logLevel: logLevelFromEnvironment(environment),
  };
}
