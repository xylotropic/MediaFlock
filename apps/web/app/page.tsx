import { redirect } from "next/navigation";
import { Landing } from "../components/landing";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  const query = await searchParams;
  if (query.screen) redirect("/app?screen=" + encodeURIComponent(query.screen));
  return <Landing />;
}
