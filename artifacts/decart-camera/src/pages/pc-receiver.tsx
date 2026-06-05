import { useState, useEffect, useRef, useCallback } from "react";
import { Monitor, Settings, Maximize2, Minimize2, Loader2, Camera, PhoneOff, Image, Video, Sparkles, Play, Volume2 } from "lucide-react";

const API_BASE = "/api";

export default function PcReceiver() {
  const [roomId, setRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Listo para recibir");
  const [hasStream, setHasStream] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [decartPrompt, setDecartPrompt] = useState("Anime style portrait");
  const [decartApiKey, setDecartApiKey] = useState("");
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
        if (data.apiKey && data.apiKey !== "***") {
          setDecartApiKey(data.apiKey);
        }
      })
      .catch(() => {});
  }, []);

  // Capture frame from video and convert to base64
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

  // Connect to Decart AI via WebSocket
  const connectToDecart = useCallback(() => {
    if (!decartApiKey) {
      setDecartStatus("No hay API key configurada");
      return;
    }
    if (decartWsRef.current?.readyState === WebSocket.OPEN) {
      setDecartStatus("Ya conectado a Decart AI");
      return;
    }
    if (decartWsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      setDecartStatus("Conectando a Decart AI...");
      setIsDecartActive(true);
      const ws = new WebSocket(`wss://api3.decart.ai/v1/stream?model=lucy-2.1`);

      ws.onopen = () => {
        setIsDecartConnected(true);
        setDecartStatus("Enviando configuración...");
        ws.send(JSON.stringify({
          type: "config",
          apiKey: decartApiKey,
          prompt: decartPrompt,
          enhance: true,
          mirror: "auto",
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "frame") {
            lastFrameRef.current = data.frame;
            isProcessingRef.current = false;
            setDecartStatus("Filtro aplicado");
          } else if (data.type === "error") {
            setDecartStatus(`Error: ${data.message || "Desconocido"}`);
            isProcessingRef.current = false;
          } else if (data.type === "config_ack") {
            setDecartStatus("Configurado, procesando frames...");
          }
        } catch (e) {
          // Could be binary data, handle as needed
        }
      };

      ws.onerror = (e) => {
        setIsDecartConnected(false);
        setDecartStatus("Error de conexión Decart AI");
      };

      ws.onclose = () => {
        setIsDecartConnected(false);
        setDecartStatus("Desconectado de Decart AI");
      };

      decartWsRef.current = ws;
    } catch (err) {
      setDecartStatus("Error iniciando conexión Decart");
      console.error("Decart connection error:", err);
    }
  }, [decartApiKey, decartPrompt]);

  // Frame processing loop
  const startFrameProcessing = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
    }

    frameIntervalRef.current = setInterval(() => {
      const ws = decartWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (isProcessingRef.current) return;

      const frame = captureFrame();
      if (!frame) return;

      isProcessingRef.current = true;
      ws.send(JSON.stringify({
        type: "frame",
        frame: frame,
      }));
    }, 200); // 5 FPS
  }, [captureFrame]);

  // Render loop for filtered output
  const startRenderLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    const render = () => {
      const filteredCanvas = filteredCanvasRef.current;
      if (filteredCanvas && lastFrameRef.current) {
        const ctx = filteredCanvas.getContext("2d");
        if (ctx) {
          const img = document.createElement("img");
          img.onload = () => {
            // Set canvas size to match image
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

      // Track connection state
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
        const state = pc.iceConnectionState;
        if (state === "failed") {
          setError("ICE connection failed - intenta recargar la página");
        }
      };

      // Handle incoming stream
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (event.track.kind === "video" && videoRef.current) {
          videoRef.current.srcObject = stream;
          setHasStream(true);
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("Recibiendo video del móvil");
        }
        if (event.track.kind === "audio" && audioRef.current) {
          audioRef.current.srcObject = stream;
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          iceCandidatesRef.current.push(event.candidate);
        }
      };

      // Poll for offer from mobile
      const pollOffer = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/offer`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.success && data.type === "offer" && data.sdp) {
            setStatus("Oferta recibida, creando respuesta...");

            await pc.setRemoteDescription(new RTCSessionDescription({
              type: "offer",
              sdp: data.sdp,
            }));

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await new Promise((resolve) => setTimeout(resolve, 2000));

            await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "answer",
                sdp: pc.localDescription?.sdp,
              }),
            });

            // Send ICE candidates
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

            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        } catch (e) {
          // Silently ignore polling errors
        }
      };

      // Poll for mobile ICE candidates
      const pollMobileIce = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/ice/mobile`);
          if (!res.ok) return;
          const data = await res.json();
          for (const candidate of data.candidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              // Ignore errors
            }
          }
        } catch (e) {
          // Silently ignore polling errors
        }
      };

      pollingRef.current = setInterval(pollOffer, 2000);
      icePollingRef.current = setInterval(pollMobileIce, 3000);
      pollOffer();
    } catch (err: any) {
      setError(err.message || "Error iniciando recepción");
      setIsConnecting(false);
      setStatus("Error");
    }
  };

  const stopReceiving = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (decartWsRef.current) {
      decartWsRef.current.close();
      decartWsRef.current = null;
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (icePollingRef.current) {
      clearInterval(icePollingRef.current);
      icePollingRef.current = null;
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    isProcessingRef.current = false;
    lastFrameRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setHasStream(false);
    setIsDecartConnected(false);
    setIsDecartActive(false);
    setRoomId("");
    setStatus("Listo para recibir");
    setDecartStatus("");
    setRtcState("");
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  };

  // Activate Decart filters
  const activateDecart = () => {
    if (hasStream && decartApiKey) {
      connectToDecart();
      startFrameProcessing();
      startRenderLoop();
    } else if (!decartApiKey) {
      setDecartStatus("Configura una API key primero");
      setShowConfig(true);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      stopReceiving();
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-black flex flex-col">
      {/* Hidden canvases for frame processing */}
      <canvas ref={captureCanvasRef} className="hidden" />
      <audio ref={audioRef} autoPlay className="hidden" />

      {/* Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between p-4 bg-gray-900">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-white" />
            <h1 className="text-lg font-semibold text-white">Decart AI PC</h1>
          </div>
          <div className="flex items-center gap-2">
            {isDecartConnected && (
              <span className="text-xs bg-purple-500/80 text-white px-2 py-1 rounded">
                Decart AI
              </span>
            )}
            {isConnected && (
              <span className="text-xs bg-green-500/80 text-white px-2 py-1 rounded">
                En vivo
              </span>
            )}
            {rtcState && (
              <span className="text-xs bg-gray-700 text-white px-2 py-1 rounded">
                {rtcState}
              </span>
            )}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Config Panel */}
      {showConfig && !isFullscreen && (
        <div className="bg-gray-800 p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Decart AI API Key
            </label>
            <input
              type="password"
              value={decartApiKey}
              onChange={(e) => setDecartApiKey(e.target.value)}
              placeholder="Tu API key de Decart AI"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500">
              Obtén tu API key en https://decart.ai
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Prompt de filtro</label>
            <input
              type="text"
              value={decartPrompt}
              onChange={(e) => setDecartPrompt(e.target.value)}
              placeholder="Ej: Anime style portrait"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
          </div>
          {roomId && (
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Sala ID (para el móvil)</label>
              <div className="bg-gray-700 text-white px-3 py-2 rounded-lg font-mono text-sm select-all">
                {roomId}
              </div>
              <p className="text-xs text-gray-500">
                Escribe este ID en el móvil para conectar
              </p>
            </div>
          )}
        </div>
      )}

      {/* Video Area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-black relative overflow-hidden"
      >
        {/* Show filtered video or raw video based on toggle */}
        {hasStream && isDecartActive && showFiltered ? (
          <canvas
            ref={filteredCanvasRef}
            className="w-full h-full"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
        )}

        {!hasStream && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center max-w-md">
              <Camera className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-2">Esperando video del móvil</p>
              <p className="text-gray-500 text-sm">
                Inicia recepción en el PC, luego abre la página en tu celular e ingresa el ID de la sala
              </p>
              {roomId && (
                <div className="mt-4 bg-gray-800 px-4 py-2 rounded-lg">
                  <p className="text-xs text-gray-400">Sala ID:</p>
                  <p className="text-lg font-mono text-white select-all">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-white mx-auto mb-2" />
              <p className="text-sm text-white">{status}</p>
            </div>
          </div>
        )}

        {/* Controls overlay */}
        {hasStream && (
          <div className="absolute bottom-4 right-4 flex gap-2 flex-wrap">
            <button
              onClick={activateDecart}
              className="bg-purple-600/80 text-white p-2 rounded-lg hover:bg-purple-500/80 transition-colors flex items-center gap-2"
              title="Activar filtros de Decart AI"
            >
              <Play className="w-5 h-5" />
              <span className="text-sm">Activar filtros</span>
            </button>
            {isDecartActive && (
              <button
                onClick={() => setShowFiltered(!showFiltered)}
                className="bg-purple-600/80 text-white p-2 rounded-lg hover:bg-purple-500/80 transition-colors flex items-center gap-2"
                title={showFiltered ? "Ver video original" : "Ver video filtrado"}
              >
                {showFiltered ? (
                  <>
                    <Video className="w-5 h-5" />
                    <span className="text-sm">Original</span>
                  </>
                ) : (
                  <>
                    <Image className="w-5 h-5" />
                    <span className="text-sm">Filtrado</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="bg-gray-800/80 text-white p-2 rounded-lg hover:bg-gray-700/80 transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>
          </div>
        )}

        {/* Status overlay */}
        {hasStream && (
          <div className="absolute top-4 left-4">
            <div className="bg-black/60 text-white px-3 py-1 rounded-lg text-sm flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span>{isDecartActive && isDecartConnected ? "Filtro Decart AI activo" : "Video directo"}</span>
              {decartStatus && (
                <span className="text-xs text-gray-400 ml-2">({decartStatus})</span>
              )}
              <Volume2 className="w-3 h-3 text-gray-400 ml-2" />
            </div>
          </div>
        )}
      </div>

      {/* Footer controls */}
      {!isFullscreen && (
        <div className="p-4 bg-gray-900 flex justify-center gap-4 flex-wrap">
          {!isConnected && !isConnecting && (
            <button
              onClick={startReceiving}
              className="bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
            >
              <Monitor className="w-5 h-5" />
              Iniciar recepción
            </button>
          )}
          {(isConnected || isConnecting) && (
            <button
              onClick={stopReceiving}
              className="bg-red-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <PhoneOff className="w-5 h-5" />
              {isConnecting ? "Cancelar" : "Detener"}
            </button>
          )}
          {hasStream && !isDecartActive && (
            <button
              onClick={activateDecart}
              className="bg-purple-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Activar Decart AI
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 text-red-200 p-3 text-sm text-center">
          {error}
        </div>
      )}

      {/* Instructions */}
      {!isFullscreen && !isConnected && (
        <div className="p-4 bg-gray-800 text-center text-xs text-gray-400">
          <p className="mb-2 font-semibold text-gray-300">Instrucciones:</p>
          <p>1. Abre esta página en tu PC (será la ventana que captura SplitCam)</p>
          <p>2. Haz clic en &quot;Iniciar recepción&quot; - se creará una Sala ID</p>
          <p>3. Abre la página /mobile en tu celular</p>
          <p>4. En el móvil, ingresa el Sala ID y presiona &quot;Iniciar transmisión&quot;</p>
          <p>5. El PC recibirá el video y audio del celular</p>
          <p>6. Configura tu API key de Decart y activa filtros</p>
          <p>7. Usa SplitCam para capturar esta ventana y enviar a WhatsApp</p>
        </div>
      )}
    </div>
  );
}
