import { isInstagramHostname, normalizeInstagramUrl } from "./urls.js";

type Fetch = typeof globalThis.fetch;

const REDIRECT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 InstagramEmbedDiscordBot/1.0";

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/")
    .replaceAll("\\/", "/");
}

function findCanonicalUrl(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+(?:property|name)=["']og:url["'][^>]+content=["']([^"']+)["'][^>]*>/iu,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:url["'][^>]*>/iu,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/iu,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1] !== undefined) return decodeHtmlAttribute(match[1]);
  }

  return undefined;
}

export async function resolveInstagramRedirect(
  sourceUrl: string,
  timeoutMs: number,
  fetcher: Fetch = globalThis.fetch,
): Promise<string | undefined> {
  const source = new URL(sourceUrl);
  if (!isInstagramHostname(source.hostname)) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": REDIRECT_USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const redirected = normalizeInstagramUrl(response.url);
    if (redirected !== undefined && redirected.cacheKey !== sourceUrl) {
      return redirected.url;
    }

    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return undefined;

    const canonical = findCanonicalUrl(await response.text());
    return canonical === undefined
      ? undefined
      : normalizeInstagramUrl(canonical)?.url;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
