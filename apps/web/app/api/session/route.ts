import {
  requestContext,
  authClient,
  csrfToken,
} from "../../../../../packages/domain/auth";
import { getConfig } from "../../../../../packages/domain/config";
import { db } from "../../../../../packages/db";
import {
  DomainError,
  publicError,
} from "../../../../../packages/domain/errors";
export async function GET(req: Request) {
  try {
    const ctx = await requestContext(req);
    const {
      data: { user },
    } = await (await authClient()).auth.getUser();
    const workspaces = (
      await db().query(
        "select w.id,w.name,w.timezone,w.mode,m.role from workspaces w join memberships m on m.workspace_id=w.id where m.user_id=$1 and w.mode=$2",
        [ctx.userId, getConfig().mode],
      )
    ).rows;
    return Response.json(
      {
        data: {
          user: {
            id: ctx.userId,
            name: user?.user_metadata?.full_name || user?.email,
            email: user?.email,
          },
          workspaceId: ctx.workspaceId,
          role: ctx.role,
          workspaces,
          csrf: csrfToken(ctx.userId),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof DomainError && e.code === "authentication_required")
      return Response.json(
        { data: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      { error: publicError(e) },
      { status: e instanceof DomainError ? e.status : 500 },
    );
  }
}
