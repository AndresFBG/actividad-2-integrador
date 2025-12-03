import React from 'react';
import ReactDOM from 'react-dom/client'; // Para React 18
import './index.css'; // Archivo de estilos globales
import App from './App'; // El componente raíz de tu aplicación
import { BrowserRouter } from 'react-router-dom'; // Necesario para las rutas

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <BrowserRouter> {/* Componente Router que gestiona las rutas */}
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
