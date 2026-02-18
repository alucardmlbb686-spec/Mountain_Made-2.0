// Run this script to add profile_photo column to users table
// Usage: node migrate_profile_photo.js

const db = require('./config/database');

async function runMigration() {
  try {
    console.log('Adding profile_photo column to users table...');
    
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT
    `);
    
    console.log('✓ Migration completed successfully!');
    console.log('Users can now have individual profile photos stored in the database.');
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
