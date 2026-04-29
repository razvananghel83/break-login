class UserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createUser(email, password) {
    const result = await this.pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, password]
    );
    return result.rows[0];
  }

  async findUserByEmail(email) {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  async updatePasswordByEmail(email, newPassword) {
    await this.pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [newPassword, email]);
  }
}

module.exports = UserRepository;
