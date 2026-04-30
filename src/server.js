const express = require('express');
const { Pool } = require('pg');     // pool-ul de conexiuni postgres
const cookieParser = require('cookie-parser');
const path = require('path');

const DbRepository = require('./repositories/DbRepository');
const AuditLogger = require('./utils/auditLogger');
const createAuditLoggerMiddleware = require('./middleware/auditLoggerMiddleware');

const fs = require('fs');

const crypto = require('crypto');
const bcrypt = require('bcrypt');

// 6. XSS Prevention: Funcție manuală pentru encoding-ul output-ului
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 1. Password Hardening: Validare complexitate
function validatePassword(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecial;
}

const app = express();
const port = 3000;

// ... (existing code for repo, auditLogger)

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

// Sesiuni cu expirare (3. Rotation & Expiry)
const sessions = {};
const SESSION_EXPIRY = 15 * 60 * 1000; // 15 minute

// Curățare periodică sesiuni expirate
setInterval(() => {
  const now = Date.now();
  for (const id in sessions) {
    if (now - sessions[id].createdAt > SESSION_EXPIRY) {
      delete sessions[id];
    }
  }
}, 60000);

// --- RUTE PENTRU AUTENTIFICARE ---

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  
  // 1. Validare complexitate parolă
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Parola trebuie să aibă minim 8 caractere și să conțină litere mari, mici, cifre și caractere speciale.' });
  }

  try {
    const user = await repo.createUser(email, password);
    res.json({ message: 'User registered successfully' });
  } catch (err) {
    // 6. Generic Error: Fără stack trace
    console.error(err);
    res.status(500).json({ error: 'Eroare la înregistrare.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  // 2. User Enumeration Fix: Mesaj generic
  const genericError = 'Email sau parolă incorectă.';

  try {
    const user = await repo.findUserByEmail(email);
    
    // 2. Account Lockout check
    if (user && user.locked) {
      return res.status(403).json({ error: 'Contul este blocat. Contactați administratorul.' });
    }

    if (!user) {
      // Uniform timing: hash-uim o parolă dummy pentru a preveni timing attacks
      await bcrypt.compare(password, '$2b$10$vI8AHe.7K8S9H.22hS8O7eM.22hS8O7eM.22hS8O7eM.22hS8O7eM');
      return res.status(401).json({ error: genericError });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      // 2. Brute Force Protection: Incrementare failed attempts
      await repo.incrementFailedAttempts(email);
      const updatedUser = await repo.findUserByEmail(email);
      if (updatedUser.failed_attempts >= 5) {
        await repo.lockAccount(email);
      }
      return res.status(401).json({ error: genericError });
    }

    // Login reușit: Resetare attempts
    await repo.resetFailedAttempts(email);

    // 3. Session Rotation: Nou ID la fiecare login
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions[sessionId] = { 
      userId: user.id, 
      email: user.email, 
      role: user.role,
      createdAt: Date.now() 
    };
    
    // 3. Cookie Hardening: HttpOnly, Secure, SameSite
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: SESSION_EXPIRY
    });
    
    await req.auditLogger.login(user.id);
    res.json({ message: 'Login successful', user: { email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la autentificare.' });
  }
});

// 5. Password Reset Security: CSPRNG, Hash în DB, Expirare 15m
app.post('/api/request-reset', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await repo.findUserByEmail(email);
    if (!user) {
      // User Enumeration Fix: Răspuns de succes chiar dacă userul nu există
      return res.json({ message: 'Dacă email-ul există în sistem, un link de resetare a fost trimis.' });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minute
    
    await repo.setResetToken(email, tokenHash, expires);
    
    // În realitate am trimite email, aici returnăm tokenul pentru demo
    res.json({ message: 'Reset token generated', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la procesarea cererii.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: 'Noua parolă nu respectă criteriile de complexitate.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await repo.findUserByResetToken(tokenHash);
    
    if (!user) {
      return res.status(400).json({ error: 'Token invalid sau expirat.' });
    }
    
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    // 5. Validation: One-time use prin invalidare token în DB
    await repo.updatePasswordAndInvalidateToken(user.id, newPasswordHash);
    
    res.json({ message: 'Parola a fost actualizată cu succes.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la resetarea parolei.' });
  }
});

app.post('/api/logout', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (session) {
    await req.auditLogger.logout(session.userId);
  }
  // 3. Logout: Invalidation pe server și client
  delete sessions[sessionId];
  res.clearCookie('sessionId');
  res.json({ message: 'Logged out' });
});

app.get('/api/me', (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session || (Date.now() - session.createdAt > SESSION_EXPIRY)) {
    if (session) delete sessions[sessionId];
    return res.status(401).json({ error: 'Sesiune expirată sau invalidă.' });
  }
  res.json({ user: session });
});

// --- RUTE PENTRU TICKETS ---

app.post('/api/tickets', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Neautorizat' });

  const { title, description, severity } = req.body;
  try {
    // 6. Output Encoding: Escapare date de la user
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    
    const ticket = await repo.createTicket(safeTitle, safeDescription, severity, session.userId);
    await req.auditLogger.ticketCreate(session.userId, ticket.id);
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la crearea tichetului.' });
  }
});

app.get('/api/tickets', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Neautorizat' });

  try {
    const { status, severity } = req.query;
    const ownerId = session.role === 'ANALYST' ? session.userId : null;
    const tickets = await repo.listTickets(status, severity, ownerId);
    await req.auditLogger.ticketList(session.userId);
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la listarea tichetelor.' });
  }
});

app.get('/api/tickets/:id', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Neautorizat' });

  try {
    const ticket = await repo.getTicketById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Tichet negăsit' });
    }

    if (session.role === 'ANALYST' && ticket.owner_id !== session.userId) {
      return res.status(403).json({ error: 'Acces interzis' });
    }

    await req.auditLogger.ticketRead(session.userId, ticket.id);
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la citirea tichetului.' });
  }
});

app.put('/api/tickets/:id', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Neautorizat' });

  try {
    const { title, description, severity, status } = req.body;
    
    const existingTicket = await repo.getTicketById(req.params.id);
    if (!existingTicket) {
      return res.status(404).json({ error: 'Tichet negăsit' });
    }

    if (session.role === 'ANALYST' && existingTicket.owner_id !== session.userId) {
      return res.status(403).json({ error: 'Acces interzis' });
    }

    // 6. Output Encoding
    const safeFields = {
      title: title ? escapeHtml(title) : undefined,
      description: description ? escapeHtml(description) : undefined,
      severity,
      status
    };

    const ticket = await repo.updateTicket(req.params.id, safeFields);
    await req.auditLogger.ticketUpdate(session.userId, ticket.id);
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la actualizarea tichetului.' });
  }
});

// --- ADMIN ROUTES ---

app.get('/api/logs', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  
  if (!session || session.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Acces interzis' });
  }

  try {
    const logs = await repo.listAuditLogs();
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la listarea logurilor.' });
  }
});

app.listen(port, () => {
  console.log(`AuthX server (v2) running at http://localhost:${port}`);
});

