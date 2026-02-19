const Backup = require('../models/Backup');
const db = require('../config/database');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const fsSync = require('fs');
const readline = require('readline');
const path = require('path');
const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';
let autoBackupTimer = null;
let isAutoBackupRunning = false;

const toBool = (value) => String(value || '').trim().toLowerCase() === 'true';

const getAutoBackupIntervalMs = () => {
  const minutesRaw = Number(process.env.AUTO_BACKUP_INTERVAL_MINUTES || 0);
  if (Number.isFinite(minutesRaw) && minutesRaw > 0) {
    return Math.max(5, minutesRaw) * 60 * 1000;
  }

  const hoursRaw = Number(process.env.AUTO_BACKUP_INTERVAL_HOURS || 24);
  const safeHours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 24;
  return safeHours * 60 * 60 * 1000;
};

function toSqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString().replace('T', ' ').replace('Z', '')}'`;
  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
}

async function countUsersRowsInSql(sqlFilePath) {
  try {
    const stream = fsSync.createReadStream(sqlFilePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let inUsersCopy = false;
    let count = 0;

    for await (const line of rl) {
      if (!inUsersCopy) {
        if (line.startsWith('COPY public.users ') && line.includes(' FROM stdin;')) {
          inUsersCopy = true;
        }
        continue;
      }

      if (line.trim() === '\\.') {
        break;
      }

      if (line.trim().length > 0) {
        count += 1;
      }
    }

    return count;
  } catch (error) {
    console.warn('Could not inspect users rows in SQL backup:', error.message);
    return null;
  }
}

async function countTableRowsInSql(sqlFilePath, tableName) {
  try {
    const stream = fsSync.createReadStream(sqlFilePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const markerRegex = new RegExp(`^--\\s*APP_${String(tableName || '').toUpperCase()}_TOTAL\\s*:\\s*(\\d+)\\s*$`);
    const copyPrefix = `COPY public.${tableName} `;

    let inCopyBlock = false;
    let count = 0;
    let markerCount = null;

    for await (const line of rl) {
      if (markerCount === null) {
        const markerMatch = line.match(markerRegex);
        if (markerMatch) {
          markerCount = parseInt(markerMatch[1], 10);
        }
      }

      if (!inCopyBlock) {
        if (line.startsWith(copyPrefix) && line.includes(' FROM stdin;')) {
          inCopyBlock = true;
        }
        continue;
      }

      if (line.trim() === '\\.') {
        break;
      }

      if (line.trim().length > 0) {
        count += 1;
      }
    }

    if (typeof markerCount === 'number' && !Number.isNaN(markerCount)) {
      return markerCount;
    }

    return inCopyBlock ? count : 0;
  } catch (error) {
    console.warn(`Could not inspect ${tableName} rows in SQL backup:`, error.message);
    return null;
  }
}

async function appendTableUpsertBlock(sqlFilePath, tableName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0]);
  const quotedColumns = columns.map(col => `"${col}"`).join(', ');
  const conflictTarget = columns.includes('id') ? 'id' : columns[0];
  const updateCols = columns.filter(col => col !== conflictTarget);
  const updateSet = updateCols.map(col => `"${col}" = EXCLUDED."${col}"`).join(', ');

  let block = `\n\n-- APP_${String(tableName).toUpperCase()}_TOTAL:${rows.length}\n`;
  block += `-- App-level ${tableName} backup (ensures all ${tableName} rows are restorable)\n`;

  for (const row of rows) {
    const values = columns.map(col => toSqlLiteral(row[col])).join(', ');
    block += `INSERT INTO public.${tableName} (${quotedColumns}) VALUES (${values}) ON CONFLICT ("${conflictTarget}") DO UPDATE SET ${updateSet};\n`;
  }

  await fs.appendFile(sqlFilePath, block, 'utf8');
}

