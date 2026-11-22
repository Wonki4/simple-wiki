import { expect, test, type Page } from "@playwright/test";
import { fillMarkdown, login, readMarkdown } from "./helpers";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page)!.push(error.message));
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function show(page: Page, markdown: string) {
  await fillMarkdown(page, markdown);
  return page.locator(".live-editor .cm-content");
}
async function unchanged(page: Page, markdown: string) {
  expect(await readMarkdown(page)).toBe(markdown);
}

test("제목 1~6, 닫는 해시와 밑줄 제목은 클릭으로 원문을 드러내며 공백을 보존한다", async ({ page }) => {
  const source = Array.from({ length: 6 }, (_, i) => `${"#".repeat(i + 1)} 제목${i + 1} ###`).join("\n\n") + "\n\n밑줄 제목\n=======\n\n작은 제목\n-------";
  const editor = await show(page, source);
  for (let i = 1; i <= 6; i++) await expect(editor.locator(`.live-h${i}`).first()).toHaveText(`제목${i}`);
  await expect(editor.locator(".live-h1").last()).toHaveText("밑줄 제목");
  await editor.locator(".live-h3").click();
  await expect(editor.locator(".live-h3")).toHaveText("### 제목3 ###");
  await unchanged(page, source);
});

test("중첩 강조·취소선과 인라인 코드의 백틱·공백·줄바꿈을 구분한다", async ({ page }) => {
  const source = "***겹친 강조*** __굵게__ _기울임_ ~짧은 취소~ ~~긴 취소~~\n\n`` code ` x ``\n\n`줄\n바꿈`\n\n`  `\n\n`<b> &amp; [[문서]]`";
  const editor = await show(page, source);
  await expect(editor.locator("em strong, strong em")).toHaveText("겹친 강조");
  await expect(editor.locator("s")).toHaveText(["짧은 취소", "긴 취소"]);
  expect(await editor.locator(".live-inline code").allTextContents()).toEqual(["code ` x", "줄 바꿈", "  ", "<b> &amp; [[문서]]"]);
  await editor.locator(".live-inline code").first().click();
  await expect(editor).toContainText("`` code ` x ``");
  await unchanged(page, source);
});

test("일반·자동·이메일·참조·앵커·첨부 링크의 주소와 레이블을 보존한다", async ({ page }) => {
  const source = '[**일반**](/s/notice "툴팁")\n\n<https://example.com/a?q=1&b=2>\n\nhttps://example.com/plain\n\n<reader@example.com>\n\n[참조][ref] [ref][] [ref]\n\n[절](#section-test) [파일](/api/attachments/test)\n\n- 정의\n\n  [ref]: /s/eng "참조 설명"';
  const editor = await show(page, source);
  for (const [name, href] of [["일반", "/s/notice"], ["https://example.com/a?q=1&b=2", "https://example.com/a?q=1&b=2"], ["https://example.com/plain", "https://example.com/plain"], ["reader@example.com", "mailto:reader@example.com"], ["참조", "/s/eng"], ["절", "#section-test"], ["파일", "/api/attachments/test"]]) {
    await expect(editor.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(editor.getByRole("link", { name: "ref", exact: true })).toHaveCount(2);
  await expect(editor.getByRole("link", { name: "일반", exact: true })).toHaveAttribute("title", "툴팁");
  await unchanged(page, source);
});

test("링크의 일반 클릭은 편집하고 수정 키 클릭은 원래 주소를 연다", async ({ page, context }) => {
  const source = "[스페이스](/s/notice)\n\n마지막";
  const editor = await show(page, source);
  await editor.getByRole("link", { name: "스페이스" }).click();
  await expect(page).toHaveURL(/\/s\/notice\/new$/);
  await expect(editor).toContainText("[스페이스](/s/notice)");
  await page.getByRole("textbox", { name: "제목" }).click();
  const opened = context.waitForEvent("page");
  await editor.getByRole("link", { name: "스페이스" }).click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await expect(tab).toHaveURL(/\/s\/notice$/);
  await tab.close();
  await unchanged(page, source);
});

test("블록·인라인·참조·링크 안의 이미지는 표시와 원문이 일치한다", async ({ page }) => {
  await page.route("**/syntax-audit.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64") }));
  const source = '![블록](/syntax-audit.png "그림 설명")\n\n앞 ![인라인](/syntax-audit.png) 뒤\n\n![참조][img]\n\n[![연결](/syntax-audit.png)](/s/notice)\n\n[img]: /syntax-audit.png';
  const editor = await show(page, source);
  await expect(editor.getByRole("img")).toHaveCount(4);
  await expect.poll(() => editor.getByRole("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth === 1))).toBe(true);
  await expect(editor.getByRole("link")).toHaveAttribute("href", "/s/notice");
  await editor.getByRole("img", { name: "블록" }).click();
  await expect(editor).toContainText('![블록](/syntax-audit.png "그림 설명")');
  await unchanged(page, source);
});

test("중첩 번호 목록·인용·체크박스는 렌더링과 편집 및 실행 취소가 맞는다", async ({ page }) => {
  const source = "3. 첫째\n3. 둘째\n\n   8. 내부 하나\n   8. 내부 둘\n3. 셋째\n\n> 인용\n>> 중첩 인용\n\n- [ ] 미완료\n- [x] 완료\n\n마지막";
  const editor = await show(page, source);
  await expect(editor.locator(".live-bullet")).toHaveText(["3.", "4.", "8.", "9.", "5."]);
  await expect(editor.locator(".live-quote")).toContainText(["인용", "중첩 인용"]);
  await expect(editor.getByRole("checkbox").first()).not.toBeChecked();
  await expect(editor.getByRole("checkbox").last()).toBeChecked();
  await editor.getByRole("checkbox").first().click();
  await expect(editor.getByRole("checkbox").first()).toBeChecked();
  await unchanged(page, source.replace("[ ]", "[x]"));
  await editor.getByText("마지막", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await unchanged(page, source);
});

test("표의 정렬·이스케이프된 파이프·인라인 코드가 올바르게 표시된다", async ({ page }) => {
  const source = "| 왼쪽 | 오른쪽 | 가운데 |\n| :--- | ---: | :---: |\n| a\\|b | `x` | **값** |";
  const editor = await show(page, source);
  await expect(editor.locator("td")).toHaveText(["a|b", "x", "값"]);
  expect(await editor.locator("td").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign))).toEqual(["left", "right", "center"]);
  await editor.locator("td").first().click();
  await expect(editor.locator("table")).toHaveCount(0);
  await unchanged(page, source);
});

