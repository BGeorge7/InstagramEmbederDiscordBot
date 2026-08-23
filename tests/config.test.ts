import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({ DISCORD_TOKEN: " token " });

    expect(config.discordToken).toBe("token");
    expect(config.maxAttachmentBytes).toBe(20 * 1024 * 1024);
    expect(config.maxMediaItemsPerLink).toBe(20);
    expect(config.mediaDeliveryMode).toBe("upload");
    expect(config.allowedChannelIds.size).toBe(0);
    expect(config.suppressOriginalEmbeds).toBe(false);
  });

  it("loads optional settings", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "token",
      ALLOWED_CHANNEL_IDS: "123, 456,",
      MAX_ATTACHMENT_MB: "25",
      SNAPSAVE_PROXY: "http://proxy.example:8080",
      REPLY_ON_ERROR: "false",
      LOG_LEVEL: "debug",
      MEDIA_DELIVERY_MODE: "link",
    });

    expect([...config.allowedChannelIds]).toEqual(["123", "456"]);
    expect(config.maxAttachmentBytes).toBe(25 * 1024 * 1024);
    expect(config.snapSaveProxy).toBe("http://proxy.example:8080");
    expect(config.replyOnError).toBe(false);
    expect(config.logLevel).toBe("debug");
    expect(config.mediaDeliveryMode).toBe("link");
  });

  it("requires the Discord token", () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
  });

  it.each([
    [{ DISCORD_TOKEN: "x", MAX_LINKS_PER_MESSAGE: "0" }, "MAX_LINKS_PER_MESSAGE"],
    [{ DISCORD_TOKEN: "x", FETCH_TIMEOUT_MS: "soon" }, "FETCH_TIMEOUT_MS"],
    [{ DISCORD_TOKEN: "x", REPLY_ON_ERROR: "yes" }, "REPLY_ON_ERROR"],
    [{ DISCORD_TOKEN: "x", LOG_LEVEL: "verbose" }, "LOG_LEVEL"],
    [{ DISCORD_TOKEN: "x", MEDIA_DELIVERY_MODE: "download" }, "MEDIA_DELIVERY_MODE"],
  ])("rejects invalid environment values", (environment, expectedName) => {
    expect(() => loadConfig(environment)).toThrow(expectedName);
  });
});
