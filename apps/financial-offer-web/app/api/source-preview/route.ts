import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";

function privateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (!address.includes(".")) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31) || (a === 192 && b === 168);
}

async function safeUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) throw new Error("URL no permitida.");
  if (url.hostname === "localhost" || isIP(url.hostname) && privateAddress(url.hostname)) throw new Error("Destino privado no permitido.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Destino privado no permitido.");
  return url;
}

function meta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  return patterns.map((pattern) => html.match(pattern)?.[1] ?? "").find(Boolean) ?? "";
}

function clean(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function GET(request: Request) {
  try {
    const url = await safeUrl(new URL(request.url).searchParams.get("url") ?? "");
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "CAF-Source-Preview/1.0" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) throw new Error(`La fuente no entrego HTML (${response.status}).`);
    const html = (await response.text()).slice(0, 750000);
    const title = clean(meta(html, "og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url.hostname);
    const description = clean(meta(html, "og:description") || meta(html, "description"));
    const image = meta(html, "og:image");
    return NextResponse.json({ title, description, image: image ? new URL(image, url).toString() : null, hostname: url.hostname });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo leer la fuente." }, { status: 400 });
  }
}
