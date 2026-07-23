import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.DISCORD_BOT_TOKEN;
const wranglerScript =
  process.env.HOLDER_REWARDS_WRANGLER_SCRIPT ??
  join(root, "node_modules", "wrangler", "bin", "wrangler.js");

if (!token) {
  throw new Error(
    "DISCORD_BOT_TOKEN is missing. Add it as a secret under Cloudflare's build variables and retry the deployment."
  );
}
if (token !== token.trim()) {
  throw new Error("DISCORD_BOT_TOKEN has an extra space or line break. Replace the build secret and retry.");
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerScript, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    timeout: 180_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Cloudflare command failed: wrangler ${args[0]}`);
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "holder-rewards-deploy-"));
const secretsFile = join(temporaryDirectory, "secrets.json");

try {
  await writeFile(secretsFile, JSON.stringify({ DISCORD_BOT_TOKEN: token }), {
    encoding: "utf8",
    mode: 0o600
  });

  // The first deploy provisions D1 and installs the encrypted runtime secret.
  runWrangler(["deploy", "--secrets-file", secretsFile]);
  runWrangler(["d1", "migrations", "apply", "DB", "--remote"]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
