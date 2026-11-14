// Textarea values use LF even when the stored Markdown uses CRLF or CR.
// Splice only the edited range so the surrounding source keeps its original endings.
export function applySourceEdit(source: string, value: string): string {
  if (!source.includes("\r")) return value;
  const previous = source.replace(/\r\n?/g, "\n");
  if (previous === value) return source;

  let start = 0;
  let end = previous.length;
  let nextEnd = value.length;
  while (start < end && start < nextEnd && previous[start] === value[start]) start++;
  while (end > start && nextEnd > start && previous[end - 1] === value[nextEnd - 1]) {
    end--;
    nextEnd--;
  }

  let rawIndex = 0;
  let normalizedIndex = 0;
  let nearbyEnding: string | undefined;
  function advanceTo(target: number) {
    while (normalizedIndex < target) {
      const char = source[rawIndex++];
      if (char === "\r" && source[rawIndex] === "\n") { rawIndex++; nearbyEnding = "\r\n"; }
      else if (char === "\r" || char === "\n") nearbyEnding = char;
      normalizedIndex++;
    }
    return rawIndex;
  }
  const rawStart = advanceTo(start);
  const ending = nearbyEnding ?? source.match(/\r\n|[\r\n]/)?.[0] ?? "\n";
  const rawEnd = advanceTo(end);
  return source.slice(0, rawStart) + value.slice(start, nextEnd).replace(/\n/g, ending) + source.slice(rawEnd);
}
