import { expect, it } from "vitest";
import { attachmentIdsInMarkdown } from "@/lib/attachment-usage";

const pageUrl = new URL("https://wiki.example/s/eng/guide");

it("본문에서 실제로 렌더링되는 이미지·링크·참조형 링크만 수집하고 같은 파일을 한 번만 센다", () => {
  const content = [
    "[![화면][캡처]](/api/attachments/pdf#page=2)", "![다시](/api/attachments/png)", "[문서][설명]",
    "", "[캡처]: /api/attachments/png", "[설명]: /api/attachments/txt?view=1",
    "[미사용]: /api/attachments/unused",
    "", "`[예시](/api/attachments/inline)`", "```md", "![예시](/api/attachments/fenced)", "```",
    "", '<img src="/api/attachments/raw">', "단순 텍스트 /api/attachments/plain",
  ].join("\n");
  expect(attachmentIdsInMarkdown(content, pageUrl)).toEqual(new Set(["pdf", "png", "txt"]));
});

it("이 위키의 절대·상대 주소를 해석하고 다른 호스트와 첨부 경로 밖의 주소는 무시한다", () => {
  const content = [
    "<https://wiki.example/api/attachments/absolute>",
    "[상대](../../api/attachments/relative)",
    "[인코딩](/api/attachments/%61lpha/)",
    "[외부](https://other.example/api/attachments/foreign)",
    "[외부](//other.example/api/attachments/also-foreign)",
    "[다른 주소](/api/attachments/one/subpath)",
    "[쿼리](/else?q=/api/attachments/unused)", "[깨진 주소](/api/attachments/%ZZ)",
  ].join("\n");
  expect(attachmentIdsInMarkdown(content, pageUrl)).toEqual(new Set(["absolute", "relative", "alpha"]));
});
