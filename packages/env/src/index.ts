import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters."),

  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required."),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required."),
  DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required."),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  CHAIN_PROVIDERS: z.string().default("mock"),
  SOLANA_RPC_URL: z.string().url().optional(),
  SOLANA_HELIUS_API_KEY: z.string().optional(),
  EVM_RPC_URL: z.string().url().optional(),
  ALCHEMY_API_KEY: z.string().optional(),
  SIMPLEHASH_API_KEY: z.string().optional(),

  APP_NAME: z.string().default("Holder Rewards"),
  REWARD_CURRENCY_NAME: z.string().default("Points")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  return parsed.data;
}
