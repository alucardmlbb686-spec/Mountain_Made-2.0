const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists.' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      is_approved: user.is_approved,
      is_blocked: user.is_blocked,
      profile_photo: user.profile_photo
    };

    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

const optionalAuth = async (req, res, next) => {
  const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user && !user.is_blocked) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          is_approved: user.is_approved,
          is_blocked: user.is_blocked,
          profile_photo: user.profile_photo
        };
      } else {
        req.user = null;
      }
    } catch (error) {
      // Token invalid, but we don't block the request
      req.user = null;
    }
  }
  next();
};

module.exports = { authenticateToken, optionalAuth };
