import { getEnv } from "@/lib/env";
import { withBackoff } from "@/lib/retry";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; icon_url?: string; url?: string };
  fields?: DiscordEmbedField[];
}

export interface DiscordComponent {
  type: number;
  style?: number;
  label?: string;
  url?: string;
  components?: DiscordComponent[];
}

export interface PostMessageOptions {
  channelId: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordComponent[];
  messageReference?: { message_id: string };
  files?: Array<{ name: string; buffer: Buffer; contentType: string }>;
}

export interface EditOriginalInteractionResponseOptions {
  applicationId: string;
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordComponent[];
  flags?: number;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  attachments: DiscordAttachment[];
}

/**
 * Creates and edits Discord messages via plain fetch (REST v10).
 * No discord.js used anywhere in the codebase.
 */
export class DiscordRestClient {
  private botToken: string;

  constructor(botToken?: string) {
    this.botToken = botToken || getEnv().DISCORD_BOT_TOKEN;
  }

  /**
   * Posts a message to a Discord channel.
   * Supports multipart/form-data for image attachments (e.g. thumbnail attachments).
   */
  async postMessage(opts: PostMessageOptions): Promise<{ id: string }> {
    const url = `${DISCORD_API_BASE}/channels/${opts.channelId}/messages`;

    const headers: Record<string, string> = {
      Authorization: `Bot ${this.botToken}`,
    };
    let body: BodyInit;

    const payloadJson: Record<string, unknown> = {};
    if (opts.content) payloadJson.content = opts.content;
    if (opts.embeds) payloadJson.embeds = opts.embeds;
    if (opts.components) payloadJson.components = opts.components;
    if (opts.messageReference) {
      payloadJson.message_reference = opts.messageReference;
    }

    if (opts.files && opts.files.length > 0) {
      const formData = new FormData();
      formData.append("payload_json", JSON.stringify(payloadJson));

      for (let i = 0; i < opts.files.length; i++) {
        const file = opts.files[i];
        const blob = new Blob([new Uint8Array(file.buffer)], { type: file.contentType });
        formData.append(`files[${i}]`, blob, file.name);
      }
      body = formData;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payloadJson);
    }

    return withBackoff(
      async () => {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          let retryAfter: number | undefined;
          try {
            const parsed = JSON.parse(errText);
            if (typeof parsed.retry_after === "number") {
              retryAfter = parsed.retry_after;
            }
          } catch {
            // ignore json parse error
          }
          const err = new Error(`Discord postMessage failed [${res.status}]: ${errText}`) as Error & {
            status: number;
            retry_after?: number;
            headers: Headers;
          };
          err.status = res.status;
          err.headers = res.headers;
          if (retryAfter !== undefined) {
            err.retry_after = retryAfter;
          }
          throw err;
        }

        return (await res.json()) as { id: string };
      },
      {
        // Discord POST (postMessage): retry on 429 ONLY.
        // No retry on 5xx or network errors, because message may already exist.
        shouldRetry: (error: unknown) => {
          const status = (error as { status?: number })?.status;
          return status === 429;
        },
      }
    );
  }

  /**
   * Patches the deferred interaction response via webhook token.
   */
  async editOriginalInteractionResponse(
    opts: EditOriginalInteractionResponseOptions
  ): Promise<void> {
    const url = `${DISCORD_API_BASE}/webhooks/${opts.applicationId}/${opts.interactionToken}/messages/@original`;

    return withBackoff(async () => {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: opts.content,
          embeds: opts.embeds,
          components: opts.components,
          flags: opts.flags,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let retryAfter: number | undefined;
        try {
          const parsed = JSON.parse(errText);
          if (typeof parsed.retry_after === "number") {
            retryAfter = parsed.retry_after;
          }
        } catch {
          // ignore json parse error
        }
        const err = new Error(`Discord editOriginalResponse failed [${res.status}]: ${errText}`) as Error & {
          status: number;
          retry_after?: number;
          headers: Headers;
        };
        err.status = res.status;
        err.headers = res.headers;
        if (retryAfter !== undefined) {
          err.retry_after = retryAfter;
        }
        throw err;
      }
    });
  }

  /**
   * Registers guild application commands.
   */
  async registerGuildCommands(
    applicationId: string,
    guildId: string,
    commands: unknown[]
  ): Promise<void> {
    const url = `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${this.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Discord registerGuildCommands failed [${res.status}]: ${errText}`);
    }
  }
}
