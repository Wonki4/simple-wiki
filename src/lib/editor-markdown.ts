import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";

// Markdown 문자열 전체에 적용하면 코드의 정규식이나 링크 주소까지 바뀐다.
// 텍스트 직렬화기가 쓴 위키링크의 바깥 대괄호만 원래 표기로 돌린다.
export function configureWikiLinkMarkdown(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (options) => {
    const text = options.handlers?.text;
    return {
      ...options,
      handlers: {
        ...options.handlers,
        text(node, parent, state, info) {
          const escaped = text ? text(node, parent, state, info) : state.safe(node.value, info);
          if (!node.value.includes("[[") || state.stack.includes("label")) return escaped;
          return escaped.replace(/\\?\[\\?\[([^\[\]|\r\n]+?(?:\|[^\[\]\r\n]+?)?)\\?\]\\?\]/g, "[[$1]]");
        },
      },
    };
  });
}
