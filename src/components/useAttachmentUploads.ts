import { useEffect, useRef, useState } from "react";
import { uploadAttachment, type UploadedAttachment } from "@/lib/attachment-upload";

type OnUploaded = (attachment: UploadedAttachment) => void;

interface FailedUpload {
  id: number;
  file: File;
  reason: string;
  onRetry: OnUploaded;
  onDismiss?: () => void;
}

export function useAttachmentUploads(spaceKey: string) {
  const [failures, setFailures] = useState<FailedUpload[]>([]);
  const [pending, setPending] = useState(0);
  const [retrying, setRetrying] = useState<number | null>(null);
  const nextId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const session = new AbortController();
    controller.current = session;
    return () => session.abort();
  }, []);

  async function attempt(file: File, onFailure: (reason: string) => void) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    setPending(count => count + 1);
    try {
      const result = await uploadAttachment(spaceKey, file, signal);
      if (!signal.aborted) return result;
    } catch (error) {
      if (!signal.aborted) onFailure(error instanceof Error ? error.message : "파일을 올리지 못했습니다.");
    } finally {
      if (!signal.aborted) setPending(count => count - 1);
    }
  }

  async function upload(file: File, onRetry: OnUploaded, onDismiss?: () => void) {
    return attempt(file, reason => {
      const failure = { id: nextId.current++, file, reason, onRetry, onDismiss };
      setFailures(current => [...current, failure]);
    });
  }

  function remove(id: number) {
    setFailures(current => current.filter(item => item.id !== id));
  }

  async function retry(failure: FailedUpload) {
    setRetrying(failure.id);
    const result = await attempt(failure.file, reason => {
      setFailures(current => current.map(item => item.id === failure.id ? { ...item, reason } : item));
    });
    setRetrying(null);
    if (result) {
      remove(failure.id);
      failure.onRetry(result);
    }
  }

  function dismiss(failure: FailedUpload) {
    remove(failure.id);
    failure.onDismiss?.();
  }

  return { upload, retry, dismiss, failures, retrying, uploadPending: pending > 0 };
}
