import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const deployScript = join(root, "cloudflare", "scripts", "deploy.mjs");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "holder-rewards-deploy-test-"));
const fakeWrangler = join(temporaryDirectory, "fake-wrangler.mjs");
const callLog = join(temporaryDirectory, "calls.jsonl");
const token = "test-discord-token-kept-out-of-source";

await writeFile(
  fakeWrangler,
  `import { appendFile, readFile } from "node:fs/promises";
const args = process.argv.slice(2);
let secretPath;
if (args[0] === "deploy") {
  const index = args.indexOf("--secrets-file");
  if (index === -1) throw new Error("Missing --secrets-file.");
  secretPath = args[index + 1];
  const values = JSON.parse(await readFile(secretPath, "utf8"));
  if (values.DISCORD_BOT_TOKEN !== process.env.DISCORD_BOT_TOKEN) {
    throw new Error("The deploy secret did not match the build secret.");
  }
}
await appendFile(process.env.HOLDER_REWARDS_CALL_LOG, JSON.stringify({ args, secretPath }) + "\\n");
`,
  "utf8"
);

try {
  const result = spawnSync(process.execPath, [deployScript], {
    cwd: join(root, "cloudflare"),
    encoding: "utf8",
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN: token,
      WRANGLER_CI_OVERRIDE_NAME: "holder-rewards-test",
      HOLDER_REWARDS_WRANGLER_SCRIPT: fakeWrangler,
      HOLDER_REWARDS_CALL_LOG: callLog
    }
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error("The template deployment test failed.");
  }
  if (`${result.stdout}${result.stderr}`.includes(token)) {
    throw new Error("The deployment command printed the Discord token.");
  }

  const calls = (await readFile(callLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (calls.length !== 2) throw new Error(`Expected 2 Wrangler calls, received ${calls.length}.`);
  if (calls[0].args[0] !== "deploy" || !calls[0].args.includes("--secrets-file")) {
    throw new Error("The Worker was not deployed with a secrets file first.");
  }
  if (calls[1].args.join(" ") !== "d1 migrations apply holder-rewards-test-db --remote") {
    throw new Error("D1 migrations did not target the database created for the connected Worker.");
  }

  try {
    await access(calls[0].secretPath);
    throw new Error("The temporary secrets file was not removed.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  process.stdout.write("Template deployment securely installs the secret, provisions the Worker, and migrates D1.\n");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
