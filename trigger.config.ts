// trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "REPLACE_ME",
  runtime: "node",
  dirs: ["./src/trigger"],

  // ✅ Trigger v4.4.0 以降で必須（最低 5 秒）
  // dispatch/sweeper はネットワーク呼び出しがあるので、余裕を見て 60 秒推奨
  maxDuration: 60,
});
