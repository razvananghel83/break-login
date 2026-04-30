const bcrypt = require('bcrypt');

class UserRepository {
  constructor(pool) {
    this.pool = pool;
    this.saltRounds = 10;
  }

  // Password protection: Se aplică bcrypt hashing asupra parolelor
  async createUser(email, password) {
    const hash = await bcrypt.hash(password, this.saltRounds);
    const result = await this.pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, role',
      [email, hash]
    );
    return result.rows[0];
  }

  async findUserByEmail(email) {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  // Brute Force Protection: Se încrementează încercările eșuate
  async incrementFailedAttempts(email) {
    await this.pool.query(
      'UPDATE users SET failed_attempts = failed_attempts + 1 WHERE email = $1',
      [email]
    );
  }

  // Brute Force Protection: Resetare încercări eșuate la login reușit
  async resetFailedAttempts(email) {
    await this.pool.query(
      'UPDATE users SET failed_attempts = 0 WHERE email = $1',
      [email]
    );
  }

  // Brute Force Protection: Blocare cont
  async lockAccount(email) {
    await this.pool.query(
      'UPDATE users SET locked = true WHERE email = $1',
      [email]
    );
  }

  // Password Reset: Salvare hash token și expirare
  async setResetToken(email, tokenHash, expires) {
    await this.pool.query(
      'UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE email = $3',
      [tokenHash, expires, email]
    );
  }

  // Password Reset: User-ul e căutat în DB după hash-ul token-ului
  async findUserByResetToken(tokenHash) {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE reset_token_hash = $1 AND reset_token_expires > NOW()',
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  // Password Reset: Update parolă și invalidare token (one-time use)
  async updatePasswordAndInvalidateToken(userId, newPasswordHash) {
    await this.pool.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2',
      [newPasswordHash, userId]
    );
  }
}

module.exports = UserRepository;
