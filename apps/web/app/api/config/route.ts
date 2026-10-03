import { getConfig } from "../../../../../packages/domain/config";
import { registrationSettings } from "../../../../../packages/domain/registration";
import { recoveryCodesEnabled } from "../../../../../packages/domain/recovery-codes";
export async function GET() {
  try {
    const c = getConfig();
    return Response.json(
      {
        data: {
          mode: c.mode,
          ready: true,
          brand: "MediaFlock",
          selfSignupEnabled: registrationSettings().enabled,
          authEmailEnabled: registrationSettings().emailDeliveryEnabled,
          recoveryCodesEnabled: recoveryCodesEnabled(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        data: {
          ready: false,
          brand: "MediaFlock",
          message: "MediaFlock could not connect. Please try again.",
        },
      },
      { status: 503 },
    );
  }
}
