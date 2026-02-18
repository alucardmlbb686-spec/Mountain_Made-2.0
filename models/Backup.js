const db = require('../config/database');

class Backup {
  static async create(backupData) {
    const { filename, file_path, drive, file_size, created_by, status, error_message } = backupData;
    
    const query = `
      INSERT INTO backups (filename, file_path, drive, file_size, created_by, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const values = [filename, file_path, drive, file_size, created_by, status || 'completed', error_message || null];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  static async getAll() {
    const query = `
      SELECT b.*, u.full_name as created_by_name
      FROM backups b
      LEFT JOIN users u ON b.created_by = u.id
      ORDER BY b.created_at DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  static async getById(id) {
    const query = 'SELECT * FROM backups WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  static async deleteById(id) {
    const query = 'DELETE FROM backups WHERE id = $1 RETURNING *';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
}

module.exports = Backup;
