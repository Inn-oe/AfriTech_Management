// Thin fetch wrapper around the Flask JSON API.
async function request(method, url, body) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${url}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  // Session ended (logged out elsewhere, deactivated, expired): send the user back to login.
  if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

// PDFs are plain downloads served by the API.
export const pdfUrl = (path) => `/api${path}`;
