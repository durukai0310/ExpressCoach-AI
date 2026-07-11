// ExpressCoach - Robust Public Tunnel with Keepalive
import localtunnel from 'localtunnel';
import http from 'http';

const PORT = 3001;
let heartbeatTimer = null;

// Keep tunnel alive with periodic health checks
function startHeartbeat(url) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    http.get(`${url}/api/health`, () => {}).on('error', () => {});
  }, 30000);
}

async function connect() {
  try {
    console.log('Creating tunnel...');
    const tunnel = await localtunnel({ port: PORT });
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║  ExpressCoach is ONLINE!            ║');
    console.log(`  ║  ${tunnel.url}    ║`);
    console.log('  ║  Share this URL with anyone!         ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    startHeartbeat(tunnel.url);

    tunnel.on('close', () => {
      console.log('[tunnel] Disconnected, reconnecting...');
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      setTimeout(connect, 5000);
    });
  } catch (e) {
    console.log('[tunnel] Error:', e.message, '- retrying in 5s...');
    setTimeout(connect, 5000);
  }
}

console.log('ExpressCoach Tunnel (keepalive enabled)');
console.log('Waiting for server on port', PORT, '...');

(function wait() {
  http.get(`http://localhost:${PORT}/api/health`, (r) => {
    if (r.statusCode === 200) { console.log('Server ready!'); connect(); }
    else setTimeout(wait, 2000);
  }).on('error', () => { process.stdout.write('.'); setTimeout(wait, 2000); });
})();
