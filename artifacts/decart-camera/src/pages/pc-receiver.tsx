import { useState, useEffect, useRef, useCallback } from "react";
import {
  Monitor, Settings, Maximize2, Minimize2, Loader2, Camera,
  PhoneOff, Image, Video, Sparkles, Play, Volume2, Upload,
  Trash2, CheckCircle, AlertCircle, RefreshCw, ArrowLeft, Eye, EyeOff
} from "lucide-react";
import { Link } from "wouter";

const API_BASE = "/api";

export default function PcReceiver() {
  const [roomId, setRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Listo para recibir");
  const [hasStream, setHasStream] = useState(false);

  // Config state
  const [showConfig, setShowConfig] = useState(true);
  const [decartPrompt, setDecartPrompt] = useState("Anime style portrait");
  const [decartApiKey, setDecartApiKey] = useState("");
  const [decartEndpoint, setDecartEndpoint] = useState("wss://api3.decart.ai/v1/stream");
  const [decartStyleImage, setDecartStyleImage] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // Decart state
  const [isDecartConnected, setIsDecartConnected] = useState(false);
  const [showFiltered, setShowFiltered] = useState(true);
  const [decartStatus, setDecartStatus] = useState("");
  const [rtcState, setRtcState] = useState("");
  const [isDecartActive, setIsDecartActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const filteredCanvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const decartWsRef = useRef<WebSocket | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const styleFileInputRef = useRef<HTMLInputElement>(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Load Decart config from server
  useEffect(() => {
    fetch(`${API_BASE}/decart/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.prompt) setDecartPrompt(data.prompt);
        if (data.apiKey && data.apiKey !== "***") setDecartApiKey(data.apiKey);
        if (data.endpoint) setDecartEndpoint(data.endpoint);
      })
      .catch(() => {});
    fetch(`${API_BASE}/decart/style-image`)
      .then((res) => res.json())
      .then((data) => {
        if (data.styleImage) setDecartStyleImage(data.styleImage);
      })
      .catch(() => {});
  }, []);

  // Capture frame from video
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  // Connect to Decart AI
  const connectToDecart = useCallback((apiKey: string, endpoint: string, prompt: string, styleImage: string) => {
    if (!apiKey) {
      setDecartStatus("❌ Sin API key — guarda la configuración primero");
      return;
    }
    if (decartWsRef.current?.readyState === WebSocket.OPEN) {
      decartWsRef.current.close();
    }

    try {
      setDecartStatus("Conectando a Decart AI...");
      setIsDecartActive(true);
      const wsUrl = `${endpoint}?model=lucy-2.1`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsDecartConnected(true);
        setDecartStatus("Enviando configuración...");
        const config: Record<string, unknown> = {
          type: "config",
          apiKey,
          enhance: true,
          mirror: "auto",
        };
        if (styleImage) {
          config.styleImage = styleImage;
        } else if (prompt) {
          config.prompt = prompt;
        }
        ws.send(JSON.stringify(config));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "frame") {
            lastFrameRef.current = data.frame;
            isProcessingRef.current = false;
            setDecartStatus("✅ Filtro aplicado");
          } else if (data.type === "error") {
            setDecartStatus(`❌ Error: ${data.message || "Desconocido"}`);
            isProcessingRef.current = false;
          } else if (data.type === "config_ack") {
            setDecartStatus("✅ Configurado — procesando frames en tiempo real...");
          }
        } catch {
          // binary data
        }
      };

      ws.onerror = () => {
        setIsDecartConnected(false);
        setDecartStatus("❌ Error de conexión con Decart AI");
      };

      ws.onclose = () => {
        setIsDecartConnected(false);
        setDecartStatus("Desconectado de Decart AI");
      };

      decartWsRef.current = ws;
    } catch {
      setDecartStatus("❌ Error iniciando conexión Decart");
    }
  }, []);

  // Frame processing loop
  const startFrameProcessing = useCallback(() => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = setInterval(() => {
      const ws = decartWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (isProcessingRef.current) return;
      const frame = captureFrame();
      if (!frame) return;
      isProcessingRef.current = true;
      ws.send(JSON.stringify({ type: "frame", frame }));
    }, 200);
  }, [captureFrame]);

  // Render loop for filtered output
  const startRenderLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const render = () => {
      const filteredCanvas = filteredCanvasRef.current;
      if (filteredCanvas && lastFrameRef.current) {
        const ctx = filteredCanvas.getContext("2d");
        if (ctx) {
          const img = document.createElement("img");
          img.onload = () => {
            const w = filteredCanvas.width;
            const h = filteredCanvas.height;
            const iw = img.width;
            const ih = img.height;
            const scale = Math.min(w / iw, h / ih);
            const sw = iw * scale;
            const sh = ih * scale;
            const x = (w - sw) / 2;
            const y = (h - sh) / 2;
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, x, y, sw, sh);
          };
          img.src = lastFrameRef.current;
        }
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
  }, []);

  // Save config and optionally re-apply filter
  const saveConfig = async (reapply = false) => {
    await fetch(`${API_BASE}/decart/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: decartApiKey, endpoint: decartEndpoint, prompt: decartPrompt }),
    });
    await fetch(`${API_BASE}/decart/style-image`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleImage: decartStyleImage }),
    });
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 3000);
    if (reapply && hasStream) {
      connectToDecart(decartApiKey, decartEndpoint, decartPrompt, decartStyleImage);
      startFrameProcessing();
      startRenderLoop();
    }
  };

  // Start receiving from mobile
  const startReceiving = async () => {
    setIsConnecting(true);
    setError("");
    setStatus("Esperando conexión del móvil...");

    try {
      let currentRoomId = roomId;
      if (!currentRoomId) {
        const res = await fetch(`${API_BASE}/signaling/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "PC Receiver" }),
        });
        const data = await res.json();
        currentRoomId = data.id;
        setRoomId(currentRoomId);
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        setRtcState(state);
        if (state === "failed" || state === "disconnected") {
          setIsConnected(false);
          setHasStream(false);
          setStatus("Conexión perdida");
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          setError("ICE connection failed — intenta recargar");
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (event.track.kind === "video" && videoRef.current) {
          videoRef.current.srcObject = stream;
          setHasStream(true);
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("Recibiendo video del móvil");
          // Auto-apply filter when stream arrives
          if (decartApiKey) {
            connectToDecart(decartApiKey, decartEndpoint, decartPrompt, decartStyleImage);
            startFrameProcessing();
            startRenderLoop();
          }
        }
        if (event.track.kind === "audio" && audioRef.current) {
          audioRef.current.srcObject = stream;
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) iceCandidatesRef.current.push(event.candidate);
      };

      const pollOffer = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/offer`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.success && data.type === "offer" && data.sdp) {
            setStatus("Oferta recibida, creando respuesta...");
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await new Promise((r) => setTimeout(r, 2000));
            await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "answer", sdp: pc.localDescription?.sdp }),
            });
            for (const candidate of iceCandidatesRef.current) {
              await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/ice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  candidate: candidate.candidate,
                  sdpMid: candidate.sdpMid,
                  sdpMLineIndex: candidate.sdpMLineIndex,
                  source: "pc",
                }),
              });
            }
            setStatus("Respuesta enviada, estableciendo conexión...");
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          }
        } catch { /* ignore */ }
      };

      const pollMobileIce = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/ice/mobile`);
          if (!res.ok) return;
          const data = await res.json();
          for (const candidate of data.candidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      };

      pollingRef.current = setInterval(pollOffer, 2000);
      icePollingRef.current = setInterval(pollMobileIce, 3000);
      pollOffer();
    } catch (err: unknown) {
      setError((err as Error).message || "Error iniciando recepción");
      setIsConnecting(false);
      setStatus("Error");
    }
  };

  const stopReceiving = () => {
    pcRef.current?.close(); pcRef.current = null;
    decartWsRef.current?.close(); decartWsRef.current = null;
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    isProcessingRef.current = false;
    lastFrameRef.current = null;
    setIsConnected(false); setIsConnecting(false); setHasStream(false);
    setIsDecartConnected(false); setIsDecartActive(false);
    setRoomId(""); setStatus("Listo para recibir"); setDecartStatus(""); setRtcState("");
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  };

  const reapplyFilter = () => {
    if (!decartApiKey) { setDecartStatus("❌ Configura tu API key primero"); return; }
    if (!hasStream) { setDecartStatus("❌ No hay video activo aún"); return; }
    connectToDecart(decartApiKey, decartEndpoint, decartPrompt, decartStyleImage);
    startFrameProcessing();
    startRenderLoop();
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      stopReceiving();
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-black flex flex-col">
      <canvas ref={captureCanvasRef} className="hidden" />
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
                Decart IA
              </span>
            )}
            {isConnected && (
              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                En vivo
              </span>
            )}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              title="Configuración"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Config Panel */}
      {showConfig && !isFullscreen && (
        <div className="bg-gray-900 border-b border-gray-800 p-4 space-y-4">
          <p className="text-white font-semibold text-sm flex items-center gap-2">
            <Settings className="w-4 h-4 text-purple-400" />
            Configuración de Decart AI
          </p>

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
                placeholder="Pega aquí tu API key de Decart AI"
                className="w-full bg-gray-800 text-white px-3 py-2.5 pr-10 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-600">Obtén tu key en <span className="text-purple-400">decart.ai</span></p>
          </div>

          {/* API URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              URL del Endpoint (si cambia)
            </label>
            <input
              type="text"
              value={decartEndpoint}
              onChange={(e) => setDecartEndpoint(e.target.value)}
              placeholder="wss://api3.decart.ai/v1/stream"
              className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm font-mono"
            />
            <p className="text-xs text-gray-600">Actualiza si Decart AI cambia su URL</p>
          </div>

          {/* Filter image */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Image className="w-3.5 h-3.5" />
              Foto de Filtro (estilo visual)
            </label>
            {decartStyleImage ? (
              <div className="flex items-start gap-3 bg-gray-800 rounded-lg p-3">
                <img
                  src={decartStyleImage}
                  alt="Filtro"
                  className="w-20 h-20 object-cover rounded-lg border-2 border-purple-500"
                />
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-green-400 font-medium flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Imagen de filtro cargada
                  </p>
                  <p className="text-xs text-gray-500">
                    El video del móvil se transformará para parecerse a esta imagen en tiempo real
                  </p>
                  <div className="flex gap-2">
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
                className="w-full border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors text-gray-500 hover:text-purple-400"
              >
                <Upload className="w-6 h-6" />
                <span className="text-sm">Subir foto de filtro</span>
                <span className="text-xs">PNG, JPG · Esta foto define el estilo visual del filtro</span>
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

          {/* Prompt fallback */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Prompt de filtro (si no usas foto)
            </label>
            <input
              type="text"
              value={decartPrompt}
              onChange={(e) => setDecartPrompt(e.target.value)}
              placeholder="Ej: Anime style portrait, Oil painting..."
              className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
            />
          </div>

          {/* Save config button */}
          <button
            onClick={() => saveConfig(isDecartActive)}
            className={`w-full font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm ${
              configSaved
                ? "bg-green-600 text-white"
                : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {configSaved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Configuración guardada
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Guardar configuración
              </>
            )}
          </button>

          {/* Room ID display */}
          {roomId && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-1">
              <p className="text-xs text-gray-400">ID de Sala (cópialo en el celular)</p>
              <p className="text-lg font-mono text-white select-all tracking-widest">{roomId}</p>
            </div>
          )}
        </div>
      )}

      {/* Video Area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-black relative overflow-hidden"
        style={{ minHeight: "300px" }}
      >
        {hasStream && isDecartActive && showFiltered ? (
          <canvas ref={filteredCanvasRef} className="w-full h-full" />
        ) : (
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />
        )}

        {!hasStream && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center max-w-sm px-4">
              <Monitor className="w-16 h-16 text-gray-700 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-1">Esperando video del móvil</p>
              <p className="text-gray-600 text-sm">
                Toca "Iniciar PC" abajo, luego conecta el celular con el ID de sala
              </p>
              {roomId && (
                <div className="mt-4 bg-gray-800 px-4 py-3 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Sala ID — cópialo en el celular:</p>
                  <p className="text-xl font-mono text-white select-all tracking-widest">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto mb-3" />
              <p className="text-white">{status}</p>
              {roomId && (
                <div className="mt-4 bg-gray-800 px-4 py-3 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Sala ID para el celular:</p>
                  <p className="text-2xl font-mono text-white select-all tracking-widest">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Controls overlay on active stream */}
        {hasStream && (
          <div className="absolute bottom-4 right-4 flex gap-2">
            {isDecartActive && (
              <button
                onClick={() => setShowFiltered(!showFiltered)}
                className="bg-purple-600/80 backdrop-blur text-white px-3 py-2 rounded-lg hover:bg-purple-500/80 transition-colors flex items-center gap-2 text-sm"
                title="Alternar vista original / filtrada"
              >
                {showFiltered ? <><Video className="w-4 h-4" /> Original</> : <><Sparkles className="w-4 h-4" /> Filtrado</>}
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="bg-gray-800/80 backdrop-blur text-white p-2 rounded-lg hover:bg-gray-700/80 transition-colors"
              title="Pantalla completa (para SplitCam)"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
          </div>
        )}

        {/* Status overlay */}
        {hasStream && (
          <div className="absolute top-3 left-3">
            <div className="bg-black/70 backdrop-blur text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${isDecartConnected ? "bg-purple-400" : "bg-green-400"}`} />
              <span>{isDecartActive && isDecartConnected ? "Filtro IA activo" : "Video directo"}</span>
              <Volume2 className="w-3 h-3 text-gray-400 ml-1" />
              {decartStatus && <span className="text-gray-400">· {decartStatus}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Footer Action Buttons */}
      {!isFullscreen && (
        <div className="bg-gray-900 border-t border-gray-800 p-4 space-y-3">
          {/* Step-by-step action buttons */}
          <div className="grid grid-cols-1 gap-2">

            {/* PASO 1: Start/Stop receiving */}
            {!isConnected && !isConnecting ? (
              <button
                onClick={startReceiving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-base"
              >
                <Monitor className="w-5 h-5" />
                📡 PASO 1 — Iniciar PC (crea sala para el celular)
              </button>
            ) : (
              <button
                onClick={stopReceiving}
                className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-base"
              >
                <PhoneOff className="w-5 h-5" />
                {isConnecting ? "⏳ Esperando celular... (Cancelar)" : "⛔ Detener todo"}
              </button>
            )}

            {/* PASO 2: Apply filter (always shown when connected) */}
            {isConnected && (
              <button
                onClick={reapplyFilter}
                className={`w-full font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-base ${
                  isDecartConnected
                    ? "bg-purple-700 hover:bg-purple-800 text-white"
                    : "bg-purple-600 hover:bg-purple-700 text-white animate-pulse"
                }`}
              >
                {isDecartConnected ? (
                  <><RefreshCw className="w-5 h-5" /> 🔄 Re-aplicar filtro con nueva configuración</>
                ) : (
                  <><Sparkles className="w-5 h-5" /> ✨ PASO 2 — Aplicar filtro Decart AI</>
                )}
              </button>
            )}

            {/* PASO 3: Fullscreen for SplitCam */}
            {isConnected && (
              <button
                onClick={toggleFullscreen}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <Maximize2 className="w-4 h-4" />
                🖥️ PASO 3 — Pantalla completa (para capturar con SplitCam)
              </button>
            )}
          </div>

          {/* Status messages */}
          {decartStatus && (
            <div className={`text-xs text-center px-3 py-2 rounded-lg ${
              decartStatus.startsWith("❌") ? "bg-red-900/40 text-red-300" :
              decartStatus.startsWith("✅") ? "bg-green-900/40 text-green-300" :
              "bg-gray-800 text-gray-400"
            }`}>
              {decartStatus}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-900/40 text-red-300 p-3 rounded-lg text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* SplitCam hint */}
          {isDecartConnected && (
            <p className="text-center text-xs text-gray-600">
              💡 Usa pantalla completa y captura esta ventana con SplitCam → úsala como cámara en WhatsApp
            </p>
          )}
        </div>
      )}
    </div>
  );
}
