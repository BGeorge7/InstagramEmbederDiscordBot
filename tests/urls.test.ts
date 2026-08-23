import { describe, expect, it } from "vitest";

import {
  extractInstagramLinks,
  normalizeInstagramUrl,
} from "../src/instagram/urls.js";

describe("Instagram URL parsing", () => {
  it.each([
    ["https://www.instagram.com/p/ABC_123-/", "post", "ABC_123-"],
    ["http://instagram.com/reel/REEL123/?igsh=mobile-share", "reel", "REEL123"],
    ["https://m.instagram.com/reels/REELS123/", "reel", "REELS123"],
    ["https://instagram.com/tv/TV123/", "tv", "TV123"],
    ["https://instagram.com/some.user/p/USERPOST/", "post", "USERPOST"],
    ["https://www.instagram.com/stories/a.user/123456789/", "story", "123456789"],
    ["https://instagram.com/stories/a.user/", "story", "a.user"],
    ["https://www.instagram.com/stories/highlights/998877/", "story", "998877"],
    ["https://www.instagram.com/share/p/SHARETOKEN/?igsh=abc", "share", "SHARETOKEN"],
    ["https://www.instagram.com/share/reel/REELTOKEN/?igsh=abc", "share", "REELTOKEN"],
    ["https://www.instagram.com/s/OLDSTORYTOKEN/", "share", "OLDSTORYTOKEN"],
    ["https://instagr.am/p/SHORT123/", "post", "SHORT123"],
    ["instagram.com/p/NOPROTOCOL/", "post", "NOPROTOCOL"],
  ])("supports %s", (rawUrl, kind, id) => {
    const result = normalizeInstagramUrl(rawUrl);
    expect(result).toMatchObject({ kind, id });
  });

  it("canonicalizes direct-media aliases and removes tracking data", () => {
    const result = normalizeInstagramUrl(
      "http://m.instagram.com/reels/ABC123/?utm_source=copy_link&igsh=secret#fragment",
    );

    expect(result).toEqual({
      url: "https://www.instagram.com/reel/ABC123/",
      cacheKey: "https://www.instagram.com/reel/ABC123/",
      kind: "reel",
      id: "ABC123",
      mayRedirect: false,
    });
  });

  it("keeps mobile share parameters for extraction but removes them from the cache key", () => {
    const result = normalizeInstagramUrl(
      "https://www.instagram.com/share/reel/TOKEN/?igsh=mobile&utm_source=copy_link&needed=yes",
    );

    expect(result?.url).toContain("igsh=mobile");
    expect(result?.url).toContain("needed=yes");
    expect(result?.cacheKey).not.toContain("igsh");
    expect(result?.cacheKey).not.toContain("utm_source");
    expect(result?.cacheKey).toContain("needed=yes");
    expect(result?.mayRedirect).toBe(true);
  });

  it("unwraps Instagram's outbound link shim when it targets Instagram media", () => {
    const wrapped =
      "https://l.instagram.com/?u=" +
      encodeURIComponent("https://www.instagram.com/reel/WRAPPED/?igsh=abc");

    expect(normalizeInstagramUrl(wrapped)).toMatchObject({
      url: "https://www.instagram.com/reel/WRAPPED/",
      kind: "reel",
      id: "WRAPPED",
    });
  });

  it("extracts markdown, angle-bracketed, bare, and punctuated links", () => {
    const message = [
      "[post](https://instagram.com/p/ONE/?igsh=x),",
      "<https://www.instagram.com/reel/TWO/?igsh=y>",
      "and instagram.com/tv/THREE/.",
    ].join(" ");

    expect(extractInstagramLinks(message).map((link) => link.id)).toEqual([
      "ONE",
      "TWO",
      "THREE",
    ]);
  });

  it("deduplicates tracked variants and observes the configured maximum", () => {
    const links = extractInstagramLinks(
      "https://instagram.com/p/ONE/?igsh=a https://instagram.com/p/ONE/?igsh=b https://instagram.com/p/TWO/ https://instagram.com/p/THREE/",
      2,
    );

    expect(links.map((link) => link.id)).toEqual(["ONE", "TWO"]);
  });

  it.each([
    "https://instagram.com/a.profile/",
    "https://instagram.com/direct/t/123/",
    "https://instagram.com/reels/audio/123/",
    "https://notinstagram.com/p/EVIL/",
    "https://instagram.com.evil.example/p/EVIL/",
    "javascript:alert(1)",
  ])("rejects non-media or deceptive URL %s", (url) => {
    expect(extractInstagramLinks(url)).toEqual([]);
    expect(normalizeInstagramUrl(url)).toBeUndefined();
  });
});
