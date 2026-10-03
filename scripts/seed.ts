import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { db, closeDb, type Context } from "../packages/db";
import { storageAdmin } from "../packages/domain/auth";
import { getConfig } from "../packages/domain/config";
import {
  createPackage,
  createVariant,
  addAccountRule,
} from "../packages/domain/content";
import {
  requestApproval,
  decideApproval,
  scheduleApproved,
} from "../packages/domain/approvals";
import {
  createExperiment,
  assignVariant,
  saveRecommendation,
  proposeObservation,
} from "../packages/experiments";
import { uploadAsset, runProcess } from "../packages/media";
const W = "11111111-1111-4111-8111-111111111111",
  W2 = "22222222-2222-4222-8222-222222222222";
async function ensureUser(email: string, name: string) {
  const auth = storageAdmin().auth.admin;
  const list = await auth.listUsers({ perPage: 100 });
  if (list.error) throw list.error;
  const existing = list.data.users.find((x) => x.email === email);
  if (existing) return existing.id;
  const created = await auth.createUser({
    email,
    password: "MediaFlock-demo-2026!",
    email_confirm: true,
    user_metadata: { full_name: name, local_fixture: true },
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}
function chunk(type: string, body: Buffer) {
  const head = Buffer.from(type),
    data = Buffer.concat([head, body]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const len = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, data, tail]);
}
function samplePNG() {
  const w = 640,
    h = 400,
    raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const offset = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const circle = (x - 460) ** 2 + (y - 130) ** 2 < 70 ** 2;
      const stripe = x > 80 && x < 350 && y > 240 && y < 290;
      const rgb = circle
        ? [217, 126, 65]
        : stripe
          ? [35, 78, 102]
          : [230, 232, 228];
      raw.set(rgb, offset + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function main() {
  const c = getConfig();
  if (
    c.mode !== "demo" ||
    !["127.0.0.1", "localhost"].includes(new URL(c.supabaseUrl).hostname)
  )
    throw new Error("Seed is local demo-only. No production seed credentials.");
  const userId = await ensureUser("floyd@mediaflock.local", "Floyd Korzan"),
    otherId = await ensureUser(
      "isolation@mediaflock.local",
      "Isolation fixture",
    );
  await db().query(
    "insert into workspaces(id,name,mode) values($1,'Floyd’s workspace','demo'),($2,'Isolation test workspace','demo') on conflict(id) do nothing",
    [W, W2],
  );
  await db().query(
    "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner') on conflict do nothing",
    [W, userId, W2, otherId],
  );
  const existing = (
    await db().query(
      "select count(*)::int as n from social_accounts where workspace_id=$1",
      [W],
    )
  ).rows[0].n;
  if (
    existing &&
    (
      await db().query(
        "select count(*)::int as n from content_packages where workspace_id=$1 and title='Mixed destination example'",
        [W],
      )
    ).rows[0].n
  ) {
    console.log("Demo workspace already seeded. Existing edits preserved.");
    return;
  }
  const ctx: Context = {
    workspaceId: W,
    userId,
    role: "owner",
    kind: "human",
    scopes: ["read", "draft", "request_approval", "schedule", "analytics"],
  };
  const accounts: {
    id: string;
    platform: string;
    format: string;
    handle: string;
  }[] = [];
  for (const [platform, handle, type, format, status, fault] of [
    ["youtube", "@floyd.demo", "channel", "video", "connected", ""],
    ["facebook", "MediaFlock Studio", "page", "image", "connected", ""],
    ["instagram", "@mediaflock.demo", "business", "reel", "connected", ""],
    ["linkedin", "Floyd · demo", "member", "text", "connected", ""],
    ["x", "@mediaflock_demo", "user", "text", "permission_missing", ""],
    ...Array.from({ length: 5 }, (_, i) => [
      "tiktok",
      `@studio.demo.${i + 1}`,
      "creator",
      "video",
      "connected",
      i === 4 ? "partial_failure" : "",
    ]),
  ]) {
    const stored = (
      await db().query(
        "select id from social_accounts where workspace_id=$1 and platform=$2 and handle=$3",
        [W, platform, handle],
      )
    ).rows[0];
    if (stored) {
      accounts.push({ id: stored.id, platform, format, handle });
      continue;
    }
    const id = randomUUID();
    const formats =
      platform === "youtube"
        ? { video: "supported", short: "supported" }
        : platform === "tiktok"
          ? { video: "supported", image: "supported" }
          : platform === "instagram"
            ? { reel: "supported", image: "supported", carousel: "supported" }
            : platform === "facebook"
              ? { image: "supported", video: "supported", text: "supported" }
              : platform === "linkedin"
                ? { text: "supported", image: "supported", video: "supported" }
                : { text: "supported", image: "supported", video: "supported" };
    const capabilities = {
      formats,
      operations: {
        publish:
          status === "permission_missing" ? "permission_missing" : "supported",
        feed: "supported",
        cancel: "supported",
        reschedule: "supported",
      },
      metrics: {
        views: "supported",
        likes: "supported",
        comments: "supported",
        shares: platform === "linkedin" ? "unsupported" : "supported",
      },
      evidence: "local_fixture",
      accountType: type,
    };
    await db().query(
      "insert into social_accounts(id,workspace_id,provider_account_id,platform,handle,display_name,account_type,status,capabilities,permissions,posting_preferences,audience,writing_guidelines,last_synced_at,provenance) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),'simulated')",
      [
        id,
        W,
        "simacct_" + id.slice(0, 8),
        platform,
        handle,
        platform === "tiktok" ? `Studio ${handle.slice(-1)}` : handle,
        type,
        status,
        capabilities,
        ["posts", "feeds"],
        fault ? { demoFault: fault } : {},
        "People interested in practical creative workflows.",
        "Write clearly. State evidence and limitations.",
      ],
    );
    accounts.push({ id, platform, format, handle });
  }
  const isolated = randomUUID();
  if (
    !(
      await db().query("select id from social_accounts where workspace_id=$1", [
        W2,
      ])
    ).rowCount
  )
    await db().query(
      "insert into social_accounts(id,workspace_id,provider_account_id,platform,handle,display_name,account_type,status,capabilities,provenance) values($1,$2,'simacct_isolation','tiktok','@isolated.demo','Isolation fixture','creator','connected',$3,'simulated')",
      [
        isolated,
        W2,
        {
          formats: { video: "supported" },
          operations: { publish: "supported" },
          metrics: { views: "supported" },
        },
      ],
    );
  await addAccountRule(
    ctx,
    accounts[0].id,
    "Use a specific title. Avoid claims of guaranteed results.",
  );
  await addAccountRule(
    ctx,
    accounts.find((x) => x.platform === "linkedin")!.id,
    "No hashtags. Use short paragraphs with a concrete takeaway.",
  );
  await mkdir("artifacts/fixtures", { recursive: true });
  await writeFile("artifacts/fixtures/original-study.png", samplePNG());
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24:duration=6",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=6",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-y",
    "artifacts/fixtures/original-motion.mp4",
  ]);
  const image = await uploadAsset(
    ctx,
    "original-study.png",
    await readFile("artifacts/fixtures/original-study.png"),
    ["sample", "original"],
    "Original local geometry fixture. Color is preserved.",
  );
  const video = await uploadAsset(
    ctx,
    "original-motion.mp4",
    await readFile("artifacts/fixtures/original-motion.mp4"),
    ["sample", "motion"],
    "Original local motion and tone fixture.",
  );
  await db().query(
    "update assets set provenance='fixture' where id=any($1::uuid[])",
    [[image!.id, video!.id]],
  );
  const exp = await createExperiment(ctx, {
    name: "Concrete vs. reflective openings",
    hypothesis:
      "A concrete opening may be associated with higher median 24-hour views on the same TikTok account.",
    changedVariable: "hook",
    primaryMetric: "views",
    horizonHours: 24,
    plannedSamples: 3,
    accounts: [
      {
        accountId: accounts.find((x) => x.platform === "tiktok")!.id,
        formats: ["video"],
      },
    ],
  });
  const account = accounts.find((x) => x.platform === "tiktok")!;
  for (let i = 0; i < 6; i++) {
    const pkg = await createPackage(ctx, {
      title: [
        "One detail that changed the edit",
        "The thumbnail decision",
        "A simpler frame",
        "A lesson from the rough cut",
        "Why the first draft helped",
        "What the final pass changed",
      ][i],
      sourceNotes: "Local historical fixture; no real social post.",
      brief: "Explain a practical creative decision.",
      tags: ["history", "fixture"],
      assetIds: [video!.id],
    });
    const variant = await createVariant(
      ctx,
      {
        packageId: pkg!.id,
        accountId: account.id,
        format: "video",
        payload: {
          hook:
            i < 3
              ? "One detail changed the result."
              : "A lesson from this process.",
          caption:
            "A practical creative observation. This is simulated historical content.",
          title: "",
          description: "",
          cta: "What would you test next?",
          visibility: "public",
          media: [{ assetId: video!.id, derivativeId: null }],
          settings: {},
          utm: "",
        },
      },
      "fixture",
    );
    const approval = await requestApproval(ctx, {
      variantId: variant.id,
      revisionId: variant.current_revision_id,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await decideApproval(ctx, approval!.id, "approved");
    const job = await scheduleApproved(ctx, approval!.id);
    const publishedAt = new Date(
      Date.now() - (10 - i) * 86400000,
    ).toISOString();
    const providerId = "demo_history_" + i;
    const platformId = "sim_history_" + i;
    await db().query(
      "update publish_jobs set state='published',scheduling_owner='provider',provider_job_id=$1,platform_post_id=$2,published_at=$3,receipt=$4,updated_at=$3 where id=$5",
      [
        providerId,
        platformId,
        publishedAt,
        {
          providerJobId: providerId,
          state: "published",
          platformPostId: platformId,
          authoritative: true,
          raw: { provenance: "simulated", source: "seeded_history_fixture" },
        },
        job!.id,
      ],
    );
    await assignVariant(
      ctx,
      exp!.id,
      variant.id,
      variant.current_revision_id,
      i < 3 ? "A" : "B",
    );
    for (const horizon of [1, 24, 72])
      for (const metric of ["views", "likes", "comments", "shares"]) {
        const base = [1800, 2200, 2000, 1400, 1650, 1750][i],
          value =
            metric === "views"
              ? Math.round(
                  base * (horizon === 1 ? 0.2 : horizon === 72 ? 1.2 : 1),
                )
              : metric === "likes"
                ? 90 + i * 12
                : metric === "comments"
                  ? 8 + i
                  : 20 + i * 2;
        await db().query(
          "insert into metric_snapshots(workspace_id,account_id,job_id,platform_post_id,metric,definition,value,unit,scope,availability,horizon_hours,observed_at,provenance,raw) values($1,$2,$3,$4,$5,$6,$7,'count','lifetime','available',$8,$9,'simulated',$10)",
          [
            W,
            account.id,
            job!.id,
            platformId,
            metric,
            metric === "views"
              ? "Lifetime video views; platform-specific view threshold. Compare within account and format only."
              : "Lifetime " + metric,
            value,
            horizon,
            new Date(
              new Date(publishedAt).getTime() + horizon * 3600000,
            ).toISOString(),
            {
              source: "seeded_example_analytics",
              provenance: "simulated",
              historicalFixture: true,
            },
          ],
        );
      }
  }
  const insight = await saveRecommendation(ctx, exp!.id);
  await proposeObservation(
    ctx,
    account.id,
    insight!.id,
    "Repeat a concrete opening with new source material before adopting it as a writing rule.",
  );
  const pending = await createPackage(ctx, {
    title: "A field note from the creative process",
    sourceNotes: "A local source for the next content cycle.",
    brief:
      "Show one concrete step in the process and invite a thoughtful response.",
    tags: ["next-cycle"],
    assetIds: [image!.id],
  });
  const variant = await createVariant(
    ctx,
    {
      packageId: pending!.id,
      accountId: accounts.find((x) => x.platform === "facebook")!.id,
      format: "image",
      payload: {
        hook: "A clearer frame starts with one decision.",
        caption:
          "A small visual study from the process. What catches your eye first?",
        cta: "Share the detail you would keep.",
        visibility: "public",
        media: [{ assetId: image!.id, derivativeId: null }],
        title: "",
        description: "",
        settings: {},
        utm: "",
      },
    },
    "fixture",
  );
  await requestApproval(ctx, {
    variantId: variant.id,
    revisionId: variant.current_revision_id,
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const failedPkg = await createPackage(ctx, {
    title: "Mixed destination example",
    sourceNotes: "Isolated failure example.",
    brief: "Show per-destination outcomes.",
    tags: ["fixture"],
    assetIds: [],
  });
  for (const a of [accounts[3], accounts[accounts.length - 1]]) {
    const v = await createVariant(
      ctx,
      {
        packageId: failedPkg!.id,
        accountId: a.id,
        format: a.format,
        payload: {
          hook: "One destination, one receipt.",
          caption: "Simulated outcome for this account.",
          cta: "",
          visibility: "public",
          media: [],
          title: "",
          description: "",
          settings: {},
          utm: "",
        },
      },
      "fixture",
    );
    const ap = await requestApproval(ctx, {
      variantId: v.id,
      revisionId: v.current_revision_id,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await decideApproval(ctx, ap!.id, "approved");
    const j = await scheduleApproved(ctx, ap!.id);
    await db().query(
      "update publish_jobs set state=$1,provider_job_id=$2,platform_post_id=$3,published_at=$4,receipt=$5,error=$6 where id=$7",
      [
        a.platform === "linkedin" ? "published" : "failed",
        "demo_mixed_" + a.id.slice(0, 6),
        a.platform === "linkedin" ? "sim_mixed_linkedin" : null,
        a.platform === "linkedin" ? new Date().toISOString() : null,
        { provenance: "simulated", source: "seeded_mixed_outcome" },
        a.platform === "linkedin"
          ? null
          : {
              classification: "fixture_rejection",
              message:
                "Simulated destination rejection. Other destinations are independent.",
            },
        j!.id,
      ],
    );
    if (a.platform === "linkedin")
      await db().query(
        "insert into metric_snapshots(workspace_id,account_id,job_id,platform_post_id,metric,definition,value,unit,scope,availability,horizon_hours,observed_at,provenance,raw) values($1,$2,$3,'sim_mixed_linkedin','shares','Lifetime shares',null,'count','lifetime','unsupported',24,now(),'simulated',$4)",
        [W, a.id, j!.id, { source: "seeded_missing_metric_fixture" }],
      );
  }
  await writeFile(
    "artifacts/fixtures/manifest.json",
    JSON.stringify(
      {
        provenance: "original_local_fixtures",
        image: { id: image!.id, checksum: image!.checksum },
        video: { id: video!.id, checksum: video!.checksum },
      },
      null,
      2,
    ),
  );
  console.log(
    "Seeded local Auth, two isolated workspaces, ten accounts including five TikTok fixtures, original media, history, approvals, mixed outcomes, missing metrics and one evaluated experiment.",
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
