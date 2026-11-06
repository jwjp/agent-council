export function linkKind(raw: string): "web" | "file" | "blocked" {
  if (!raw || /[\u0000-\u001f]/.test(raw)) return "blocked";
  if (/^https?:\/\//i.test(raw)) return "web";
  if (/^[a-z]:[\\/]/i.test(raw) || /^file:\/\/\//i.test(raw)) return "file";
  if (/^[^:?#]+\.[a-z\d]+:\d+(?::\d+)?(?:#.*)?$/i.test(raw)) return "file";
  if (
    /^[a-z][a-z\d+.-]*:/i.test(raw) ||
    raw.startsWith("//") ||
    raw.startsWith("#")
  )
    return "blocked";
  return "file";
}
