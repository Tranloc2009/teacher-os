import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/400-italic.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import 'katex/dist/katex.min.css';
import '@xyflow/react/dist/style.css';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import './workspace.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisterError() {
      // Bỏ qua lỗi đăng ký SW trong môi trường hạn chế hoặc iframe preview
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
