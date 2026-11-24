import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Publicado em https://danieldsantana.github.io/construct/
export default defineConfig({
  base: '/construct/',
  plugins: [react()],
});
