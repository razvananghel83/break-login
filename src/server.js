const express = require('express');
const { Pool } = require('pg');     // pool-ul de conexiuni postgres
const cookieParser = require('cookie-parser');
const path = require('path');

const DbRepository = require('./repositories/DbRepository');
const AuditLogger = require('./utils/auditLogger');
const createAuditLoggerMiddleware = require('./middleware/auditLoggerMiddleware');

const fs = require('fs');

const app = express();
const port = 3000;

// Helper to read secrets from Docker Secrets mount
function getSecret(secretPath) {
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    // Fallback if secret file is not available
    return null;
  }
}

const dbPassword = getSecret('/run/secrets/app_password');
const dbUser = process.env.DB_USER || 'authx_app';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_NAME || 'authx_db_v2';

// Database connection
const pool = new Pool({
  connectionString: `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`,
});

const repo = new DbRepository(pool);
const auditLogger = new AuditLogger(repo);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(createAuditLoggerMiddleware(auditLogger));

// Voi stoca sesiunile în memorie fără a le cripta
const sessions = {};

// --- RUTE PENTRU AUTENTIFICARE ---

// Înregistrare: fără validări complexe, stochez parolele în plaintext
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await repo.createUser(email, password);
    res.json({ message: 'User registered successfully', user });
  } catch (err) {
    // Trimit la client erori detaliate
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Login: Mesaje de eroare specifice, Fără Rate Limiting, Cookies nesecurizați
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await repo.findUserByEmail(email);
    
    if (!user) {
      // Eroarea ("User not found")
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.password_hash !== password) {
      // Eroarea ("Incorrect password")
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Sesiune vulnerabilă
    const sessionId = Math.random().toString(36).substring(2);
    sessions[sessionId] = { userId: user.id, email: user.email, role: user.role };
    
    // Cookie-uri nesecurizate, fără flag-urile HttpOnly, Secure sau SameSite
    res.cookie('sessionId', sessionId);
    
    await req.auditLogger.login(user.id);
    
    res.json({ message: 'Login successful', user: { email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Password Reset: Tokeni predictibili
const resetTokens = {};
app.post('/api/request-reset', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await repo.findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Token format din "reset-" și email-ul user-ului
    const token = `reset-${email}`; 
    resetTokens[token] = email;
    
    res.json({ message: 'Reset token generated', token });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  const email = resetTokens[token];
  
  if (!email) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  
  try {
    await repo.updatePasswordByEmail(email, newPassword);
    // Token-ul nu e invalidat după utilizare, permițând reutilizarea
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.post('/api/logout', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (session) {
    await req.auditLogger.logout(session.userId);
  }
  delete sessions[sessionId];
  res.clearCookie('sessionId');
  res.json({ message: 'Logged out' });
});

app.get('/api/me', (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: session });
});

// --- RUTE PENTRU TICKETS ---

app.post('/api/tickets', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const { title, description, severity } = req.body;
  try {
    // Creez un ticket și atașez un logger
    const ticket = await repo.createTicket(title, description, severity, session.userId);
    await req.auditLogger.ticketCreate(session.userId, ticket.id);
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.get('/api/tickets', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { status, severity } = req.query;
    // RBAC: Un analyst poate vedea doar tichetele create de el, un manager le poate vedea pe toate
    const ownerId = session.role === 'ANALYST' ? session.userId : null;
    const tickets = await repo.listTickets(status, severity, ownerId);
    await req.auditLogger.ticketList(session.userId);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.get('/api/tickets/:id', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const ticket = await repo.getTicketById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // RBAC: Un analyst poate vedea doar tichetele create de el, un manager le poate vedea pe toate
    if (session.role === 'ANALYST' && ticket.owner_id !== session.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this ticket' });
    }

    await req.auditLogger.ticketRead(session.userId, ticket.id);
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.put('/api/tickets/:id', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { title, description, severity, status } = req.body;
    
    const existingTicket = await repo.getTicketById(req.params.id);
    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Doar owner-ul și manager-ul pot edita ticket-ul
    if (session.role === 'ANALYST' && existingTicket.owner_id !== session.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this ticket' });
    }

    const ticket = await repo.updateTicket(req.params.id, { title, description, severity, status });
    await req.auditLogger.ticketUpdate(session.userId, ticket.id);
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// --- ADMIN ROUTES ---

app.get('/api/logs', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  
  if (!session || session.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Forbidden: Managers only' });
  }

  // Trimit clientului eroarea cu stack trace
  try {
    const logs = await repo.listAuditLogs();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.listen(port, () => {
  console.log(`AuthX server (v1) running at http://localhost:${port}`);
});
