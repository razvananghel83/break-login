const UserRepository = require('./userRepository');
const TicketRepository = require('./ticketRepository');
const AuditLogRepository = require('./auditLogRepository');

class DbRepository {

  // pool = cache de conexiuni la DB care pot fi refolosite  
  constructor(pool) {
    this.userRepository = new UserRepository(pool);
    this.ticketRepository = new TicketRepository(pool);
    this.auditLogRepository = new AuditLogRepository(pool);
  }

  async createUser(email, password) {
    return this.userRepository.createUser(email, password);
  }

  async findUserByEmail(email) {
    return this.userRepository.findUserByEmail(email);
  }

  async incrementFailedAttempts(email) {
    return this.userRepository.incrementFailedAttempts(email);
  }

  async resetFailedAttempts(email) {
    return this.userRepository.resetFailedAttempts(email);
  }

  async lockAccount(email) {
    return this.userRepository.lockAccount(email);
  }

  async setResetToken(email, tokenHash, expires) {
    return this.userRepository.setResetToken(email, tokenHash, expires);
  }

  async findUserByResetToken(tokenHash) {
    return this.userRepository.findUserByResetToken(tokenHash);
  }

  async updatePasswordAndInvalidateToken(userId, newPasswordHash) {
    return this.userRepository.updatePasswordAndInvalidateToken(userId, newPasswordHash);
  }

  async updatePasswordByEmail(email, newPassword) {
    return this.userRepository.updatePasswordByEmail(email, newPassword);
  }

  async createTicket(title, description, severity, ownerId) {
    return this.ticketRepository.createTicket(title, description, severity, ownerId);
  }

  async listTickets(status, severity, ownerId = null) {
    return this.ticketRepository.listTicketsByOwner(ownerId, status, severity);
  }

  async getTicketById(ticketId) {
    return this.ticketRepository.getTicketById(ticketId);
  }

  async updateTicket(ticketId, fields) {
    return this.ticketRepository.updateTicket(ticketId, fields);
  }

  async deleteTicket(ticketId) {
    return this.ticketRepository.deleteTicket(ticketId);
  }

  async createAuditLog(userId, action, resource = null, resourceId = null, ip = '127.0.0.1') {
    return this.auditLogRepository.createAuditLog(userId, action, resource, resourceId, ip);
  }

  async listAuditLogs() {
    return this.auditLogRepository.listAuditLogs();
  }
}

module.exports = DbRepository;
