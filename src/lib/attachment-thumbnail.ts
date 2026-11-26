import sharp from "sharp";
import { isPreviewableImage } from "./attachment-image";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hasRasterHeader(input: Buffer) {
  const header = input.toString("latin1", 0, 6);
  return input.subarray(0, 8).equals(pngSignature)
    || (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff)
    || header === "GIF87a" || header === "GIF89a"
    || (header.startsWith("RIFF") && input.toString("latin1", 8, 12) === "WEBP");
}

export async function createAttachmentThumbnail(input: Buffer): Promise<Buffer | null> {
  // 업로드 당시 지정한 MIME과 별도로, 지원하는 래스터 바이트만 디코더에 전달한다.
  if (!hasRasterHeader(input)) return null;
  try {
    const image = sharp(input, { limitInputPixels: 64_000_000 });
    const { format } = await image.metadata();
    if (!isPreviewableImage(`image/${format}`)) return null;
    return await image
      .autoOrient()
      .resize({ width: 176, height: 128, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
  } catch {
    return null;
  }
}
