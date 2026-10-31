/** Empty public catalogue for SEO builds: localhost only, no production credentials or writes. */
import { createServer } from 'node:http';
const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(request.headers.accept?.includes('vnd.pgrst.object') ? 'null' : '[]');
});
server.listen(54329, '127.0.0.1', () => console.log('SEO test catalogue: http://127.0.0.1:54329'));
