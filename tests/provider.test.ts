import { describe, expect, it, vi } from "vitest";

import {
  InstagramExtractionError,
  InstagramProvider,
} from "../src/instagram/provider.js";
import type { Logger } from "../src/logger.js";
import type { InstagramLink } from "../src/types.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const link: InstagramLink = {
  url: "https://www.instagram.com/p/POST/",
  cacheKey: "https://www.instagram.com/p/POST/",
  kind: "post",
  id: "POST",
  mayRedirect: false,
};

function options() {
  return {
    retry: 3,
    retryDelayMs: 5,
    redirectTimeoutMs: 1_000,
    cacheTtlMs: 60_000,
    cacheMaxEntries: 10,
  };
}

describe("InstagramProvider", () => {
  it("normalizes and deduplicates extractor output", async () => {
    const client = vi.fn(async () => ({
      success: true,
      data: {
        media: [
          {
            url: "https://cdn.example/image.jpg",
            thumbnail: "https://cdn.example/thumb.jpg",
            type: "image" as const,
          },
          {
            url: "https://cdn.example/video.mp4",
            type: "video" as const,
          },
          { url: "https://cdn.example/image.jpg", type: "image" as const },
          { url: "http://insecure.example/file.jpg", type: "image" as const },
          {},
        ],
      },
    }));
    const provider = new InstagramProvider(options(), logger, client);

    await expect(provider.getPost(link)).resolves.toEqual({
      sourceUrl: link.url,
      media: [
        {
          url: "https://cdn.example/image.jpg",
          thumbnailUrl: "https://cdn.example/thumb.jpg",
          kind: "image",
        },
        { url: "https://cdn.example/video.mp4", kind: "video" },
      ],
    });
    expect(client).toHaveBeenCalledWith(link.url, {
      retry: 3,
      retryDelay: 5,
    });
  });

  it("coalesces and caches simultaneous extraction requests", async () => {
    const client = vi.fn(async () => ({
      success: true,
      data: { media: [{ url: "https://cdn.example/file.jpg", type: "image" as const }] },
    }));
    const provider = new InstagramProvider(options(), logger, client);

    const [first, second] = await Promise.all([
      provider.getPost(link),
      provider.getPost(link),
    ]);

    expect(first).toEqual(second);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("rejects failed and empty extractor results", async () => {
    const failedClient = vi.fn(async () => ({
      success: false,
      message: "not available",
    }));
    const emptyClient = vi.fn(async () => ({
      success: true,
      data: { media: [] },
    }));

    await expect(
      new InstagramProvider(options(), logger, failedClient).getPost(link),
    ).rejects.toThrow(InstagramExtractionError);
    await expect(
      new InstagramProvider(options(), logger, emptyClient).getPost(link),
    ).rejects.toThrow("no valid downloadable media");
  });
});
