import axios from 'axios';
import { onSessionEnded } from '../offline/session';
import { installAuthInterceptors } from './auth-interceptors';

axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
axios.defaults.withCredentials = true;

installAuthInterceptors(axios, {
  getAccessToken: () => localStorage.getItem('accessToken'),
  getRefreshToken: () => localStorage.getItem('refreshToken'),
  storeAccessToken: (token) => localStorage.setItem('accessToken', token),
  refreshClient: axios.create({ baseURL: axios.defaults.baseURL, withCredentials: true }),
  endSession: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    onSessionEnded().catch(() => undefined); // downloaded member lists must not outlive the session
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  },
});

export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const base64 = token.split('.')[1];
    const json = decodeURIComponent(
      atob(base64.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default axios;
