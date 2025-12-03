import { Server } from "socket.io";
import "dotenv/config";

const origins = (process.env.ORIGIN ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const io = new Server({
  cors: {
    origin: origins,
  },
});

const port = Number(process.env.PORT);

io.listen(port);
console.log(`Server is running on port ${port}`);

// Estructura:
// rooms: { roomId: { socketId: { socketId, userId, displayName, photoURL?: string } } }
// mediaStates: { roomId: { socketId: { audioEnabled: boolean; videoEnabled: boolean } } }
const rooms: Record<string, Record<string, { socketId: string; userId: string; displayName: string; photoURL?: string }>> = {};
const mediaStates: Record<string, Record<string, { audioEnabled: boolean; videoEnabled: boolean }>> = {};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Usuario se une a una sala
  socket.on("join:room", (roomId: string, userId: string, displayName: string, photoURL?: string) => {
    // Limitar salas a máximo 10 usuarios (voz/video)
    const currentCount = rooms[roomId] ? Object.keys(rooms[roomId]).length : 0;
    if (currentCount >= 10) {
      socket.emit("room:full");
      return;
    }

    socket.join(roomId);

    // Inicializar sala si no existe
    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }
    if (!mediaStates[roomId]) {
      mediaStates[roomId] = {};
    }

    // Agregar usuario a la sala
    rooms[roomId][socket.id] = { socketId: socket.id, userId, displayName, photoURL };
    mediaStates[roomId][socket.id] = { audioEnabled: true, videoEnabled: true };

    // Notificar a los usuarios existentes sobre el nuevo usuario
    const existingUsers = Object.entries(rooms[roomId])
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ socketId: id, userId: info.userId, displayName: info.displayName, photoURL: info.photoURL }));
    
    socket.emit("room:joined", { roomId, existingUsers });
    // Enviar estados de medios actuales a quien se une
    socket.emit("media:states", mediaStates[roomId]);

    socket.to(roomId).emit("user:joined", { socketId: socket.id, userId, displayName, photoURL });

    console.log(`User ${socket.id} joined room ${roomId}. Total users: ${Object.keys(rooms[roomId]).length}`);
  });

    // Señalización WebRTC
  socket.on("signal", (data: { to: string; from: string; signal: any; roomId: string }) => {
    const { to, from, signal, roomId } = data;
    if (!signal || !to) return;
    const senderInfo = rooms[roomId]?.[from];

    // Envía la señal solo al destinatario indicado
    io.to(to).emit("signal", {
      from,
      signal,
      displayName: senderInfo?.displayName,
      userId: senderInfo?.userId,
      photoURL: senderInfo?.photoURL,
    });
  });

  // Actualización de estado de medios (mute/video)
  socket.on("media:state", (data: { roomId: string; audioEnabled?: boolean; videoEnabled?: boolean }) => {
    const { roomId, audioEnabled, videoEnabled } = data;
    if (!mediaStates[roomId]) {
      mediaStates[roomId] = {};
    }
    const current = mediaStates[roomId][socket.id] || { audioEnabled: true, videoEnabled: true };
    mediaStates[roomId][socket.id] = {
      audioEnabled: audioEnabled ?? current.audioEnabled,
      videoEnabled: videoEnabled ?? current.videoEnabled,
    };

    socket.to(roomId).emit("media:state", {
      socketId: socket.id,
      audioEnabled: mediaStates[roomId][socket.id].audioEnabled,
      videoEnabled: mediaStates[roomId][socket.id].videoEnabled,
    });
  });

  // Usuario sale de la sala
  socket.on("leave:room", (roomId: string) => {
    if (rooms[roomId]?.[socket.id]) {
      delete rooms[roomId][socket.id];
      delete mediaStates[roomId]?.[socket.id];
      socket.to(roomId).emit("user:left", socket.id);
      socket.leave(roomId);

      // Limpiar sala si está vacía
      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
        delete mediaStates[roomId];
      }

      console.log(`User ${socket.id} left room ${roomId}`);
    }
  });

  // Chat en tiempo real
  socket.on("chat:message", (data: { roomId: string; userId: string; message: string }) => {
    const { roomId, userId, message } = data;

    const outgoingMessage = {
      userId,
      message: message.trim(),
      timestamp: new Date().toISOString(),
    };

    io.to(roomId).emit("chat:message", outgoingMessage);
    console.log(`Message in room ${roomId} from ${userId}: ${message}`);
  });

  // Desconexión
  socket.on("disconnect", () => {
    // Remover usuario de todas las salas
    for (const roomId in rooms) {
      if (rooms[roomId][socket.id]) {
        delete rooms[roomId][socket.id];
        delete mediaStates[roomId]?.[socket.id];
        socket.to(roomId).emit("user:left", socket.id);

        // Limpiar sala si está vacía
        if (Object.keys(rooms[roomId]).length === 0) {
          delete rooms[roomId];
        }
      }
    }

    console.log(`User disconnected: ${socket.id}`);
  });
});
