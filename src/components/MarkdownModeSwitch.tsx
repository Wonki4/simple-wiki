interface Props {
  editing?: boolean;
  source: boolean;
  onChange: (source: boolean) => void;
  disableFormatted?: boolean;
  disabled?: boolean;
}

export function MarkdownModeSwitch({ editing, source, onChange, disableFormatted, disabled }: Props) {
  return (
    <div className="markdown-mode" role="group" aria-label={editing ? "편집 방식" : "보기 방식"}>
      <button type="button" aria-pressed={!source} disabled={disabled || disableFormatted}
        onClick={() => onChange(false)}>{editing ? "블록" : "본문"}</button>
      <button type="button" aria-pressed={source} disabled={disabled}
        onClick={() => onChange(true)}>원문</button>
    </div>
  );
}
