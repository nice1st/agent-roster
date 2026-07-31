export function senderColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return `light-dark(hsl(${hash} 60% 38%), hsl(${hash} 65% 72%))`;
}
