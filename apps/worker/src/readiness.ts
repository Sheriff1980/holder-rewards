import { ensureDiscordSetup, type DiscordSetupStatus } from "./discord.js";
import { checkChainProviders, type ChainHealth } from "./health.js";
import type { Env } from "./types.js";

export type ReadinessStatus = "ready" | "waiting" | "problem";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  message: string;
};

export type LaunchReadiness = {
  ready: boolean;
  checkedAt: string;
  inviteUrl: string;
  checks: ReadinessCheck[];
};

type ReadinessDependencies = {
  discord?: (env: Env, origin: string) => Promise<DiscordSetupStatus>;
  providers?: (env: Env) => Promise<ChainHealth[]>;
};

async function databaseCheck(env: Env): Promise<ReadinessCheck> {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return result?.ok === 1
      ? { id: "database", label: "App data", status: "ready", message: "Database is ready." }
      : { id: "database", label: "App data", status: "problem", message: "Database did not respond correctly." };
  } catch {
    return {
      id: "database",
      label: "App data",
      status: "problem",
      message: "Database could not be reached."
    };
  }
}

function discordCheck(status: DiscordSetupStatus): ReadinessCheck {
  if (status.ready) {
    return { id: "discord", label: "Discord", status: "ready", message: status.message };
  }
  return {
    id: "discord",
    label: "Discord",
    status: status.local ? "waiting" : "problem",
    message: status.message
  };
}

function providerCheck(provider: ChainHealth): ReadinessCheck {
  return {
    id: `network-${provider.id}`,
    label: provider.name,
    status: provider.status === "healthy" ? "ready" : "problem",
    message:
      provider.status === "healthy"
        ? `Network is available (${provider.latencyMs} ms).`
        : provider.message
  };
}

export async function checkLaunchReadiness(
  env: Env,
  origin: string,
  dependencies: ReadinessDependencies = {}
): Promise<LaunchReadiness> {
  const discord = dependencies.discord ?? ensureDiscordSetup;
  const providers = dependencies.providers ?? checkChainProviders;
  const [database, discordResult, providerResults] = await Promise.all([
    databaseCheck(env),
    discord(env, origin).catch(
      (): DiscordSetupStatus => ({
        ready: false,
        local: false,
        inviteUrl: "",
        message: "Discord could not be checked."
      })
    ),
    providers(env).catch((): ChainHealth[] => [])
  ]);

  const checks = [
    database,
    discordCheck(discordResult),
    ...providerResults.map(providerCheck)
  ];
  if (providerResults.length === 0) {
    checks.push({
      id: "networks",
      label: "Blockchain networks",
      status: "problem",
      message: "Networks could not be checked."
    });
  }

  return {
    ready: checks.every((check) => check.status === "ready"),
    checkedAt: new Date().toISOString(),
    inviteUrl: discordResult.inviteUrl,
    checks
  };
}
