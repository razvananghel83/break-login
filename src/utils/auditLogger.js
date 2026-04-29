class AuditLogger {
  constructor(repository) {
    this.repository = repository;
  }

  async log({ userId, action, resource = null, resourceId = null, ip = '127.0.0.1' }) {
    if (!userId) {
      return null;
    }

    // Inserez logul în baza de date
    return this.repository.createAuditLog(userId, action, resource, resourceId, ip);
  }

  // Creează un logger predefinite, în funcție de request ( acțiunea user-ului )
  createRequestLogger(req) {

    const base = {
      ip: req.ip
    };

    return {
      log: (entry) => this.log({ ...base, ...entry }),
      login: (userId) => this.log({ ...base, userId, action: 'LOGIN' }),
      logout: (userId) => this.log({ ...base, userId, action: 'LOGOUT' }),
      ticketCreate: (userId, ticketId) => this.log({ ...base, userId, action: 'CREATE_TICKET', resource: 'tickets', resourceId: ticketId }),
      ticketRead: (userId, ticketId) => this.log({ ...base, userId, action: 'READ_TICKET', resource: 'tickets', resourceId: ticketId }),
      ticketUpdate: (userId, ticketId) => this.log({ ...base, userId, action: 'UPDATE_TICKET', resource: 'tickets', resourceId: ticketId }),
      ticketDelete: (userId, ticketId) => this.log({ ...base, userId, action: 'DELETE_TICKET', resource: 'tickets', resourceId: ticketId }),
      ticketList: (userId) => this.log({ ...base, userId, action: 'LIST_TICKETS', resource: 'tickets' })
    };
  }
}

module.exports = AuditLogger;
