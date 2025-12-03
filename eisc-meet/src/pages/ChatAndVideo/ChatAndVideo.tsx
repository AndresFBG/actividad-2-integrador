import { memo, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import io, { Socket } from "socket.io-client";
import SimplePeer from "simple-peer";
import useAuthStore from "../../stores/useAuthStore";
import {
  Copy,
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  Link2,
  PhoneOff,
  MessageCircle,
  Send,
  Monitor,
  MonitorOff,
} from "lucide-react";
import "./ChatAndVideo.css";

interface Message {
  userId: string;
  message: string;
  timestamp: string;
}

interface RemoteUser {
  socketId: string;
  displayName?: string;
  userId?: string;
  photoURL?: string;
}

type MediaState = { 
  audioEnabled: boolean; 
  videoEnabled: boolean;
  isScreenSharing?: boolean;
};

const getInitials = (name: string) => {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");
};

const VideoTile = memo(
  ({
    pid,
    stream,
    isSelf,
    name,
    mediaState,
    photoURL,
    placeholderClass,
    isScreenSharing,
  }: {
    pid: string;
    stream: MediaStream | null;
    isSelf: boolean;
    name: string;
    mediaState: MediaState;
    photoURL?: string;
    placeholderClass: string;
    isScreenSharing?: boolean;
  }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      if (stream && (mediaState.videoEnabled !== false || isScreenSharing)) {
        if (videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
        }
      } else if (videoEl.srcObject) {
        videoEl.srcObject = null;
      }
    }, [stream, mediaState.videoEnabled, isScreenSharing]);

    useEffect(() => {
      const audioEl = audioRef.current;
      if (!audioEl) return;
      if (!stream || isSelf) {
        if (audioEl.srcObject) {
          audioEl.srcObject = null;
        }
        return;
      }

      if (audioEl.srcObject !== stream) {
        audioEl.srcObject = stream;
      }
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err: any) => console.warn("🔇 Autoplay audio bloqueado:", err));
      }
    }, [stream, isSelf]);

    const showVideo = Boolean(stream) && (mediaState.videoEnabled !== false || isScreenSharing);

    return (
      <div
        key={pid}
        className={`video-wrapper ${isSelf ? "local-video" : "remote-video"} ${isScreenSharing ? "screen-sharing" : ""}`}
      >
        {!isSelf && (
          <audio autoPlay playsInline ref={audioRef} />
        )}

        {showVideo ? (
          <video autoPlay muted={isSelf} playsInline ref={videoRef} />
        ) : (
          <div className={placeholderClass}>
            <div className="placeholder-avatar">
              {photoURL ? (
                <img src={photoURL} alt={name} className="video-avatar" />
              ) : (
                <div className="avatar-fallback">{getInitials(name)}</div>
              )}
            </div>
            <p className="placeholder-text">
              {mediaState.videoEnabled === false && !isScreenSharing
                ? "Cámara desactivada"
                : isSelf
                  ? "Cargando cámara..."
                  : "Conectando con participante..."}
            </p>
          </div>
        )}

        <span className="video-label">
          {name}
          {isScreenSharing && " 🖥️ (Compartiendo pantalla)"}
          {mediaState.videoEnabled === false && !isScreenSharing && " (Cámara OFF)"}
          {mediaState.audioEnabled === false && (
            <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 6 }}>
              <MicOff size={14} />
            </span>
          )}
        </span>
      </div>
    );
  }
);

VideoTile.displayName = "VideoTile";

