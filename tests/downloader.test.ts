import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../src/logger.js";
import { MediaDownloader } from "../src/media/downloader.js";
import type { InstagramMedia } from "../src/types.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const image: InstagramMedia = {
  url: "https://cdn.example/media",
  kind: "image",
};

function createDownloader(fetcher: typeof fetch, maximumBytes = 100) {
  return new MediaDownloader(
    { maximumBytes, timeoutMs: 1_000, concurrency: 2 },
    logger,
    fetcher,
  );
}

describe("MediaDownloader", () => {
  it("downloads a media response into a named attachment", async () => {
    const fetcher = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png", "content-length": "3" },
      }),
    );

    const result = await createDownloader(fetcher).prepare([image], "POST/unsafe");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "attached",
      attachment: {
        contentType: "image/png",
        fileName: "instagram-POST-unsafe-1.png",
      },
    });
    if (result[0]?.status === "attached") {
      expect([...result[0].attachment.buffer]).toEqual([1, 2, 3]);
    }
  });

  it("does not buffer a response whose declared size exceeds the limit", async () => {
    const fetcher = vi.fn(async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "video/mp4", "content-length": "101" },
      }),
    );

    await expect(createDownloader(fetcher).prepare([image], "POST")).resolves.toEqual([
      { status: "fallback", media: image, reason: "too-large" },
    ]);
  });

  it("stops an undeclared-length stream once it crosses the limit", async () => {
    const fetcher = vi.fn(async () =>
      new Response(new Uint8Array(101), {
        headers: { "content-type": "image/jpeg" },
      }),
    );

    await expect(createDownloader(fetcher).prepare([image], "POST")).resolves.toEqual([
      { status: "fallback", media: image, reason: "too-large" },
    ]);
  });

  it("follows validated HTTPS redirects", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other-cdn.example/file.mp4" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), {
          headers: { "content-type": "video/mp4" },
        }),
      );

    const result = await createDownloader(fetcher).prepare(
      [{ ...image, kind: "video" }],
      "REEL",
    );

    expect(result[0]?.status).toBe("attached");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new Response("login", { headers: { "content-type": "text/html" } })],
    [new Response(null, { status: 500 })],
  ])("uses direct URL fallback for invalid responses", async (response) => {
    const fetcher = vi.fn(async () => response);
    await expect(createDownloader(fetcher).prepare([image], "POST")).resolves.toEqual([
      { status: "fallback", media: image, reason: "download-failed" },
    ]);
  });

  it("rejects unsafe media hosts before fetching", async () => {
    const fetcher = vi.fn();
    const unsafe = { ...image, url: "https://127.0.0.1/private" };

    await expect(createDownloader(fetcher).prepare([unsafe], "POST")).resolves.toEqual([
      { status: "fallback", media: unsafe, reason: "download-failed" },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
