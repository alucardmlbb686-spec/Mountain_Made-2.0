const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// All address routes require authentication
router.use(authenticateToken);

// Get all addresses for current user
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ addresses: result.rows });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ error: 'Failed to fetch addresses.' });
  }
});

// Get specific address
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT * FROM addresses WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found.' });
    }
    
    res.json({ address: result.rows[0] });
  } catch (error) {
    console.error('Get address error:', error);
    res.status(500).json({ error: 'Failed to fetch address.' });
  }
});

// Create new address
router.post('/', async (req, res) => {
  try {
    const {
      label,
      full_name,
      phone,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      is_default
    } = req.body;

    // Validate required fields
    if (!label || !full_name || !phone || !address_line1 || !city || !state || !postal_code) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // If this is being set as default, unset all other defaults for this user
      if (is_default) {
        await client.query(
          'UPDATE addresses SET is_default = false WHERE user_id = $1',
          [req.user.id]
        );
      }

      // Insert new address
      const result = await client.query(
        `INSERT INTO addresses 
         (user_id, label, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [req.user.id, label, full_name, phone, address_line1, address_line2, city, state, postal_code, country || 'USA', is_default || false]
      );

      await client.query('COMMIT');
      res.status(201).json({ 
        message: 'Address added successfully.',
        address: result.rows[0] 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ error: 'Failed to create address.' });
  }
});

// Update address
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      label,
      full_name,
      phone,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      is_default
    } = req.body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if address belongs to user
      const checkResult = await client.query(
        'SELECT id FROM addresses WHERE id = $1 AND user_id = $2',
        [id, req.user.id]
      );

      if (checkResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Address not found.' });
      }

      // If this is being set as default, unset all other defaults
      if (is_default) {
        await client.query(
          'UPDATE addresses SET is_default = false WHERE user_id = $1 AND id != $2',
          [req.user.id, id]
        );
      }

      // Update address
      const result = await client.query(
        `UPDATE addresses 
         SET label = $1, full_name = $2, phone = $3, address_line1 = $4, 
             address_line2 = $5, city = $6, state = $7, postal_code = $8, 
             country = $9, is_default = $10, updated_at = CURRENT_TIMESTAMP
         WHERE id = $11 AND user_id = $12
         RETURNING *`,
        [label, full_name, phone, address_line1, address_line2, city, state, postal_code, country, is_default, id, req.user.id]
      );

      await client.query('COMMIT');
      res.json({ 
        message: 'Address updated successfully.',
        address: result.rows[0] 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ error: 'Failed to update address.' });
  }
});

// Delete address
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found.' });
    }

    res.json({ message: 'Address deleted successfully.' });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ error: 'Failed to delete address.' });
  }
});

// Set default address
router.put('/:id/default', async (req, res) => {
  try {
    const { id } = req.params;
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Check if address belongs to user
      const checkResult = await client.query(
        'SELECT id FROM addresses WHERE id = $1 AND user_id = $2',
        [id, req.user.id]
      );

      if (checkResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Address not found.' });
      }

      // Unset all defaults for user
      await client.query(
        'UPDATE addresses SET is_default = false WHERE user_id = $1',
        [req.user.id]
      );

      // Set this address as default
      const result = await client.query(
        'UPDATE addresses SET is_default = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
        [id]
      );

      await client.query('COMMIT');
      res.json({ 
        message: 'Default address updated.',
        address: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({ error: 'Failed to set default address.' });
  }
});

module.exports = router;
