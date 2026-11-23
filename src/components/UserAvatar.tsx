"use client";

import { useEffect, useRef, useState } from "react";
import { profileImageUrl, profileInitial } from "@/lib/profile-image";

// Decorative: the adjacent name or account-menu label supplies the accessible name.
export function UserAvatar({ name, imageUrl, size = "sm" }: {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md";
}) {
  const src = profileImageUrl(imageUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A cached error can finish before React hydrates and installs onError.
    if (src && image.current?.complete && image.current.naturalWidth === 0) setFailedSrc(src);
  }, [src]);
  return (
    <span className={`user-avatar user-avatar--${size}`} aria-hidden="true">
      {src && src !== failedSrc ? (
        <img
          ref={image}
          src={src}
          alt=""
          width={size === "md" ? 28 : 24}
          height={size === "md" ? 28 : 24}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : profileInitial(name)}
    </span>
  );
}
