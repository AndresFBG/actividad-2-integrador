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

type MediaState = { audioEnabled: boolean; videoEnabled: boolean };

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
  }: {
    pid: string;
    stream: MediaStream | null;
    isSelf: boolean;
    name: string;
    mediaState: MediaState;
    photoURL?: string;
    placeholderClass: string;
  }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      if (stream && mediaState.videoEnabled !== false) {
        if (videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
        }
      } else if (videoEl.srcObject) {
        videoEl.srcObject = null;
      }
    }, [stream, mediaState.videoEnabled]);

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

    const showVideo = Boolean(stream) && mediaState.videoEnabled !== false;

    return (
      <div
        key={pid}
        className={`video-wrapper ${isSelf ? "local-video" : "remote-video"}`}
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
              {mediaState.videoEnabled === false
                ? "Cámara desactivada"
                : isSelf
                  ? "Cargando cámara..."
                  : "Conectando con participante..."}
            </p>
          </div>
        )}

        <span className="video-label">
          {name}
          {mediaState.videoEnabled === false && " (Cámara OFF)"}
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
  const [videoEnabled, setVideoEnabled] = useState(true);  // Keep track of video status
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [waitingForPeer, setWaitingForPeer] = useState(true);
  const [participantCount, setParticipantCount] = useState(1);
  const [participants, setParticipants] = useState<string[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [userInfos, setUserInfos] = useState<Record<string, { displayName?: string; photoURL?: string }>>({});
  const [mediaStates, setMediaStates] = useState<Record<string, { audioEnabled: boolean; videoEnabled: boolean }>>({});

  // Usa VITE_SIGNALING_URL para apuntar al backend de señalización:
  // - Local: deja el fallback http://localhost:9000
  // - Túnel/Internet: asigna la URL del túnel (https://...) en .env y reinicia npm run dev
  const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:9000";
  const MAX_REMOTE_PEERS = 9; // tú + 9 = 10 usuarios en sala

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

  useEffect(() => {
    if (!roomId || !user) {
      navigate("/login");
      return;
    }

    // Cierra sockets previos si el efecto se reejecuta (React StrictMode duplica efectos en dev)
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

    // Obtener media local (cámara y audio)
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

        // Asegurarse de que el stream de video esté asignado al video local
        setLocalStream(stream);
        localStreamRef.current = stream;
        setConnectionStatus("connected");

        // Analizador de audio local para detectar voz y animar el botón (sin re-render continuo)
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
            const active = rms > 2.5; // sensible
            const prev = speakingActiveRef.current;
            if (active !== prev) {
              speakingActiveRef.current = active;
              // aplica clase directamente para evitar re-render de video
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

        // Unirse a la sala después de obtener el stream con displayName
        newSocket.emit("join:room", roomId, user.email, user.displayName || "Invitado", user.photoURL || "");
        console.log("📡 Emitido join:room");
      })
      .catch((err) => {
        console.error("❌ Error al acceder a los dispositivos:", err);
        setConnectionStatus("error");
        alert("No se pudo acceder a la cámara o micrófono. Verifica los permisos.");
      });

    // Listener: Sala unida
    newSocket.on("room:joined", ({ existingUsers }: { existingUsers: RemoteUser[] }) => {
      console.log("🏠 Sala unida. Usuarios existentes:", existingUsers);

      const ids = new Set<string>();
      const infos: Record<string, { displayName?: string; photoURL?: string }> = {};
      const media: Record<string, { audioEnabled: boolean; videoEnabled: boolean }> = {};
      existingUsers.forEach((u) => {
        ids.add(u.socketId);
        infos[u.socketId] = { displayName: u.displayName, photoURL: u.photoURL };
        media[u.socketId] = { audioEnabled: true, videoEnabled: true };
      });
      if (newSocket.id) {
        ids.add(newSocket.id);
        setMyId(newSocket.id);
        infos[newSocket.id] = { displayName: user?.displayName || undefined, photoURL: user?.photoURL || undefined };
        media[newSocket.id] = { audioEnabled: !muted, videoEnabled: videoEnabled };
      }
      participantsRef.current = ids;
      setParticipantCount(ids.size);
      setParticipants(Array.from(ids));
      setUserInfos((prev) => ({ ...prev, ...infos }));
      setMediaStates((prev) => ({ ...media, ...prev }));

      if (existingUsers.length > 0) {
        isInitiatorRef.current = true;
        setWaitingForPeer(false);

        // Crea peers hacia todos los usuarios existentes (hasta 10 total)
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

    // Listener: Nuevo usuario (solo actualiza participantes; la oferta la envía quien entra)
    newSocket.on("user:joined", ({ socketId, displayName, photoURL }: { socketId: string; displayName?: string; photoURL?: string }) => {
      console.log("🆕 Nuevo usuario:", socketId);

      if (!participantsRef.current.has(socketId)) {
        participantsRef.current.add(socketId);
        setParticipantCount(participantsRef.current.size);
        setParticipants(Array.from(participantsRef.current));
        setUserInfos((prev) => ({ ...prev, [socketId]: { displayName, photoURL } }));
        setMediaStates((prev) => ({ ...prev, [socketId]: { audioEnabled: true, videoEnabled: true } }));
      }
    });

    // Listener: Señales WebRTC (ofertas/answers/candidates)
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

    // Listener: Usuario se fue
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

      if (participantsRef.current.has(userId)) {
        participantsRef.current.delete(userId);
        setParticipantCount(participantsRef.current.size);
        setParticipants(Array.from(participantsRef.current));
      }

      setWaitingForPeer(Object.keys(peersRef.current).length === 0);
      isInitiatorRef.current = false;
    });

    // Listener: Mensajes
    newSocket.on("chat:message", (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    // Estados de medios (batch inicial)
    newSocket.on("media:states", (state: Record<string, { audioEnabled: boolean; videoEnabled: boolean }>) => {
      setMediaStates((prev) => ({ ...state, ...prev }));
    });

    // Estado de medios en tiempo real
    newSocket.on("media:state", ({ socketId, audioEnabled, videoEnabled }: { socketId: string; audioEnabled?: boolean; videoEnabled?: boolean }) => {
      setMediaStates((prev) => ({
        ...prev,
        [socketId]: {
          audioEnabled: audioEnabled ?? prev[socketId]?.audioEnabled ?? true,
          videoEnabled: videoEnabled ?? prev[socketId]?.videoEnabled ?? true,
        },
      }));
    });

    // Sala llena (backend rechaza)
    newSocket.on("room:full", () => {
      alert("La sala alcanzó el máximo de 10 usuarios. Intenta más tarde o crea otra sala.");
      newSocket.disconnect();
      navigate("/profile");
    });

    // Cleanup
    return () => {
      console.log("🧹 Limpiando recursos...");
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
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

  // Crea o reemplaza un peer WebRTC hacia targetUserId
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

    // Destruye si ya existe
    const existing = peersRef.current[targetUserId];
    if (existing) {
      existing.destroy();
    }

    let peer: SimplePeer.Instance;
    try {
      peer = new SimplePeer({
        initiator,
        trickle: false, // deshabilita trickle para evitar señales parciales fuera de orden
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

    // Procesa señales entrantes acumuladas
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

  // Envío de chat
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

  // Mute/unmute mic y notificar estado
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
          },
        }));
        socketRef.current?.emit("media:state", {
          roomId,
          audioEnabled: audioTrack.enabled,
        });
      }
    }
  };

  // Encender/apagar cámara y notificar estado
  const toggleVideo = () => {
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
          },
        }));
        socketRef.current?.emit("media:state", {
          roomId,
          videoEnabled: videoTrack.enabled,
        });
      }
    }
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
    return mediaStates[id] || { audioEnabled: true, videoEnabled: true };
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
              const stream = isSelf ? localStream : remoteStreams[pid] || null;
              const name = getDisplayName(pid, isSelf);
              const mediaState = getMediaState(pid);
              const photoURL = getPhotoURL(pid, isSelf);
              const placeholderClass = `placeholder ${mediaState.videoEnabled === false ? "camera-off" : "connecting"}`;

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

        {/* Controles */}
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
            disabled={connectionStatus !== "connected"}
          >
            {videoEnabled ? <VideoIcon size={18} /> : <VideoOff size={18} />} Cámara
          </button>

          <button className="control-button share-button" onClick={copyRoomLink}>
            <Link2 size={18} /> Compartir
          </button>

          <button className="control-button leave-button" onClick={leaveRoom}>
            <PhoneOff size={18} /> Salir
          </button>
        </div>
      </div>

      {/* Chat */}
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
