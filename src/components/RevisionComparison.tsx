import { diffMarkdown } from "@/lib/revision-diff";

type Revision = { version: number; title: string; content: string };

export function RevisionComparison({ from, to }: { from: Revision; to: Revision }) {
  const blocks = diffMarkdown(from.content, to.content);
  return (
    <section className="revision-diff" aria-label="버전 비교 결과">
      <h2 className="section-title">v{from.version} → v{to.version}</h2>
      {from.title !== to.title && <div className="diff-titles">
        <p><span>이전 제목</span> {from.title}</p>
        <p><span>이후 제목</span> {to.title}</p>
      </div>}
      {blocks === null ? <>
        <p className="meta">변경 범위가 커서 두 버전의 원문을 표시합니다.</p>
        {[from, to].map(revision => <details key={revision.version}><summary>v{revision.version} 원문</summary><pre>{revision.content}</pre></details>)}
      </> : !blocks.length ? <p>{from.title === to.title ? "두 버전의 제목과 본문이 같습니다." : "본문 변경이 없습니다."}</p> : <>
        <p className="meta">− 삭제한 줄 · + 추가한 줄</p>
        {blocks.map((block, i) => {
          if (block.kind === "context" && block.lines.length > 6) {
            return <details key={i}><summary>변경 없는 {block.lines.length}줄</summary><pre>{block.lines.join("\n")}</pre></details>;
          }
          const sign = block.kind === "add" ? "+" : block.kind === "remove" ? "−" : " ";
          return <pre key={i} className={`diff-${block.kind}`}>{block.lines.map(line => `${sign} ${line}`).join("\n")}</pre>;
        })}
      </>}
    </section>
  );
}
