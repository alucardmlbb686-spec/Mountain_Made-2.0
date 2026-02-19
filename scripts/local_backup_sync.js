const fs = require('fs');
const path = require('path');

const requiredEnv = ['BACKUP_SYNC_BASE_URL', 'BACKUP_SYNC_EMAIL', 'BACKUP_SYNC_PASSWORD', 'BACKUP_LOCAL_DIR'];

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const toBool = (value) => String(value || '').trim().toLowerCase() === 'true';

function ensureEnv() {
  const missing = requiredEnv.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: text };
  }
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await parseJsonSafe(response);
  if (!response.ok || !data?.token) {
    throw new Error(data?.error || 'Login failed');
  }

  return data.token;
}

async function getHistory(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/backup/history`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data?.error || 'Failed to get backup history');
  }

  return Array.isArray(data?.backups) ? data.backups : [];
}

async function downloadBackup(baseUrl, token, backupId) {
  const response = await fetch(`${baseUrl}/api/backup/${backupId}/download`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const data = await parseJsonSafe(response);
    throw new Error(data?.error || `Failed to download backup ${backupId}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function syncOnce() {
  ensureEnv();

  const baseUrl = normalizeBaseUrl(process.env.BACKUP_SYNC_BASE_URL);
  const email = String(process.env.BACKUP_SYNC_EMAIL || '').trim();
  const password = String(process.env.BACKUP_SYNC_PASSWORD || '').trim();
  const targetDir = String(process.env.BACKUP_LOCAL_DIR || '').trim();
  const maxPerRun = Math.max(1, Number(process.env.BACKUP_SYNC_MAX_PER_RUN || 3));

  await fs.promises.mkdir(targetDir, { recursive: true });

  const token = await login(baseUrl, email, password);
  const history = await getHistory(baseUrl, token);
  const completed = history
    .filter((item) => item?.status === 'completed' && item?.id && item?.filename)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, maxPerRun);

  if (completed.length === 0) {
    console.log(`[${new Date().toISOString()}] No completed backups found.`);
    return;
  }

  for (const backup of completed) {
    const safeName = path.basename(String(backup.filename));
    const localPath = path.join(targetDir, safeName);

    if (fs.existsSync(localPath)) {
      console.log(`[${new Date().toISOString()}] Skip existing: ${safeName}`);
      continue;
    }

    const fileBuffer = await downloadBackup(baseUrl, token, backup.id);
    await fs.promises.writeFile(localPath, fileBuffer);
    console.log(`[${new Date().toISOString()}] Downloaded: ${safeName} -> ${localPath}`);
  }
}

async function run() {
  try {
    await syncOnce();

    if (toBool(process.env.BACKUP_SYNC_RUN_ONCE)) {
      return;
    }

    const intervalMinutes = Math.max(5, Number(process.env.BACKUP_SYNC_INTERVAL_MINUTES || 30));
    console.log(`Local backup sync is running every ${intervalMinutes} minutes...`);

    setInterval(async () => {
      try {
        await syncOnce();
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Sync failed: ${error.message}`);
      }
    }, intervalMinutes * 60 * 1000);
  } catch (error) {
    console.error('Local backup sync startup failed:', error.message);
    process.exit(1);
  }
}

run();
