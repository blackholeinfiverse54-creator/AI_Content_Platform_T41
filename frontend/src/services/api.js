import axios from 'axios';
import toast from 'react-hot-toast';

const trimTrailingSlash = (value) => value.replace(/\/$/, '');

function resolveApiConfig() {
  const envBase = import.meta.env.VITE_API_URL?.trim();
  const envOrigin = import.meta.env.VITE_API_ORIGIN?.trim();

  if (envBase) {
    return {
      baseUrl: trimTrailingSlash(envBase),
      origin: envOrigin ? trimTrailingSlash(envOrigin) : trimTrailingSlash(envBase).replace(/\/api\/v1$/, ''),
    };
  }

  if (envOrigin) {
    const origin = trimTrailingSlash(envOrigin);
    return { baseUrl: `${origin}/api/v1`, origin };
  }

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocal) {
      return { baseUrl: 'http://localhost:5000/api/v1', origin: 'http://localhost:5000' };
    }

    // Production default: same-origin API route for custom domains / rewrites.
    const normalizedOrigin = trimTrailingSlash(origin);
    return { baseUrl: `${normalizedOrigin}/api/v1`, origin: normalizedOrigin };
  }

  return { baseUrl: 'http://localhost:5000/api/v1', origin: 'http://localhost:5000' };
}

const { baseUrl: API_BASE_URL, origin: API_ORIGIN } = resolveApiConfig();

/** localStorage key for JWT (Authorization: Bearer). */
export const AUTH_TOKEN_KEY = 'artha_auth_token';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const reqUrl = error.config?.url || '';
    const silent401Me = error.response?.status === 401 && reqUrl.includes('/auth/me');
    if (!silent401Me) {
      console.error('API Error:', {
        status: error.response?.status,
        data: error.response?.data,
        url: reqUrl,
        method: error.config?.method,
      });
    }

    const message = error.response?.data?.message || error.response?.data?.error || 'An error occurred';

    if (error.response?.status === 401) {
      const url = reqUrl;
      if (url.includes('/auth/login')) {
        toast.error(message);
      } else if (!url.includes('/auth/me')) {
        toast.error('Session expired. Please sign in again.');
        try {
          localStorage.removeItem(AUTH_TOKEN_KEY);
        } catch {
          /* ignore */
        }
        window.location.href = '/login';
      }
    } else if (error.response?.status === 403) {
      if (error.response?.data?.code === 'app_not_allowed') {
        toast.error('Your account is not enabled for this app.');
      } else if (error.response?.data?.error === 'AUTHORITY_VIOLATION') {
        console.warn('Authority violation (route not mapped):', reqUrl);
      } else if (error.response?.data?.error === 'POLICY_VIOLATION') {
        console.warn('Policy violation:', reqUrl);
      } else {
        const msg = error.response?.data?.message || 'You do not have permission to perform this action';
        toast.error(msg);
      }
    } else if (error.response?.status === 409) {
      toast.error(message);
    } else if (error.response?.status === 429) {
      toast.error(message);
    } else if (error.response?.status === 503) {
      toast.error(message || 'Service temporarily unavailable. Try again in a moment.');
    } else if (error.response?.status === 400) {
      const errors = error.response?.data?.errors;
      if (errors && Array.isArray(errors)) {
        errors.forEach((err) => toast.error(err.msg || err.message));
      } else {
        toast.error(message);
      }
    } else if (error.response?.status >= 500) {
      const isAuthFlowUrl =
        reqUrl.includes('/auth/login') ||
        reqUrl.includes('/auth/magic-link') ||
        reqUrl.includes('/auth/signup');
      toast.error(isAuthFlowUrl ? message : 'Server error. Please try again later.');
    }

    return Promise.reject(error);
  }
);

export { API_ORIGIN };
export { API_BASE_URL };
export default api;
