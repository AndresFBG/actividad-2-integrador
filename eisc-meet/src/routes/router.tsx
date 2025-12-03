// src/routes.tsx o src/App.tsx (según tu configuración)
import { createBrowserRouter, Navigate } from "react-router-dom";
import Login from "../pages/login/Login";
import Profile from "../pages/profile/Profile";
import ChatAndVideo from "../pages/ChatAndVideo/ChatAndVideo";
import useAuthStore from "../stores/useAuthStore";

const ProtectedRoute = ({ element }: { element: JSX.Element }) => {
  const { user } = useAuthStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return element;
};

export const routes = [
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/profile",
    element: <ProtectedRoute element={<Profile />} />,
  },
  {
    path: "/room/:roomId",
    element: <ProtectedRoute element={<ChatAndVideo />} />,
  },
];

export const router = createBrowserRouter(routes);
