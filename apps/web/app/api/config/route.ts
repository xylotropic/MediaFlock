import { getConfig } from "../../../../../packages/domain/config";
export async function GET() {
  try {
    const c = getConfig();
    return Response.json(
      { data: { mode: c.mode, ready: true, brand: "MediaFlock" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        data: {
          ready: false,
          brand: "MediaFlock",
          message:
            "Run pnpm setup from mediaflock/ to configure local Supabase.",
        },
      },
      { status: 503 },
    );
  }
}
