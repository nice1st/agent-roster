export function createSseParser(): (chunk: string) => unknown[] {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const events: unknown[] = [];
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const rawFrame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawFrame.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            events.push(JSON.parse(line.slice("data: ".length)));
          } catch {
            // 손상된 프레임은 버린다
          }
        }
      }
      idx = buffer.indexOf("\n\n");
    }
    return events;
  };
}
