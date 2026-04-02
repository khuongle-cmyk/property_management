"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ASSISTANT_LANGUAGES, normalizeAssistantLanguage, type SupportedAssistantLanguage } from "@/lib/voice-assistant/languages";

type UiState = "idle" | "recording" | "processing" | "speaking";
type Msg = { role: "user" | "assistant"; text: string; ts: number };

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: unknown) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    SpeechRecognition?: new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: unknown) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
  }
}

type VoiceAssistantWidgetProps = {
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  hideLauncher?: boolean;
};

export default function VoiceAssistantWidget({
  panelOpen: controlledOpen,
  onPanelOpenChange,
  hideLauncher = false,
}: VoiceAssistantWidgetProps = {}) {
  const pathname = usePathname();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    onPanelOpenChange?.(next);
    if (controlledOpen === undefined) setInternalOpen(next);
  };
  const [uiState, setUiState] = useState<UiState>("idle");
  const [language, setLanguage] = useState<SupportedAssistantLanguage>("en");
  const [inputText, setInputText] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Msg[]>([
    { role: "assistant", text: "Voice assistant ready. Phase 1 supports: room availability, bookings, and open invoices.", ts: Date.now() },
  ]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const monitorIntervalRef = useRef<number | null>(null);
  const lastSpeechTsRef = useRef<number>(Date.now());
  const recognitionRef = useRef<{
    stop: () => void;
    start: () => void;
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: unknown) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
  } | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("voice.assistant.language") : null;
    const initial = normalizeAssistantLanguage(saved ?? navigator.language.slice(0, 2));
    setLanguage(initial);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("voice.assistant.language", language);
  }, [language]);

  useEffect(() => {
    return () => {
      if (monitorIntervalRef.current != null) window.clearInterval(monitorIntervalRef.current);
      recognitionRef.current?.stop?.();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const micAvailable = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!navigator.mediaDevices?.getUserMedia;
  }, []);

  const canWebSpeech = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  function pushMessage(role: Msg["role"], text: string) {
    setHistory((h) => [...h, { role, text, ts: Date.now() }]);
  }

  async function sendToAssistant(args: { text?: string; audio?: Blob }) {
    setUiState("processing");
    setError(null);
    try {
      const form = new FormData();
      if (args.text) form.append("text", args.text);
      if (args.audio) form.append("audio", args.audio, "voice.webm");
      form.append("language", language);
      form.append("pagePath", pathname || "");

      const resp = await fetch("/api/voice-assistant/process", {
        method: "POST",
        body: form,
      });
      const json = (await resp.json()) as {
        error?: string;
        transcribedText?: string;
        result?: { responseText?: string };
      };
      if (!resp.ok) {
        setError(json.error ?? "Voice request failed.");
        setUiState("idle");
        return;
      }

      const userText = (json.transcribedText ?? args.text ?? "").trim();
      if (userText) pushMessage("user", userText);
      const assistantText = json.result?.responseText ?? "Done.";
      pushMessage("assistant", assistantText);
      setLiveTranscript("");
      setUiState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice request failed.");
      setUiState("idle");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    recognitionRef.current?.stop?.();
    if (monitorIntervalRef.current != null) {
      window.clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startWebSpeechFallback() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Speech recognition is unavailable on this browser.");
      return;
    }
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = language;
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = "";
    setLiveTranscript("");
    setUiState("recording");

    rec.onresult = (event: unknown) => {
      const e = event as {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      };
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const item = e.results[i];
        const txt = item[0]?.transcript ?? "";
        if (item.isFinal) finalText += ` ${txt}`;
        else interim += ` ${txt}`;
      }
      setLiveTranscript((finalText + interim).trim());
      lastSpeechTsRef.current = Date.now();
    };
    rec.onerror = () => {
      setUiState("idle");
      setError("Web Speech recognition failed.");
    };
    rec.onend = () => {
      const text = (finalText || liveTranscript).trim();
      if (text) void sendToAssistant({ text });
      else setUiState("idle");
    };

    rec.start();
  }

  async function startRecording() {
    setError(null);
    if (!micAvailable) {
      await startWebSpeechFallback();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      setLiveTranscript("");
      setUiState("recording");
      lastSpeechTsRef.current = Date.now();

      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1200) {
          setUiState("idle");
          setError("No speech detected.");
          return;
        }
        void sendToAssistant({ audio: blob });
      };

      mr.start(300);

      const AudioCtx = window.AudioContext || (window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        monitorIntervalRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let total = 0;
          for (let i = 0; i < data.length; i += 1) total += Math.abs(data[i] - 128);
          const avg = total / data.length;
          if (avg > 5) lastSpeechTsRef.current = Date.now();
          if (Date.now() - lastSpeechTsRef.current > 2000) stopRecording();
        }, 200);
      }
    } catch (e) {
      setUiState("idle");
      setError(e instanceof Error ? e.message : "Microphone unavailable.");
      if (canWebSpeech) await startWebSpeechFallback();
    }
  }

  function toggleMic() {
    if (uiState === "recording") stopRecording();
    else void startRecording();
  }

  function onSendText() {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    void sendToAssistant({ text });
  }

  if (hideLauncher && !open) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: "max(24px, calc(env(safe-area-inset-right) + 16px))",
        bottom: "max(24px, calc(env(safe-area-inset-bottom) + 16px))",
        zIndex: 100,
      }}
    >
      <style>{`
        @keyframes va-pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.85; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes va-wave { 0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.6);} 70% { box-shadow: 0 0 0 12px rgba(37,99,235,0);} 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0);} }
      `}</style>

      {open ? (
        <div
          style={{
            width: "min(94vw, 390px)",
            maxHeight: "75vh",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, borderBottom: "1px solid #eee" }}>
            <strong style={{ fontSize: 14 }}>Voice Assistant (Phase 1)</strong>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>{uiState}</span>
            <button type="button" onClick={() => setOpen(false)} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8 }}>
              Close
            </button>
          </div>

          <div style={{ padding: 10, display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#555" }}>Language</span>
              <select value={language} onChange={(e) => setLanguage(normalizeAssistantLanguage(e.target.value))} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}>
                {ASSISTANT_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={toggleMic}
                disabled={uiState === "processing"}
                style={{
                  borderRadius: 999,
                  border: "1px solid #111",
                  background: uiState === "recording" ? "#dc2626" : "#111",
                  color: "#fff",
                  padding: "10px 14px",
                  animation: uiState === "recording" ? "va-pulse 1.2s infinite" : uiState === "speaking" ? "va-wave 1.2s infinite" : "none",
                  cursor: "pointer",
                }}
              >
                {uiState === "recording" ? "Stop recording" : "Start microphone"}
              </button>
              <button
                type="button"
                onClick={() => setHistory((h) => h.slice(0, 1))}
                style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "8px 10px" }}
              >
                Clear
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSendText();
                }}
                placeholder="Text fallback: type your command"
                style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: 10 }}
              />
              <button type="button" onClick={onSendText} disabled={uiState === "processing" || !inputText.trim()} style={{ border: "1px solid #111", background: "#111", color: "#fff", borderRadius: 8, padding: "8px 10px" }}>
                Send
              </button>
            </div>

            {liveTranscript ? (
              <div style={{ fontSize: 12, color: "#334155", background: "#f8fafc", border: "1px solid #e2e8f0", padding: 8, borderRadius: 8 }}>
                Live: {liveTranscript}
              </div>
            ) : null}
            {error ? <div style={{ color: "#b00020", fontSize: 12 }}>{error}</div> : null}
          </div>

          <div style={{ borderTop: "1px solid #eee", maxHeight: 260, overflowY: "auto", padding: 10, display: "grid", gap: 8 }}>
            {history.map((m) => (
              <div
                key={`${m.ts}-${m.role}-${m.text.slice(0, 8)}`}
                style={{
                  alignSelf: m.role === "user" ? "end" : "start",
                  maxWidth: "92%",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: m.role === "user" ? "#eff6ff" : "#f8fafc",
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{m.role === "user" ? "You" : "Assistant"}</div>
                {m.text}
              </div>
            ))}
          </div>
        </div>
      ) : !hideLauncher ? (
        <button
          type="button"
          aria-label="Open voice assistant"
          title="Open voice assistant (microphone)"
          onClick={() => setOpen(true)}
          style={{
            borderRadius: 999,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            width: 56,
            height: 56,
            fontSize: 24,
            cursor: "pointer",
          }}
        >
          🎤
        </button>
      ) : null}
    </div>
  );
}
