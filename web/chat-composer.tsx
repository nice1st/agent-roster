import { useState } from "react";

export interface ChatComposerProps {
  inputId: string;
  disabled: boolean;
  onSend(message: string): void;
}

export function ChatComposer({ inputId, disabled, onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState("");

  function send() {
    if (draft.trim() === "") return;
    onSend(draft);
    setDraft("");
  }

  return (
    <div className="chat-input-bar">
      <input
        id={inputId}
        aria-label="메시지 입력"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 한글 IME 조합 중 Enter는 keydown이 두 번 발화한다 — 조합 확정분은 무시해야 중복 발신이 없다.
          if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
        }}
        disabled={disabled}
        placeholder="메시지 입력"
      />
      <button type="button" onClick={send} disabled={disabled}>
        전송
      </button>
    </div>
  );
}
