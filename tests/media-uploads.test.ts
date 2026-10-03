import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, closeDb, scoped, workerContext } from "../packages/db";
import { fixture, draft } from "./helpers";
import { getConfig } from "../packages/domain/config";
import {
  checksum,
  identifyMime,
  runProcess,
  assetBytes,
  requestDerivative,
} from "../packages/media";
import {
  beginAssetUpload,
  completeAssetUpload,
  getAssetUpload,
  assetDownloadUrl,
  registerVerifiedUpload,
  MAX_ORIGINAL_BYTES,
  ORIGINAL_RESERVATION_BYTES,
} from "../packages/media/uploads";
import { processAssetUploadQueue } from "../apps/worker/media";
import { storageAdmin, createToken } from "../packages/domain/auth";
import { handleApi } from "../packages/domain/api-router";

let a: Awaited<ReturnType<typeof fixture>>,
  b: Awaited<ReturnType<typeof fixture>>;
let small: Buffer, large: Buffer;
beforeAll(async () => {
  // getConfig refuses remote demo databases and Storage. Never test live media.
  expect(getConfig().mode).toBe("demo");
  a = await fixture("direct uploads");
  b = await fixture("foreign upload");
  small = await readFile("artifacts/fixtures/original-study.png");
  const dir = await mkdtemp(join(tmpdir(), "mediaflock-large-test-"));
  try {
    const output = join(dir, "noise.png");
    await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "nullsrc=s=2000x2000,format=rgb24,geq=r=random(1)*255:g=random(2)*255:b=random(3)*255",
        "-frames:v",
        "1",
        "-threads",
        "2",
        output,
      ],
      20000,
    );
    large = await readFile(output);
    expect(large.length).toBeGreaterThan(4.5 * 1024 * 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
afterAll(closeDb);

function input(bytes = small, extra: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    filename: "../original.png",
    bytes: bytes.length,
    mimeType: "image/png",
    checksum: checksum(bytes),
    ...extra,
  };
}
async function put(
  upload: any,
  bytes: Buffer,
  mimeType = "image/png",
  upsert = false,
) {
  return fetch(upload.signedUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "Content-Type": mimeType, "x-upsert": String(upsert) },
  });
}