test("코드 펜스·들여쓰기·언어 지정·미지원 언어와 코드 안의 문법을 보존한다", async ({ page }) => {
  const snippets = [
    ["js", "const x = '<tag> [[문서]]';"], ["python", "print('한글')"], ["sh", "echo \"$HOME\""],
    ["unknown-language", "**그대로** # [[문서]]"],
  ];
  const source = snippets.map(([lang, code], i) => `${i % 2 ? "~~~~" : "````"}${lang}\n${code}\n${i % 2 ? "~~~~" : "````"}`).join("\n\n") + "\n\n    들여쓴 코드 <script>\n    [[문서]]";
  const editor = await show(page, source);
  await expect(editor.locator("pre")).toHaveCount(5);
  await expect(editor.locator("pre.shiki")).toHaveCount(4);
  expect((await editor.locator("pre code").allTextContents()).map(text => text.trimEnd())).toEqual([...snippets.map(([, code]) => code), "들여쓴 코드 <script>\n[[문서]]"]);
  await expect(editor.locator("pre.shiki").first().locator('span[style*="color"]')).not.toHaveCount(0);
  await expect(editor.locator("pre a, pre script")).toHaveCount(0);
  await editor.locator("pre").first().click();
  await expect(editor).toContainText("````js");
  await unchanged(page, source);
});

test("늦은 코드 강조 응답과 실패는 새 입력을 덮어쓰거나 편집을 막지 않는다", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/spaces/notice/preview", async route => {
    if (route.request().postDataJSON().content.includes("old_code")) { await held; await route.fulfill({ json: { html: '<pre class="shiki"><code>old_code</code></pre>' } }); }
    else await route.fulfill({ status: 503 });
  });
  try {
    const requested = page.waitForRequest(request => request.url().endsWith("/preview"));
    const editor = await show(page, "```js\nold_code\n```");
    await requested;
    await show(page, "```js\nnew_code\n```");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(editor.locator("pre")).toHaveText("new_code");
    await unchanged(page, "```js\nnew_code\n```");
  } finally { release(); }
});

test("각주 순서·반복 참조·돌아가기 링크는 읽기 화면과 동일하게 연결된다", async ({ page }) => {
  const source = "A[^b] B[^a] C[^a]\n\n[^a]: 설명 **a**\n\n[^b]: 설명 b";
  const editor = await show(page, source);
  await expect(editor.locator("a[data-footnote-ref]")).toHaveText(["1", "2", "2"]);
  const response = await page.request.post("/api/spaces/notice/preview", { data: { content: source } });
  const { html } = await response.json();
  expect(await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].every(a => doc.getElementById(a.getAttribute("href")!.slice(1)));
  }, html)).toBe(true);
  await editor.locator("a[data-footnote-ref]").first().click();
  await expect(editor).toContainText("[^b]");
  await unchanged(page, source);
});

test("이스케이프·엔티티·줄바꿈·수평선과 위험한 HTML/URL의 경계를 지킨다", async ({ page }) => {
  const source = "\\*글자\\* &amp; &#65; &lt;script&gt;\n\n줄 끝\\\n다음\n\n---\n\n[위험](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n\\[[문서]] &#91;&#91;문서]]\n\n$$x^2$$\n\n```mermaid\ngraph LR\n A --> B\n```";
  const editor = await show(page, source);
  await expect(editor).toContainText("*글자* & A <script>");
  await expect(editor.locator("hr")).toHaveCount(1);
  await expect(editor.locator('a[href^="javascript:"], script, img[onerror]')).toHaveCount(0);
  await expect(editor.locator("a.wiki-link")).toHaveCount(0);
  await expect(editor).toContainText("$$x^2$$");
  await expect(editor.locator("pre")).toContainText("graph LR");
  await unchanged(page, source);
});

test("인용·목록 속 코드와 표, 표 안 각주도 원문과 연결 관계를 보존한다", async ({ page }) => {
  const source = "> 인용\n>\n> ~~~js\n> const nested = 1;\n> ~~~\n\n- 목록\n\n  | 항목 | 값 |\n  | --- | --- |\n  | 내부 | 표 |\n\n첫 각주[^first]\n\n| 메모 |\n| --- |\n| 각주[^second] |\n\n[^first]: 첫 설명\n\n> [^second]: 두 번째 설명";
  const editor = await show(page, source);
  await expect(editor.locator("pre.shiki")).toContainText("const nested = 1;");
  await expect(editor.locator("table")).toHaveCount(2);
  await expect(editor.locator("a[data-footnote-ref]")).toHaveText(["1", "2"]);
  await expect(editor.locator("table a[data-footnote-ref]")).toHaveAttribute("href", /fn-second$/);
  await editor.locator("pre").click();
  await expect(editor).toContainText("> const nested = 1;");
  await unchanged(page, source);
});
