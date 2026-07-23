import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} from "discord.js";
import { loadEnv } from "@holder-rewards/env";
import { registerCommands } from "./register.js";

const env = loadEnv();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot logged in as ${readyClient.user.tag}.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "verify") {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "panel") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "You need the Manage Server permission to post a verification panel.",
            ephemeral: true
          });
          return;
        }

        const verifyUrl = new URL("/verify", env.PUBLIC_APP_URL);
        if (interaction.guildId) {
          verifyUrl.searchParams.set("guild_id", interaction.guildId);
        }

        const embed = new EmbedBuilder()
          .setTitle(`${env.APP_NAME} Verification`)
          .setDescription("Link your wallet to check holder roles. You will only sign a readable message.")
          .setColor(0x2f80ed);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("Verify Wallet")
            .setStyle(ButtonStyle.Link)
            .setURL(verifyUrl.toString())
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        return;
      }

      if (subcommand === "status") {
        await interaction.reply({
          content: "Wallet status checks are scaffolded. Database-backed lookup is next.",
          ephemeral: true
        });
        return;
      }

      if (subcommand === "refresh") {
        await interaction.reply({
          content: "Role refresh is scaffolded. Ownership sync jobs are next.",
          ephemeral: true
        });
        return;
      }
    }

    if (interaction.commandName === "points") {
      const subcommand = interaction.options.getSubcommand();
      const content =
        subcommand === "leaderboard"
          ? "The points leaderboard is scaffolded. The ledger comes next."
          : `Your ${env.REWARD_CURRENCY_NAME} balance is not available until the ledger is connected.`;

      await interaction.reply({ content, ephemeral: true });
    }
  }
});

await registerCommands(env);
await client.login(env.DISCORD_BOT_TOKEN);
