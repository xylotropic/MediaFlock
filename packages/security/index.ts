import { lookup } from "node:dns/promises";
import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { DomainError } from "../domain/errors";
import { workerTimeout, remainingWorkerTime } from "../worker/budget";
const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 32],
  ["64:ff9b::", 96],
] as const)
  blockedV6.addSubnet(address, prefix, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return (
    !!family &&
    !(family === 4
      ? blocked.check(address, "ipv4")
      : blockedV6.check(address, "ipv6"))
  );
}
export async function validatedUploadTarget(url: string, resolver = lookup) {
  const target = new URL(url);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443")
  )
    throw new DomainError("unsafe_url", "Unsafe provider upload URL.");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : resolver === lookup && remainingWorkerTime("provider") !== null
      ? await cloudUploadAddresses(host)
      : await resolver(host, { all: true });
  if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
    throw new DomainError(
      "unsafe_url",
      "Provider upload must resolve exclusively to public addresses.",
    );
  return { target, address: addresses[0].address, family: addresses[0].family };
}
async function cloudUploadAddresses(host: string) {
  const limit = workerTimeout(5000);
  const resolver = new Resolver({ timeout: limit, tries: 1 });
  const timer = setTimeout(() => resolver.cancel(), limit);
  try {
    const result = await Promise.allSettled([
      resolver.resolve4(host),
      resolver.resolve6(host),
    ]);
    const addresses: { address: string; family: number }[] = [];
    for (const [index, entry] of result.entries()) {
      if (entry.status === "fulfilled")
        addresses.push(
          ...entry.value.map((address) => ({ address, family: index ? 6 : 4 })),
        );
      else if (!["ENODATA", "ENOTFOUND"].includes(entry.reason?.code))
        throw new DomainError(
          "unsafe_url",
          "Provider upload address could not be verified in time.",
        );
    }
    return addresses;
  } finally {
    clearTimeout(timer);
  }
}
// Pin the checked address on the connection; preserve TLS hostname verification and never redirect.
// Node contracts: https://nodejs.org/api/https.html and https://nodejs.org/api/net.html#class-netblocklist
export async function uploadPublicBytes(
  url: string,
  bytes: Buffer,
  contentType: string,
) {
  const { target, address, family } = await validatedUploadTarget(url);
  return new Promise<void>((resolve, reject) => {
    const req = request(
      target,
      {
        method: "PUT",
        agent: false,
        signal: AbortSignal.timeout(workerTimeout(120000)),
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(bytes.length),
        },
        lookup: (_host, _options, callback) => callback(null, address, family),
      },
      (res) => {
        res.resume();
        res.on("error", reject);
        res.on("end", () =>
          res.statusCode && res.statusCode >= 200 && res.statusCode < 300
            ? resolve()
            : reject(
                new DomainError(
                  "upload_failed",
                  "Provider media upload failed.",
                ),
              ),
        );
      },
    );
    req.on("error", () =>
      reject(
        new DomainError("upload_failed", "Provider media upload unavailable."),
      ),
    );
    req.end(bytes);
  });
}
export async function boundedBody(req: Request, limit: number) {
  if (Number(req.headers.get("content-length") || 0) > limit)
    throw new DomainError("request_size", "Request body too large.", 413);
  const chunks: Uint8Array[] = [];
  let count = 0;
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.length;
      if (count > limit) {
        await reader.cancel();
        throw new DomainError("request_size", "Request body too large.", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks));
}
