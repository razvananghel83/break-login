class TicketRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createTicket(title, description, severity, ownerId) {
    const result = await this.pool.query(
      'INSERT INTO tickets (title, description, severity, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, severity, ownerId]
    );
    return result.rows[0];
  }

  async listTickets(status, severity) {
    return this.listTicketsByOwner(null, status, severity);
  }

  async listTicketsByOwner(ownerId = null, status = null, severity = null) {
    let query = 'SELECT t.*, u.email as owner_email FROM tickets t JOIN users u ON t.owner_id = u.id WHERE 1=1';
    const params = [];

    if (ownerId) {
      params.push(ownerId);
      query += ` AND t.owner_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (severity) {
      params.push(severity);
      query += ` AND severity = $${params.length}`;
    }

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // Update pentru (title, description, severity, status)
  async updateTicket(ticketId, fields = {}) {
    const allowed = ['title', 'description', 'severity', 'status'];
    const set = [];
    const params = [];

    Object.keys(fields).forEach((key) => {
      if (allowed.includes(key)) {
        params.push(fields[key]);
        set.push(`${key} = $${params.length}`);
      }
    });

    if (set.length === 0) return null;

    params.push(ticketId);
    const query = `UPDATE tickets SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`;
    const result = await this.pool.query(query, params);
    return result.rows[0] || null;
  }

  async deleteTicket(ticketId) {
    const result = await this.pool.query(
      'DELETE FROM tickets WHERE id = $1 RETURNING *',
      [ticketId]
    );
    return result.rows[0] || null;
  }

  async getTicketById(ticketId) {
    const result = await this.pool.query(
      'SELECT t.*, u.email as owner_email FROM tickets t JOIN users u ON t.owner_id = u.id WHERE t.id = $1',
      [ticketId]
    );
    return result.rows[0] || null;
  }
}

module.exports = TicketRepository;
