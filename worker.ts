import { handleApi } from "./src/api";
import type { FetchSidearmEnv } from "./src/fetch";
import { publicModelKey } from "./src/models";

const MODEL_CACHE = "public, max-age=31536000, immutable";

function contentTypeForKey(key: string): string {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".onnx")) return "application/octet-stream";
  return "application/octet-stream";
}

async function serveModel(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const key = publicModelKey(pathname);
  if (!key) {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method === "HEAD" || request.method === "GET") {
    const object = await env.MODELS.get(key);
    if (!object) {
      return new Response("Not Found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", MODEL_CACHE);
    if (!headers.has("content-type")) {
      headers.set("content-type", contentTypeForKey(key));
    }
    // Same-origin mostly, but allow workers.dev + custom domain interchangeably.
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");

    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }
    return new Response(object.body, { headers });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-max-age": "86400",
      },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/models" || pathname.startsWith("/models/")) {
      return serveModel(request, env, pathname);
    }

    // Env.BROWSER.quickAction is overloaded; TS only considers the first
    // signature, which is not assignable to the "content" helper type.
    const api = handleApi(request, env as FetchSidearmEnv);
    if (api) return api;

    return new Response("Not Found", { status: 404 });
  },
};
