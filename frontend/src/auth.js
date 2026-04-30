const TOKEN_KEY = 'flux_token';
const SERVER_KEY = 'flux_server_url';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getServerUrl() {
  return localStorage.getItem(SERVER_KEY) || '';
}

export function setServerUrl(url) {
  localStorage.setItem(SERVER_KEY, url.replace(/\/$/, ''));
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiUrl(path) {
  const baseUrl = getServerUrl();
  if (!baseUrl) return path;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const sep = path.startsWith('/') ? '' : '/';
  return `${baseUrl}${sep}${path}`;
}

export async function apiFetch(url, opts = {}) {
  const hadToken = !!getToken();
  const fullUrl = apiUrl(url);
  const headers = { ...authHeaders(), ...(opts.headers || {}) };
  const res = await fetch(fullUrl, { ...opts, headers });
  if (res.status === 401 && hadToken) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  return res;
}
