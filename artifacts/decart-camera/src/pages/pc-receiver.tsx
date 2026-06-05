import { useState, useEffect, useRef, useCallback } from "react";
import {
  Monitor, Settings, Maximize2, Minimize2, Loader2, Camera,
  PhoneOff, Image, Sparkles, CheckCircle, AlertCircle, ArrowLeft,
  Eye, EyeOff, Upload, Trash2, RefreshCw, Video, Play
} from "lucide-react";
import { Link } from "wouter";
import { createDecartClient, models } from "@decartai/sdk";
import type { RealTimeClient } from "@decartai/sdk";

const API_BASE = "/api";
const LUCY_MODEL = models.realtime("lucy-2.1");

export default function PcReceiver() {
  // WebRTC state
  const [roomId, setRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rtcStatus, setRtcStatus] = useState("Listo para recibir");
  const [rtcError, setRtcError] = useState("");

  // Decart AI state
  const [decartStatus, setDecartStatus] = useState("");
  const [decartState, setDecartState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [showFiltered, setShowFiltered] = useState(true);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);

  // Config state
  const [showConfig, setShowConfig] = useState(true);
  const [decartApiKey, setDecartApiKey] = useState("");
  const [decartPrompt, setDecartPrompt] = useState("Anime style portrait");
  const [decartStyleImage, setDecartStyleImage] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // UI
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refs
  const rawVideoRef = useRef<HTMLVideoElement>(null);
  const filteredVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const decartClientRef = useRef<RealTimeClient | null>(null);
  const mobileStreamRef = useRef<MediaStream | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);

  // Load saved config on mount
  useEffect(() => {
    fetch(`${API_BASE}/decart/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.prompt) setDecartPrompt(d.prompt);
        if (d.apiKey && d.apiKey !== "***") setDecartApiKey(d.apiKey);
      })
      .catch(() => {});
    fetch(`${API_BASE}/decart/style-image`)
      .then((r) => r.json())
      .then((d) => { if (d.styleImage) setDecartStyleImage(d.styleImage); })
      .catch(() => {});
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      stopAll();
    };
  }, []);

  // Save config to server
  const saveConfig = async () => {
    await fetch(`${API_BASE}/decart/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: decartApiKey, prompt: decartPrompt }),
    });
    await fetch(`${API_BASE}/decart/style-image`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleImage: decartStyleImage }),
    });
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 3000);
  };

  // Connect Decart SDK with the mobile stream
  const connectDecart = useCallback(async (stream: MediaStream) => {
    if (!decartApiKey) {
      setDecartStatus("❌ Configura tu API key y guarda primero");
      setDecartState("error");
      return;
    }
    // Disconnect previous session if any
    if (decartClientRef.current) {
      decartClientRef.current.disconnect();
      decartClientRef.current = null;
    }
    setDecartState("connecting");
    setDecartStatus("Conectando a Decart AI (Lucy 2.1)...");

    try {
      const client = createDecartClient({ apiKey: decartApiKey });

      const realtimeClient = await client.realtime.connect(stream, {
        model: LUCY_MODEL,
        mirror: "auto",
        onRemoteStream: (editedStream) => {
          setHasRemoteStream(true);
          setDecartState("connected");
          setDecartStatus("✅ Filtro aplicado en tiempo real");
          if (filteredVideoRef.current) {
            filteredVideoRef.current.srcObject = editedStream;
          }
        },
        onConnectionChange: (state) => {
          setDecartStatus(`Estado: ${state}`);
          if (state === "disconnected" || state === "failed") {
            setDecartState("idle");
            setHasRemoteStream(false);
          }
        },
        initialState: decartStyleImage
          ? { image: decartStyleImage }
          : decartPrompt
          ? { prompt: { text: decartPrompt, enhance: true } }
          : undefined,
      });

      decartClientRef.current = realtimeClient;
    } catch (err: unknown) {
      const msg = (err as Error).message || "Error al conectar con Decart AI";
      setDecartStatus(`❌ ${msg}`);
      setDecartState("error");
    }
  }, [decartApiKey, decartPrompt, decartStyleImage]);

  // Apply / update filter on existing connection
  const applyFilter = useCallback(async () => {
    const client = decartClientRef.current;
    if (!client || !client.isConnected()) {
      if (mobileStreamRef.current) {
        await connectDecart(mobileStreamRef.current);
      } else {
        setDecartStatus("❌ No hay stream activo aún");
      }
      return;
    }
    try {
      setDecartStatus("Actualizando filtro...");
      await client.set({
        prompt: decartStyleImage ? undefined : decartPrompt,
        enhance: true,
        image: decartStyleImage || undefined,
      });
      setDecartStatus("✅ Filtro actualizado");
    } catch (err: unknown) {
      setDecartStatus(`❌ ${(err as Error).message}`);
    }
  }, [decartPrompt, decartStyleImage, connectDecart]);

  // Start receiving WebRTC stream from mobile
  const startReceiving = async () => {
    setIsConnecting(true);
    setRtcError("");
    setRtcStatus("Creando sala...");
    iceCandidatesRef.current = [];

    try {
      const res = await fetch(`${API_BASE}/signaling/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "PC Receiver" }),
      });
      const data = await res.json();
      const currentRoomId: string = data.id;
      setRoomId(currentRoomId);
      setRtcStatus("Sala creada — ingresa el ID en el móvil");

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          setIsConnected(true);
          setIsConnecting(false);
          setRtcStatus("Recibiendo video del móvil");
        } else if (state === "failed" || state === "disconnected") {
          setIsConnected(false);
          setRtcStatus("Conexión perdida");
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (event.track.kind === "video" && rawVideoRef.current) {
          rawVideoRef.current.srcObject = stream;
          mobileStreamRef.current = stream;
          setIsConnected(true);
          setIsConnecting(false);
          setRtcStatus("Recibiendo video del móvil");
          // Auto-connect Decart AI
          if (decartApiKey) {
            connectDecart(stream);
          } else {
            setDecartStatus("⚠️ Ingresa tu API key y toca 'Aplicar filtro' para activar IA");
          }
        }
        if (event.track.kind === "audio" && audioRef.current) {
          audioRef.current.srcObject = stream;
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) iceCandidatesRef.current.push(event.candidate);
      };

      // Poll for mobile offer
      const pollOffer = async () => {
        try {
          const r = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/offer`);
          if (!r.ok) return;
          const d = await r.json();
          if (d.success && d.type === "offer" && d.sdp) {
            setRtcStatus("Oferta recibida — conectando...");
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: d.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "answer", sdp: pc.localDescription?.sdp }),
            });
            for (const c of iceCandidatesRef.current) {
              await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/ice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, source: "pc" }),
              });
            }
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          }
        } catch { /* ignore */ }
      };

      const pollMobileIce = async () => {
        try {
          const r = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/ice/mobile`);
          if (!r.ok) return;
          const d = await r.json();
          for (const c of d.candidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      };

      pollingRef.current = setInterval(pollOffer, 2000);
      icePollingRef.current = setInterval(pollMobileIce, 3000);
      pollOffer();
    } catch (err: unknown) {
      setRtcError((err as Error).message || "Error al iniciar");
      setIsConnecting(false);
      setRtcStatus("Error");
    }
  };

  const stopAll = () => {
    decartClientRef.current?.disconnect();
    decartClientRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    mobileStreamRef.current = null;
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setIsConnected(false);
    setIsConnecting(false);
    setHasRemoteStream(false);
    setDecartState("idle");
    setDecartStatus("");
    setRoomId("");
    setRtcStatus("Listo para recibir");
    setRtcError("");
    if (rawVideoRef.current) rawVideoRef.current.srcObject = null;
    if (filteredVideoRef.current) filteredVideoRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  };

  const isDecartConnected = decartState === "connected";
  const isDecartBusy = decartState === "connecting";
  const hasStream = isConnected;

  return (
    <div className="min-h-screen w-full bg-black flex flex-col">
      <audio ref={audioRef} autoPlay className="hidden" />

      {/* Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Link href="/">
              <button className="text-gray-500 hover:text-gray-300 transition-colors mr-1">
                <ArrowLeft className="w-4 h-4" />
              </button>
            </Link>
            <Monitor className="w-5 h-5 text-blue-400" />
            <h1 className="text-base font-bold text-white">Panel PC</h1>
          </div>
          <div className="flex items-center gap-2">
            {isDecartConnected && (
              <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                Decart AI
              </span>
            )}
            {hasStream && (
              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                En vivo
              </span>
            )}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Config Panel */}
      {showConfig && !isFullscreen && (
        <div className="bg-gray-900 border-b border-gray-800 p-4 space-y-4 overflow-y-auto max-h-[55vh]">
          <p className="text-white font-semibold text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Configuración de Decart AI · Lucy 2.1
          </p>

          {/* SDK info */}
          <div className="bg-purple-950/40 border border-purple-800/40 rounded-lg p-3 text-xs text-purple-300 space-y-1">
            <p className="font-semibold text-purple-200">✅ SDK oficial @decartai/sdk</p>
            <p>Resolución: {LUCY_MODEL.width}×{LUCY_MODEL.height} · FPS: {typeof LUCY_MODEL.fps === "object" ? LUCY_MODEL.fps.ideal : LUCY_MODEL.fps}</p>
            <p>Protocolo: WebRTC (LiveKit) → Decart AI → video filtrado en tiempo real</p>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              API Key de Decart AI *
            </label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={decartApiKey}
                onChange={(e) => setDecartApiKey(e.target.value)}
                placeholder="Pega aquí tu API key de decart.ai"
                className="w-full bg-gray-800 text-white px-3 py-2.5 pr-10 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-600">
              Obtén tu key en <span className="text-purple-400">decart.ai</span> · 2 créditos por segundo
            </p>
          </div>

          {/* Filter image */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Image className="w-3.5 h-3.5" />
              Foto de Filtro (estilo visual) — recomendado
            </label>
            {decartStyleImage ? (
              <div className="flex items-start gap-3 bg-gray-800 rounded-lg p-3">
                <img
                  src={decartStyleImage}
                  alt="Filtro"
                  className="w-20 h-20 object-cover rounded-lg border-2 border-purple-500 flex-shrink-0"
                />
                <div className="flex-1 space-y-2 min-w-0">
                  <p className="text-xs text-green-400 font-medium flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Imagen cargada
                  </p>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    El video del móvil se transformará para parecerse a esta foto en tiempo real usando la API de Decart AI
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => styleFileInputRef.current?.click()}
                      className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600 flex items-center gap-1"
                    >
                      <Upload className="w-3 h-3" />
                      Cambiar foto
                    </button>
                    <button
                      onClick={() => {
                        setDecartStyleImage("");
                        if (styleFileInputRef.current) styleFileInputRef.current.value = "";
                      }}
                      className="text-xs bg-red-900/60 text-red-300 px-2 py-1 rounded hover:bg-red-900 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => styleFileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-lg p-5 flex flex-col items-center gap-2 transition-colors text-gray-500 hover:text-purple-400"
              >
                <Upload className="w-6 h-6" />
                <span className="text-sm font-medium">Subir foto de filtro</span>
                <span className="text-xs text-center">PNG, JPG · Esta foto define el estilo visual del filtro AI</span>
              </button>
            )}
            <input
              ref={styleFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setDecartStyleImage(reader.result as string);
                reader.readAsDataURL(file);
              }}
            />
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Prompt (si no usas foto de filtro)
            </label>
            <input
              type="text"
              value={decartPrompt}
              onChange={(e) => setDecartPrompt(e.target.value)}
              placeholder="Ej: Anime style portrait, Oil painting, Cartoon..."
              className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
            />
            <p className="text-xs text-gray-600">
              Puedes cambiar el prompt en tiempo real con el filtro activo
            </p>
          </div>

          {/* Save button */}
          <button
            onClick={saveConfig}
            className={`w-full font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm ${
              configSaved ? "bg-green-600 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            <CheckCircle className="w-4 h-4" />
            {configSaved ? "✅ Configuración guardada" : "Guardar configuración"}
          </button>

          {/* Room ID display */}
          {roomId && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-1">
              <p className="text-xs text-gray-400">ID de Sala — escríbelo en el celular:</p>
              <p className="text-2xl font-mono text-white select-all tracking-widest text-center py-1">{roomId}</p>
            </div>
          )}
        </div>
      )}

      {/* Video Area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-black relative overflow-hidden"
        style={{ minHeight: "280px" }}
      >
        {/* Raw video (always rendered, shown when no filtered stream or toggled) */}
        <video
          ref={rawVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain absolute inset-0 ${hasRemoteStream && showFiltered ? "opacity-0" : "opacity-100"}`}
        />
        {/* Filtered video from Decart AI */}
        <video
          ref={filteredVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain absolute inset-0 ${hasRemoteStream && showFiltered ? "opacity-100" : "opacity-0"}`}
        />

        {/* Empty state */}
        {!hasStream && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center max-w-sm px-4">
              <Monitor className="w-16 h-16 text-gray-700 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-1">Esperando video del móvil</p>
              <p className="text-gray-600 text-sm">
                Toca "Iniciar PC" abajo, copia el ID de sala y pégalo en el celular
              </p>
              {roomId && (
                <div className="mt-4 bg-gray-800 px-4 py-3 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Sala ID:</p>
                  <p className="text-2xl font-mono text-white select-all tracking-widest">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connecting state */}
        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto mb-3" />
              <p className="text-white mb-1">{rtcStatus}</p>
              {roomId && (
                <div className="mt-4 bg-gray-800 px-6 py-3 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Sala ID para el celular:</p>
                  <p className="text-3xl font-mono text-white select-all tracking-widest">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Decart connecting overlay */}
        {isDecartBusy && hasStream && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
            <div className="text-center bg-gray-900/90 rounded-xl p-6">
              <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-2 animate-pulse" />
              <p className="text-white text-sm">{decartStatus}</p>
              <p className="text-gray-500 text-xs mt-1">Conectando SDK de Decart AI...</p>
            </div>
          </div>
        )}

        {/* Controls overlay (active stream) */}
        {hasStream && !isDecartBusy && (
          <div className="absolute bottom-3 right-3 flex gap-2 z-10">
            {hasRemoteStream && (
              <button
                onClick={() => setShowFiltered(!showFiltered)}
                className="bg-purple-600/80 backdrop-blur text-white px-3 py-1.5 rounded-lg hover:bg-purple-500/80 transition-colors flex items-center gap-1.5 text-xs"
              >
                {showFiltered ? <><Video className="w-3.5 h-3.5" /> Original</> : <><Sparkles className="w-3.5 h-3.5" /> Filtrado</>}
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="bg-gray-800/80 backdrop-blur text-white p-1.5 rounded-lg hover:bg-gray-700/80 transition-colors"
              title="Pantalla completa para SplitCam"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        )}

        {/* Top-left status */}
        {hasStream && (
          <div className="absolute top-3 left-3 z-10">
            <div className="bg-black/70 backdrop-blur text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${isDecartConnected ? "bg-purple-400" : "bg-green-400"}`} />
              {isDecartConnected && showFiltered ? "Filtro IA activo" : "Video directo"}
              {decartStatus && !isDecartBusy && (
                <span className="text-gray-400 ml-1 hidden sm:inline">· {decartStatus}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Action Buttons */}
      {!isFullscreen && (
        <div className="bg-gray-900 border-t border-gray-800 p-4 space-y-2">

          {/* STEP 1 */}
          {!hasStream && !isConnecting ? (
            <button
              onClick={startReceiving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Monitor className="w-5 h-5" />
              📡 PASO 1 — Iniciar PC (genera sala para el celular)
            </button>
          ) : hasStream ? (
            <button
              onClick={stopAll}
              className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <PhoneOff className="w-5 h-5" />
              ⛔ Detener todo
            </button>
          ) : (
            <button
              onClick={stopAll}
              className="w-full bg-yellow-700 hover:bg-yellow-800 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <PhoneOff className="w-5 h-5" />
              ⏳ Esperando celular... (Cancelar)
            </button>
          )}

          {/* STEP 2 — Apply / re-apply filter */}
          {hasStream && (
            <button
              onClick={applyFilter}
              disabled={isDecartBusy}
              className={`w-full font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                isDecartConnected
                  ? "bg-purple-700 hover:bg-purple-800 text-white"
                  : "bg-purple-600 hover:bg-purple-700 text-white"
              }`}
            >
              {isDecartBusy ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Conectando Decart AI...</>
              ) : isDecartConnected ? (
                <><RefreshCw className="w-5 h-5" /> 🔄 Re-aplicar filtro con config actual</>
              ) : (
                <><Sparkles className="w-5 h-5" /> ✨ PASO 2 — Aplicar filtro Decart AI</>
              )}
            </button>
          )}

          {/* STEP 3 — Fullscreen for SplitCam */}
          {hasStream && (
            <button
              onClick={toggleFullscreen}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Maximize2 className="w-4 h-4" />
              🖥️ PASO 3 — Pantalla completa (captura con SplitCam → WhatsApp)
            </button>
          )}

          {/* Status */}
          {decartStatus && (
            <div className={`text-xs text-center px-3 py-2 rounded-lg ${
              decartStatus.startsWith("❌") ? "bg-red-900/40 text-red-300" :
              decartStatus.startsWith("✅") ? "bg-green-900/40 text-green-300" :
              decartStatus.startsWith("⚠️") ? "bg-yellow-900/40 text-yellow-300" :
              "bg-gray-800 text-gray-400"
            }`}>
              {decartStatus}
            </div>
          )}

          {rtcError && (
            <div className="flex items-start gap-2 bg-red-900/40 text-red-300 p-3 rounded-lg text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {rtcError}
            </div>
          )}

          {isDecartConnected && (
            <p className="text-center text-xs text-gray-600">
              💡 Pantalla completa → captura con SplitCam → úsala como cámara virtual en WhatsApp
            </p>
          )}
        </div>
      )}
    </div>
  );
}
