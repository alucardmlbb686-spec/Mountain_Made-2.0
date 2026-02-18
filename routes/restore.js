const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { superAdminCheck } = require('../middleware/adminCheck');
const restoreController = require('../controllers/restoreController');

// Multer config for SQL uploads
const upload = multer({
  dest: path.join(__dirname, '../tmp'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/sql' || file.originalname.endsWith('.sql')) {
      cb(null, true);
    } else {
      cb(new Error('Only .sql files are allowed'));
    }
  }
});

router.use(authenticateToken, superAdminCheck);

// POST /api/restore
router.post('/', upload.single('sqlfile'), restoreController.restoreDatabase);

module.exports = router;
