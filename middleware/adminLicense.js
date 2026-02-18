const db = require('../config/database');

const LICENSE_EXPIRED_MESSAGE = 'Your License is expired Please Contact ur developer.';

function parseBoolean(value) {
  if (value === true || value === false) return value;
  return String(value || '').toLowerCase() === 'true';
}

function parseDateTime(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

async function getLicenseState() {
  const result = await db.query(
    `
      SELECT setting_key, setting_value
      FROM site_settings
      WHERE setting_key IN ('admin_license_blocked', 'admin_license_expires_at')
    `
  );

  const settings = {};
  result.rows.forEach((row) => {
    settings[row.setting_key] = row.setting_value;
  });

  const now = Date.now();
  const manualBlocked = parseBoolean(settings.admin_license_blocked);
  const expiresAtRaw = (settings.admin_license_expires_at || '').trim();
  const expiresAtMs = parseDateTime(expiresAtRaw);
  const isExpired = !!(expiresAtMs && now >= expiresAtMs);
  const isBlocked = manualBlocked || isExpired;

  return {
    isBlocked,
    isExpired,
    manualBlocked,
    expiresAt: expiresAtRaw || null,
    serverTime: new Date(now).toISOString(),
    message: isBlocked ? LICENSE_EXPIRED_MESSAGE : null
  };
}

const enforceAdminLicense = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return next();
    }

    const license = await getLicenseState();
    if (!license.isBlocked) {
      return next();
    }

    return res.status(403).json({
      error: LICENSE_EXPIRED_MESSAGE,
      code: 'ADMIN_LICENSE_EXPIRED',
      license
    });
  } catch (error) {
    console.error('Admin license check error:', error);
    return res.status(500).json({ error: 'Failed to validate admin license.' });
  }
};

module.exports = {
  enforceAdminLicense,
  getLicenseState,
  LICENSE_EXPIRED_MESSAGE
};
