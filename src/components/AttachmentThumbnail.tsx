"use client";

import { useState } from "react";
import { WikiIcon } from "./WikiIcon";

export function AttachmentThumbnail({ id, filename }: { id: string; filename: string }) {
  const [failed, setFailed] = useState(false);
  const original = `/api/attachments/${encodeURIComponent(id)}`;
  const label = `${filename} 원본 보기`;
  return (
    <a className="attachment-visual" href={original} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
      {failed ? <WikiIcon name="file" /> : (
        <img src={`${original}?preview=thumbnail`} width={88} height={64} alt=""
          loading="lazy" decoding="async" onError={() => setFailed(true)}
          ref={image => { if (image?.complete && !image.naturalWidth) setFailed(true); }} />
      )}
    </a>
  );
}
