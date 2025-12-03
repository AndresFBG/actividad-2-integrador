// src/stores/useAuthStore.ts
import { create } from 'zustand';

interface User {
  uid: string;  // ✅ AGREGAR ESTE CAMPO
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

type AuthStore = {
  user: User | null;
  alternateUser: User | null;
  setUser: (user: User) => void;
  setAlternateUser: (user: User) => void;
};

const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  alternateUser: null,
  setUser: (user: User) => set({ user }),
  setAlternateUser: (user: User) => set({ alternateUser: user }),
}));

export default useAuthStore;