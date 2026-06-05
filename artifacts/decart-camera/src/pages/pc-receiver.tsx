import { useState, useEffect, useRef, useCallback } from "react";
import { Monitor, Settings, Maximize2, Minimize2, Loader2, Camera, PhoneOff, Image, Video, Sparkles } from "lucide-react";

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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filteredCanvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const decartWsRef = useRef<WebSocket | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Capture frame from video and convert to base64
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
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
    if (!decartApiKey) return;
    if (decartWsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      setDecartStatus("Conectando a Decart AI...");
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

      // Start rendering filtered frames
      const renderFrame = () => {
        const frame = lastFrameRef.current;
        if (frame && filteredCanvasRef.current) {
          const ctx = filteredCanvasRef.current.getContext("2d");
          if (ctx) {
            const img = document.createElement("img");
            img.onload = () => {
              if (filteredCanvasRef.current) {
                filteredCanvasRef.current.width = img.width;
                filteredCanvasRef.current.height = img.height;
                ctx.drawImage(img, 0, 0);
              }
            };
            img.src = frame;
          }
        }
        requestAnimationFrame(renderFrame);
      };
      requestAnimationFrame(renderFrame);
      
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
    }, 200); // 5 FPS - adjust based on API limits
  }, [captureFrame]);

  // Render loop for filtered output
  const startRenderLoop = useCallback(() => {
    const render = () => {
      const filteredCanvas = filteredCanvasRef.current;
      if (filteredCanvas && lastFrameRef.current) {
        const ctx = filteredCanvas.getContext("2d");
        if (ctx) {
          const img = document.createElement("img");
          img.onload = () => {
            filteredCanvas.width = img.width;
            filteredCanvas.height = img.height;
            ctx.drawImage(img, 0, 0);
          };
          img.src = lastFrameRef.current;
        }
      }
      requestAnimationFrame(render);
    };
    render();
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

      // Handle incoming stream
      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setHasStream(true);
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("Recibiendo video del móvil");
          
          // Start Decart AI processing if API key is set
          if (decartApiKey) {
            connectToDecart();
            startFrameProcessing();
            startRenderLoop();
          }
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          iceCandidatesRef.current.push(event.candidate);
        }
      };

      // Poll for offer from mobile
      const pollOffer = async () => {
        const res = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/offer`);
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
          }
        }
      };

      const pollMobileIce = async () => {
        const res = await fetch(`${API_BASE}/signaling/rooms/${currentRoomId}/ice/mobile`);
        const data = await res.json();
        for (const candidate of data.candidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            // Ignore errors
          }
        }
      };

      pollingRef.current = setInterval(pollOffer, 2000);
      setInterval(pollMobileIce, 3000);
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
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    isProcessingRef.current = false;
    lastFrameRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setHasStream(false);
    setIsDecartConnected(false);
    setRoomId("");
    setStatus("Listo para recibir");
    setDecartStatus("");
    if (videoRef.current) {
      videoRef.current.srcObject = null;
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
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={filteredCanvasRef} className="hidden" />

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
              <label className="text-sm text-gray-400">Sala ID</label>
              <div className="bg-gray-700 text-white px-3 py-2 rounded-lg font-mono text-sm">
                {roomId}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Video Area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-black relative"
      >
        {/* Show filtered video or raw video based on toggle */}
        {hasStream && isDecartConnected && showFiltered ? (
          <canvas
            ref={filteredCanvasRef}
            className="w-full h-full object-contain"
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
            <div className="text-center">
              <Camera className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-2">Esperando video del móvil</p>
              <p className="text-gray-500 text-sm">
                Abre /mobile en tu celular y conecta a esta sala
              </p>
              {roomId && (
                <div className="mt-4 bg-gray-800 px-4 py-2 rounded-lg">
                  <p className="text-xs text-gray-400">Sala ID:</p>
                  <p className="text-lg font-mono text-white">{roomId}</p>
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
          <div className="absolute bottom-4 right-4 flex gap-2">
            {isDecartConnected && (
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
              <span>{isDecartConnected ? "Filtro Decart AI activo" : "Video directo"}</span>
              {decartStatus && (
                <span className="text-xs text-gray-400 ml-2">({decartStatus})</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer controls */}
      {!isFullscreen && (
        <div className="p-4 bg-gray-900 flex justify-center gap-4">
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
          <p>2. Abre la página /mobile en tu celular</p>
          <p>3. En el móvil, inicia la transmisión</p>
          <p>4. El PC recibirá automáticamente el video</p>
          <p>5. Si tienes API key de Decart, configúrala para aplicar filtros</p>
          <p>6. Usa SplitCam para capturar esta ventana y enviar a WhatsApp</p>
        </div>
      )}
    </div>
  );
}
