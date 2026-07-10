// LLM/API(개인 액세스 토큰)로 편집된 경우에만 뱃지를 보여준다. 사람 편집(web)은 아무것도 렌더하지 않는다.
export function EditSourceBadge({
  source,
  label,
}: {
  source: string;
  label?: string | null;
}) {
  if (source !== "api") return null;
  return (
    <span className="badge-bot" title={label ? `${label}(으)로 편집됨` : "LLM/API로 편집됨"}>
      <span aria-hidden="true">🤖</span>
      {label || "AI 편집"}
    </span>
  );
}
