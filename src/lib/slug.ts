export function slugify(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function sectionId(title: string) {
  return `section-${slugify(title) || "heading"}`;
}
