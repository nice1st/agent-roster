export function roomStatusLabel(status: "draft" | "active" | "ended"): string {
  if (status === "draft") return "준비 중";
  if (status === "active") return "진행 중";
  return "종료됨";
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
