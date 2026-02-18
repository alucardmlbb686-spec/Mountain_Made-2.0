const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const db = require('../config/database');
const execAsync = promisify(exec);

async function countUsersRowsInSql(sqlFilePath) {
  try {
    const stream = fs.createReadStream(sqlFilePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let inUsersCopy = false;
    let count = 0;
    let markerCount = null;

    for await (const line of rl) {
      if (markerCount === null) {
        const markerMatch = line.match(/^--\s*APP_USERS_TOTAL\s*:\s*(\d+)\s*$/);
        if (markerMatch) {
          markerCount = parseInt(markerMatch[1], 10);
        }
      }

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

    if (typeof markerCount === 'number' && !Number.isNaN(markerCount)) {
      return markerCount;
    }

    return count;
  } catch (error) {
    console.warn('Could not inspect users rows in SQL file:', error.message);
    return null;
  }
}

// Restore database from uploaded SQL file
exports.restoreDatabase = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const sqlFilePath = req.file.path;

    // Inspect uploaded SQL so we know how many user rows are in the backup file itself
    const expectedUsersFromBackup = await countUsersRowsInSql(sqlFilePath);

    // Get DB credentials
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '5432';
    const dbName = process.env.DB_NAME || 'mountain_made';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD || '';
    const psqlBinary = process.env.PSQL_PATH || 'psql';
    const env = { ...process.env, PGPASSWORD: dbPassword };

    // Step 1: Reset schema so restore doesn't fail with duplicate rows (e.g., existing admin/user IDs)
    const resetCmd = `"${psqlBinary}" -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"`;
    await execAsync(resetCmd, { env, windowsHide: true });

    // Step 2: Restore SQL and stop on first error
    const restoreCmd = `"${psqlBinary}" -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -v ON_ERROR_STOP=1 -f "${sqlFilePath}"`;
    await execAsync(restoreCmd, { env, windowsHide: true });

    // Verify key data is present after restore
    let usersCount = 0;
    try {
      const result = await db.query('SELECT COUNT(*)::int AS count FROM users');
      usersCount = result.rows[0]?.count || 0;
    } catch (verifyError) {
      console.warn('Post-restore verification warning:', verifyError.message);
    }

    if (typeof expectedUsersFromBackup === 'number' && usersCount < expectedUsersFromBackup) {
      return res.status(500).json({
        error: 'Restore completed with missing users data.',
        verification: {
          expectedUsersFromBackup,
          restoredUsersCount: usersCount
        }
      });
    }

    if (typeof expectedUsersFromBackup === 'number' && expectedUsersFromBackup <= 1) {
      return res.json({
        message: 'Database restored successfully, but the uploaded backup contains only admin/no additional users.',
        verification: {
          usersCount,
          expectedUsersFromBackup,
          warning: 'Backup file has no non-admin users to restore.'
        }
      });
    }

    // Optionally delete the uploaded file after restore
    fs.unlink(sqlFilePath, () => {});

    res.json({
      message: 'Database restored successfully.',
      verification: {
        usersCount,
        expectedUsersFromBackup
      }
    });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Restore failed: ' + error.message });
  }
};
