import { spawn } from 'child_process';
import net from 'net';

let currentUrl = null;
let reconnectTimer = null;

export function getTunnelUrl() {
  return currentUrl;
}

export async function startTunnel(port) {
  console.log('  🔗 Starting public tunnel...\n');

  // Try localtunnel programmatically
  try {
    await tryLocalTunnel(port);
    return;
  } catch (e) {
    console.log('  ⚠️  localtunnel failed:', e.message);
    console.log('  Trying SSH tunnel...\n');
  }

  // Fallback to SSH tunnel (localhost.run)
  tryLocalhostRun(port);
}

function tryLocalTunnel(port) {
  return new Promise((resolve, reject) => {
    // Use npx localtunnel with auto-retry
    const lt = spawn('npx', [
      'localtunnel', '--port', String(port),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let started = false;
    let retries = 0;
    const maxRetries = 5;

    const handleOutput = (data) => {
      const text = data.toString();
      process.stdout.write(text);

      // Parse URL from localtunnel output
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.loca\.lt/);
      if (match && !started) {
        started = true;
        currentUrl = match[0];
        console.log(`\n  ✅ Public URL: ${currentUrl}\n`);
        console.log('  Share this link - anyone can open it!\n');
        resolve();
      }
    };

    lt.stdout.on('data', handleOutput);
    lt.stderr.on('data', handleOutput);

    lt.on('close', (code) => {
      if (!started) {
        retries++;
        if (retries < maxRetries) {
          console.log(`  Retrying... (${retries}/${maxRetries})`);
          setTimeout(() => tryLocalTunnel(port).then(resolve).catch(reject), 2000);
        } else {
          reject(new Error(`localtunnel exited with code ${code}`));
        }
      } else {
        // Reconnect on disconnect
        currentUrl = null;
        console.log('  Tunnel disconnected. Reconnecting in 5s...');
        reconnectTimer = setTimeout(() => {
          tryLocalTunnel(port).catch(() => tryLocalhostRun(port));
        }, 5000);
      }
    });

    lt.on('error', (err) => {
      if (!started) reject(err);
    });
  });
}

function tryLocalhostRun(port) {
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
    '-R', `80:localhost:${port}`,
    'localhost.run',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let started = false;

  const handleOutput = (data) => {
    const text = data.toString();
    process.stdout.write(text);

    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.lhr\.life/);
    if (match && !started) {
      started = true;
      currentUrl = match[0];
      console.log(`\n  ✅ Public URL: ${currentUrl}\n`);
      console.log('  Share this link - anyone can open it!\n');
    }
  };

  ssh.stdout.on('data', handleOutput);
  ssh.stderr.on('data', handleOutput);

  ssh.on('close', () => {
    currentUrl = null;
    console.log('\n  Tunnel disconnected. Reconnecting in 5s...');
    reconnectTimer = setTimeout(() => tryLocalhostRun(port), 5000);
  });
}

export function stopTunnel() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  currentUrl = null;
}
