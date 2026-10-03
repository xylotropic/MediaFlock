import spec from "../../../../../docs/openapi.json";
export async function GET() {
  return Response.json(spec);
}
