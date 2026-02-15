const adminCheck = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  next();
};

const wholesaleCheck = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (req.user.role !== 'wholesale' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Wholesale or admin access required.' });
  }

  if (req.user.role === 'wholesale' && !req.user.is_approved) {
    return res.status(403).json({ error: 'Your wholesale account is pending approval.' });
  }

  next();
};

module.exports = { adminCheck, wholesaleCheck };
