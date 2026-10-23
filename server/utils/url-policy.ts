import dns from "dns";
import net from "net";
import { handleApiError } from "~~/server/utils/logging";

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIPv4(normalized.slice("::ffff:".length));
  }
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;

  return false;
}

function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

export async function assertAllowedOutboundUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw handleApiError(400, `Invalid instance URL: ${rawUrl}`, "Invalid instance URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw handleApiError(
      400,
      `Blocked instance URL protocol: ${parsed.protocol}`,
      "Instance URL must use http or https.",
    );
  }

  const hostname = parsed.hostname;
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw handleApiError(
      400,
      `Blocked instance hostname: ${hostname}`,
      "This instance URL is not allowed.",
    );
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw handleApiError(
        400,
        `Blocked instance URL target: ${hostname}`,
        "This instance URL is not allowed.",
      );
    }
    return;
  }

  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw handleApiError(
      400,
      `Could not resolve instance hostname: ${hostname}`,
      "Could not resolve instance URL.",
    );
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw handleApiError(
        400,
        `Blocked instance URL target: ${hostname} -> ${address}`,
        "This instance URL is not allowed.",
      );
    }
  }
}

export async function fetchExternalInstance<T>(
  url: string,
  opts?: Record<string, unknown>,
): Promise<T> {
  await assertAllowedOutboundUrl(url);
  return $fetch<T>(url, opts as any);
}
