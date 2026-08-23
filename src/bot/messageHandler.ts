import { AttachmentBuilder } from "discord.js";
import type { Message, MessageReplyOptions } from "discord.js";

import type { BotConfig } from "../config.js";
import type { InstagramProvider } from "../instagram/provider.js";
import { extractInstagramLinks } from "../instagram/urls.js";
import type { Logger } from "../logger.js";
import type { MediaDownloader } from "../media/downloader.js";
import type { InstagramMedia, PreparedMedia } from "../types.js";

const FRIENDLY_EXTRACTION_ERROR =
  "I couldn't retrieve media from that Instagram link. It may be private, expired, deleted, or temporarily unavailable.";

async function replySafely(
  message: Message,
  options: MessageReplyOptions,
): Promise<void> {
  await message.reply({
    ...options,
    allowedMentions: { parse: [], repliedUser: false },
    failIfNotExists: false,
  });
}

function attachmentFromPrepared(
  item: Extract<PreparedMedia, { status: "attached" }>,
  index: number,
): AttachmentBuilder {
  return new AttachmentBuilder(item.attachment.buffer, {
    name: item.attachment.fileName,
    description: `Instagram ${item.media.kind} ${index + 1}`,
  });
}

async function sendDirectMediaUrl(
  message: Message,
  media: InstagramMedia,
  logger: Logger,
): Promise<void> {
  if (media.url.length > 2_000) {
    logger.warn("A direct media URL exceeded Discord's message length limit");
    await replySafely(message, {
      content:
        "This temporary direct-media URL was too long for a Discord message. Open the original Instagram link to view it.",
    });
    return;
  }

  // A bare direct-media URL lets Discord render the remote image/video itself.
  await replySafely(message, { content: media.url });
}

async function sendPreparedMedia(
  message: Message,
  prepared: readonly PreparedMedia[],
  maximumAttachmentsPerReply: number,
  logger: Logger,
  truncationNotice?: string,
): Promise<void> {
  const attached = prepared.filter(
    (item): item is Extract<PreparedMedia, { status: "attached" }> =>
      item.status === "attached",
  );
  const fallback = prepared.filter(
    (item): item is Extract<PreparedMedia, { status: "fallback" }> =>
      item.status === "fallback",
  );

  for (let index = 0; index < attached.length; index += maximumAttachmentsPerReply) {
    const group = attached.slice(index, index + maximumAttachmentsPerReply);
    try {
      await replySafely(message, {
        ...(index === 0 && truncationNotice !== undefined
          ? { content: truncationNotice }
          : {}),
        files: group.map((item, groupIndex) =>
          attachmentFromPrepared(item, index + groupIndex),
        ),
      });
    } catch (error) {
      logger.warn("Discord rejected an attachment batch", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failedCount = fallback.filter(
    (item) => item.reason === "download-failed",
  ).length;
  if (failedCount > 0) {
    await replySafely(message, {
      content: `Skipped ${failedCount} media ${failedCount === 1 ? "item" : "items"} because ${failedCount === 1 ? "it could" : "they could"} not be downloaded for upload.`,
    });
  }
}

export interface MessageHandlerDependencies {
  config: BotConfig;
  provider: Pick<InstagramProvider, "getPost">;
  downloader: Pick<MediaDownloader, "prepare">;
  logger: Logger;
}

export function createMessageHandler({
  config,
  provider,
  downloader,
  logger,
}: MessageHandlerDependencies): (message: Message) => Promise<void> {
  return async function handleMessage(message: Message): Promise<void> {
    if (message.author.bot || message.webhookId !== null) return;
    if (
      config.allowedChannelIds.size > 0 &&
      !config.allowedChannelIds.has(message.channelId)
    ) {
      return;
    }

    const links = extractInstagramLinks(
      message.content,
      config.maxLinksPerMessage,
    );
    if (links.length === 0) return;

    logger.info("Processing Instagram link message", {
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      linkCount: links.length,
    });

    if (config.suppressOriginalEmbeds) {
      try {
        await message.suppressEmbeds(true);
      } catch (error) {
        logger.warn("Could not suppress the original Instagram embed", {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const link of links) {
      try {
        const post = await provider.getPost(link);
        const selectedMedia = post.media.slice(0, config.maxMediaItemsPerLink);
        const truncationNotice =
          post.media.length > selectedMedia.length
            ? `Showing the first ${selectedMedia.length} of ${post.media.length} media items.`
            : undefined;

        if (config.mediaDeliveryMode === "link") {
          if (truncationNotice !== undefined) {
            await replySafely(message, { content: truncationNotice });
          }
          for (const media of selectedMedia) {
            await sendDirectMediaUrl(message, media, logger);
          }
        } else {
          const prepared = await downloader.prepare(selectedMedia, link.id);
          await sendPreparedMedia(
            message,
            prepared,
            config.maxAttachmentsPerReply,
            logger,
            truncationNotice,
          );
        }
      } catch (error) {
        logger.error("Could not process Instagram link", {
          messageId: message.id,
          linkKind: link.kind,
          linkId: link.id,
          error: error instanceof Error ? error.message : String(error),
        });

        if (config.replyOnError) {
          try {
            await replySafely(message, { content: FRIENDLY_EXTRACTION_ERROR });
          } catch (replyError) {
            logger.error("Could not send the Instagram error reply", {
              messageId: message.id,
              error:
                replyError instanceof Error
                  ? replyError.message
                  : String(replyError),
            });
          }
        }
      }
    }
  };
}
