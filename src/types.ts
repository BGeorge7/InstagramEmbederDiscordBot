export type InstagramMediaKind = "image" | "video";

export type InstagramLinkKind =
  | "post"
  | "reel"
  | "tv"
  | "story"
  | "share";

export interface InstagramLink {
  /** URL sent to the extractor. */
  url: string;
  /** Tracking-free key used for deduplication and caching. */
  cacheKey: string;
  kind: InstagramLinkKind;
  id: string;
  mayRedirect: boolean;
}

export interface InstagramMedia {
  url: string;
  kind: InstagramMediaKind;
  thumbnailUrl?: string;
}

export interface InstagramPost {
  sourceUrl: string;
  media: InstagramMedia[];
}

export interface DownloadedAttachment {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

export type PreparedMedia =
  | {
      status: "attached";
      attachment: DownloadedAttachment;
      media: InstagramMedia;
    }
  | {
      status: "fallback";
      media: InstagramMedia;
      reason: "too-large" | "download-failed";
    };
