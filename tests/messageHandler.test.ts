import type { Message, MessageReplyOptions } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { createMessageHandler } from "../src/bot/messageHandler.js";
import type { BotConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import type { InstagramMedia, PreparedMedia } from "../src/types.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function config(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    discordToken: "test",
    allowedChannelIds: new Set(),
    mediaDeliveryMode: "upload",
    maxLinksPerMessage: 3,
    maxMediaItemsPerLink: 20,
    maxAttachmentBytes: 20 * 1024 * 1024,
    maxAttachmentsPerReply: 10,
    processConcurrency: 2,
    downloadConcurrency: 3,
    fetchTimeoutMs: 30_000,
    snapSaveRetries: 3,
    snapSaveRetryDelayMs: 500,
    cacheTtlMs: 300_000,
    cacheMaxEntries: 250,
    suppressOriginalEmbeds: false,
    replyOnError: true,
    logLevel: "error",
    ...overrides,
  };
}

function fakeMessage(content: string, bot = false) {
  const replies: MessageReplyOptions[] = [];
  const message = {
    author: { bot },
    webhookId: null,
    channelId: "channel",
    guildId: "guild",
    id: "message",
    content,
    suppressEmbeds: vi.fn(async () => undefined),
    reply: vi.fn(async (options: MessageReplyOptions) => {
      replies.push(options);
      return undefined;
    }),
  } as unknown as Message;

  return { message, replies };
}

function media(index: number): InstagramMedia {
  return { url: `https://cdn.example/${index}.jpg`, kind: "image" };
}

function attached(item: InstagramMedia, index: number): PreparedMedia {
  return {
    status: "attached",
    media: item,
    attachment: {
      buffer: Buffer.from([index]),
      contentType: "image/jpeg",
      fileName: `instagram-${index}.jpg`,
    },
  };
}

describe("Discord message handler", () => {
  it("splits a large album into Discord-sized attachment batches", async () => {
    const items = Array.from({ length: 12 }, (_, index) => media(index));
    const provider = { getPost: vi.fn(async () => ({ sourceUrl: "source", media: items })) };
    const downloader = {
      prepare: vi.fn(async () => items.map((item, index) => attached(item, index))),
    };
    const { message, replies } = fakeMessage("https://instagram.com/p/ALBUM/");
    const handler = createMessageHandler({
      config: config(),
      provider,
      downloader,
      logger,
    });

    await handler(message);

    expect(provider.getPost).toHaveBeenCalledTimes(1);
    expect(replies).toHaveLength(2);
    expect(replies[0]?.files).toHaveLength(10);
    expect(replies[1]?.files).toHaveLength(2);
    expect(replies[0]?.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("does not post a media URL when an upload is too large", async () => {
    const item = media(1);
    const provider = { getPost: vi.fn(async () => ({ sourceUrl: "source", media: [item] })) };
    const downloader = {
      prepare: vi.fn(async () => [
        { status: "fallback", media: item, reason: "too-large" } as PreparedMedia,
      ]),
    };
    const { message, replies } = fakeMessage("https://instagram.com/reel/LARGE/");

    await createMessageHandler({
      config: config(),
      provider,
      downloader,
      logger,
    })(message);

    expect(replies).toHaveLength(0);
  });

  it("skips downloads and sends direct URLs in link mode", async () => {
    const items = [media(1), { ...media(2), kind: "video" as const }];
    const provider = {
      getPost: vi.fn(async () => ({ sourceUrl: "source", media: items })),
    };
    const downloader = { prepare: vi.fn() };
    const { message, replies } = fakeMessage("https://instagram.com/p/LINKS/");

    await createMessageHandler({
      config: config({ mediaDeliveryMode: "link" }),
      provider,
      downloader,
      logger,
    })(message);

    expect(downloader.prepare).not.toHaveBeenCalled();
    expect(replies.map((reply) => reply.content)).toEqual([
      items[0]?.url,
      items[1]?.url,
    ]);
    expect(replies.every((reply) => reply.files === undefined)).toBe(true);
  });

  it("replies with a safe error and continues without exposing internals", async () => {
    const provider = { getPost: vi.fn(async () => Promise.reject(new Error("secret internals"))) };
    const downloader = { prepare: vi.fn() };
    const { message, replies } = fakeMessage("https://instagram.com/p/FAIL/");

    await createMessageHandler({
      config: config(),
      provider,
      downloader,
      logger,
    })(message);

    expect(replies[0]?.content).toContain("couldn't retrieve media");
    expect(replies[0]?.content).not.toContain("secret internals");
  });

  it("ignores bots, disallowed channels, and non-media Instagram pages", async () => {
    const provider = { getPost: vi.fn() };
    const downloader = { prepare: vi.fn() };
    const botMessage = fakeMessage("https://instagram.com/p/POST/", true).message;
    const disallowed = fakeMessage("https://instagram.com/p/POST/").message;
    const profile = fakeMessage("https://instagram.com/a.profile/").message;
    const handler = createMessageHandler({
      config: config({ allowedChannelIds: new Set(["different-channel"]) }),
      provider,
      downloader,
      logger,
    });

    await handler(botMessage);
    await handler(disallowed);
    await createMessageHandler({
      config: config(),
      provider,
      downloader,
      logger,
    })(profile);

    expect(provider.getPost).not.toHaveBeenCalled();
  });
});
