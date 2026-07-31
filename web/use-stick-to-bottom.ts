import { useEffect, useRef } from "react";

export function useStickToBottom(dep: unknown) {
  const logRef = useRef<HTMLUListElement | null>(null);
  const stickRef = useRef(true);

  function onScroll() {
    const el = logRef.current;
    if (el === null) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 목록이 갱신될 때 바닥 고정 여부를 반영한다.
  useEffect(() => {
    const el = logRef.current;
    if (el !== null && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  return { logRef, onScroll };
}
