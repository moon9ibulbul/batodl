export function extractImgHttps(html: string): string[] {
  const m = html.match(/const\s+imgHttps\s*=\s*(\[[\s\S]*?\])\s*;/i);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    if (Array.isArray(arr)) {
      return arr.filter((x) => typeof x === "string" && x.trim()).map((s) => s.trim());
    }
  } catch {}
  return [];
}