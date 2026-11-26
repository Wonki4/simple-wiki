const inlineImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isPreviewableImage(mime: string): boolean {
  return inlineImageTypes.has(mime.split(";", 1)[0].trim().toLowerCase());
}
