import { Link2 } from "lucide-react";
import { PlatformMark, socialPlatforms } from "./platform-mark";

const marks: Record<string, string> = {
  postforme: "/connections/postforme.png",
  chatgpt: "/connections/chatgpt.webp",
  elevenlabs: "/connections/elevenlabs.svg",
  supabase: "/connections/supabase.svg",
};

export function ServiceMark({ service }: { service: string }) {
  return (
    <span className="service-mark" aria-hidden="true">
      {marks[service] ? (
        <img src={marks[service]} alt="" width={28} height={28} />
      ) : (
        <Link2 size={22} />
      )}
    </span>
  );
}

export function SocialAccountMark({ platform }: { platform: string }) {
  const brand = socialPlatforms.find(
    (item) => item.name.toLowerCase() === platform.toLowerCase(),
  );
  return (
    <span className="service-mark" aria-hidden="true">
      {brand ? <PlatformMark icon={brand.icon} /> : <Link2 size={22} />}
    </span>
  );
}
