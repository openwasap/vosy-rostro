import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

let RTCPeerConnection: any;
let RTCIceCandidate: any;
let RTCSessionDescription: any;
let RTCView: any;
let mediaDevices: any;
let MediaStream: any;

if (Platform.OS !== "web") {
  const webrtc = require("react-native-webrtc");
  RTCPeerConnection = webrtc.RTCPeerConnection;
  RTCIceCandidate = webrtc.RTCIceCandidate;
  RTCSessionDescription = webrtc.RTCSessionDescription;
  RTCView = webrtc.RTCView;
  mediaDevices = webrtc.mediaDevices;
  MediaStream = webrtc.MediaStream;
} else {
  RTCPeerConnection = (window as any).RTCPeerConnection;
  RTCIceCandidate = (window as any).RTCIceCandidate;
  RTCSessionDescription = (window as any).RTCSessionDescription;
  mediaDevices = (navigator as any).mediaDevices;
}

const VIDEO_WIDTH = 1088;
const VIDEO_HEIGHT = 624;
const VIDEO_FPS = 30;
const AUDIO_BITRATE = 64000;

type ConnectionState = "idle" | "starting" | "connecting" | "connected" | "error";

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const [roomId, setRoomId] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [statusText, setStatusText] = useState("Listo para conectar");
  const [errorText, setErrorText] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isRemoteMuted, setIsRemoteMuted] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [streamURL, setStreamURL] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(
    `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "localhost"}`
  );

  const streamRef = useRef<any>(null);
  const pcRef = useRef<any>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidatesRef = useRef<any[]>([]);
  const remoteAudioRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const dataChannelRef = useRef<any>(null);

  const apiBase = `${serverUrl}/api`;

  useEffect(() => {
    if (Platform.OS !== "web") {
      startCamera(true);
    }
    return () => stopAll();
  }, []);

  const startCamera = async (front: boolean) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t: any) => t.stop());
      }
      const stream = await mediaDevices.getUserMedia({
        video: {
          facingMode: front ? "user" : "environment",
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          frameRate: { ideal: VIDEO_FPS },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;
      if (Platform.OS !== "web") {
        setStreamURL(stream.toURL());
      }
    } catch (err: any) {
      setErrorText("No se pudo acceder a la cámara: " + (err?.message ?? String(err)));
    }
  };

  const switchCamera = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newFront = !isFrontCamera;
    setIsFrontCamera(newFront);
    const oldStream = streamRef.current;
    await startCamera(newFront);
    if (pcRef.current && streamRef.current) {
      try {
        const senders = pcRef.current.getSenders();
        const vTrack = streamRef.current.getVideoTracks()[0];
        const aTrack = streamRef.current.getAudioTracks()[0];
        const vSender = senders.find((s: any) => s.track?.kind === "video");
        const aSender = senders.find((s: any) => s.track?.kind === "audio");
        if (vSender && vTrack) await vSender.replaceTrack(vTrack);
        if (aSender && aTrack) await aSender.replaceTrack(aTrack);
      } catch { /* ignore */ }
    }
    if (oldStream && oldStream !== streamRef.current) {
      oldStream.getTracks().forEach((t: any) => t.stop());
    }
  };

  const toggleMute = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t: any) => {
        t.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  const startConnection = async () => {
    const trimmed = roomId.trim().toUpperCase();
    if (!trimmed) {
      setErrorText("Escribe el ID de sala del PC");
      return;
    }
    if (!streamRef.current) {
      setErrorText("La cámara no está lista");
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();
    setConnectionState("starting");
    setErrorText("");
    setStatusText("Verificando sala del PC...");
    iceCandidatesRef.current = [];

    try {
      const roomCheck = await fetch(`${apiBase}/signaling/rooms/${trimmed}`);
      if (!roomCheck.ok) {
        setErrorText("Sala no encontrada. Asegúrate de que el PC inició la sesión primero.");
        setConnectionState("error");
        return;
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          setConnectionState("connected");
          setStatusText("Transmitiendo al PC en tiempo real");
        } else if (state === "failed" || state === "disconnected") {
          setConnectionState("error");
          setStatusText("Conexión perdida");
        }
      };

      streamRef.current.getTracks().forEach((track: any) => {
        pc.addTrack(track, streamRef.current);
      });

      pc.ontrack = (event: any) => {
        if (event.streams && event.streams[0]) {
          remoteStreamRef.current = event.streams[0];
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = event.streams[0];
            remoteAudioRef.current.play().catch(() => {});
          }
        }
        if (event.track && event.track.kind === "audio") {
          setIsRemoteMuted(false);
        }
      };

      pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          iceCandidatesRef.current.push(event.candidate);
        }
      };

      pc.ondatachannel = (event: any) => {
        const channel = event.channel;
        dataChannelRef.current = channel;
        channel.onmessage = (e: any) => {
          const data = JSON.parse(e.data || "{}");
          if (data.type === "mute-changed") {
            setIsRemoteMuted(data.muted);
          }
        };
      };

      setConnectionState("connecting");
      setStatusText("Preparando oferta WebRTC...");
      const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const dc = pc.createDataChannel("mute-sync", { ordered: true });
      dataChannelRef.current = dc;
      dc.onopen = () => {};
      dc.onerror = () => {};

      await new Promise((r) => setTimeout(r, 2000));

      setStatusText("Enviando señal al PC...");
      await fetch(`${apiBase}/signaling/rooms/${trimmed}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: pc.localDescription?.sdp }),
      });

      for (const c of iceCandidatesRef.current) {
        await fetch(`${apiBase}/signaling/rooms/${trimmed}/ice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate: c.candidate,
            sdpMid: c.sdpMid,
            sdpMLineIndex: c.sdpMLineIndex,
            source: "mobile",
          }),
        });
      }

      setStatusText("Esperando respuesta del PC...");

      const pollAnswer = async () => {
        try {
          const r = await fetch(`${apiBase}/signaling/rooms/${trimmed}/answer`);
          if (!r.ok) return;
          const d = await r.json();
          if (d.success && d.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(d));
            setConnectionState("connected");
            setStatusText("Transmitiendo al PC en tiempo real");
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch { /* ignore */ }
      };

      pollingRef.current = setInterval(pollAnswer, 2000);
      pollAnswer();

      const pollIce = async () => {
        try {
          const r = await fetch(`${apiBase}/signaling/rooms/${trimmed}/ice/pc`);
          if (!r.ok) return;
          const d = await r.json();
          for (const c of d.candidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      };
      icePollingRef.current = setInterval(pollIce, 3000);

    } catch (err: any) {
      setErrorText(err?.message ?? "Error de conexión");
      setConnectionState("error");
    }
  };

  const disconnect = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pcRef.current?.close();
    pcRef.current = null;
    remoteStreamRef.current = null;
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setConnectionState("idle");
    setStatusText("Listo para conectar");
    setErrorText("");
    setIsRemoteMuted(false);
  }, []);

  const toggleRemoteMute = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (remoteStreamRef.current) {
      const audioTracks = remoteStreamRef.current.getAudioTracks();
      audioTracks.forEach((t: any) => {
        t.enabled = isRemoteMuted;
      });
      setIsRemoteMuted(!isRemoteMuted);
      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        dataChannelRef.current.send(JSON.stringify({ type: "mute-changed", muted: !isRemoteMuted }));
      }
    }
  };

  const stopAll = () => {
    pcRef.current?.close();
    pcRef.current = null;
    remoteStreamRef.current = null;
    if (dataChannelRef.current) {
      try { dataChannelRef.current.close(); } catch {}
      dataChannelRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t: any) => t.stop());
      streamRef.current = null;
    }
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
  };

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting" || connectionState === "starting";

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Camera Preview */}
        <View style={styles.cameraContainer}>
          {streamURL && Platform.OS !== "web" ? (
            <RTCView
              streamURL={streamURL}
              style={styles.camera}
              objectFit="cover"
              mirror={isFrontCamera}
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Ionicons name="camera-outline" size={64} color="#374151" />
              <Text style={styles.placeholderText}>
                {Platform.OS === "web"
                  ? "Vista previa no disponible en web"
                  : "Iniciando cámara..."}
              </Text>
            </View>
          )}

          {/* Live badge */}
          {isConnected && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>EN VIVO → PC</Text>
            </View>
          )}

          {/* Connecting overlay */}
          {isConnecting && (
            <View style={styles.connectingOverlay}>
              <ActivityIndicator size="small" color="#16a34a" />
              <Text style={styles.connectingText}>{statusText}</Text>
            </View>
          )}

          {/* Camera controls */}
          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={switchCamera}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-reverse-outline" size={22} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={toggleMute}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isMuted ? "mic-off" : "mic"}
                size={22}
                color="#ffffff"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={() => router.push("/settings")}
              activeOpacity={0.7}
            >
              <Ionicons name="settings-outline" size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Resolution badge */}
          <View style={styles.resBadge}>
            <Text style={styles.resText}>{VIDEO_WIDTH}×{VIDEO_HEIGHT} · {VIDEO_FPS}fps</Text>
          </View>
        </View>

        {/* Bottom Panel */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.bottomPanel}
        >
          <View style={[styles.bottomContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>

            {/* Status text */}
            <Text style={styles.statusText}>{statusText}</Text>

            {/* Room ID input */}
            {!isConnected && !isConnecting && (
              <>
                <Text style={styles.label}>ID DE SALA DEL PC</Text>
                <TextInput
                  style={styles.roomInput}
                  value={roomId}
                  onChangeText={(t) => setRoomId(t.toUpperCase())}
                  onSubmitEditing={startConnection}
                  placeholder="Ej: ABC"
                  placeholderTextColor="#4b5563"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  returnKeyType="go"
                />
                <Text style={styles.hint}>
                  El ID aparece en el panel PC al iniciar sesión
                </Text>
              </>
            )}

            {/* Action button */}
            {!isConnected && !isConnecting && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.connectBtn]}
                onPress={startConnection}
                activeOpacity={0.8}
              >
                <Ionicons name="radio" size={20} color="#ffffff" />
                <Text style={styles.actionBtnText}>Conectar y transmitir</Text>
              </TouchableOpacity>
            )}

            {isConnecting && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={disconnect}
                activeOpacity={0.8}
              >
                <Ionicons name="close-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.actionBtnText}>Cancelar</Text>
              </TouchableOpacity>
            )}

            {isConnected && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.disconnectBtn]}
                onPress={disconnect}
                activeOpacity={0.8}
              >
                <Ionicons name="stop-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.actionBtnText}>Detener transmisión</Text>
              </TouchableOpacity>
            )}

            {/* Error */}
            {!!errorText && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#fca5a5" />
                <Text style={styles.errorText}>{errorText}</Text>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: "#000000",
    position: "relative",
  },
  camera: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  cameraPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  placeholderText: {
    color: "#4b5563",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  liveBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(22, 163, 74, 0.85)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ffffff",
  },
  liveText: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  connectingOverlay: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  connectingText: {
    color: "#d1d5db",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  cameraControls: {
    position: "absolute",
    top: 12,
    right: 12,
    gap: 8,
  },
  controlBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  controlBtnActive: {
    backgroundColor: "rgba(220, 38, 38, 0.75)",
  },
  resBadge: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  resText: {
    color: "#9ca3af",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  bottomPanel: {
    backgroundColor: "#0a0f1a",
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
  },
  bottomContent: {
    padding: 16,
    gap: 10,
  },
  statusText: {
    color: "#6b7280",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  label: {
    color: "#6b7280",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    marginTop: 4,
  },
  roomInput: {
    backgroundColor: "#111827",
    color: "#ffffff",
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    letterSpacing: 8,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  hint: {
    color: "#374151",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 4,
  },
  connectBtn: {
    backgroundColor: "#16a34a",
  },
  cancelBtn: {
    backgroundColor: "#854d0e",
  },
  disconnectBtn: {
    backgroundColor: "#991b1b",
  },
  actionBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(127, 29, 29, 0.4)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
});
