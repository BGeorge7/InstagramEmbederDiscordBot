import { isIP } from "node:net";

import type { Logger } from "../logger.js";
import type {
  DownloadedAttachment,
  InstagramMedia,
  PreparedMedia,
} from "../types.js";
import { createLimiter } from "../utils/asyncLimiter.js";

type Fetch = typeof globalThis.fetch;

const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 InstagramEmbedDiscordBot/1.0";
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export interface MediaDownloaderOptions {
  maximumBytes: number;
  timeoutMs: number;
  concurrency: number;
  maximumRedirects?: number;
}

type DownloadResult =
  | { status: "downloaded"; attachment: DownloadedAttachment }
  | { status: "too-large" };

function assertSafeRemoteUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("Media URL must use HTTPS.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("Media URL must not contain credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const ipVersion = isIP(hostname.replace(/^\[|\]$/gu, ""));
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    ipVersion !== 0
  ) {
    throw new Error("Media URL host is not allowed.");
  }

  return url;
}

function extensionFor(contentType: string, media: InstagramMedia): string {
  const knownTypes: Readonly<Record<string, string>> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  const knownExtension = knownTypes[contentType];
  if (knownExtension !== undefined) return knownExtension;

  try {
    const extension = /\.([a-z0-9]{2,5})$/iu.exec(new URL(media.url).pathname)?.[1];
    if (extension !== undefined) return extension.toLowerCase();
  } catch {
    // The provider has already validated this URL. Use the media-kind fallback.
  }

  return media.kind === "video" ? "mp4" : "jpg";
}

function safeFileStem(value: string): string {
  const safe = value.replace(/[^a-z0-9_-]/giu, "-").replace(/-+/gu, "-");
  return safe.replace(/^-|-$/gu, "").slice(0, 80) || "media";
}

async function readBodyWithLimit(
  response: Response,
  maximumBytes: number,
): Promise<Buffer | undefined> {
  if (response.body === null) throw new Error("Media response had no body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export class MediaDownloader {
  readonly #limit: ReturnType<typeof createLimiter>;

  public constructor(
    private readonly options: MediaDownloaderOptions,
    private readonly logger: Logger,
    private readonly fetcher: Fetch = globalThis.fetch,
  ) {
    this.#limit = createLimiter(options.concurrency);
  }

  public async prepare(
    mediaItems: readonly InstagramMedia[],
    linkId: string,
  ): Promise<PreparedMedia[]> {
    return Promise.all(
      mediaItems.map((media, index) =>
        this.#limit(async (): Promise<PreparedMedia> => {
          try {
            const result = await this.#download(media, linkId, index);
            if (result.status === "too-large") {
              return { status: "fallback", media, reason: "too-large" };
            }
            return { status: "attached", media, attachment: result.attachment };
          } catch (error) {
            this.logger.warn("Media download failed; using the direct URL", {
              mediaIndex: index,
              error: error instanceof Error ? error.message : String(error),
            });
            return { status: "fallback", media, reason: "download-failed" };
          }
        }),
      ),
    );
  }

  async #download(
    media: InstagramMedia,
    linkId: string,
    mediaIndex: number,
  ): Promise<DownloadResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const maximumRedirects = this.options.maximumRedirects ?? 5;

    try {
      let currentUrl = assertSafeRemoteUrl(media.url);

      for (let redirectCount = 0; ; redirectCount += 1) {
        const response = await this.fetcher(currentUrl, {
          headers: {
            accept: "image/*,video/*;q=0.9,*/*;q=0.1",
            "user-agent": DOWNLOAD_USER_AGENT,
          },
          redirect: "manual",
          signal: controller.signal,
        });

        if (REDIRECT_STATUS_CODES.has(response.status)) {
          if (redirectCount >= maximumRedirects) {
            await response.body?.cancel();
            throw new Error("Media download exceeded the redirect limit.");
          }

          const location = response.headers.get("location");
          await response.body?.cancel();
          if (location === null) throw new Error("Media redirect had no location.");
          currentUrl = assertSafeRemoteUrl(new URL(location, currentUrl).toString());
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Media server returned HTTP ${response.status}.`);
        }

        const contentLengthHeader = response.headers.get("content-length");
        const contentLength =
          contentLengthHeader !== null && /^\d+$/u.test(contentLengthHeader)
            ? Number(contentLengthHeader)
            : undefined;
        if (
          contentLength !== undefined &&
          Number.isSafeInteger(contentLength) &&
          contentLength > this.options.maximumBytes
        ) {
          await response.body?.cancel();
          this.logger.debug("Media exceeds configured attachment limit", {
            mediaIndex,
            contentLength,
          });
          return { status: "too-large" };
        }

        const rawContentType = response.headers.get("content-type") ?? "";
        const contentType = rawContentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (contentType === "text/html" || contentType === "application/json") {
          await response.body?.cancel();
          throw new Error(`Media server returned ${contentType} instead of media.`);
        }

        const buffer = await readBodyWithLimit(response, this.options.maximumBytes);
        if (buffer === undefined) {
          this.logger.debug("Streamed media exceeds configured attachment limit", {
            mediaIndex,
          });
          return { status: "too-large" };
        }
        if (buffer.byteLength === 0) throw new Error("Media download was empty.");

        const resolvedContentType =
          contentType || (media.kind === "video" ? "video/mp4" : "image/jpeg");
        const extension = extensionFor(resolvedContentType, media);
        return {
          status: "downloaded",
          attachment: {
            buffer,
            contentType: resolvedContentType,
            fileName: `instagram-${safeFileStem(linkId)}-${mediaIndex + 1}.${extension}`,
          },
        };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