describe("Direct private originals and durable validation", () => {
  it("receives a file above the Vercel body limit, verifies it on the worker and redirects byte ranges", async () => {
    const upload = await beginAssetUpload(a.ctx, input(large));
    expect(upload.status).toBe("awaiting_upload");
    const pending = (
      await db().query("select reserved_bytes from asset_uploads where id=$1", [
        upload.id,
      ])
    ).rows[0];
    expect(Number(pending.reserved_bytes)).toBe(ORIGINAL_RESERVATION_BYTES);
    expect((await put(upload, large)).ok).toBe(true);
    expect((await getAssetUpload(a.ctx, upload.id)).asset).toBeUndefined();
    await expect(
      draft(a.ctx, a.account.id, "Pending cannot enter approval", [
        { assetId: upload.id },
      ]),
    ).rejects.toMatchObject({ code: "invalid_asset" });
    expect((await completeAssetUpload(a.ctx, upload.id)).status).toBe("queued");
    expect(await processAssetUploadQueue(1, upload.id)).toBe(1);
    const ready = await getAssetUpload(a.ctx, upload.id);
    expect(ready.status).toBe("ready");
    expect(ready.asset!.checksum).toBe(checksum(large));
    const stored = (
      await db().query(
        "select storage_path,final_storage_path,reserved_bytes,staged_bytes from asset_uploads where id=$1",
        [upload.id],
      )
    ).rows[0];
    expect(ready.asset!.storage_path).toBe(stored.final_storage_path);
    expect(ready.asset!.storage_path).not.toBe(stored.storage_path);
    expect(ready.asset!.storage_path).toContain(
      "/originals/" + upload.id + "/",
    );
    expect(Number(stored.reserved_bytes)).toBe(0);
    expect(Number(stored.staged_bytes)).toBe(large.length);
    const charged = (
      await db().query(
        "select (select bytes from assets where id=$1)+(select staged_bytes+reserved_bytes from asset_uploads where id=$1) as bytes",
        [upload.id],
      )
    ).rows[0];
    expect(Number(charged.bytes)).toBe(2 * large.length);
    expect((await assetBytes(a.ctx, ready.asset!.id)).bytes.equals(large)).toBe(
      true,
    );
    expect((await completeAssetUpload(a.ctx, upload.id)).asset!.id).toBe(
      ready.asset!.id,
    );
    const url = await assetDownloadUrl(a.ctx, ready.asset!.id);
    const range = await fetch(url, { headers: { Range: "bytes=0-31" } });
    expect(range.status).toBe(206);
    expect(
      Buffer.from(await range.arrayBuffer()).equals(large.subarray(0, 32)),
    ).toBe(true);
    const anonymous = await fetch(
      getConfig().supabaseUrl +
        "/storage/v1/object/mediaflock/" +
        ready.asset!.storage_path,
    );
    expect(anonymous.ok).toBe(false);
    const token = await createToken(a.ctx, {
      name: "Upload test",
      scopes: ["read", "draft"],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    const redirect = await handleApi(
      new Request(
        "http://127.0.0.1/api/v1/assets/" + ready.asset!.id + "/file",
        {
          headers: {
            Authorization: "Bearer " + token.secret,
            Range: "bytes=0-31",
          },
        },
      ),
      ["assets", ready.asset!.id, "file"],
    );
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("cache-control")).toBe("private, no-store");
    expect(await redirect.text()).toBe("");
    await expect(
      assetDownloadUrl(b.ctx, ready.asset!.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps retries idempotent, refuses caller paths and cannot overwrite a signed object", async () => {
    const data = input(),
      first = await beginAssetUpload(a.ctx, data),
      retry = await beginAssetUpload(a.ctx, data);
    expect(retry.id).toBe(first.id);
    expect(retry.signedUrl).toBe(first.signedUrl);
    await expect(
      beginAssetUpload(a.ctx, {
        ...data,
        storagePath: b.ctx.workspaceId + "/foreign.png",
      }),
    ).rejects.toThrow();
    await expect(
      beginAssetUpload(a.ctx, { ...data, checksum: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "upload_request_changed" });
    expect((await put(first, small)).ok).toBe(true);
    expect((await put(first, large, "image/png", true)).ok).toBe(false);
    await expect(completeAssetUpload(b.ctx, first.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getAssetUpload(b.ctx, first.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const completion = await Promise.all([
      completeAssetUpload(a.ctx, first.id),
      completeAssetUpload(a.ctx, first.id),
    ]);
    expect(completion.every((x) => x.status === "queued")).toBe(true);
    await processAssetUploadQueue(1, first.id);
    const ready = await getAssetUpload(a.ctx, first.id);
    expect((await assetBytes(a.ctx, ready.asset!.id)).checksum).toBe(
      checksum(small),
    );
    const replay = new URL(first.signedUrl!);
    replay.pathname =
      replay.pathname.split("/mediaflock/")[0] +
      "/mediaflock/" +
      ready.asset!.storage_path;
    expect(
      (await put({ signedUrl: replay.toString() }, large, "image/png", true))
        .ok,
    ).toBe(false);
    expect((await put(first, large, "image/png", true)).ok).toBe(false);
    expect((await assetBytes(a.ctx, ready.asset!.id)).checksum).toBe(
      checksum(small),
    );
    expect((await completeAssetUpload(a.ctx, first.id)).asset!.id).toBe(
      ready.asset!.id,
    );
    expect(
      Number(
        (
          await db().query("select count(*) from assets where id=$1", [
            first.id,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
  });

  it("rejects MIME spoofing and checksum mismatches without exposing an asset", async () => {
    expect(() =>
      identifyMime(Buffer.from("\u0000\u0000\u0000\u0018ftypavif")),
    ).toThrow();
    for (const extra of [
      { mimeType: "image/jpeg" },
      { checksum: "0".repeat(64) },
    ]) {
      const upload = await beginAssetUpload(a.ctx, input(small, extra));
      expect(
        (await put(upload, small, String(extra.mimeType || "image/png"))).ok,
      ).toBe(true);
      await completeAssetUpload(a.ctx, upload.id);
      await processAssetUploadQueue(1, upload.id);
      const status = await getAssetUpload(a.ctx, upload.id);
      expect(status.status).toBe("failed");
      expect(status.asset).toBeUndefined();
      const reservation = (
        await db().query(
          "select reserved_bytes from asset_uploads where id=$1",
          [upload.id],
        )
      ).rows[0];
      expect(Number(reservation.reserved_bytes)).toBe(MAX_ORIGINAL_BYTES);
    }
  });

  it("serializes pending quotas across parallel clients and fences recovered workers", async () => {
    const isolated = await fixture("parallel upload quota");
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => beginAssetUpload(isolated.ctx, input())),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect(results.find((x) => x.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { code: "upload_pending" },
    });
    const first = results.find((x) => x.status === "fulfilled")!;
    if (first.status !== "fulfilled") throw new Error("Missing upload");
    await put(first.value, small);
    await completeAssetUpload(isolated.ctx, first.value.id);
    const oldLease = randomUUID(),
      newerLease = randomUUID();
    await db().query(
      "update asset_uploads set status='validating',lease_token=$1,lease_expires_at=now()-interval '1 minute' where id=$2",
      [oldLease, first.value.id],
    );
    const stale = (
      await db().query("select * from asset_uploads where id=$1", [
        first.value.id,
      ])
    ).rows[0];
    await db().query("update asset_uploads set lease_token=$1 where id=$2", [
      newerLease,
      first.value.id,
    ]);
    await expect(
      registerVerifiedUpload(
        workerContext(isolated.ctx.workspaceId),
        stale,
        {
          mimeType: "image/png",
          width: 640,
          height: 360,
          duration: null,
          bytes: small.length,
          checksum: checksum(small),
        },
        small,
      ),
    ).rejects.toMatchObject({ code: "upload_lease_lost" });
    await db().query(
      "update asset_uploads set lease_expires_at=now()-interval '1 minute' where id=$1",
      [first.value.id],
    );
    expect(await processAssetUploadQueue(1, first.value.id)).toBe(1);
  });

  it("recovers a final written before a worker crash without replacing it or duplicating the asset", async () => {
    const isolated = await fixture("recover immutable final");
    const upload = await beginAssetUpload(isolated.ctx, input());
    await put(upload, small);
    await completeAssetUpload(isolated.ctx, upload.id);
    const lease = randomUUID();
    const row = (
      await db().query(
        "update asset_uploads set status='validating',lease_token=$1,lease_expires_at=now()-interval '1 minute' where id=$2 returning *",
        [lease, upload.id],
      )
    ).rows[0];
    const storage = storageAdmin().storage.from("mediaflock");
    expect(
      (
        await storage.upload(row.final_storage_path, small, {
          contentType: "image/png",
          upsert: false,
        })
      ).error,
    ).toBeNull();
    const version = (await storage.info(row.final_storage_path)).data!.version;
    expect(await processAssetUploadQueue(1, upload.id)).toBe(1);
    const ready = await getAssetUpload(isolated.ctx, upload.id);
    expect(ready.asset!.storage_path).toBe(row.final_storage_path);
    expect((await storage.info(row.final_storage_path)).data!.version).toBe(
      version,
    );
    expect((await assetBytes(isolated.ctx, ready.asset!.id)).checksum).toBe(
      checksum(small),
    );
    expect(
      Number(
        (
          await db().query("select count(*) from assets where id=$1", [
            upload.id,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(await processAssetUploadQueue(1, upload.id)).toBe(0);
  });

  it("rejects an existing final with different bytes without replacing or approving it", async () => {
    const isolated = await fixture("reject changed final");
    const upload = await beginAssetUpload(isolated.ctx, input());
    await put(upload, small);
    await completeAssetUpload(isolated.ctx, upload.id);
    const row = (
      await db().query(
        "select final_storage_path from asset_uploads where id=$1",
        [upload.id],
      )
    ).rows[0];
    const storage = storageAdmin().storage.from("mediaflock");
    await storage.upload(row.final_storage_path, large, {
      contentType: "image/png",
      upsert: false,
    });
    const version = (await storage.info(row.final_storage_path)).data!.version;
    expect(await processAssetUploadQueue(1, upload.id)).toBe(0);
    const failed = await getAssetUpload(isolated.ctx, upload.id);
    expect(failed.status).toBe("failed");
    expect(failed.asset).toBeUndefined();
    expect((await storage.info(row.final_storage_path)).data!.version).toBe(
      version,
    );
    expect(
      Number(
        (
          await db().query(
            "select reserved_bytes from asset_uploads where id=$1",
            [upload.id],
          )
        ).rows[0].reserved_bytes,
      ),
    ).toBe(ORIGINAL_RESERVATION_BYTES);
  });

  it("expires abandoned URLs after their grant, preserves uploaded quarantine and blocks derivative quota bypass", async () => {
    const isolated = await fixture("upload expiry");
    const empty = await beginAssetUpload(isolated.ctx, input()),
      stored = await beginAssetUpload(isolated.ctx, input());
    await put(stored, small);
    await db().query(
      "update asset_uploads set expires_at=now()-interval '1 minute' where id=any($1::uuid[])",
      [[empty.id, stored.id]],
    );
    await processAssetUploadQueue(0);
    const rows = (
      await db().query(
        "select id,status,reserved_bytes from asset_uploads where id=any($1::uuid[])",
        [[empty.id, stored.id]],
      )
    ).rows;
    expect(rows.find((x) => x.id === empty.id)).toMatchObject({
      status: "expired",
      reserved_bytes: "0",
    });
    expect(rows.find((x) => x.id === stored.id)).toMatchObject({
      status: "expired",
      reserved_bytes: String(MAX_ORIGINAL_BYTES),
    });
    const info = await scoped(isolated.ctx, (tx) =>
      tx.query("select storage_path from asset_uploads where id=$1", [
        stored.id,
      ]),
    );
    expect(
      (
        await storageAdmin()
          .storage.from("mediaflock")
          .info(info.rows[0].storage_path)
      ).data,
    ).toBeTruthy();
    const ready = (
      await getAssetUpload(
        a.ctx,
        (
          await db().query(
            "select id from asset_uploads where workspace_id=$1 and status='ready' limit 1",
            [a.ctx.workspaceId],
          )
        ).rows[0].id,
      )
    ).asset!;
    const recipe = { width: 128, height: 128, output: "png" };
    const queue = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        requestDerivative(a.ctx, ready.id, recipe),
      ),
    );
    expect(queue.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect(queue.find((x) => x.status === "rejected")).toMatchObject({
      reason: { code: "upload_pending" },
    });
  });

  it("enforces the daily allowance and the total stored-byte allowance", async () => {
    const daily = await fixture("daily media allowance");
    await db().query(
      `insert into asset_uploads(workspace_id,user_id,request_id,filename,storage_path,declared_mime_type,declared_bytes,expected_checksum,status,reserved_bytes)
      select $1::uuid,$2::uuid,gen_random_uuid(),'expired.png',($1::uuid)::text||'/quota/'||gen_random_uuid()::text,'image/png',1,$3,'expired',0 from generate_series(1,20)`,
      [daily.ctx.workspaceId, daily.ctx.userId, checksum(small)],
    );
    await expect(beginAssetUpload(daily.ctx, input())).rejects.toMatchObject({
      code: "upload_quota",
    });
    const full = await fixture("stored media allowance");
    await db().query(
      `insert into assets(workspace_id,filename,storage_path,mime_type,bytes,checksum,provenance)
      select $1::uuid,'quota-fixture.png',($1::uuid)::text||'/quota-fixture/'||gen_random_uuid()::text,'image/png',52428800,'quota-fixture','fixture' from generate_series(1,20)`,
      [full.ctx.workspaceId],
    );
    try {
      await expect(beginAssetUpload(full.ctx, input())).rejects.toMatchObject({
        code: "media_quota",
      });
      const asset = (
        await db().query(
          "select id from assets where workspace_id=$1 limit 1",
          [full.ctx.workspaceId],
        )
      ).rows[0];
      await expect(
        requestDerivative(full.ctx, asset.id, {
          width: 128,
          height: 128,
          output: "png",
        }),
      ).rejects.toMatchObject({ code: "media_quota" });
    } finally {
      // Only the synthetic metadata inserted above is removed, never media files.
      await db().query(
        "delete from assets where workspace_id=$1 and checksum='quota-fixture' and provenance='fixture'",
        [full.ctx.workspaceId],
      );
    }
  });

  it("enforces one global capacity allowance across parallel workspaces with server-only aggregate access", async () => {
    const workspaces = await Promise.all(
      Array.from({ length: 4 }, (_, i) => fixture("global storage " + i)),
    );
    const permission = (
      await db().query(
        "select has_function_privilege('anon','mf_media_storage_usage()','execute') as anon,has_function_privilege('authenticated','mf_media_storage_usage()','execute') as authenticated,has_function_privilege('mediaflock_app','mf_media_storage_usage()','execute') as server",
      )
    ).rows[0];
    expect(permission).toEqual({
      anon: false,
      authenticated: false,
      server: true,
    });
    const used = Number(
      (await db().query("select mf_media_storage_usage() as used")).rows[0]
        .used,
    );
    const previous = process.env.MEDIAFLOCK_STORAGE_TOTAL_BYTES;
    process.env.MEDIAFLOCK_STORAGE_TOTAL_BYTES = String(
      used + 2 * ORIGINAL_RESERVATION_BYTES,
    );
    try {
      const results = await Promise.allSettled(
        workspaces.map((workspace) => beginAssetUpload(workspace.ctx, input())),
      );
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
      expect(results.filter((x) => x.status === "rejected")).toHaveLength(2);
      for (const result of results.filter((x) => x.status === "rejected"))
        expect(result).toMatchObject({ reason: { code: "storage_capacity" } });
      expect(
        Number(
          (await db().query("select mf_media_storage_usage() as used")).rows[0]
            .used,
        ),
      ).toBe(used + 2 * ORIGINAL_RESERVATION_BYTES);
      const first = results.findIndex((x) => x.status === "fulfilled"),
        entry = results[first];
      if (entry.status !== "fulfilled") throw new Error("Missing reservation");
      const manifest = (
        await db().query(
          "select request_id,declared_bytes,expected_checksum from asset_uploads where id=$1",
          [entry.value.id],
        )
      ).rows[0];
      const retry = await beginAssetUpload(
        workspaces[first].ctx,
        input(small, { requestId: manifest.request_id }),
      );
      expect(retry.id).toBe(entry.value.id);
    } finally {
      if (previous === undefined)
        delete process.env.MEDIAFLOCK_STORAGE_TOTAL_BYTES;
      else process.env.MEDIAFLOCK_STORAGE_TOTAL_BYTES = previous;
    }
  });
});
