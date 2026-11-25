import http from 'http';
import net from 'net';

export interface CallbackResult {
  code: string;
  state: string;
}

/** Find a free TCP port starting from the given candidate. */
export function findFreePort(start = 9876): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(start, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // port in use — try next
      findFreePort(start + 1)
        .then(resolve)
        .catch(reject);
    });
  });
}

const FAVICON =
  'data:image/x-icon;base64,AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAABMLAAATCwAAAAAAAAAAAAD///8A23tHAN2JTQDejVAA3YtPMN+NUbz2vGr1+sRu/vnCbf35wm3x+sRvqf3Lcwb9y3MA/ctzAP3LcwD///8A////ANt7RwDdiU0A3o1Qed6LT/nhkFL/971r8vrBbbD5wGub+8dxz/3Kcv39y3Pn/ctzF/3LcwD9y3MA////AP///wDbfEcA3opNcd+NUP7dik//4I1R1PrIcQD903cA/NB1Jf3UeAD9zXQ6/cty+/3Lc8/9ynIA/cpyAP///wD///8A23dFH92CSvjfjlH/3YlO/eqoYCj+2nxU/tt7zv7ae7D+2nuD/tV4AP3KcpP9y3P4/cpyHf3KcgD///8A////ANpzQqfac0P/3YFL/9yHTfD3y3Mu/95+6/7Yek3+2HoM/tl60P7VeEj9yXNh/ctz+f3Lcyb9y3MA////AP///wDadEPo2nND/9pzQ//ZdkP19MBsUv/gfvj92Ho1/dh6BP7ZeqH+1HgE/cpyzv3Lc+f9y3IG/ctyAP///wD///8A23ZE+9t1Q//bdEP/2G0//+KMUF3/4n/F/td69f7Yeov+2HpV/c50w/3Kcvn9y3JX/s1zAP/SdgD///8A////ANFtP/rVcEH/2HNC/9lyQv/ce0fh+tN3Bv/kgbT/3Hzx/tN37/7Lc+H/z3RP/9N2APzKcQDkpF0A////AP///wDHZDn2x2Q6/8llO//LZzz/yWM5/8xsPsXgm1gA9890AP7KcxT/znUA8r5rAN6cWAC3YTcAokIlAP///wD///8AyGU66shlOv/HZDr/x2Q6/8dlOv/GYTj/xl4258liOGLOeEQAx3tGAKZHKQCmRykApUUoAKlMKwD///8A////AMdlOo/JZjv/ymc7/8pnO//KZzv/ymc7/8hlOv+/XjX/q0sr76NDJsepTCuqp0gpq6hJKrWpTCuq////AP///wDNaDwbwmA4871cNf+8WzT/uFgy/7NUMP+tTi3/qEsq/6hKKv+pSyv/qEoq/7JZM/uuVDD/qEoq/f///wD///8AuFcyAKpNK2WmSSr9p0oq/6dJKv+nSSr/qEoq/6lLK/+pSyv/qUsr/6VFKP/TkVKIwXJA6KVFJ9H///8A////AKZJKQCnSyoAqUsrf6lLK7upSyv/qUwr/6lLK/+pTCv/qUsr/6lLK/+pSyv/q00s/qlMK+2pSysq////AP///wCoSyoAqEsqAKlLKwCpSyswqUsrzalLK/qpSyv/qUsr/6lLK/6pSyv/qUwr/6hKKvCpTCs4qUsrAP///wD///8AqEsqAKhLKgCpSysAqUsrAKlLKwCpSysfqUsraqlLK3SpSyt/qUwr8KlMK7apSysXqUwrAKlLKwD///8A8A8AAOAHAADDRwAAgCMAAIADAACAAwAAgAcAAIAPAACBvwAAgH8AAIABAACAAQAAwAEAAOABAADwAwAA/AcAAA==';

const SHARED_STYLE =
  'body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.card{text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;max-width:400px}h1{margin-bottom:.5rem}p{color:#94a3b8}';

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>DevPanel Login</title>
<link rel="icon" type="image/x-icon" href="${FAVICON}">
<style>${SHARED_STYLE}h1{color:#38bdf8}</style></head>
<body><div class="card">
<h1>&#10003; Logged in!</h1>
<p>You can close this tab and return to your terminal.</p>
</div></body></html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>DevPanel Login</title>
<link rel="icon" type="image/x-icon" href="${FAVICON}">
<style>${SHARED_STYLE}h1{color:#f87171}</style></head>
<body><div class="card">
<h1>&#10007; Login failed</h1>
<p>${msg}</p>
</div></body></html>`;

/**
 * Starts a one-shot local HTTP server that waits for Cognito to redirect
 * back with ?code=…&state=… and then resolves with those values.
 */
export function waitForCallback(
  port: number,
  expectedState: string,
  timeoutMs = 300_000,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out (5 min). Please try again.'));
    }, timeoutMs);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        const desc = url.searchParams.get('error_description') ?? error;
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(ERROR_HTML(desc));
        clearTimeout(timer);
        server.close();
        reject(new Error(`OAuth error: ${desc}`));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || state !== expectedState) {
        const msg = !code ? 'Missing authorization code.' : 'State mismatch — possible CSRF.';
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML(msg));
        clearTimeout(timer);
        server.close();
        reject(new Error(msg));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);
      clearTimeout(timer);
      server.close();
      resolve({ code, state });
    });

    server.listen(port, '127.0.0.1');
  });
}
