class AuditLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createAuditLog(userId, action, resource = null, resourceId = null, ip = '127.0.0.1') {
    await this.pool.query(
      'INSERT INTO audit_logs (user_id, action, resource, resource_id, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [userId, action, resource, resourceId, ip]
    );
  }

  async listAuditLogs() {
    const result = await this.pool.query(
      'SELECT a.*, u.email FROM audit_logs a JOIN users u ON a.user_id = u.id ORDER BY timestamp DESC'
    );
    return result.rows;
  }
}

module.exports = AuditLogRepository;
