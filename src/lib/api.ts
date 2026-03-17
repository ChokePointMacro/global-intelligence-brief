export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const sid = window.localStorage.getItem('debug_sid');
  const headers: Record<string, string> = {
    ...(options.headers as any),
    'Content-Type': 'application/json',
  };
  if (sid) headers['x-session-id'] = sid;
  return fetch(url, { ...options, headers, credentials: 'include' });
};
