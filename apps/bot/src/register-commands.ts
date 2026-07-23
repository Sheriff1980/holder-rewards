import { loadEnv } from "@holder-rewards/env";
import { registerCommands } from "./register.js";

const env = loadEnv();
await registerCommands(env);
