/**
 * The live-updates WebSocket (/ws/logs).
 *
 * - Only signed-in, allow-listed people can connect (same cookie as the REST API).
 * - Connections from other websites are refused.
 * - Every job event goes only to the sockets of the person whose search it is.
 */

import { WebSocketServer } from 'ws';

import { TRUST_PROXY } from './config.js';
import { isSameSite } from './utils/origin.js';

export function attachWebSocket(server, { auth, jobManager, heartbeatMs = 30_000 }) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const refuse = (status) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };

    if (new URL(req.url, 'http://localhost').pathname !== '/ws/logs') return refuse('404 Not Found');

    if (!isSameSite(req.headers.origin, req.headers, TRUST_PROXY)) return refuse('403 Forbidden');

    const user = auth.userFromRequest(req);
    if (!user) return refuse('401 Unauthorized');

    return wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('error', () => socket.terminate());
  });

  const onMessage = ({ owner, ...message }) => {
    if (!wss.clients.size) return;
    const data = JSON.stringify(message); // serialise once
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN && client.userId === owner) client.send(data);
    }
  };
  jobManager.on('message', onMessage);

  // Ping every client; drop the ones that stopped answering (also keeps proxies from idling the socket out).
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    wss,
    close() {
      clearInterval(heartbeat);
      jobManager.off('message', onMessage);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
