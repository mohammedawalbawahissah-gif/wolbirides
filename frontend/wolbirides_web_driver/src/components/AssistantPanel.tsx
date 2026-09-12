import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api/client";
import "./AssistantPanel.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AssistantPanel({ greeting }: { greeting: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post<{ reply: string }>("/assistant/chat", {
        message: text,
        history: messages,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "The assistant couldn't respond right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="assistant-root">
      {open && (
        <div className="assistant-panel">
          <div className="assistant-header">
            <span>WolbiRides Assistant</span>
            <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close assistant">
              ✕
            </button>
          </div>

          <div className="assistant-messages" ref={listRef}>
            {messages.length === 0 && <div className="assistant-greeting">{greeting}</div>}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-bubble assistant-bubble-${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="assistant-bubble assistant-bubble-assistant assistant-typing">···</div>}
          </div>

          {error && <div className="assistant-error">{error}</div>}

          <form className="assistant-input-row" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
              ➤
            </button>
          </form>
        </div>
      )}

      <button
        className="assistant-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
