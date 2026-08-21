import { afterEach, expect, test } from "bun:test";
import {
  fetchOriginalImage,
  isSidearmImageCdn,
  resolveOriginalImageUrl,
  unwrapSidearmCdnUrl,
} from "./images";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ORIGIN = "https://drexeldragons.com";
const SCHOOL =
  "https://drexeldragons.com/images/2026/8/10/headshot.jpg";
const CLOUDFRONT =
  "https://dxbhsrqyrr690.cloudfront.net/sidearm.nextgen.sites/drexeldragons.com/images/2026/8/10/headshot.jpg";
const CONVERT = `https://images.sidearmdev.com/convert?url=${encodeURIComponent(CLOUDFRONT)}&type=webp`;

test("unwraps Sidearm convert CDN to the embedded origin URL", () => {
  expect(resolveOriginalImageUrl(CONVERT, ORIGIN)).toBe(CLOUDFRONT);
  expect(unwrapSidearmCdnUrl(new URL(CONVERT))).toBe(CLOUDFRONT);
});

test("strips resize params on school-host image URLs", () => {
  expect(
    resolveOriginalImageUrl(
      "/images/2026/8/10/headshot.jpg?width=80&quality=90&foo=1",
      ORIGIN,
    ),
  ).toBe(`${ORIGIN}/images/2026/8/10/headshot.jpg?foo=1`);
});

test("isSidearmImageCdn matches the convert host only", () => {
  expect(isSidearmImageCdn("images.sidearmdev.com")).toBe(true);
  expect(isSidearmImageCdn("dxbhsrqyrr690.cloudfront.net")).toBe(false);
  expect(isSidearmImageCdn("drexeldragons.com")).toBe(false);
});

test("fetchOriginalImage follows a school 302 by fetching CloudFront, never the convert CDN", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const requested: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    requested.push(href);
    if (href.includes("images.sidearmdev.com")) {
      throw new Error(`Sidearm CDN must not be fetched: ${href}`);
    }
    if (href === SCHOOL) {
      return new Response(null, {
        status: 302,
        headers: { Location: CONVERT },
      });
    }
    if (href === CLOUDFRONT) {
      return new Response(jpeg, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as typeof fetch;

  const image = await fetchOriginalImage(SCHOOL);
  expect(image).not.toBeNull();
  expect(image!.url).toBe(CLOUDFRONT);
  expect(image!.contentType).toBe("image/jpeg");
  expect(image!.bytes).toEqual(jpeg);
  expect(requested).toEqual([SCHOOL, CLOUDFRONT]);
});

test("fetchOriginalImage uses a school-origin 200 without following to the CDN", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes("images.sidearmdev.com")) {
      throw new Error(`Sidearm CDN must not be fetched: ${href}`);
    }
    expect(href).toBe(SCHOOL);
    return new Response(jpeg, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  }) as typeof fetch;

  const image = await fetchOriginalImage(SCHOOL);
  expect(image?.url).toBe(SCHOOL);
  expect(image?.bytes).toEqual(jpeg);
});

test("fetchOriginalImage refuses a Sidearm CDN URL with no embedded origin", async () => {
  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  expect(
    await fetchOriginalImage("https://images.sidearmdev.com/convert?type=webp"),
  ).toBeNull();
});
