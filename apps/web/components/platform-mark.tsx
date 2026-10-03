import {
  faYoutube,
  faInstagram,
  faTiktok,
  faFacebook,
  faLinkedin,
  faXTwitter,
} from "@fortawesome/free-brands-svg-icons";

export const socialPlatforms = [
  { name: "YouTube", icon: faYoutube },
  { name: "Instagram", icon: faInstagram },
  { name: "TikTok", icon: faTiktok },
  { name: "Facebook", icon: faFacebook },
  { name: "LinkedIn", icon: faLinkedin },
  { name: "X", icon: faXTwitter },
] as const;

export function PlatformMark({
  icon,
  className,
}: {
  icon: typeof faYoutube;
  className?: string;
}) {
  const [width, height, , , path] = icon.icon;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {(Array.isArray(path) ? path : [path]).map((value, index) => (
        <path d={value} key={index} />
      ))}
    </svg>
  );
}
