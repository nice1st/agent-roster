import { toChannelNotification } from "../client-core/channel";

export function toChannelText(event: unknown): string | null {
  const notification = toChannelNotification(event);
  if (notification === null) return null;
  const attrs = Object.entries(notification.params.meta)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  return `<channel ${attrs}>\n${notification.params.content}\n</channel>`;
}
