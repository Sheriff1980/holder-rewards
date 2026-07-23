import { REST, Routes } from "discord.js";
import type { AppEnv } from "@holder-rewards/env";
import { commands } from "./commands.js";

type DiscordRegistrationEnv = Pick<
  AppEnv,
  "DISCORD_BOT_TOKEN" | "DISCORD_CLIENT_ID" | "DISCORD_GUILD_ID"
>;

export async function registerCommands(env: DiscordRegistrationEnv): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

  if (env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body: commands
    });
    console.log(`Registered ${commands.length} guild commands for ${env.DISCORD_GUILD_ID}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commands });
  console.log(`Registered ${commands.length} global commands.`);
}