const ChatAndVideo: React.FC = () => {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [waitingForPeer, setWaitingForPeer] = useState(true);
  const [participantCount, setParticipantCount] = useState(1);
  const [participants, setParticipants] = useState<string[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [userInfos, setUserInfos] = useState<Record<string, { displayName?: string; photoURL?: string }>>({});
  const [mediaStates, setMediaStates] = useState<Record<string, MediaState>>({});
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenShares, setRemoteScreenShares] = useState<Record<string, boolean>>({});

  const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:9000";
  const MAX_REMOTE_PEERS = 9;

  const peersRef = useRef<Record<string, SimplePeer.Instance>>({});
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isInitiatorRef = useRef(false);
  const pendingSignalsRef = useRef<Record<string, any[]>>({});
  const participantsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const speakingIntervalRef = useRef<number | null>(null);
  const speakingActiveRef = useRef<boolean>(false);
  const muteButtonRef = useRef<HTMLButtonElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const originalStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!roomId || !user) {
      navigate("/login");
      return;
    }

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    console.log("🚀 Iniciando conexión para sala:", roomId);

    const newSocket = io(SIGNALING_URL, {
      transports: ["websocket"],
      reconnection: true,
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        console.log("✅ Stream local obtenido");
        console.log("🎵 Audio tracks:", stream.getAudioTracks().length);
        console.log("📹 Video tracks:", stream.getVideoTracks().length);

        setLocalStream(stream);
        localStreamRef.current = stream;
        originalStreamRef.current = stream;
        setConnectionStatus("connected");

        try {
          const audioCtx = new AudioContext();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;

          const data = new Uint8Array(analyser.frequencyBinCount);
          if (speakingIntervalRef.current) {
            clearInterval(speakingIntervalRef.current);
          }
          speakingIntervalRef.current = window.setInterval(() => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteTimeDomainData(data);
            let sumSquares = 0;
            for (let i = 0; i < data.length; i++) {
              const v = data[i] - 128;
              sumSquares += v * v;
            }
            const rms = Math.sqrt(sumSquares / data.length);
            const active = rms > 2.5;
            const prev = speakingActiveRef.current;
            if (active !== prev) {
              speakingActiveRef.current = active;
              const btn = muteButtonRef.current;
              if (btn && !muted) {
                if (active) btn.classList.add("speaking");
                else btn.classList.remove("speaking");
              }
            }
          }, 120);
        } catch (err) {
          console.warn("⚠️ No se pudo iniciar el analizador de audio:", err);
        }

        newSocket.emit("join:room", roomId, user.email, user.displayName || "Invitado", user.photoURL || "");
        console.log("📡 Emitido join:room");
      })
      .catch((err) => {
        console.error("❌ Error al acceder a los dispositivos:", err);
        setConnectionStatus("error");
        alert("No se pudo acceder a la cámara o micrófono. Verifica los permisos.");
      });

    newSocket.on("room:joined", ({ existingUsers }: { existingUsers: RemoteUser[] }) => {
      console.log("🏠 Sala unida. Usuarios existentes:", existingUsers);

      const ids = new Set<string>();
      const infos: Record<string, { displayName?: string; photoURL?: string }> = {};
      const media: Record<string, MediaState> = {};
      existingUsers.forEach((u) => {
        ids.add(u.socketId);
        infos[u.socketId] = { displayName: u.displayName, photoURL: u.photoURL };
        media[u.socketId] = { audioEnabled: true, videoEnabled: true, isScreenSharing: false };
      });
      if (newSocket.id) {
        ids.add(newSocket.id);
        setMyId(newSocket.id);
        infos[newSocket.id] = { displayName: user?.displayName || undefined, photoURL: user?.photoURL || undefined };
        media[newSocket.id] = { audioEnabled: !muted, videoEnabled: videoEnabled, isScreenSharing: false };
      }
      participantsRef.current = ids;
      setParticipantCount(ids.size);
      setParticipants(Array.from(ids));
      setUserInfos((prev) => ({ ...prev, ...infos }));
      setMediaStates((prev) => ({ ...media, ...prev }));

      if (existingUsers.length > 0) {
        isInitiatorRef.current = true;
        setWaitingForPeer(false);

        existingUsers.slice(0, MAX_REMOTE_PEERS).forEach((u) => {
          const userId = u.socketId;
          setTimeout(() => {
            if (localStreamRef.current) {
              createOrReplacePeer(userId, true);
            }
          }, 300);
        });
      } else {
        console.log("⏳ Esperando otros usuarios...");
        isInitiatorRef.current = false;
        setWaitingForPeer(true);
      }
    });

    newSocket.on("user:joined", ({ socketId, displayName, photoURL }: { socketId: string; displayName?: string; photoURL?: string }) => {
      console.log("🆕 Nuevo usuario:", socketId);

      if (!participantsRef.current.has(socketId)) {
        participantsRef.current.add(socketId);
        setParticipantCount(participantsRef.current.size);
        setParticipants(Array.from(participantsRef.current));
        setUserInfos((prev) => ({ ...prev, [socketId]: { displayName, photoURL } }));
        setMediaStates((prev) => ({ ...prev, [socketId]: { audioEnabled: true, videoEnabled: true, isScreenSharing: false } }));
      }
    });

    newSocket.on("signal", ({ from, signal, displayName, photoURL }: { from: string; signal: any; displayName?: string; photoURL?: string }) => {
      if (!signal) {
        console.warn("⚠️ Señal vacía recibida de", from);
        return;
      }
      const sigType = (signal as any).type;
      if (!sigType && !(signal as any).candidate && !(signal as any).renegotiate) {
        console.warn("⚠️ Señal desconocida de", from, signal);
        return;
      }
      console.log("📥 Señal recibida de:", from, "Tipo:", sigType || "candidate/renegotiate");

      setUserInfos((prev) => ({
        ...prev,
        [from]: { displayName: displayName || prev[from]?.displayName, photoURL: photoURL || prev[from]?.photoURL },
      }));

      const existingPeer = peersRef.current[from];
      if (existingPeer) {
        try {
          existingPeer.signal(signal);
          console.log("✅ Señal procesada en peer existente");
        } catch (err) {
          console.error("❌ Error al procesar señal en peer existente:", err, signal);
        }
        return;
      }

      if (sigType === "offer") {
        console.log("📨 Offer recibida, creando peer como RECEPTOR");
        isInitiatorRef.current = false;

        if (localStreamRef.current) {
          createOrReplacePeer(from, false, signal);
        } else {
          console.warn("⚠️ Stream no listo, guardando señal");
          pendingSignalsRef.current[from] = pendingSignalsRef.current[from] || [];
          pendingSignalsRef.current[from].push(signal);
        }
      } else {
        console.log("📦 Guardando señal para procesar después");
        pendingSignalsRef.current[from] = pendingSignalsRef.current[from] || [];
        pendingSignalsRef.current[from].push(signal);
      }
    });

    newSocket.on("user:left", (userId: string) => {
      console.log("👋 Usuario se fue:", userId);

      const peer = peersRef.current[userId];
      if (peer) {
        peer.destroy();
        delete peersRef.current[userId];
      }

      setRemoteStreams((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });

      setRemoteScreenShares((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });

      if (participantsRef.current.has(userId)) {
        participantsRef.current.delete(userId);
        setParticipantCount(participantsRef.current.size);
        setParticipants(Array.from(participantsRef.current));
      }

      setWaitingForPeer(Object.keys(peersRef.current).length === 0);
      isInitiatorRef.current = false;
    });

    newSocket.on("chat:message", (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    newSocket.on("media:states", (state: Record<string, MediaState>) => {
      setMediaStates((prev) => ({ ...state, ...prev }));
    });

    newSocket.on("media:state", ({ socketId, audioEnabled, videoEnabled }: { socketId: string; audioEnabled?: boolean; videoEnabled?: boolean }) => {
      setMediaStates((prev) => ({
        ...prev,
        [socketId]: {
          audioEnabled: audioEnabled ?? prev[socketId]?.audioEnabled ?? true,
          videoEnabled: videoEnabled ?? prev[socketId]?.videoEnabled ?? true,
          isScreenSharing: prev[socketId]?.isScreenSharing ?? false,
        },
      }));
    });

    newSocket.on("screen:share", ({ socketId, sharing }: { socketId: string; sharing: boolean }) => {
      console.log(`${socketId} ${sharing ? 'inicio' : 'detuvo'} compartir pantalla`);
      setRemoteScreenShares((prev) => ({
        ...prev,
        [socketId]: sharing,
      }));
      setMediaStates((prev) => ({
        ...prev,
        [socketId]: {
          ...prev[socketId],
          isScreenSharing: sharing,
        },
      }));
    });

    newSocket.on("room:full", () => {
      alert("La sala alcanzó el máximo de 10 usuarios. Intenta más tarde o crea otra sala.");
      newSocket.disconnect();
      navigate("/profile");
    });

    return () => {
      console.log("🧹 Limpiando recursos...");
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }
      Object.values(peersRef.current).forEach((peer) => peer.destroy());
      peersRef.current = {};
      pendingSignalsRef.current = {};
      setRemoteStreams({});
      setMessages([]);
      participantsRef.current = new Set();
      setParticipantCount(1);
      setParticipants([]);
      setMyId(null);
      if (speakingIntervalRef.current) {
        clearInterval(speakingIntervalRef.current);
        speakingIntervalRef.current = null;
      }
      speakingActiveRef.current = false;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
        analyserRef.current = null;
      }
      newSocket.emit("leave:room", roomId);
      newSocket.removeAllListeners();
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, user, navigate, SIGNALING_URL]);

  const createOrReplacePeer = (
    targetUserId: string,
    initiator: boolean,
    initialSignal?: any
  ) => {
    console.log(`🔗 Inicializando peer con ${targetUserId} - Iniciador: ${initiator}`);

    if (!localStreamRef.current || !socketRef.current) {
      console.error("❌ No hay stream local o socket no listo");
      return;
    }

    const existing = peersRef.current[targetUserId];
    if (existing) {
      existing.destroy();
    }

    let peer: SimplePeer.Instance;
    try {
      peer = new SimplePeer({
        initiator,
        trickle: false,
        stream: localStreamRef.current,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
      });
    } catch (err) {
      console.error("❌ Error creando peer:", err, "WEBRTC_SUPPORT:", (SimplePeer as any)?.WEBRTC_SUPPORT);
      console.error("   opts initiator:", initiator, "hasStream:", !!localStreamRef.current, "tracks:", localStreamRef.current?.getTracks().map(t => `${t.kind}:${t.readyState}:${t.enabled}`));
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      return;
    }

    peer.on("signal", (signal) => {
      console.log("📤 Enviando señal:", signal.type || "candidate", "destino:", targetUserId);
      socketRef.current?.emit("signal", {
        to: targetUserId,
        from: socketRef.current?.id || "",
        signal,
        roomId,
      });
    });

    peer.on("stream", (stream) => {
      console.log("🎥 Stream remoto recibido de", targetUserId);
      console.log("🎵 Audio tracks:", stream.getAudioTracks().map(t => `${t.id}:${t.enabled}`).join(","));
      setRemoteStreams((prev) => ({ ...prev, [targetUserId]: stream }));
      setWaitingForPeer(false);
    });

    peer.on("connect", () => {
      console.log("✅ Peer conectado con", targetUserId);
      setWaitingForPeer(false);
    });

    peer.on("error", (err) => {
      console.error("❌ Error en peer con", targetUserId, err);
    });

    peer.on("close", () => {
      console.log("🔌 Peer cerrado con", targetUserId);
      setRemoteStreams((prev) => {
        const copy = { ...prev };
        delete copy[targetUserId];
        return copy;
      });
      delete peersRef.current[targetUserId];
      setWaitingForPeer(Object.keys(peersRef.current).length === 0);
      if (participantsRef.current.has(targetUserId)) {
        participantsRef.current.delete(targetUserId);
        setParticipantCount(participantsRef.current.size);
        setParticipants(Array.from(participantsRef.current));
      }
    });

    if (initialSignal) {
      console.log("🔄 Procesando señal inicial");
      try {
        peer.signal(initialSignal);
      } catch (err) {
        console.error("❌ Error procesando señal inicial:", err);
      }
    }
    const pending = pendingSignalsRef.current[targetUserId];
    if (pending && pending.length > 0) {
      console.log(`📦 Procesando ${pending.length} señales pendientes para`, targetUserId);
      pending.forEach((sig) => {
        if (!sig) return;
        try {
          peer.signal(sig);
        } catch (err) {
          console.error("❌ Error procesando señal pendiente:", err);
        }
      });
      pendingSignalsRef.current[targetUserId] = [];
    }

    peersRef.current[targetUserId] = peer;
    if (!participantsRef.current.has(targetUserId)) {
      participantsRef.current.add(targetUserId);
      setParticipantCount(participantsRef.current.size);
      setParticipants(Array.from(participantsRef.current));
    }
    console.log("✅ Peer creado para", targetUserId);
  
  };

  const sendMessage = () => {
    if (inputValue.trim() && socket && roomId) {
      socket.emit("chat:message", {
        roomId,
        userId: user?.displayName || "Usuario",
        message: inputValue,
      });
      setInputValue("");
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
        console.log("🔊 Audio:", audioTrack.enabled ? "ON" : "OFF");
        setMediaStates((prev) => ({
          ...prev,
          [myId || "self"]: {
            audioEnabled: audioTrack.enabled,
            videoEnabled: prev[myId || "self"]?.videoEnabled ?? videoEnabled,
            isScreenSharing: prev[myId || "self"]?.isScreenSharing ?? false,
          },
        }));
        socketRef.current?.emit("media:state", {
          roomId,
          audioEnabled: audioTrack.enabled,
        });
      }
    }
  };

  const toggleVideo = () => {
    if (isScreenSharing) {
      alert("No puedes desactivar la cámara mientras compartes pantalla. Detén primero la presentación.");
      return;
    }

    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
        console.log("📹 Video:", videoTrack.enabled ? "ON" : "OFF");
        setMediaStates((prev) => ({
          ...prev,
          [myId || "self"]: {
            audioEnabled: prev[myId || "self"]?.audioEnabled ?? !muted,
            videoEnabled: videoTrack.enabled,
            isScreenSharing: false,
          },
        }));
        socketRef.current?.emit("media:state", {
          roomId,
          videoEnabled: videoTrack.enabled,
        });
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: "always",
            displaySurface: "monitor",
          },
          audio: false,
        });

        if (!originalStreamRef.current) {
          originalStreamRef.current = localStreamRef.current;
        }

        screenStreamRef.current = stream;
        setScreenStream(stream);
        setIsScreenSharing(true);

        const videoTrack = stream.getVideoTracks()[0];
        
        // Reemplazar el track de video en todos los peers
        Object.values(peersRef.current).forEach((peer) => {
          const sender = (peer as any)._pc
            ?.getSenders()
            ?.find((s: RTCRtpSender) => s.track?.kind === "video");

          if (sender) {
            sender.replaceTrack(videoTrack).then(() => {
              console.log("✅ Track de pantalla reemplazado en peer");
            }).catch((err: any) => {
              console.error("❌ Error reemplazando track:", err);
            });
          }
        });

        // Actualizar el stream local para mostrar la pantalla
        localStreamRef.current = stream;
        setLocalStream(stream);

        // Notificar a otros usuarios
        socketRef.current?.emit("screen:share", {
          roomId,
          sharing: true,
        });

        setMediaStates((prev) => ({
          ...prev,
          [myId || "self"]: {
            ...prev[myId || "self"],
            isScreenSharing: true,
          },
        }));

        // Detectar cuando el usuario detiene la compartición desde el navegador
        videoTrack.onended = () => {
          stopScreenShare();
        };

        console.log("✅ Compartiendo pantalla iniciado");
      } else {
        stopScreenShare();
      }
    } catch (err) {
      console.error("❌ Error compartiendo pantalla:", err);
      alert("No se pudo compartir la pantalla. Verifica los permisos.");
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }

    setScreenStream(null);
    setIsScreenSharing(false);

    // Restaurar el stream original de la cámara
    if (originalStreamRef.current) {
      const videoTrack = originalStreamRef.current.getVideoTracks()[0];

      Object.values(peersRef.current).forEach((peer) => {
        const sender = (peer as any)._pc
          ?.getSenders()
          ?.find((s: RTCRtpSender) => s.track?.kind === "video");

        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack).then(() => {
            console.log("✅ Track de cámara restaurado en peer");
          }).catch((err: any) => {
            console.error("❌ Error restaurando track:", err);
          });
        }
      });

      localStreamRef.current = originalStreamRef.current;
      setLocalStream(originalStreamRef.current);
    }

    socketRef.current?.emit("screen:share", {
      roomId,
      sharing: false,
    });

    setMediaStates((prev) => ({
      ...prev,
      [myId || "self"]: {
        ...prev[myId || "self"],
        isScreenSharing: false,
      },
    }));

    console.log("✅ Compartir pantalla detenido");
  };

  const leaveRoom = () => {
    if (socket && roomId) {
      socket.emit("leave:room", roomId);
    }
    navigate("/profile");
  };

  const copyRoomLink = () => {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setShowCopyNotification(true);
      setTimeout(() => setShowCopyNotification(false), 2000);
    });
  };

  const participantIds = participants.length ? participants : myId ? [myId] : [];
  const showWaitingCard = participantIds.length <= 1 && waitingForPeer;

  const getDisplayName = (id: string, isSelf: boolean) => {
    if (isSelf) return user?.displayName || "Tú";
    return userInfos[id]?.displayName || id;
  };

  const getMediaState = (id: string): MediaState => {
    return mediaStates[id] || { audioEnabled: true, videoEnabled: true, isScreenSharing: false };
  };

  const getPhotoURL = (id: string, isSelf: boolean) => {
    if (isSelf) return user?.photoURL || undefined;
    return userInfos[id]?.photoURL;
  };

  return (
    <div className="chat-video-container">
      <div className="video-section">
        <div className="video-container">
          <div className="videos-grid">
            {participantIds.map((pid) => {
              const isSelf = pid === myId;
              const stream = isSelf 
                ? (isScreenSharing ? screenStream : localStream) 
                : remoteStreams[pid] || null;
              const name = getDisplayName(pid, isSelf);
              const mediaState = getMediaState(pid);
              const photoURL = getPhotoURL(pid, isSelf);
              const isSharing = isSelf ? isScreenSharing : remoteScreenShares[pid] || mediaState.isScreenSharing;
              const placeholderClass = `placeholder ${mediaState.videoEnabled === false && !isSharing ? "camera-off" : "connecting"}`;

              return (
                <VideoTile
                  key={pid}
                  pid={pid}
                  stream={stream}
                  isSelf={isSelf}
                  name={name}
                  mediaState={mediaState}
                  photoURL={photoURL}
                  placeholderClass={placeholderClass}
                  isScreenSharing={isSharing}
                />
              );
            })}

            {showWaitingCard && (
              <div className="video-wrapper waiting">
                <div className="waiting-content">
                  <div className="spinner"></div>
                  <p>Esperando a otro participante...</p>
                  <p className="room-code">
                    Código: <strong>{roomId}</strong>
                  </p>
                  <button className="share-link-btn" onClick={copyRoomLink}>
                    <Link2 size={18} style={{ marginRight: 8 }} /> Compartir enlace
                  </button>
                </div>
              </div>
            )}
          </div>

          {connectionStatus === "error" && (
            <div className="video-error">
              <p>❌ Error al acceder a la cámara o micrófono</p>
              <p>Permite el acceso en tu navegador</p>
            </div>
          )}
        </div>

        <div className="video-controls">
          <button
            ref={muteButtonRef}
            className={`control-button mute-button ${muted ? "muted" : ""}`}
            onClick={toggleMute}
            disabled={connectionStatus !== "connected"}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />} {muted ? "Activar" : "Silenciar"}
          </button>

          <button
            className={`control-button video-button ${
              !videoEnabled ? "disabled" : ""
            }`}
            onClick={toggleVideo}
            disabled={connectionStatus !== "connected" || isScreenSharing}
          >
            {videoEnabled ? <VideoIcon size={18} /> : <VideoOff size={18} />} Cámara
          </button>

          <button
            className={`control-button screen-share-button ${
              isScreenSharing ? "sharing" : ""
            }`}
            onClick={toggleScreenShare}
            disabled={connectionStatus !== "connected"}
            title={isScreenSharing ? "Detener presentación" : "Compartir pantalla"}
          >
            {isScreenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />} 
            {isScreenSharing ? "Detener" : "Compartir"}
          </button>

          <button className="control-button share-button" onClick={copyRoomLink}>
            <Link2 size={18} /> Compartir
          </button>

          <button className="control-button leave-button" onClick={leaveRoom}>
            <PhoneOff size={18} /> Salir
          </button>
        </div>
      </div>

      <div className="chat-section">
        <div className="chat-header">
          <h3><MessageCircle size={18} style={{ marginRight: 6, verticalAlign: "middle" }} /> Chat</h3>
          <p>{messages.length} mensajes · {participantCount} participantes</p>
          <div className="room-id-container" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="room-id">Sala: {roomId}</span>
            <button className="copy-room-id-btn" onClick={() => navigator.clipboard.writeText(roomId)} title="Copiar ID de sala" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <Copy size={24} />
            </button>
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>No hay mensajes</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isOwn = msg.userId === (user?.displayName || "Usuario");
              const time = new Date(msg.timestamp).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <div key={index} className={`message-item ${isOwn ? "own" : ""}`}>
                  <div className="message-header">
                    <div className="message-avatar">{getInitials(msg.userId || "")}</div>
                    <div className="message-meta">
                      <span className="message-user">{msg.userId}</span>
                      <span className="message-time">{time}</span>
                    </div>
                  </div>
                  <p className="message-text">{msg.message}</p>
                </div>
              );
            })
          )}
        </div>

        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <input
              className="chat-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Escribe un mensaje..."
              onKeyPress={(e) => e.key === "Enter" && sendMessage()}
            />
            <button
              className="send-button"
              onClick={sendMessage}
              disabled={!inputValue.trim()}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>

      {showCopyNotification && (
        <div className="copy-notification">✓ Link copiado</div>
      )}
    </div>
  );
};

export default ChatAndVideo;