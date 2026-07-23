export interface Env {
  DB: D1Database;
  APP_NAME: string;
  REWARD_CURRENCY_NAME: string;
  DAILY_CLAIM_AMOUNT?: string;
  DISCORD_BOT_TOKEN: string;
  SETUP_TOKEN?: string;
}

export type DiscordInteraction = {
  id: string;
  application_id?: string;
  token?: string;
  type: number;
  guild_id?: string;
  member?: {
    permissions?: string;
    user?: {
      id: string;
    };
  };
  user?: {
    id: string;
  };
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{
      name: string;
      type: number;
      value?: string | number | boolean;
      options?: Array<{
        name: string;
        type: number;
        value?: string | number | boolean;
      }>;
    }>;
  };
};
