import mysql from 'mysql2/promise';

const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = 3306,
  MYSQL_DB = '',
  MYSQL_USER = '',
  MYSQL_PASS = ''
} = process.env;

export const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASS,
  database: MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true
});

// cria a tabela usada para marcar picklists concluídas (se não existir)
export async function ensureCompletedTable() {
  const sql = `CREATE TABLE IF NOT EXISTS completed_picklists (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    operador_id INT UNSIGNED NOT NULL,
    picklist_id VARCHAR(64) NOT NULL,
    completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_operador_picklist (operador_id, picklist_id),
    KEY idx_operador (operador_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  await pool.query(sql);
}
