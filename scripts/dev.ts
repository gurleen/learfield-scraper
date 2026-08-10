const root = import.meta.dir.replace(/\/scripts$/, "");

const api = Bun.spawn({
  cmd: ["bun", "./index.ts"],
  cwd: root,
  env: {
    ...process.env,
    PORT: process.env.API_PORT || "3001",
    SERVE_STATIC: "0",
  },
  stdout: "inherit",
  stderr: "inherit",
});

const vite = Bun.spawn({
  cmd: ["bunx", "vite"],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

function shutdown() {
  api.kill();
  vite.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const [apiCode, viteCode] = await Promise.all([api.exited, vite.exited]);
process.exit(apiCode || viteCode || 0);
