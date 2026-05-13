import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          const pkg = nodeModulePackageName(id);
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') {
            return 'react';
          }
          if (pkg === '@ant-design/icons') {
            return 'antd-icons';
          }
          if (pkg === 'antd') {
            return 'antd-core';
          }
          if (pkg.startsWith('rc-') || pkg.startsWith('@rc-component/')) {
            return 'antd-rc';
          }
          if (pkg.startsWith('@ant-design/')) {
            return 'antd-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787',
    },
  },
});

function nodeModulePackageName(id: string): string {
  const normalized = id.replaceAll('\\', '/');
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) {
    return '';
  }
  const parts = normalized.slice(index + marker.length).split('/');
  if (parts[0]?.startsWith('@')) {
    return `${parts[0]}/${parts[1] ?? ''}`;
  }
  return parts[0] ?? '';
}
