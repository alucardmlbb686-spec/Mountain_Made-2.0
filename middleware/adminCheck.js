const isAdminLike = (role) => role === 'admin' || role === 'super_admin';

const adminCheck = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (!isAdminLike(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  next();
};

const superAdminCheck = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required.' });
  }

  next();
};

const wholesaleCheck = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (req.user.role !== 'wholesale' && !isAdminLike(req.user.role)) {
    return res.status(403).json({ error: 'Wholesale or admin access required.' });
  }

  if (req.user.role === 'wholesale' && !req.user.is_approved) {
    return res.status(403).json({ error: 'Your wholesale account is pending approval.' });
  }

  next();
};

module.exports = { adminCheck, superAdminCheck, wholesaleCheck };
