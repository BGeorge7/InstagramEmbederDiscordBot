import { describe, expect, it, vi } from "vitest";

import { resolveInstagramRedirect } from "../src/instagram/redirectResolver.js";

describe("mobile share redirect resolution", () => {
  it("uses the final Instagram response URL", async () => {
    const response = {
      url: "https://www.instagram.com/reel/RESOLVED/",
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: vi.fn(async () => ""),
    } as unknown as Response;
    const fetcher = vi.fn(async () => response);

    await expect(
      resolveInstagramRedirect(
        "https://www.instagram.com/share/reel/TOKEN/?igsh=x",
        1_000,
        fetcher,
      ),
    ).resolves.toBe("https://www.instagram.com/reel/RESOLVED/");
  });

  it("falls back to the Open Graph canonical URL", async () => {
    const html =
      '<html><meta property="og:url" content="https:\\/\\/www.instagram.com\\/p\\/CANONICAL\\/"></html>';
    const response = {
      url: "https://www.instagram.com/share/p/TOKEN/",
      ok: true,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: vi.fn(async () => html),
    } as unknown as Response;
    const fetcher = vi.fn(async () => response);

    await expect(
      resolveInstagramRedirect(
        "https://www.instagram.com/share/p/TOKEN/",
        1_000,
        fetcher,
      ),
    ).resolves.toBe("https://www.instagram.com/p/CANONICAL/");
  });

  it("does not follow non-Instagram inputs", async () => {
    const fetcher = vi.fn();
    await expect(
      resolveInstagramRedirect("https://evil.example/share/p/X", 1_000, fetcher),
    ).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
