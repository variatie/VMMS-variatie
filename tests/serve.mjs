import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain'};
createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (target !== root && !target.startsWith(root + sep)) {response.writeHead(403).end();return}
  try {
    const data = await readFile(target);
    const extension = target.slice(target.lastIndexOf('.'));
    response.writeHead(200, {'Content-Type':mime[extension] || 'application/octet-stream','Cache-Control':'no-store'}).end(data);
  } catch {response.writeHead(404).end()}
}).listen(8765, '127.0.0.1', () => console.log('VMMS testserver: http://127.0.0.1:8765'));
