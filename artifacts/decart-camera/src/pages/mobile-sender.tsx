import { useState, useEffect, useRef } from "react";
import { Camera, PhoneOff, Loader2, ArrowLeft, Mic, MicOff, RotateCcw } from "lucide-react";
import { Link } from "wouter";

const API_BASE = "/api";

export default function MobileSender() {
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Listo");
  const [facingMode, setFacingMode] = useState("user");
  const [isMuted, setIsMuted] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-start camera preview on load
  useEffect(() => {
    startCameraPreview();
    return () => stopAll();
  }, []);

  const startCameraPreview = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
      setStatus("Cámara lista — ingresa el ID y conecta");
    } catch (err: unknown) {
      setError("No se pudo acceder a la cámara: " + (err as Error).message);
      setStatus("Error de cámara");
    }
  };

  const switchCamera = async () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: newMode },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      // If connected, replace tracks in peer connection
      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        const videoTrack = stream.getVideoTracks()[0];
        const videoSender = senders.find((s) => s.track?.kind === "video");
        if (videoSender && videoTrack) videoSender.replaceTrack(videoTrack);
        const audioTrack = stream.getAudioTracks()[0];
        const audioSender = senders.find((s) => s.track?.kind === "audio");
        if (audioSender && audioTrack) audioSender.replaceTrack(audioTrack);
      }
    } catch {
      setError("No se pudo cambiar de cámara");
    }
  };

  const startConnection = async () => {
    const targetRoomId = inputRoomId.trim();
    if (!targetRoomId) {
      setError("Escribe el ID de sala del PC");
      return;
    }
    if (!streamRef.current) {
      setError("La cámara no está lista");
      return;
    }

    setIsConnecting(true);
    setError("");
    setStatus("Verificando sala...");
    setRoomId(targetRoomId);

    try {
      const roomCheck = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}`);
      if (!roomCheck.ok) {
        setError("Sala no encontrada. Asegúrate de que el PC inició primero.");
        setIsConnecting(false);
        return;
      }

      const stream = streamRef.current;
      setStatus("Configurando WebRTC...");

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "failed" || state === "disconnected") {
          setIsConnected(false);
          setStatus("Conexión perdida");
        }
        if (state === "connected") {
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("✅ Conectado — transmitiendo al PC");
        }
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) iceCandidatesRef.current.push(event.candidate);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setStatus("Recopilando ICE...");
      await new Promise((r) => setTimeout(r, 2000));

      setStatus("Enviando oferta al PC...");
      await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: pc.localDescription?.sdp }),
      });

      for (const candidate of iceCandidatesRef.current) {
        await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/ice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            source: "mobile",
          }),
        });
      }

      setStatus("Esperando respuesta del PC...");

      const pollAnswer = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/answer`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.success && data.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            setIsConnected(true);
            setIsConnecting(false);
            setStatus("✅ Conectado — transmitiendo al PC");
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          }
        } catch { /* ignore */ }
      };

      pollingRef.current = setInterval(pollAnswer, 2000);
      pollAnswer();

      const pollIce = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/ice/pc`);
          if (!res.ok) return;
          const data = await res.json();
          for (const candidate of data.candidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      };
      icePollingRef.current = setInterval(pollIce, 3000);

    } catch (err: unknown) {
      setError((err as Error).message || "Error de conexión");
      setIsConnecting(false);
      setStatus("Error");
    }
  };

  const stopAll = () => {
    pcRef.current?.close(); pcRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setIsConnected(false);
    setIsConnecting(false);
    setRoomId("");
    setStatus("Desconectado");
    setCameraReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const disconnect = () => {
    pcRef.current?.close(); pcRef.current = null;
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setIsConnected(false);
    setIsConnecting(false);
    setRoomId("");
    setStatus("Cámara lista");
    // Keep camera preview active
    if (streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach((t) => { t.enabled = isMuted; });
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="min-h-screen w-full bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Link href="/">
            <button className="text-gray-500 hover:text-gray-300 transition-colors mr-1">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <Camera className="w-5 h-5 text-green-400" />
          <h1 className="text-base font-bold text-white">Panel Móvil</h1>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Transmitiendo
            </span>
          )}
        </div>
      </div>

      {/* Camera preview — full height */}
      <div className="relative flex-1 bg-black" style={{ minHeight: "50vh" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ minHeight: "50vh" }}
        />

        {!cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Iniciando cámara...</p>
            </div>
          </div>
        )}

        {/* Camera controls overlay */}
        {cameraReady && (
          <div className="absolute top-3 right-3 flex gap-2">
            <button
              onClick={switchCamera}
              className="bg-black/60 backdrop-blur text-white p-2 rounded-full hover:bg-black/80 transition-colors"
              title="Cambiar cámara"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              onClick={toggleMute}
              className={`backdrop-blur text-white p-2 rounded-full transition-colors ${
                isMuted ? "bg-red-600/80 hover:bg-red-700/80" : "bg-black/60 hover:bg-black/80"
              }`}
              title={isMuted ? "Activar audio" : "Silenciar"}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>
        )}

        {/* Status badge */}
        {isConnected && (
          <div className="absolute top-3 left-3">
            <div className="bg-green-600/80 backdrop-blur text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              En vivo → PC
            </div>
          </div>
        )}

        {isConnecting && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <div className="bg-black/70 backdrop-blur text-white text-sm px-4 py-2 rounded-full flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status}
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-gray-900 border-t border-gray-800 p-4 space-y-3">
        <p className="text-xs text-gray-500 text-center">{status}</p>

        {/* Room ID input */}
        {!isConnected && !isConnecting && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              ID de Sala del PC
            </label>
            <input
              type="text"
              value={inputRoomId}
              onChange={(e) => setInputRoomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startConnection()}
              placeholder="Ej: abc123 (del panel PC)"
              className="w-full bg-gray-800 text-white px-3 py-3 rounded-xl border border-gray-700 focus:border-green-500 focus:outline-none font-mono text-base tracking-widest text-center"
            />
            <p className="text-xs text-gray-600 text-center">
              Este ID aparece en el panel PC al tocar "Iniciar PC"
            </p>
          </div>
        )}

        {/* Action buttons */}
        {!isConnected && !isConnecting && (
          <button
            onClick={startConnection}
            disabled={!cameraReady}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-lg"
          >
            <Camera className="w-6 h-6" />
            📡 Conectar y enviar al PC
          </button>
        )}

        {isConnecting && (
          <button
            onClick={disconnect}
            className="w-full bg-yellow-700 hover:bg-yellow-800 text-white font-bold py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-base"
          >
            <PhoneOff className="w-5 h-5" />
            Cancelar conexión
          </button>
        )}

        {isConnected && (
          <button
            onClick={disconnect}
            className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-lg"
          >
            <PhoneOff className="w-6 h-6" />
            ⛔ Desconectar del PC
          </button>
        )}

        {error && (
          <div className="bg-red-900/40 text-red-300 text-xs p-3 rounded-lg text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
