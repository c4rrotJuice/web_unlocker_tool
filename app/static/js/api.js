(function () {
  function getCookie(name) {
    return document.cookie
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.split('=')[1] || null;
  }

  async function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});

    if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = getCookie('csrf_token');
      if (csrf && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrf);
      }
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: 'include',
    });

    if (response.status === 401 && !options.skipAuthRedirect) {
      window.location.href = '/static/auth.html?reason=expired';
    }

    return response;
  }

  async function requireAuth() {
    const res = await apiFetch('/api/auth/me', { skipAuthRedirect: true });
    if (!res.ok) {
      window.location.href = '/static/auth.html';
      return null;
    }
    return res.json();
  }

  window.apiFetch = apiFetch;
  window.requireAuth = requireAuth;
})();
