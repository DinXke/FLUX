import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      base: "./",
      manifest: {
        name: "FLUX",
        short_name: "FLUX",
        description: "Energie-optimalisatie voor thuisbatterijen",
        theme_color: "#1e3a5f",
        background_color: "#0f1b2d",
        display: "standalone",
        start_url: "./",
        scope: "./",
        orientation: "portrait-primary",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: null,
        runtimeCaching: [],
      },
    }),
  ],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        'mesh-dashboard': new URL('./mesh-dashboard.html', import.meta.url).pathname,
      },
      output: {
        entryFileNames: '[name]/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
