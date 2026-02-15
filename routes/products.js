const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Public routes
router.get('/', productController.getAllProducts);
router.get('/categories', productController.getAllCategories);
router.get('/homepage-sections', productController.getHomepageSections);
router.get('/settings', productController.getSiteSettings);
router.get('/search-suggestions', productController.getSearchSuggestions);
router.get('/category/:id', productController.getProductsByCategory);
router.get('/:id', productController.getProductById);

module.exports = router;
