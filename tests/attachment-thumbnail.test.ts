import sharp from "sharp";
import { expect, it } from "vitest";
import { isPreviewableImage } from "@/lib/attachment-image";
import { createAttachmentThumbnail } from "@/lib/attachment-thumbnail";

function image(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#597483" } });
}

it.each(["png", "jpeg", "gif", "webp"] as const)("%s 이미지를 비율을 유지한 WebP로 축소한다", async format => {
  const source = await image(440, 220).toFormat(format).toBuffer();
  const thumbnail = await createAttachmentThumbnail(source);
  expect(thumbnail).not.toBeNull();
  expect(await sharp(thumbnail!).metadata()).toMatchObject({ format: "webp", width: 176, height: 88 });
});

it("작은 이미지를 확대하지 않는다", async () => {
  const thumbnail = await createAttachmentThumbnail(await image(40, 30).png().toBuffer());
  expect(await sharp(thumbnail!).metadata()).toMatchObject({ width: 40, height: 30 });
});

it("JPEG의 회전 정보를 반영해 세로 사진에 맞는 크기로 축소한다", async () => {
  const source = await image(440, 220).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const thumbnail = await createAttachmentThumbnail(source);
  expect(await sharp(thumbnail!).metadata()).toMatchObject({ width: 64, height: 128 });
});

it("이미지 MIME의 매개변수와 대소문자를 처리하고 SVG와 일반 파일을 제외한다", () => {
  expect(isPreviewableImage("Image/JPEG; charset=binary")).toBe(true);
  expect(isPreviewableImage("image/svg+xml")).toBe(false);
  expect(isPreviewableImage("text/csv")).toBe(false);
});

it("SVG와 손상된 이미지에서 축소본을 만들지 않는다", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const truncatedPng = Buffer.from("89504e470d0a1a0a", "hex");
  await expect(createAttachmentThumbnail(svg)).resolves.toBeNull();
  await expect(createAttachmentThumbnail(truncatedPng)).resolves.toBeNull();
});
