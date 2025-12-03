// src/config/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Tu configuración de Firebase (obtén estos valores de Firebase Console)
// Ve a: https://console.firebase.google.com/
// Selecciona tu proyecto > Project Settings > Your apps > Web app
const firebaseConfig = {
  apiKey: "AIzaSyCDW5DCuydYDDPjS3BtRt1DtZ7JJuNVA5A",
  authDomain: "video-meet-ad89d.firebaseapp.com",
  projectId: "video-meet-ad89d",
  storageBucket: "video-meet-ad89d.firebasestorage.app",
  messagingSenderId: "827498270914",
  appId: "1:827498270914:web:b12575a65e4aa58c482b5b",
  measurementId: "G-STKE85JBGS"
};


// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar Firebase Authentication y obtener una referencia al servicio
export const auth = getAuth(app);

// Configurar el proveedor de Google
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account' // Forzar selección de cuenta cada vez
});