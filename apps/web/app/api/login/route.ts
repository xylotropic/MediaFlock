import { z } from "zod";
import {
  authClient,
  sameOrigin,
  limit,
} from "../../../../../packages/domain/auth";
import {
  DomainError,
  publicError,
} from "../../../../../packages/domain/errors";
import {
  clientAddressHash,
  registrationBody,
} from "../../../../../packages/domain/registration";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await limit("login:" + clientAddressHash(req), 20);
    const data = await registrationBody(
      req,
      z.object({
        email: z.email().max(254),
        password: z.string().min(1).max(200),
      }),
    );
    const { error } = await (await authClient()).auth.signInWithPassword(data);
    if (error)
      throw new DomainError(
        "sign_in_failed",
        "Email or password was not accepted.",
        401,
      );
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: publicError(e) },
      {
        status: e instanceof DomainError ? e.status : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
