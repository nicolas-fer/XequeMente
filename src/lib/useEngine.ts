import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, nextSearchId, type InfoEvent, type PvLine } from "./api";
import { terminalEval } from "./chess-utils";

/** Análise contínua da posição atual enquanto `enabled` for verdadeiro. */
/** `restartKey` muda quando o motor é reiniciado ou recebe um comando, para recomeçar a análise. */
export function useLiveEngine(fen: string, enabled: boolean, multipv: number, restartKey = 0) {
  const [result, setResult] = useState<{ fen: string; lines: PvLine[] }>({ fen, lines: [] });
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const un = listen<InfoEvent>("engine-info", (e) => {
      if (e.payload.id === idRef.current) setResult({ fen: e.payload.fen, lines: e.payload.lines });
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    setResult({ fen, lines: [] });
    if (!enabled || terminalEval(fen)) {
      if (idRef.current) api.engineStop().catch(() => {});
      idRef.current = 0;
      return;
    }
    const id = nextSearchId();
    idRef.current = id;
    setError(null);
    api.engineAnalyze(id, fen, multipv).catch((e) => setError(errorText(e)));
  }, [fen, enabled, multipv, restartKey]);

  const lines = result.fen === fen ? result.lines : [];
  return { lines, error };
}
