import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "cloudflare");
const temporaryRoot = await mkdtemp(join(tmpdir(), "holder-rewards-release-"));
const app = join(temporaryRoot, "app");
const state = join(temporaryRoot, "state");
const port = 8900 + (process.pid % 500);
const origin = `http://127.0.0.1:${port}`;
const pnpmScript = process.env.npm_execpath;
const wranglerScript = join(app, "node_modules", "wrangler", "bin", "wrangler.js");
let worker;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 180_000
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
}

async function waitForWorker() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`The standalone Worker exited before becoming ready (${worker.exitCode}).`);
    }
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return response;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("The standalone Worker did not become ready within 30 seconds.");
}

try {
  await cp(source, app, {
    recursive: true,
    filter: (path) =>
      !["node_modules", "dist", ".wrangler", ".dev.vars"].includes(path.split(/[\\/]/).at(-1))
  });
  const wranglerConfig = await readFile(join(app, "wrangler.jsonc"), "utf8");
  if (wranglerConfig.includes("database_id") || wranglerConfig.includes("00000000-0000")) {
    throw new Error("The deployment template still requires a manually created D1 database.");
  }
  if (!pnpmScript) throw new Error("Run this smoke test through pnpm.");
  run(process.execPath, [pnpmScript, "install", "--ignore-workspace", "--frozen-lockfile"], app);
  await writeFile(join(app, ".dev.vars"), 'DISCORD_BOT_TOKEN="release-smoke-token"\n', "utf8");
  run(
    process.execPath,
    [wranglerScript, "d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
    app
  );

  worker = spawn(
    process.execPath,
    [wranglerScript, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", state],
    { cwd: app, stdio: "ignore" }
  );
  const health = await waitForWorker();
  const healthBody = await health.json();
  if (healthBody.ok !== true || healthBody.database !== true) {
    throw new Error("The standalone Worker started, but its fresh D1 database was not healthy.");
  }

  const setupResponse = await fetch(origin);
  const setupHtml = await setupResponse.text();
  if (!setupResponse.ok || !setupHtml.includes("Launch check") || !setupHtml.includes("local preview")) {
    throw new Error("The standalone setup page did not render its expected first-run state.");
  }

  const chainsResponse = await fetch(`${origin}/api/chains`);
  const chainsBody = await chainsResponse.json();
  if (
    !chainsResponse.ok ||
    !Array.isArray(chainsBody.chains) ||
    !chainsBody.chains.some((chain) => chain.id === "apechain") ||
    !chainsBody.chains.some((chain) => chain.id === "solana")
  ) {
    throw new Error("The standalone chain registry did not include ApeChain and Solana.");
  }

  process.stdout.write(
    "Standalone Cloudflare release passed clean install, 18 migrations, boot, health, setup-page, and chain-registry checks.\n"
  );
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill();
    await new Promise((resolvePromise) => worker.once("exit", resolvePromise));
  }
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
