import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Send, Square } from "lucide-react";
import { api, errorText, type ChatMessageParam } from "../lib/api";
import coach from "../assets/brand/coach.png";

/** Avatar do treinador + balão de fala branco. */
export function CoachBubble({ children, typing }: { children?: ReactNode; typing?: boolean }) {
  return (
    <div className="coach-row">
      <img className="coach-avatar" src={coach} alt="Treinador" />
      <div className="speech-bubble">{typing ? <span className="typing"><i /><i /><i /></span> : children}</div>
    </div>
  );
}

export interface TutorAsk {
  id: number;
  text: string;
  display: string;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  display: string;
  apiContent: string;
  failed?: boolean;
  streaming?: boolean;
}

interface Props {
  buildContext: () => string;
  ask: TutorAsk | null;
  providerLabel: string;
  configured: boolean;
}

const QUICK = [
  { label: "Explique a posição", text: "Explique esta posição: quem está melhor, por quê, e quais são os planos para cada lado." },
  { label: "Me dê uma dica", text: "Me dê uma dica para o próximo lance sem entregar a resposta." },
  { label: "Por que o último lance?", text: "Comente o último lance jogado: foi bom ou ruim? O que ele mudou na posição e o que eu deveria ter considerado?" },
  { label: "Ameaças", text: "Quais são as ameaças imediatas na posição (minhas e do adversário)? Tem alguma tática no ar?" },
];

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (head) {
      flushPara();
      flushList();
      blocks.push(<h4 key={blocks.length}>{inline(head[1])}</h4>);
    } else if (bullet || num) {
      flushPara();
      const ordered = !!num;
      const l = list as { ordered: boolean; items: string[] } | null;
      if (!l || l.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list!.items.push((bullet ?? num)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="md">{blocks}</div>;
}

export function TutorChat({ buildContext, ask, providerLabel, configured }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAsk = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(text: string, display?: string) {
    const question = text.trim();
    if (!question || busyId) return;
    setError(null);
    const context = buildContext();
    const apiContent = `[CONTEXTO]\n${context}\n[/CONTEXTO]\n\n${question}`;
    const requestId = crypto.randomUUID();
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", display: display ?? question, apiContent };
    const botMsg: ChatMsg = { id: requestId, role: "assistant", display: "", apiContent: "", streaming: true };

    const history: ChatMessageParam[] = messagesRef.current
      .filter((m) => !m.failed && !m.streaming && m.apiContent)
      .map((m) => ({ role: m.role, content: m.apiContent }));
    history.push({ role: "user", content: apiContent });

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setBusyId(requestId);

    const unlisten = await listen<{ requestId: string; text: string }>("tutor-delta", (e) => {
      if (e.payload.requestId !== requestId) return;
      setMessages((prev) => prev.map((m) => (m.id === requestId ? { ...m, display: m.display + e.payload.text } : m)));
    });
    try {
      await api.tutorChat(requestId, history);
      setMessages((prev) =>
        prev.map((m) => (m.id === requestId ? { ...m, streaming: false, apiContent: m.display || "(sem resposta)" } : m)),
      );
    } catch (e) {
      setError(errorText(e));
      setMessages((prev) =>
        prev.map((m) => (m.id === requestId || m.id === userMsg.id ? { ...m, streaming: false, failed: true } : m)),
      );
    } finally {
      unlisten();
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (ask && ask.id !== lastAsk.current) {
      lastAsk.current = ask.id;
      send(ask.text, ask.display);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  return (
    <div className="tutor">
      <div className="chat-scroll" ref={scrollRef}>
        {!configured && (
          <CoachBubble>Para conversar comigo, configure a chave de API do Claude ou do Gemini na aba Configurações.</CoachBubble>
        )}
        {configured && messages.length === 0 && (
          <CoachBubble>
            Olá! Sou o seu treinador. Pergunte qualquer coisa sobre a posição do tabuleiro: eu recebo os lances e a análise do
            Stockfish junto com a sua pergunta.
          </CoachBubble>
        )}
        {messages.map((m) =>
          m.role === "assistant" ? (
            <div key={m.id} className={m.failed ? "failed" : ""}>
              <CoachBubble typing={m.streaming && !m.display}>{m.display ? <Markdown text={m.display} /> : null}</CoachBubble>
            </div>
          ) : (
            <div key={m.id} className={`user-msg ${m.failed ? "failed" : ""}`}>
              {m.display}
            </div>
          ),
        )}
        {error && <div className="error">{error}</div>}
      </div>
      <div className="chat-bottom">
        <div className="quick">
          {QUICK.map((q) => (
            <button key={q.label} className="chip" disabled={!!busyId || !configured} onClick={() => send(q.text, q.label)}>
              {q.label}
            </button>
          ))}
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            const t = input;
            setInput("");
            send(t);
          }}
        >
          <textarea
            value={input}
            placeholder="Pergunte ao treinador…"
            rows={2}
            disabled={!configured}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const t = input;
                setInput("");
                send(t);
              }
            }}
          />
          {busyId ? (
            <button type="button" className="btn-2 send" onClick={() => api.tutorCancel(busyId)} title="Parar">
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="btn-primary send" disabled={!input.trim() || !configured} title="Enviar (Enter)">
              <Send size={20} strokeWidth={2.6} />
            </button>
          )}
        </form>
        <div className="chat-meta">
          <span>{providerLabel}</span>
          {messages.length > 0 && !busyId && (
            <button className="link small" onClick={() => setMessages([])}>
              Nova conversa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
