const { Pool } = require('pg');
require('dotenv').config();

// Validate that DB_PASSWORD is set if PostgreSQL requires authentication
if (!process.env.DB_PASSWORD && process.env.NODE_ENV !== 'development-no-auth') {
  console.warn('⚠️  WARNING: DB_PASSWORD is not set in .env file');
  console.warn('If your PostgreSQL server requires a password, the connection will fail.');
  console.warn('Update your .env file with: DB_PASSWORD=your_postgresql_password');
}

const dbName = process.env.DB_NAME || 'mountain_made';

// Create pool config for the target database
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  database: dbName,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Add password if provided
if (process.env.DB_PASSWORD) {
  poolConfig.password = process.env.DB_PASSWORD;
}

// Create a temporary pool config for the postgres database (to create the target database if it doesn't exist)
const adminPoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  database: 'postgres',
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

if (process.env.DB_PASSWORD) {
  adminPoolConfig.password = process.env.DB_PASSWORD;
}

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

// Create database if it doesn't exist
const ensureDatabaseExists = async () => {
  const adminPool = new Pool(adminPoolConfig);
  const client = await adminPool.connect();
  try {
    // Check if database exists
    const result = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );
    
    if (result.rows.length === 0) {
      console.log(`Creating database: ${dbName}`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✓ Database created: ${dbName}`);
    } else {
      console.log(`✓ Database already exists: ${dbName}`);
    }
  } finally {
    client.release();
    await adminPool.end();
  }
};

// Database initialization and schema creation
const initializeDatabase = async () => {
  // First ensure the database exists
  await ensureDatabaseExists();
  
  const client = await pool.connect();
  try {
    console.log('Initializing database schema...');

    // Create Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        role VARCHAR(20) DEFAULT 'customer' CHECK (role IN ('customer', 'wholesale', 'admin')),
        business_name VARCHAR(255),
        tax_id VARCHAR(50),
        is_approved BOOLEAN DEFAULT false,
        is_blocked BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add is_blocked column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='users' AND column_name='is_blocked') THEN
          ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);

    // Create Categories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        image_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Homepage Sections table for custom featured sections
    await client.query(`
      CREATE TABLE IF NOT EXISTS homepage_sections (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Site Settings table for logo and other site customizations
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        homepage_section_id INTEGER REFERENCES homepage_sections(id) ON DELETE SET NULL,
        price DECIMAL(10, 2) NOT NULL,
        wholesale_price DECIMAL(10, 2),
        stock_quantity INTEGER DEFAULT 0,
        min_wholesale_qty INTEGER DEFAULT 10,
        image_url VARCHAR(500),
        images JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        weight DECIMAL(10, 2),
        unit VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add homepage_section_id column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='products' AND column_name='homepage_section_id') THEN
          ALTER TABLE products ADD COLUMN homepage_section_id INTEGER REFERENCES homepage_sections(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Create Cart table
    await client.query(`
      CREATE TABLE IF NOT EXISTS cart (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      );
    `);

    // Create Orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        order_number VARCHAR(50) UNIQUE NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
        shipping_address JSONB NOT NULL,
        payment_method VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add delivery columns to orders table for shipping options (if they don't already exist)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'delivery_speed'
        ) THEN
          ALTER TABLE orders ADD COLUMN delivery_speed VARCHAR(50);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'delivery_charge'
        ) THEN
          ALTER TABLE orders ADD COLUMN delivery_charge DECIMAL(10, 2) DEFAULT 0;
        END IF;
      END $$;
    `);

    // Create Order Items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Addresses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        label VARCHAR(100) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        postal_code VARCHAR(20) NOT NULL,
        country VARCHAR(100) DEFAULT 'USA',
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
      CREATE INDEX IF NOT EXISTS idx_products_homepage_section ON products(homepage_section_id);
      CREATE INDEX IF NOT EXISTS idx_cart_user ON cart(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
    `);

    // Create or replace a dynamic stock report VIEW that always reflects
    // the latest product and order data from the core tables
    await client.query(`
      CREATE OR REPLACE VIEW product_stock_report AS
      SELECT 
        p.id,
        p.name,
        p.description,
        p.category_id,
        c.name AS category_name,
        p.price,
        p.wholesale_price,
        p.stock_quantity AS current_stock,
        p.images,
        p.is_active,
        p.created_at,
        COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN oi.quantity ELSE 0 END), 0) AS total_sold,
        (p.stock_quantity + COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN oi.quantity ELSE 0 END), 0)) AS initial_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE p.is_active = true
      GROUP BY p.id, p.name, p.description, p.category_id, c.name, p.price,
               p.wholesale_price, p.stock_quantity, p.images, p.is_active, p.created_at
      ORDER BY p.id ASC;
    `);

    // Also maintain a physical table snapshot for tools like pgAdmin
    // so stock report appears under Tables as well.
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_stock_report_table (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INTEGER,
        category_name VARCHAR(100),
        price DECIMAL(10, 2),
        wholesale_price DECIMAL(10, 2),
        current_stock INTEGER,
        images JSONB,
        is_active BOOLEAN,
        created_at TIMESTAMP,
        total_sold INTEGER,
        initial_stock INTEGER
      );
    `);

    // Refresh the snapshot from the live view on startup
    await client.query('TRUNCATE TABLE product_stock_report_table');
    await client.query('INSERT INTO product_stock_report_table SELECT * FROM product_stock_report');

    // Insert default categories only when the table is empty
    // so deleted categories do not get recreated on every restart.
    const categoryCountResult = await client.query('SELECT COUNT(*)::int AS count FROM categories');
    if (categoryCountResult.rows[0].count === 0) {
      await client.query(`
        INSERT INTO categories (name, description, image_url) VALUES
        ('Fresh Produce', 'Farm-fresh fruits and vegetables', '/images/categories/produce.jpg'),
        ('Dairy Products', 'Milk, cheese, and dairy items', '/images/categories/dairy.jpg'),
        ('Bakery', 'Fresh bread and baked goods', '/images/categories/bakery.jpg'),
        ('Meat & Poultry', 'Quality meats and poultry', '/images/categories/meat.jpg'),
        ('Beverages', 'Drinks and refreshments', '/images/categories/beverages.jpg'),
        ('Snacks', 'Healthy snacks and treats', '/images/categories/snacks.jpg')
        ON CONFLICT (name) DO NOTHING;
      `);
    }

    // Insert default homepage section only when the table is empty
    const sectionCountResult = await client.query('SELECT COUNT(*)::int AS count FROM homepage_sections');
    if (sectionCountResult.rows[0].count === 0) {
      await client.query(`
        INSERT INTO homepage_sections (name, description, sort_order, is_active) VALUES
        ('Featured Products', 'Handpicked selections from our premium collection', 1, true)
        ON CONFLICT (name) DO NOTHING;
      `);
    }

    console.log('✓ Database schema initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initializeDatabase
};
