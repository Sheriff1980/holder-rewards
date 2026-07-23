import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const mismatches = [];

async function syncFile(source, destination, transform = (value) => value) {
  const expected = transform(await readFile(join(root, source), "utf8"));
  const target = join(root, destination);
  if (checkOnly) {
    let actual = "";
    try {
      actual = await readFile(target, "utf8");
    } catch {
      mismatches.push(destination);
      return;
    }
    if (actual !== expected) mismatches.push(destination);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, expected, "utf8");
}

const workerSources = (await readdir(join(root, "apps/worker/src")))
  .filter((name) => name.endsWith(".ts"))
  .sort();
for (const name of workerSources) {
  await syncFile(
    `apps/worker/src/${name}`,
    `cloudflare/src/${name}`,
    (content) =>
      content.replaceAll('from "@holder-rewards/chains"', 'from "./chain-registry.js"')
  );
}
await syncFile("packages/chains/src/index.ts", "cloudflare/src/chain-registry.ts");

const migrations = (await readdir(join(root, "migrations")))
  .filter((name) => name.endsWith(".sql"))
  .sort();
for (const name of migrations) {
  await syncFile(`migrations/${name}`, `cloudflare/migrations/${name}`);
}
await syncFile("docs/START_HERE.md", "cloudflare/START_HERE.md");
await syncFile("LICENSE", "cloudflare/LICENSE");

if (checkOnly && mismatches.length > 0) {
  console.error("Cloudflare release files are out of sync:");
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("Cloudflare release files match the tested source.");
} else {
  console.log(`Synchronized ${workerSources.length} source files and ${migrations.length} migrations.`);
}
