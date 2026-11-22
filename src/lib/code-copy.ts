// Shared by the reading view and CodeMirror's rendered code widgets.
export function addCodeCopyButtons(root: HTMLElement) {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  for (const pre of root.querySelectorAll("pre")) {
    if (!pre.querySelector("code") || pre.parentElement?.classList.contains("code-block")) continue;
    const block = document.createElement("div");
    block.className = "code-block";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "복사";
    button.setAttribute("aria-label", "코드 복사");
    const status = document.createElement("span");
    status.className = "sr-only";
    status.setAttribute("role", "status");
    pre.before(block);
    block.append(button, pre, status);
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(timer);
      status.textContent = "";
      button.disabled = true;
      try {
        // Read the current code, including a syntax highlighter's replacement.
        // Only code text is copied, never the fence, language or button label.
        const currentPre = block.querySelector("pre");
        const text = currentPre?.querySelector("code")?.textContent ?? "";
        // remark adds a final display newline; Shiki removes that same newline.
        const code = currentPre?.classList.contains("shiki") ? text : text.replace(/\n$/, "");
        await navigator.clipboard.writeText(code);
        if (controller.signal.aborted) return;
        button.textContent = "복사됨";
        status.textContent = "코드를 복사했습니다.";
      } catch {
        if (controller.signal.aborted) return;
        button.textContent = "복사 실패";
        status.textContent = "코드를 선택해 직접 복사하세요.";
      } finally {
        if (!controller.signal.aborted) {
          button.disabled = false;
          button.title = status.textContent;
          timer = setTimeout(() => {
            button.textContent = "복사";
            button.removeAttribute("title");
            status.textContent = "";
          }, 3000);
        }
      }
    }, { signal: controller.signal });
    cleanups.push(() => {
      clearTimeout(timer);
      const currentPre = block.querySelector("pre");
      if (currentPre) block.replaceWith(currentPre);
    });
  }
  return () => { controller.abort(); cleanups.forEach(cleanup => cleanup()); };
}
