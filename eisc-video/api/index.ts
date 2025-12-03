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

const rooms: Record<string, Record<string, { socketId: string; userId: string; displayName: string; photoURL?: string }>> = {};
const mediaStates: Record<string, Record<string, { audioEnabled: boolean; videoEnabled: boolean; isScreenSharing?: boolean }>> = {};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join:room", (roomId: string, userId: string, displayName: string, photoURL?: string) => {
    const currentCount = rooms[roomId] ? Object.keys(rooms[roomId]).length : 0;
    if (currentCount >= 10) {
      socket.emit("room:full");
      return;
    }

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }
    if (!mediaStates[roomId]) {
      mediaStates[roomId] = {};
    }

    rooms[roomId][socket.id] = { socketId: socket.id, userId, displayName, photoURL };
    mediaStates[roomId][socket.id] = { audioEnabled: true, videoEnabled: true, isScreenSharing: false };

    const existingUsers = Object.entries(rooms[roomId])
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ socketId: id, userId: info.userId, displayName: info.displayName, photoURL: info.photoURL }));
    
    socket.emit("room:joined", { roomId, existingUsers });
    socket.emit("media:states", mediaStates[roomId]);

    socket.to(roomId).emit("user:joined", { socketId: socket.id, userId, displayName, photoURL });

    console.log(`User ${socket.id} joined room ${roomId}. Total users: ${Object.keys(rooms[roomId]).length}`);
  });

  socket.on("signal", (data: { to: string; from: string; signal: any; roomId: string }) => {
    const { to, from, signal, roomId } = data;
    if (!signal || !to) return;
    const senderInfo = rooms[roomId]?.[from];

    io.to(to).emit("signal", {
      from,
      signal,
      displayName: senderInfo?.displayName,
      userId: senderInfo?.userId,
      photoURL: senderInfo?.photoURL,
    });
  });

  socket.on("media:state", (data: { roomId: string; audioEnabled?: boolean; videoEnabled?: boolean }) => {
    const { roomId, audioEnabled, videoEnabled } = data;
    if (!mediaStates[roomId]) {
      mediaStates[roomId] = {};
    }
    const current = mediaStates[roomId][socket.id] || { audioEnabled: true, videoEnabled: true, isScreenSharing: false };
    mediaStates[roomId][socket.id] = {
      audioEnabled: audioEnabled ?? current.audioEnabled,
      videoEnabled: videoEnabled ?? current.videoEnabled,
      isScreenSharing: current.isScreenSharing ?? false,
    };

    socket.to(roomId).emit("media:state", {
      socketId: socket.id,
      audioEnabled: mediaStates[roomId][socket.id].audioEnabled,
      videoEnabled: mediaStates[roomId][socket.id].videoEnabled,
    });
  });

  // EVENTO UNIFICADO PARA COMPARTIR PANTALLA
  socket.on("screen:share", ({ roomId, sharing }: { roomId: string; sharing: boolean }) => {
    console.log(`🖥️ Usuario ${socket.id} ${sharing ? 'comenzó' : 'detuvo'} compartir pantalla en sala ${roomId}`);
    
    // Actualizar el estado de compartir pantalla
    if (mediaStates[roomId]?.[socket.id]) {
      mediaStates[roomId][socket.id].isScreenSharing = sharing;
    }

    const senderInfo = rooms[roomId]?.[socket.id];
    
    // Notificar a todos los demás usuarios en la sala
    socket.to(roomId).emit("screen:share", {
      socketId: socket.id,
      sharing,
      displayName: senderInfo?.displayName,
      photoURL: senderInfo?.photoURL,
    });

    console.log(`✅ Notificación de compartir pantalla enviada a sala ${roomId}`);
  });

  // Eventos legacy por compatibilidad (puedes eliminarlos si solo usas screen:share)
  socket.on("screen:share-start", ({ roomId }) => {
    console.log(`📺 Usuario ${socket.id} comenzó a compartir pantalla en sala ${roomId} (evento legacy)`);
    
    if (mediaStates[roomId]?.[socket.id]) {
      mediaStates[roomId][socket.id].isScreenSharing = true;
    }
    
    const senderInfo = rooms[roomId]?.[socket.id];
    
    socket.to(roomId).emit("peer:screen-share-start", {
      socketId: socket.id,
      displayName: senderInfo?.displayName,
      photoURL: senderInfo?.photoURL,
    });
  });

  socket.on("screen:share-stop", ({ roomId }) => {
    console.log(`📺 Usuario ${socket.id} detuvo compartir pantalla en sala ${roomId} (evento legacy)`);
    
    if (mediaStates[roomId]?.[socket.id]) {
      mediaStates[roomId][socket.id].isScreenSharing = false;
    }
    
    socket.to(roomId).emit("peer:screen-share-stop", {
      socketId: socket.id,
    });
  });

  socket.on("screen:signal", ({ to, from, signal, roomId }) => {
    console.log(`📤 Reenviando señal de pantalla de ${from} a ${to}`);
    
    io.to(to).emit("screen:signal", {
      from,
      signal,
    });
  });

  socket.on("leave:room", (roomId: string) => {
    if (rooms[roomId]?.[socket.id]) {
      delete rooms[roomId][socket.id];
      delete mediaStates[roomId]?.[socket.id];
      socket.to(roomId).emit("user:left", socket.id);
      socket.leave(roomId);

      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
        delete mediaStates[roomId];
      }

      console.log(`User ${socket.id} left room ${roomId}`);
    }
  });

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

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      if (rooms[roomId][socket.id]) {
        delete rooms[roomId][socket.id];
        delete mediaStates[roomId]?.[socket.id];
        socket.to(roomId).emit("user:left", socket.id);

        if (Object.keys(rooms[roomId]).length === 0) {
          delete rooms[roomId];
          delete mediaStates[roomId];
        }
      }
    }

    console.log(`User disconnected: ${socket.id}`);
  });
});