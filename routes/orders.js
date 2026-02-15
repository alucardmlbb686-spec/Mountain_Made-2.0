const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { authenticateToken } = require('../middleware/auth');

// All order routes require authentication
router.use(authenticateToken);

// Create order
router.post('/', async (req, res) => {
  try {
    const orderData = {
      ...req.body,
      user_id: req.user.id
    };

    const order = await Order.create(orderData);
    res.status(201).json({ 
      message: 'Order placed successfully.',
      order 
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// Get user's orders
router.get('/', async (req, res) => {
  try {
    const { status, limit } = req.query;
    const filters = {
      status,
      limit: limit ? parseInt(limit) : null
    };

    const orders = await Order.findByUserId(req.user.id, filters);
    res.json({ orders });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// Get specific order
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Check if order belongs to user (unless admin)
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    res.json({ order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// Quick buy - create order from single product
router.post('/quick-buy', async (req, res) => {
  try {
    const { product_id, quantity = 1, shipping_address, payment_method = 'COD' } = req.body;
    
    if (!product_id) {
      return res.status(400).json({ error: 'Product ID is required.' });
    }

    // Get product details
    const productQuery = `
      SELECT id, name, price, wholesale_price, discount_price, stock_quantity 
      FROM products 
      WHERE id = $1
    `;
    const productResult = await require('../config/database').query(productQuery, [product_id]);
    
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const product = productResult.rows[0];
    const retailPrice = product.discount_price != null ? product.discount_price : product.price;
    
    // Check stock
    if (product.stock_quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient stock.' });
    }

    // Determine price based on user type
    const isWholesale = req.user.is_wholesale_approved;
    const price = isWholesale && product.wholesale_price ? product.wholesale_price : retailPrice;
    const subtotal = price * quantity;

    // Create order
    const orderData = {
      user_id: req.user.id,
      total_amount: subtotal,
      shipping_address: shipping_address || {},
      payment_method,
      notes: 'Quick Buy Order',
      items: [{
        product_id: product.id,
        product_name: product.name,
        quantity,
        price,
        subtotal
      }]
    };

    const order = await Order.create(orderData);
    
    res.status(201).json({ 
      message: 'Order placed successfully!',
      order 
    });
  } catch (error) {
    console.error('Quick buy error:', error);
    res.status(500).json({ error: 'Failed to process quick buy.' });
  }
});

module.exports = router;
