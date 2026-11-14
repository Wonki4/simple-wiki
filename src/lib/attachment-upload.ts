export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_SIZE_MESSAGE = "20MB 이하만 업로드할 수 있습니다.";

export interface UploadedAttachment {
  url: string;
  filename: string;
}

const statusMessages: Record<number, string> = {
  401: "로그인이 필요합니다. 다시 로그인한 후 시도하세요.",
  403: "이 스페이스에 파일을 올릴 권한이 없습니다.",
  404: "이 스페이스에 접근할 수 없습니다.",
  413: "업로드 용량 제한을 초과했습니다. 더 작은 파일을 선택하세요.",
  429: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
};

export async function uploadAttachment(spaceKey: string, file: File, signal: AbortSignal): Promise<UploadedAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(ATTACHMENT_SIZE_MESSAGE);
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/attachments`, { method: "POST", body, signal });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 네트워크 연결을 확인하세요.");
  }
  if (!response.ok) {
    throw new Error(statusMessages[response.status] ?? `서버에서 업로드를 처리하지 못했습니다 (HTTP ${response.status}).`);
  }
  const data = await response.json().catch(() => null);
  if (typeof data?.url !== "string" || !data.url) throw new Error("서버에서 첨부파일 주소를 받지 못했습니다.");
  return { url: data.url, filename: typeof data.filename === "string" ? data.filename : file.name };
}
