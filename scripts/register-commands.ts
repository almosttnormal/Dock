import { DiscordRestClient } from "@/lib/discord/client";
import { COMMANDS } from "@/lib/discord/commands-def";
import { getEnv } from "@/lib/env";

/**
 * Registers application commands for the specific guild defined by DISCORD_GUILD_ID.
 * Usage: npx tsx scripts/register-commands.ts
 */
async function main() {
  const env = getEnv();

  console.log(`Registering ${COMMANDS.length} guild commands for Guild ID ${env.DISCORD_GUILD_ID}...`);
  const client = new DiscordRestClient(env.DISCORD_BOT_TOKEN);

  await client.registerGuildCommands(
    env.DISCORD_APPLICATION_ID,
    env.DISCORD_GUILD_ID,
    COMMANDS
  );

  console.log("Successfully registered commands:");
  for (const cmd of COMMANDS) {
    console.log(` - [${cmd.type === 1 ? "SLASH" : "CONTEXT_MENU"}] ${cmd.name}`);
  }
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
