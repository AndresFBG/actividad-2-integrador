// src/pages/profile/Profile.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../stores/useAuthStore';

const Profile: React.FC = () => {
  const { user, alternateUser } = useAuthStore(); // Traemos ambos usuarios
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');

  // Generar ID único para sala
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  };

  // Crear nueva sala
  const createRoom = () => {
    const newRoomId = generateRoomId();
    navigate(`/room/${newRoomId}`); // Redirigimos a la sala con el roomId generado
  };

  // Unirse a sala existente
  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      navigate(`/room/${roomId.trim()}`); // Redirigimos a la sala con el roomId proporcionado
    }
  };

  // Determinamos qué usuario mostrar (el usuario activo, ya sea "user" o "alternateUser")
  const currentUser = user || alternateUser;

  return (
    <div className="container-page">
      <div>
        <h1>Bienvenido</h1>
        <h2>{currentUser?.displayName}</h2>
        
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Crear nueva sala */}
          <div style={{ textAlign: 'center' }}>
            <button 
              onClick={createRoom}
              style={{ width: '100%', fontSize: '1rem' }}
            >
              📹 Crear Nueva Reunión
            </button>
          </div>

          {/* Separador */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '1rem',
            margin: '0.5rem 0' 
          }}>
            <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }}></div>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>O</span>
            <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }}></div>
          </div>

          {/* Unirse a sala existente */}
          <form onSubmit={joinRoom}>
            <div style={{ marginBottom: '1rem' }}>
              <label 
                htmlFor="roomId"
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 500 
                }}
              >
                Código de la reunión
              </label>
              <input
                id="roomId"
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Ingresa el código de la sala"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.5rem',
                  fontSize: '1rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            <button 
              type="submit"
              disabled={!roomId.trim()}
              style={{ 
                width: '100%', 
                fontSize: '1rem',
                opacity: roomId.trim() ? 1 : 0.5
              }}
            >
              🚀 Unirse a Reunión
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Profile;
