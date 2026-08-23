import { snapsave } from "snapsave-media-downloader";

import type { Logger } from "../logger.js";
import type {
  InstagramLink,
  InstagramMedia,
  InstagramMediaKind,
  InstagramPost,
} from "../types.js";
import { TtlCache } from "../utils/ttlCache.js";
import { resolveInstagramRedirect } from "./redirectResolver.js";

type SnapSave = typeof snapsave;

export interface InstagramProviderOptions {
  retry: number;
  retryDelayMs: number;
  proxy?: string;
  redirectTimeoutMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

export class InstagramExtractionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstagramExtractionError";
  }
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function inferMediaKind(
  declaredType: "image" | "video" | undefined,
  mediaUrl: string,
): InstagramMediaKind {
  if (declaredType !== undefined) return declaredType;
  return /\.(?:mp4|mov|webm)(?:$|\?)/iu.test(mediaUrl) ? "video" : "image";
}

export class InstagramProvider {
  readonly #cache: TtlCache<InstagramPost>;

  public constructor(
    private readonly options: InstagramProviderOptions,
    private readonly logger: Logger,
    private readonly snapSaveClient: SnapSave = snapsave,
  ) {
    this.#cache = new TtlCache<InstagramPost>(
      options.cacheTtlMs,
      options.cacheMaxEntries,
    );
  }

  public async getPost(link: InstagramLink): Promise<InstagramPost> {
    return this.#cache.getOrCreate(link.cacheKey, async () => {
      try {
        return await this.#extract(link.url);
      } catch (firstError) {
        if (!link.mayRedirect) throw firstError;

        this.logger.debug("Direct extraction of share URL failed; resolving it", {
          linkKind: link.kind,
          linkId: link.id,
        });
        const resolvedUrl = await resolveInstagramRedirect(
          link.url,
          this.options.redirectTimeoutMs,
        );
        if (resolvedUrl === undefined || resolvedUrl === link.url) throw firstError;
        return this.#extract(resolvedUrl);
      }
    });
  }

  async #extract(sourceUrl: string): Promise<InstagramPost> {
    const result = await this.snapSaveClient(sourceUrl, {
      retry: this.options.retry,
      retryDelay: this.options.retryDelayMs,
      ...(this.options.proxy === undefined ? {} : { proxy: this.options.proxy }),
    });

    if (result.success !== true || result.data?.media === undefined) {
      throw new InstagramExtractionError(
        result.message ?? "Instagram returned no downloadable media.",
      );
    }

    const media: InstagramMedia[] = [];
    const seenUrls = new Set<string>();

    for (const item of result.data.media) {
      const mediaUrl = safeHttpsUrl(item.url);
      if (mediaUrl === undefined || seenUrls.has(mediaUrl)) continue;

      seenUrls.add(mediaUrl);
      const thumbnailUrl = safeHttpsUrl(item.thumbnail);
      media.push({
        url: mediaUrl,
        kind: inferMediaKind(item.type, mediaUrl),
        ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
      });
    }

    if (media.length === 0) {
      throw new InstagramExtractionError(
        "Instagram returned no valid downloadable media.",
      );
    }

    return { sourceUrl, media };
  }
}
