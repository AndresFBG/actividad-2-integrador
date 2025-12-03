// eisc-chat/api/index.ts
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Load environment variables early
dotenv.config();

const app = express();
const server = http.createServer(app);

// Configurar CORS
app.use(cors({
  origin: process.env.ORIGIN?.split(',') || "http://localhost:5173",
  methods: ["GET", "POST"]
}));

const io = new Server(server, {
  cors: {
    origin: process.env.ORIGIN?.split(',') || "http://localhost:5173", // URL de tu frontend
    methods: ["GET", "POST"],
  }
});

// Estructura para manejar las salas
interface Room {
  [roomId: string]: {
    [socketId: string]: {
      userId: string;
      displayName: string;
      photoURL?: string;
    };
  };
}

const rooms: Room = {};

io.on('connection', (socket) => {
  console.log('🔌 Usuario conectado:', socket.id);

  // Unirse a una sala
  socket.on('join:room', (roomId: string, userInfo: any) => {
    console.log(`👤 ${userInfo.displayName} (${socket.id}) se unió a la sala: ${roomId}`);
    const currentCount = rooms[roomId] ? Object.keys(rooms[roomId]).length : 0;
    if (currentCount >= 10) {
      socket.emit('room:full');
      return;
    }

    socket.join(roomId);

    // Inicializar la sala si no existe
    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    // Guardar información del usuario
    rooms[roomId][socket.id] = userInfo;

    // Notificar a todos los usuarios existentes sobre el nuevo usuario
    socket.to(roomId).emit('user:joined', {
      socketId: socket.id,
      userInfo: userInfo
    });

    // Enviar la lista de usuarios existentes al nuevo usuario
    const existingUsers = Object.keys(rooms[roomId])
      .filter(id => id !== socket.id)
      .map(id => ({
        socketId: id,
        userInfo: rooms[roomId][id]
      }));

    socket.emit('existing:users', existingUsers);

    console.log(`📊 Usuarios en sala ${roomId}:`, Object.keys(rooms[roomId]).length);
  });

  // Manejo de señales WebRTC
  socket.on('webrtc:offer', ({ to, offer, from }) => {
    console.log(`📤 Enviando offer de ${from} a ${to}`);
    io.to(to).emit('webrtc:offer', { from, offer });
  });

  socket.on('webrtc:answer', ({ to, answer, from }) => {
    console.log(`📤 Enviando answer de ${from} a ${to}`);
    io.to(to).emit('webrtc:answer', { from, answer });
  });

  socket.on('webrtc:ice-candidate', ({ to, candidate, from }) => {
    console.log(`🧊 Enviando ICE candidate de ${from} a ${to}`);
    io.to(to).emit('webrtc:ice-candidate', { from, candidate });
  });

  // Chat
  socket.on('chat:message', (data) => {
    console.log(`💬 Mensaje de ${data.userName}: ${data.message}`);
    io.to(data.roomId).emit('chat:message', data);
  });

  // Control de medios (mute/video)
  socket.on('media:toggle', ({ roomId, type, enabled }) => {
    socket.to(roomId).emit('peer:media-toggle', {
      socketId: socket.id,
      type,
      enabled
    });
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('❌ Usuario desconectado:', socket.id);
    
    // Buscar en qué sala estaba el usuario
    for (const roomId in rooms) {
      if (rooms[roomId][socket.id]) {
        const userInfo = rooms[roomId][socket.id];
        delete rooms[roomId][socket.id];
        
        // Notificar a los demás usuarios
        socket.to(roomId).emit('user:left', {
          socketId: socket.id,
          userInfo
        });

        console.log(`👋 ${userInfo.displayName} salió de la sala ${roomId}`);
        
        // Eliminar sala si está vacía
        if (Object.keys(rooms[roomId]).length === 0) {
          delete rooms[roomId];
          console.log(`🗑️  Sala ${roomId} eliminada (vacía)`);
        }
        break;
      }
    }
  });
});

// Default to 3000 to avoid clashing with other services (e.g., eisc-video on 9000)
const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});




