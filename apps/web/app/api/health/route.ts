import { getConfig } from "../../../../../packages/domain/config";
import { db } from "../../../../../packages/db";
export async function GET() {
  try {
    const c = getConfig();
    await db().query("select 1");
    return Response.json(
      {
        status: "ready",
        mode: c.mode,
        brand: "MediaFlock",
        database: "connected",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        status: "unavailable",
        message: "MediaFlock is temporarily unavailable. Please try again.",
      },
      { status: 503 },
    );
  }
}
