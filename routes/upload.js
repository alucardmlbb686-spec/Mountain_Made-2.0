const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');

// Use memory storage so we can persist to DB (avoids losing files on redeploy)
const storage = multer.memoryStorage();

// Dynamic file filter - accept JPG/PNG/GIF/WEBP
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();    
    // Only accept JPG/PNG/GIF/WEBP files
    if (allowedTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPG, PNG, GIF, and WEBP images are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

async function saveUploadToDb(file) {
    const filename = file.originalname;
    const mimetype = file.mimetype;
    const data = file.buffer;
    const result = await db.query(
        'INSERT INTO uploads (filename, mimetype, data) VALUES ($1, $2, $3) RETURNING id',
        [filename, mimetype, data]
    );
    return result.rows[0].id;
}

// Image upload endpoint - accepts JPG/PNG/GIF
router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded or invalid file type.' });
        }

        const id = await saveUploadToDb(req.file);
        const imageUrl = `/uploads/${id}`;
        
        res.json({
            success: true,
            message: 'Image uploaded successfully',
            imageUrl,
            id
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message || 'Failed to upload image' });
    }
});

// Multiple image upload endpoint
router.post('/images', authenticateToken, upload.array('images', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded or invalid file type.' });
        }

        const ids = [];
        for (const file of req.files) {
            const id = await saveUploadToDb(file);
            ids.push(id);
        }

        const imageUrls = ids.map(id => `/uploads/${id}`);
        
        res.json({
            success: true,
            message: 'Images uploaded successfully',
            imageUrls,
            ids,
            count: ids.length
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message || 'Failed to upload images' });
    }
});

// Handle multer errors
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
        }
        return res.status(400).json({ error: err.message });
    } else if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

module.exports = router;
