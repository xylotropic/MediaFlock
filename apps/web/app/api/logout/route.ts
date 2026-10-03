import {
  requestContext,
  authClient,
} from "../../../../../packages/domain/auth";
import {
  DomainError,
  publicError,
} from "../../../../../packages/domain/errors";
export async function POST(req: Request) {
  try {
    await requestContext(req);
    await (await authClient()).auth.signOut();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: publicError(e) },
      { status: e instanceof DomainError ? e.status : 500 },
    );
  }
}
