// Toast UI Editor는 package.json "exports"가 타입 경로를 노출하지 않아
// 번들 타입이 해석되지 않는다. 사용하는 표면만 최소 선언한다.
declare module "@toast-ui/editor" {
  interface EditorOptions {
    el: HTMLElement;
    [key: string]: unknown;
  }
  export default class Editor {
    constructor(options: EditorOptions);
    getMarkdown(): string;
    setMarkdown(markdown: string): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    destroy(): void;
  }
}

declare module "@toast-ui/editor/dist/toastui-editor.css";
declare module "@toast-ui/editor/dist/theme/toastui-editor-dark.css";
