import { useState, useEffect, useRef } from "react";
import { Camera, PhoneOff, Loader2, Keyboard, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const API_BASE = "/api";

export default function MobileSender() {
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Esperando...");
  const [facingMode, setFacingMode] = useState("user");
  const [isMuted, setIsMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startConnection = async () => {
    const targetRoomId = inputRoomId.trim();
    if (!targetRoomId) {
      setError("Ingresa el ID de la sala creada en el PC");
      return;
    }

    setIsConnecting(true);
    setError("");
    setStatus("Solicitando cámara...");
    setRoomId(targetRoomId);

    try {
      // Verify room exists
      const roomCheck = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}`);
      if (!roomCheck.ok) {
        setError("Sala no encontrada. Asegúrate de que el PC creó la sala correctamente.");
        setIsConnecting(false);
        return;
      }

      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: facingMode },
        audio: true,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStatus("Configurando conexión WebRTC...");
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
        if (state === "failed" || state === "disconnected") {
          setIsConnected(false);
          setStatus("Conexión perdida");
        }
      };

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
      await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "offer",
          sdp: pc.localDescription?.sdp,
        }),
      });

      // Send ICE candidates
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
      // Poll for answer
      const pollAnswer = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/answer`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.success && data.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            setIsConnected(true);
            setIsConnecting(false);
            setStatus("Conectado! Transmisión activa.");
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        } catch (e) {
          // Silently ignore polling errors
        }
      };

      pollingRef.current = setInterval(pollAnswer, 2000);
      pollAnswer();

      // Also poll for PC ICE candidates
      const pollIce = async () => {
        try {
          const res = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/ice/pc`);
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
      icePollingRef.current = setInterval(pollIce, 3000);
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
    if (icePollingRef.current) {
      clearInterval(icePollingRef.current);
      icePollingRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setRoomId("");
    setInputRoomId("");
    setStatus("Desconectado");
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    // Restart connection with new facing mode
    if (isConnected || isConnecting) {
      stopConnection();
      setTimeout(() => {
        setFacingMode(newMode);
      }, 500);
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

        {/* Room ID input */}
        {!isConnected && !isConnecting && (
          <div className="bg-gray-900 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-gray-400" />
              <label className="text-sm text-gray-400">ID de la Sala del PC</label>
            </div>
            <input
              type="text"
              value={inputRoomId}
              onChange={(e) => setInputRoomId(e.target.value)}
              placeholder="Ej: abc123"
              className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none font-mono text-sm"
            />
            <p className="text-xs text-gray-500">
              Escribe el ID que aparece en el PC después de hacer &quot;Iniciar recepción&quot;
            </p>
          </div>
        )}

        {roomId && (
          <div className="bg-gray-900 rounded-lg p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Sala ID:</p>
            <p className="text-lg font-mono text-white select-all">{roomId}</p>
          </div>
        )}

        <div className="relative aspect-[3/4] bg-gray-800 rounded-lg overflow-hidden max-h-[60vh]">
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
          {isConnected && (
            <div className="absolute top-2 left-2 flex gap-2">
              <button
                onClick={toggleMute}
                className="bg-black/50 text-white text-xs px-2 py-1 rounded"
              >
                {isMuted ? "Mudo" : "Audio on"}
              </button>
              <button
                onClick={toggleCamera}
                className="bg-black/50 text-white text-xs px-2 py-1 rounded"
              >
                {facingMode === "user" ? "Frontal" : "Trasera"}
              </button>
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
          <p>1. Abre la página principal en tu PC</p>
          <p>2. En el PC, haz clic en &quot;Iniciar recepción&quot;</p>
          <p>3. Copia el ID de la sala que aparece en el PC</p>
          <p>4. Escribe el ID aquí y presiona &quot;Iniciar transmisión&quot;</p>
          <p>5. El PC recibirá tu cámara y audio</p>
        </div>

        <div className="text-center">
          <Link href="/">
            <button className="text-gray-500 text-xs hover:text-gray-300 flex items-center gap-1 justify-center mx-auto">
              <ArrowLeft className="w-3 h-3" />
              Volver al PC
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