// Get available drives and their space (Windows)
exports.getDrives = async (req, res) => {
  try {
    if (isWindows) {
      const { stdout } = await execAsync(
        'powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name=\'FreeSpace\';Expression={$_.Free}}, @{Name=\'TotalSpace\';Expression={$_.Used + $_.Free}} | ConvertTo-Json"',
        { windowsHide: true }
      );

      const drives = JSON.parse(stdout);
      const driveList = (Array.isArray(drives) ? drives : [drives])
        .filter(drive => drive.FreeSpace !== null)
        .map(drive => ({
          name: drive.Name + ':',
          freeSpaceGB: (drive.FreeSpace / (1024 ** 3)).toFixed(2),
          totalSpaceGB: (drive.TotalSpace / (1024 ** 3)).toFixed(2),
          usedSpaceGB: ((drive.TotalSpace - drive.FreeSpace) / (1024 ** 3)).toFixed(2),
          freeSpaceBytes: drive.FreeSpace,
          totalSpaceBytes: drive.TotalSpace
        }));

      return res.json({ drives: driveList });
    }

    const { stdout } = await execAsync('df -kP /');
    const lines = stdout.trim().split('\n');
    const dataLine = lines[lines.length - 1] || '';
    const parts = dataLine.trim().split(/\s+/);

    const totalKB = Number(parts[1] || 0);
    const usedKB = Number(parts[2] || 0);
    const availableKB = Number(parts[3] || 0);

    const totalBytes = totalKB * 1024;
    const usedBytes = usedKB * 1024;
    const freeBytes = availableKB * 1024;

    return res.json({
      drives: [{
        name: '/',
        freeSpaceGB: (freeBytes / (1024 ** 3)).toFixed(2),
        totalSpaceGB: (totalBytes / (1024 ** 3)).toFixed(2),
        usedSpaceGB: (usedBytes / (1024 ** 3)).toFixed(2),
        freeSpaceBytes: freeBytes,
        totalSpaceBytes: totalBytes
      }]
    });
  } catch (error) {
    console.error('Get drives error:', error);
    if (!isWindows) {
      return res.json({
        drives: [{
          name: '/',
          freeSpaceGB: '0.00',
          totalSpaceGB: '0.00',
          usedSpaceGB: '0.00',
          freeSpaceBytes: 0,
          totalSpaceBytes: 0
        }]
      });
    }
    res.status(500).json({ error: 'Failed to get drive information' });
  }
};

