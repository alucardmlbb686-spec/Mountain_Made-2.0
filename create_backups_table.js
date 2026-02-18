// Migration: Create backups table to track database backups
const db = require('./config/database');

async function createBackupsTable() {
  try {
    console.log('Creating backups table...');
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        drive VARCHAR(10),
        file_size BIGINT,
        status VARCHAR(50) DEFAULT 'completed',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT
      )
    `);
    
    console.log('✓ Backups table created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

createBackupsTable();
