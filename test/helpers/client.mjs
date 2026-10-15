// Minimal cookie-jar client over Node's fetch. Redirects are returned, not followed.
export function createClient(baseUrl) {
  const jar = new Map();
  const remember = response => {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      if (/;\s*max-age=0/i.test(line)) jar.delete(name);
      else jar.set(name, pair.slice(index + 1));
    }
  };
  return {
    jar,
    async request(path, { method = 'GET', json, headers = {} } = {}) {
      const init = { method, redirect: 'manual', headers: { ...headers } };
      if (jar.size) init.headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
      if (json !== undefined) {
        init.body = JSON.stringify(json);
        init.headers['content-type'] = 'application/json';
      }
      const response = await fetch(baseUrl + path, init);
      remember(response);
      const text = await response.text();
      return { status: response.status, headers: response.headers, setCookie: response.headers.getSetCookie(), text, json: () => JSON.parse(text) };
    }
  };
}
