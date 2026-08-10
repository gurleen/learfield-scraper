import { join } from "node:path";
import { handleApi } from "./src/api";

const root = import.meta.dir;
const distDir = join(root, "dist");

async function staticFromDist(pathname: string): Promise<Response | null> {
  const filePath =
    pathname === "/" || pathname === ""
      ? join(distDir, "index.html")
      : join(distDir, pathname.slice(1));
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }
  if (!pathname.includes(".")) {
    const fallback = Bun.file(join(distDir, "index.html"));
    if (await fallback.exists()) {
      return new Response(fallback);
    }
  }
  return null;
}

export function startServer(options?: { serveStatic?: boolean }): void {
  const port = Number(process.env.PORT) || 3001;
  const serveStatic = options?.serveStatic ?? process.env.SERVE_STATIC === "1";

  Bun.serve({
    port,
    async fetch(req) {
      const api = handleApi(req);
      if (api) return api;

      if (serveStatic) {
        const { pathname } = new URL(req.url);
        const staticRes = await staticFromDist(pathname);
        if (staticRes) return staticRes;
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(
    serveStatic
      ? `Roster scraper (API + static) at http://localhost:${port}`
      : `Roster API at http://localhost:${port}`,
  );
}

if (import.meta.path === Bun.main) {
  startServer({
    serveStatic: process.env.SERVE_STATIC !== "0",
  });
}
