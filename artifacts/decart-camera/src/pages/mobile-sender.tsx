import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, PhoneOff, Loader2 } from "lucide-react";

const API_BASE = "/api";

export default function MobileSender() {
  const [roomId, setRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Esperando...");

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createRoom = async () => {
    try {
      const res = await fetch(`${API_BASE}/signaling/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mobile Sender" }),
      });
      const data = await res.json();
      if (data.id) {
        setRoomId(data.id);
        return data.id;
      }
      throw new Error("Failed to create room");
    } catch (err: any) {
      setError(err.message || "Error creating room");
      return null;
    }
  };

  const startConnection = async () => {
    setIsConnecting(true);
    setError("");
    setStatus("Solicitando cámara...");

    try {
      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStatus("Creando sala...");
      const roomId = await createRoom();
      if (!roomId) {
        setIsConnecting(false);
        return;
      }

      setStatus("Configurando conexión WebRTC...");
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Collect ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          iceCandidatesRef.current.push(event.candidate);
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait a bit for ICE gathering
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setStatus("Enviando oferta...");
      // Send offer to server
      await fetch(`${API_BASE}/signaling/rooms/${roomId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "offer",
          sdp: pc.localDescription?.sdp,
        }),
      });

      // Send ICE candidates
      for (const candidate of iceCandidatesRef.current) {
        await fetch(`${API_BASE}/signaling/rooms/${roomId}/ice`, {
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
      // Poll for answer
      const pollAnswer = async () => {
        const res = await fetch(`${API_BASE}/signaling/rooms/${roomId}/answer`);
        const data = await res.json();
        if (data.success && data.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("Conectado! Transmisión activa.");
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
          }
        }
      };

      pollingRef.current = setInterval(pollAnswer, 2000);
      pollAnswer();

      // Also poll for PC ICE candidates
      const pollIce = async () => {
        const res = await fetch(`${API_BASE}/signaling/rooms/${roomId}/ice/pc`);
        const data = await res.json();
        for (const candidate of data.candidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            // Ignore errors
          }
        }
      };
      setInterval(pollIce, 3000);
    } catch (err: any) {
      setError(err.message || "Error iniciando conexión");
      setIsConnecting(false);
      setStatus("Error");
    }
  };

  const stopConnection = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setRoomId("");
    setStatus("Desconectado");
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-white">Decart AI Mobile</h1>
          <p className="text-sm text-gray-400">
            Enviar cámara al PC para aplicar filtros
          </p>
        </div>

        {roomId && (
          <div className="bg-gray-900 rounded-lg p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Sala ID:</p>
            <p className="text-lg font-mono text-white select-all">{roomId}</p>
          </div>
        )}

        <div className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!isConnected && !isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Camera className="w-12 h-12 text-gray-600" />
            </div>
          )}
          {isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-white mx-auto mb-2" />
                <p className="text-sm text-white">{status}</p>
              </div>
            </div>
          )}
          {isConnected && (
            <div className="absolute top-2 right-2 bg-green-500/80 text-white text-xs px-2 py-1 rounded">
              En vivo
            </div>
          )}
        </div>

        <div className="text-center">
          <p className="text-xs text-gray-500 mb-4">{status}</p>
        </div>

        <div className="flex gap-2">
          {!isConnected && !isConnecting && (
            <button
              onClick={startConnection}
              className="flex-1 bg-white text-black font-semibold py-3 px-4 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
            >
              <Camera className="w-5 h-5" />
              Iniciar transmisión
            </button>
          )}
          {(isConnected || isConnecting) && (
            <button
              onClick={stopConnection}
              className="flex-1 bg-red-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
            >
              <PhoneOff className="w-5 h-5" />
              {isConnecting ? "Cancelar" : "Detener"}
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-900/50 text-red-200 p-3 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        <div className="text-center text-xs text-gray-500 mt-8">
          <p>1. Abre esta página en tu celular</p>
          <p>2. Abre la página principal en tu PC</p>
          <p>3. Inicia la transmisión</p>
          <p>4. El PC recibirá tu cámara y aplicará filtros</p>
        </div>
      </div>
    </div>
  );
}
