import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Mit Präfix '' werden auch Variablen ohne VITE_ geladen. Sie bleiben auf dem Server
  // (Dev-Server) und gelangen NICHT in den Browser-Code.
  const env = loadEnv(mode, process.cwd(), '')
  const token = env.STRATZ_TOKEN

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Browser ruft /stratz/graphql auf; der Dev-Server leitet an STRATZ weiter und hängt den Token an.
        '/stratz': {
          target: 'https://api.stratz.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/stratz/, ''),
          headers: {
            'User-Agent': 'STRATZ_API',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      },
    },
  }
})
