import type {
  InstagramLink,
  InstagramLinkKind,
} from "../types.js";

const INSTAGRAM_URL_PATTERN =
  /(?<![\p{L}\p{N}_.-])(?:https?:\/\/)?(?:(?:www|m|l)\.)?(?:instagram\.com|instagr\.am)\/[^\s<>()\[\]{}]+/giu;

const TRAILING_MESSAGE_PUNCTUATION = /[\]}>.,!;:'"…]+$/gu;
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "ig_mid",
  "ig_web_copy_link",
  "igsh",
  "igshid",
]);

interface ClassifiedPath {
  kind: InstagramLinkKind;
  id: string;
  canonicalPath?: string;
  mayRedirect: boolean;
}

export function isInstagramHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/\.$/u, "");
  return (
    value === "instagram.com" ||
    value.endsWith(".instagram.com") ||
    value === "instagr.am" ||
    value.endsWith(".instagr.am")
  );
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function classifyPath(pathname: string): ClassifiedPath | undefined {
  const segments = pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map(decodePathSegment);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());

  const shareIndex = lowerSegments.indexOf("share");
  if (shareIndex >= 0 && segments.length > shareIndex + 1) {
    return {
      kind: "share",
      id: segments.at(-1) ?? "share",
      mayRedirect: true,
    };
  }

  const shortShareIndex = lowerSegments.indexOf("s");
  if (shortShareIndex >= 0 && segments.length > shortShareIndex + 1) {
    return {
      kind: "share",
      id: segments.at(-1) ?? "share",
      mayRedirect: true,
    };
  }

  const storiesIndex = lowerSegments.indexOf("stories");
  if (storiesIndex >= 0 && segments.length > storiesIndex + 1) {
    return {
      kind: "story",
      id: segments.at(storiesIndex + 2) ?? segments[storiesIndex + 1] ?? "story",
      mayRedirect: false,
    };
  }

  const knownSegments: ReadonlyArray<{
    segment: string;
    kind: InstagramLinkKind;
    canonicalSegment: string;
  }> = [
    { segment: "p", kind: "post", canonicalSegment: "p" },
    { segment: "reel", kind: "reel", canonicalSegment: "reel" },
    { segment: "reels", kind: "reel", canonicalSegment: "reel" },
    { segment: "tv", kind: "tv", canonicalSegment: "tv" },
  ];

  for (const known of knownSegments) {
    const index = lowerSegments.indexOf(known.segment);
    const id = index >= 0 ? segments[index + 1] : undefined;
    if (
      id !== undefined &&
      id !== "" &&
      id.toLowerCase() !== "audio" &&
      id.toLowerCase() !== "explore"
    ) {
      return {
        kind: known.kind,
        id,
        canonicalPath: `/${known.canonicalSegment}/${encodeURIComponent(id)}/`,
        mayRedirect: false,
      };
    }
  }

  return undefined;
}

function stripTrackingParameters(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
}

function unwrapInstagramLinkShim(url: URL, depth: number): InstagramLink | undefined {
  if (url.hostname.toLowerCase() !== "l.instagram.com" || depth >= 2) {
    return undefined;
  }

  const target = url.searchParams.get("u") ?? url.searchParams.get("url");
  if (target === null) return undefined;
  return parseInstagramUrl(target, depth + 1);
}

function parseInstagramUrl(rawUrl: string, depth = 0): InstagramLink | undefined {
  const withoutInvisibleCharacters = rawUrl.replace(/[\u200B-\u200D\uFEFF]/gu, "");
  const trimmed = withoutInvisibleCharacters.replace(
    TRAILING_MESSAGE_PUNCTUATION,
    "",
  );
  const withProtocol = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return undefined;
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !isInstagramHostname(parsed.hostname)
  ) {
    return undefined;
  }

  const unwrapped = unwrapInstagramLinkShim(parsed, depth);
  if (unwrapped !== undefined) return unwrapped;

  const classified = classifyPath(parsed.pathname);
  if (classified === undefined) return undefined;

  const originalHostname = parsed.hostname.toLowerCase();
  parsed.protocol = "https:";
  parsed.username = "";
  parsed.password = "";
  parsed.port = "";
  parsed.hostname = "www.instagram.com";
  parsed.hash = "";

  if (classified.canonicalPath !== undefined) {
    parsed.pathname = classified.canonicalPath;
    parsed.search = "";
  }

  const cacheUrl = new URL(parsed);
  stripTrackingParameters(cacheUrl);

  return {
    url: parsed.toString(),
    cacheKey: cacheUrl.toString(),
    kind: classified.kind,
    id: classified.id,
    mayRedirect:
      classified.mayRedirect ||
      originalHostname === "instagr.am" ||
      originalHostname.endsWith(".instagr.am"),
  };
}

export function extractInstagramLinks(
  messageContent: string,
  maximumLinks = Number.POSITIVE_INFINITY,
): InstagramLink[] {
  const links: InstagramLink[] = [];
  const seen = new Set<string>();

  for (const match of messageContent.matchAll(INSTAGRAM_URL_PATTERN)) {
    const value = match[0];
    const link = value === undefined ? undefined : parseInstagramUrl(value);
    if (link === undefined || seen.has(link.cacheKey)) continue;

    seen.add(link.cacheKey);
    links.push(link);
    if (links.length >= maximumLinks) break;
  }

  return links;
}

export function normalizeInstagramUrl(rawUrl: string): InstagramLink | undefined {
  return parseInstagramUrl(rawUrl);
}
