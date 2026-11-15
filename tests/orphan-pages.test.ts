import { expect, it } from "vitest";
import { linkedPageSlugs } from "@/lib/orphan-pages";

const source = new URL("https://wiki.example/s/eng/start");
const options = {
  spaceKey: "eng",
  destinations: new Map([["옛-이름", "stable"], ["notice-legacy", "local"]]),
  otherSpaces: new Map([["notice", new Map([["guide", "guide"], ["legacy", "legacy"]])]]),
};

it("본문과 같은 규칙으로 이전 제목·별칭·소제목과 다른 스페이스 링크를 해석한다", () => {
  const md = "[[옛 이름#설치|절차]] [[없는 문서]] [[notice:guide#배포]] [[notice:legacy]] [[private:secret]]";
  expect(linkedPageSlugs(md, source, "eng", options)).toEqual(new Set(["stable", "local"]));
  expect(linkedPageSlugs(md, source, "notice", options)).toEqual(new Set(["guide"]));
});

it("실제 문서 주소로 열리는 상대·절대·참조형 링크만 센다", () => {
  const md = [
    "[상대](./한글?mode=read#절) [참조][ref] <https://wiki.example/s/eng/direct> [![도표](/image.png)](/s/eng/chart)",
    "[외부](https://other.example/s/eng/foreign) [오류](/s/eng/%ZZ) [편집](/s/eng/guide/edit)",
    "![이미지](/s/eng/image) [새 문서](/s/eng/new) [설정](/s/eng/settings)",
    "`[[옛 이름]]`", "~~~md\n[예시](/s/eng/code)\n~~~", "[ref]: ../notice/guide/", "[미사용]: /s/eng/unused",
  ].join("\n\n");
  expect(linkedPageSlugs(md, source, "eng", options)).toEqual(new Set(["한글", "direct", "chart"]));
  expect(linkedPageSlugs(md, source, "notice", options)).toEqual(new Set(["guide"]));
});
