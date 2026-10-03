import { handleApi } from "../../../../../../packages/domain/api-router";
export const runtime = "nodejs";
async function handler(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleApi(req, (await context.params).path);
}
export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as DELETE,
  handler as PUT,
};
