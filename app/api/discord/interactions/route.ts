import { NextResponse } from "next/server";
import { after } from "next/server";
import { InteractionType, InteractionResponseType } from "discord-interactions";
import { verifyDiscordRequest } from "@/lib/discord/verify";
import { getEnv } from "@/lib/env";
import { setChannelMapping, removeChannelMapping } from "@/lib/bridge/channel-mapping";
import { executeSaveToDriveJob } from "@/lib/discord/save-to-drive";

// maxDuration configured to 300 (or 60 on Hobby if build limits enforce)
export const maxDuration = 300;

export async function POST(req: Request) {
  // 1. Signature check BEFORE parsing or acting
  const { isValid, rawBody } = await verifyDiscordRequest(req);
  if (!isValid) {
    return new NextResponse("Invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);
  const env = getEnv();

  // 2. Handle Discord PING (Type 1)
  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({
      type: InteractionResponseType.PONG,
    });
  }

  const userId =
    interaction.member?.user?.id || interaction.user?.id || "";
  const channelId = interaction.channel_id;

  // 3. Handle Application Command (Type 2)
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const data = interaction.data;

    // Check admin commands: /link and /unlink
    if (data.name === "link") {
      if (!env.ALLOWED_USER_IDS.includes(userId)) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "⛔ You are not authorized to use this command.",
            flags: 64, // EPHEMERAL
          },
        });
      }

      const folderIdOption = data.options?.find(
        (opt: { name: string; value: string }) => opt.name === "folder_id"
      );
      const folderNameOption = data.options?.find(
        (opt: { name: string; value: string }) => opt.name === "folder_name"
      );

      const folderId = folderIdOption?.value;
      const folderName = folderNameOption?.value;

      if (!folderId) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "❌ Folder ID is required.",
            flags: 64,
          },
        });
      }

      try {
        await setChannelMapping({
          channelId,
          folderId,
          folderName,
          linkedBy: userId,
        });

        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `✅ Linked <#${channelId}> to Google Drive folder \`${folderId}\`${
              folderName ? ` ("${folderName}")` : ""
            }.`,
            flags: 64,
          },
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ Failed to link channel: ${errorMsg}`,
            flags: 64,
          },
        });
      }
    }

    if (data.name === "unlink") {
      if (!env.ALLOWED_USER_IDS.includes(userId)) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "⛔ You are not authorized to use this command.",
            flags: 64,
          },
        });
      }

      try {
        const removed = await removeChannelMapping(channelId);
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: removed
              ? `✅ Unlinked <#${channelId}> from its Google Drive folder.`
              : `ℹ️ No existing folder mapping found for this channel.`,
            flags: 64,
          },
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ Failed to unlink channel: ${errorMsg}`,
            flags: 64,
          },
        });
      }
    }

    // Message context menu: "Save to Drive"
    if (data.name === "Save to Drive" && data.type === 3) {
      const targetMessageId = data.target_id;
      const targetMessage = data.resolved?.messages?.[targetMessageId];
      const attachments = targetMessage?.attachments || [];

      // Respond IMMEDIATELY with deferred ephemeral ACK (< 3 seconds)
      const ackResponse = NextResponse.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: 64, // EPHEMERAL confirmation to invoker
        },
      });

      // Execute background upload in after()
      after(async () => {
        await executeSaveToDriveJob({
          applicationId: interaction.application_id,
          interactionToken: interaction.token,
          channelId,
          targetMessageId,
          attachments,
        });
      });

      return ackResponse;
    }
  }

  return NextResponse.json({ error: "Unknown interaction" }, { status: 400 });
}
