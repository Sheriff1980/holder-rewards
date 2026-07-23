import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Holder verification commands.")
    .addSubcommand((subcommand) =>
      subcommand.setName("panel").setDescription("Post a verification panel in this channel.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Check your linked wallet and role status.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("refresh").setDescription("Refresh your holder roles.")
    ),
  new SlashCommandBuilder()
    .setName("points")
    .setDescription("Rewards points commands.")
    .addSubcommand((subcommand) =>
      subcommand.setName("balance").setDescription("Check your current rewards balance.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("leaderboard").setDescription("Show the rewards leaderboard.")
    )
].map((command) => command.toJSON());