const createBackupInternal = async ({ drive, folderPath, createdByUserId = null }) => {
    const driveInput = (drive || '').trim();
    const envBackupRoot = (process.env.BACKUP_DIR || '').trim();

    // Allow optional folderPath (can be empty string)
    const safeFolderPath = (folderPath || '').trim();

    let backupRoot;
    if (isWindows) {
      if (!driveInput && !envBackupRoot) {
        throw new Error('Drive is required on Windows');
      }
      backupRoot = envBackupRoot || `${driveInput}\\`;
    } else {
      backupRoot = envBackupRoot || '/tmp';
    }

    const backupDir = safeFolderPath
      ? path.join(backupRoot, safeFolderPath)
      : path.join(backupRoot, 'mountain_made_backups');

    const driveLabel = driveInput || (isWindows ? backupRoot : '/');
    
    // Create directory if it doesn't exist
    try {
      await fs.mkdir(backupDir, { recursive: true });
    } catch (err) {
      throw new Error('Failed to create backup directory: ' + err.message);
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `mountain_made_backup_${timestamp}.sql`;
    const filePath = path.join(backupDir, filename);

    // Get database credentials from environment
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '5432';
    const dbName = process.env.DB_NAME || 'mountain_made';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD || '';

    // Set PGPASSWORD environment variable for pg_dump
    const env = { ...process.env, PGPASSWORD: dbPassword };

    // Determine pg_dump binary path (allow override via PG_DUMP_PATH)
    const pgDumpBinary = process.env.PG_DUMP_PATH || 'pg_dump';

    // Snapshot user counts at backup time for visibility/verification
    let usersTotal = 0;
    let nonAdminUsers = 0;
    try {
      const countResult = await db.query(`
        SELECT
          COUNT(*)::int AS users_total,
          COUNT(*) FILTER (WHERE role <> 'admin')::int AS non_admin_users
        FROM users
      `);
      usersTotal = countResult.rows[0]?.users_total || 0;
      nonAdminUsers = countResult.rows[0]?.non_admin_users || 0;
    } catch (countError) {
      console.warn('Backup user count warning:', countError.message);
    }

    // Execute pg_dump command (quote binary and output path for Windows safety)
    const pgDumpCommand = `"${pgDumpBinary}" -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p -f "${filePath}"`;

    console.log('Starting database backup...');
    
    try {
      await execAsync(pgDumpCommand, { env, windowsHide: true });
      
      // Append app-level critical table upsert blocks so data is restorable even if pg_dump COPY is partial
      const usersResult = await db.query('SELECT * FROM users ORDER BY id ASC');
      const usersRows = usersResult.rows || [];
      const ordersResult = await db.query('SELECT * FROM orders ORDER BY id ASC');
      const ordersRows = ordersResult.rows || [];
      const orderItemsResult = await db.query('SELECT * FROM order_items ORDER BY id ASC');
      const orderItemsRows = orderItemsResult.rows || [];

      await appendTableUpsertBlock(filePath, 'users', usersRows);
      await appendTableUpsertBlock(filePath, 'orders', ordersRows);
      await appendTableUpsertBlock(filePath, 'order_items', orderItemsRows);

      // Get file size after append
      const stats = await fs.stat(filePath);
      const fileSizeBytes = stats.size;
      const fileSizeMB = (fileSizeBytes / (1024 ** 2)).toFixed(2);

      // Verify backup file contains critical table rows (marker-aware)
      const usersRowsInDump = usersRows.length;
      if (usersRowsInDump < usersTotal) {
        throw new Error(`Backup verification failed: users in database=${usersTotal}, users in backup=${usersRowsInDump}`);
      }

      const ordersRowsInDump = await countTableRowsInSql(filePath, 'orders');
      const orderItemsRowsInDump = await countTableRowsInSql(filePath, 'order_items');
      const ordersTotal = ordersRows.length;
      const orderItemsTotal = orderItemsRows.length;

      if (typeof ordersRowsInDump === 'number' && ordersRowsInDump < ordersTotal) {
        throw new Error(`Backup verification failed: orders in database=${ordersTotal}, orders in backup=${ordersRowsInDump}`);
      }

      if (typeof orderItemsRowsInDump === 'number' && orderItemsRowsInDump < orderItemsTotal) {
        throw new Error(`Backup verification failed: order_items in database=${orderItemsTotal}, order_items in backup=${orderItemsRowsInDump}`);
      }

      // Save backup record to database
      const backupRecord = await Backup.create({
        filename,
        file_path: filePath,
        drive: driveLabel,
        file_size: fileSizeBytes,
        created_by: createdByUserId,
        status: 'completed'
      });

      console.log('✓ Backup completed successfully');

      return {
        message: 'Database backup created successfully',
        backup: {
          id: backupRecord.id,
          filename,
          filePath,
          drive: driveLabel,
          fileSizeMB,
          createdAt: backupRecord.created_at,
          snapshot: {
            usersTotal,
            nonAdminUsers,
            usersRowsInDump,
            ordersTotal,
            orderItemsTotal,
            ordersRowsInDump,
            orderItemsRowsInDump
          }
        }
      };
    } catch (pgError) {
      console.error('pg_dump error:', pgError);
      
      // Save failed backup record
      await Backup.create({
        filename,
        file_path: filePath,
        drive: driveLabel,
        file_size: 0,
        created_by: createdByUserId,
        status: 'failed',
        error_message: pgError.message
      });

      // Provide clearer guidance when pg_dump is missing
      const notRecognized = pgError.message && pgError.message.includes('\'pg_dump\' is not recognized');
      const errorMessage = notRecognized
        ? 'pg_dump executable not found. Set PG_DUMP_PATH in your .env to the full path of pg_dump.exe (e.g., C:/Program Files/PostgreSQL/16/bin/pg_dump.exe).'
        : 'Database backup failed: ' + pgError.message;

      const err = new Error(errorMessage);
      err.details = notRecognized
        ? 'Install PostgreSQL (with pgAdmin) and point PG_DUMP_PATH to pg_dump.exe, or add the PostgreSQL bin directory to your system PATH.'
        : 'Make sure PostgreSQL bin directory is in your system PATH';
      throw err;
    }
};

// Create database backup
exports.createBackup = async (req, res) => {
  try {
    const { drive, folderPath } = req.body;
    const response = await createBackupInternal({
      drive,
      folderPath,
      createdByUserId: req.user?.id || null
    });

    res.json(response);
  } catch (error) {
    console.error('Create backup error:', error);
    res.status(500).json({
      error: error.message,
      details: error.details || 'Backup creation failed'
    });
  }
};

exports.runAutomatedBackup = async () => {
  const autoDrive = process.env.AUTO_BACKUP_DRIVE || (isWindows ? 'C:' : '/');
  const autoFolder = process.env.AUTO_BACKUP_FOLDER || 'mountain_made_backups';
  return createBackupInternal({
    drive: autoDrive,
    folderPath: autoFolder,
    createdByUserId: null
  });
};

exports.startAutoBackupScheduler = () => {
  if (!toBool(process.env.AUTO_BACKUP_ENABLED)) {
    return;
  }

  if (autoBackupTimer) {
    return;
  }

  const intervalMs = getAutoBackupIntervalMs();

  const runJob = async () => {
    if (isAutoBackupRunning) {
      return;
    }

    isAutoBackupRunning = true;
    try {
      const result = await exports.runAutomatedBackup();
      const fileName = result?.backup?.filename || 'unknown';
      console.log(`✓ Auto backup completed: ${fileName}`);
    } catch (error) {
      console.error('Auto backup failed:', error.message || error);
    } finally {
      isAutoBackupRunning = false;
    }
  };

  autoBackupTimer = setInterval(runJob, intervalMs);

  if (typeof autoBackupTimer.unref === 'function') {
    autoBackupTimer.unref();
  }

  if (toBool(process.env.AUTO_BACKUP_RUN_ON_STARTUP)) {
    runJob();
  }

  const intervalMinutes = Math.round(intervalMs / 60000);
  console.log(`✓ Auto backup scheduler enabled (every ${intervalMinutes} minutes)`);
};

// Get all backups
exports.getAllBackups = async (req, res) => {
  try {
    const backups = await Backup.getAll();
    
    // Format backup data
    const formattedBackups = backups.map(backup => ({
      id: backup.id,
      filename: backup.filename,
      filePath: backup.file_path,
      drive: backup.drive,
      fileSizeMB: (backup.file_size / (1024 ** 2)).toFixed(2),
      status: backup.status,
      canDownload: backup.status === 'completed',
      createdBy: backup.created_by_name,
      createdAt: backup.created_at,
      errorMessage: backup.error_message
    }));

    res.json({ backups: formattedBackups });
  } catch (error) {
    console.error('Get backups error:', error);
    res.status(500).json({ error: 'Failed to get backups' });
  }
};

// Download backup file by backup ID
exports.downloadBackup = async (req, res) => {
  try {
    const { id } = req.params;
    const backup = await Backup.getById(id);

    if (!backup) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    const filePath = backup.file_path;
    if (!filePath || !fsSync.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Backup file is not available on server storage. Create a new backup and download it immediately.'
      });
    }

    const filename = backup.filename || `backup-${backup.id}.sql`;
    return res.download(filePath, filename);
  } catch (error) {
    console.error('Download backup error:', error);
    return res.status(500).json({ error: 'Failed to download backup file' });
  }
};

// Delete backup record (does not delete the actual file)
exports.deleteBackup = async (req, res) => {
  try {
    const { id } = req.params;
    const backup = await Backup.deleteById(id);
    
    if (!backup) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    res.json({ message: 'Backup record deleted successfully' });
  } catch (error) {
    console.error('Delete backup error:', error);
    res.status(500).json({ error: 'Failed to delete backup' });
  }
};
