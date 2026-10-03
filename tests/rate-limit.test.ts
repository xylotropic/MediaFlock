import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeDb, db } from "../packages/db";
import { getConfig } from "../packages/domain/config";
import {
  clientAddressHash,
  registrationRateLimit,
  type RegistrationPurpose,
} from "../packages/domain/registration";

const oldVercel = process.env.VERCEL;
function source() {
  const suffix = randomBytes(6).toString("hex");
  return new Request(getConfig().origin + "/api/signup", {
    headers: {
      "x-vercel-forwarded-for": `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}:${suffix.slice(8, 12)}::1`,
      "x-forwarded-for": "203.0.113.7",
    },
  });
}
async function count(key: string) {
  return (
    (
      await db().query(
        "select count from request_limits where key=$1 and window_at=date_trunc('hour',now())",
        [key],
      )
    ).rows[0]?.count || 0
  );
}
async function cleanup(keys: string[], globals: Array<[string, number]>) {
  await db().query("delete from request_limits where key=any($1::text[])", [
    keys,
  ]);
  for (const [key, consumed] of globals)
    if (consumed)
      await db().query(
        "update request_limits set count=greatest(count-$2,0) where key=$1 and window_at=date_trunc('hour',now())",
        [key, consumed],
      );
}
beforeAll(() => {
  const config = getConfig();
  if (
    config.mode !== "demo" ||
    !["127.0.0.1", "localhost"].includes(new URL(config.databaseUrl).hostname)
  )
    throw new Error("Rate-limit fixtures require isolated local database.");
  process.env.VERCEL = "1";
});
afterAll(async () => {
  if (oldVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = oldVercel;
  await closeDb();
});

describe("Atomic account request budgets", () => {
  it("121 rejected requests from a blocked source do not drain shared signup capacity", async () => {
    const blocked = source(),
      fresh = source();
    const global = "account:signup:global";
    const baseline = await count(global);
    let accepted = 0;
    try {
      for (let i = 0; i < 12; i++) {
        await registrationRateLimit(blocked, undefined, "signup");
        accepted++;
      }
      for (let i = 0; i < 121; i++)
        await expect(
          registrationRateLimit(blocked, undefined, "signup"),
        ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
      expect(await count(global)).toBe(baseline + 12);
      await registrationRateLimit(fresh, undefined, "signup");
      accepted++;
      expect(await count(global)).toBe(baseline + 13);
      expect(
        await count("account:signup:ip:" + clientAddressHash(blocked)),
      ).toBe(12);
    } finally {
      await cleanup(
        [
          "account:signup:ip:" + clientAddressHash(blocked),
          "account:signup:ip:" + clientAddressHash(fresh),
        ],
        [[global, accepted]],
      );
    }
  });

  it("rejected account buckets roll back source counters and separate actions retain independent budgets", async () => {
    const req = source();
    const email = `budget-${randomUUID()}@mediaflock.local`;
    const emailHash = createHash("sha256").update(email).digest("hex");
    const purposes: RegistrationPurpose[] = [
      "signup",
      "resend",
      "email_recover",
      "recovery_code",
    ];
    const consumed: Array<[string, number]> = [];
    try {
      for (const purpose of purposes) {
        const prefix = `account:${purpose}:`;
        const baseline = await count(prefix + "global");
        let successes = 0;
        consumed.push([prefix + "global", 0]);
        for (let i = 0; i < 4; i++) {
          await registrationRateLimit(req, email, purpose);
          successes++;
          consumed[consumed.length - 1][1] = successes;
        }
        await expect(
          registrationRateLimit(req, email, purpose),
        ).rejects.toMatchObject({ code: "rate_limited" });
        expect(await count(prefix + "global")).toBe(baseline + 4);
        expect(await count(prefix + "ip:" + clientAddressHash(req))).toBe(4);
        expect(await count(prefix + "email:" + emailHash)).toBe(4);
      }
    } finally {
      await cleanup(
        purposes.flatMap((purpose) => [
          `account:${purpose}:ip:${clientAddressHash(req)}`,
          `account:${purpose}:email:${emailHash}`,
        ]),
        consumed,
      );
    }
  });
});
