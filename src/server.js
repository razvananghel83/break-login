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

// Protecție XSS: Transformă caractere care pot face parte din script-uri în
// caractere care vor fi randate de HTML => script-ul va fi afișat, dar nu va fi rulat
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Password Security: Validări complexe
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

// Helper pentru a citi Docker Secrets
function getSecret(secretPath) {
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    return null;
  }
}

// Setările pentru DB
const dbPassword = getSecret('/run/secrets/app_password');
const dbUser = process.env.DB_USER || 'authx_app';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_NAME || 'authx_db_v2';

// Conexiunea la baza de date
const pool = new Pool({
  connectionString: `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`,
});

const repo = new DbRepository(pool);
const auditLogger = new AuditLogger(repo);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(createAuditLoggerMiddleware(auditLogger));

// Sesiuni cu expirare la fiecare 15 min
const sessions = {};
const SESSION_EXPIRY = 15 * 60 * 1000;

// Curăță periodic sesiunile expirate
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
  
  // Validare complexitate parolă
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Your password needs to have at least 8 characters: small letters, capital letters numbers and special characters' });
  }

  try {
    const user = await repo.createUser(email, password);
    res.json({ message: 'User registered succesfully!' });
  } catch (err) {
    // Erori generice: Fără stack trace
    console.error(err);
    res.status(500).json({ error: 'Error while registering' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Mesaj de eroare generic
  const genericError = 'Incorrect email or password';

  try {
    const user = await repo.findUserByEmail(email);
    
    // Verific dacă user-ul a fost blocat
    if (user && user.locked) {
      return res.status(403).json({ error: 'Your account is locked! Contact an administrator.' });
    }

    if (!user) {
      // Protecție la timing attacks: fac hash cu o parolă dummy pentru a preveni timing attacks
      await bcrypt.compare(password, '$2b$10$vI8AHe.7K8S9H.22hS8O7eM.22hS8O7eM.22hS8O7eM.22hS8O7eM');
      return res.status(401).json({ error: genericError });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      // Brute Force Protection: Incrementarea logărilor nereușite
      await repo.incrementFailedAttempts(email);
      const user = await repo.findUserByEmail(email);
      if (user.failed_attempts >= 5) {
        await repo.lockAccount(email);
      }
      return res.status(401).json({ error: genericError });
    }

    // Resetez failed attempts 
    await repo.resetFailedAttempts(email);

    // Session Security: Id nou la fiecare login
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions[sessionId] = { 
      userId: user.id, 
      email: user.email, 
      role: user.role,
      createdAt: Date.now() 
    };
    
    // Cookie-uri securizate: HttpOnly, SameSite
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: SESSION_EXPIRY
    });
    
    // Adaug login-ul în log-urile de audit
    await req.auditLogger.login(user.id);
    res.json({ message: 'Login successful', user: { email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Authentication error.' });
  }
});

// Password Reset Security: CSPRNG, hash la token stocat în DB, expirare 15 minute
app.post('/api/request-reset', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await repo.findUserByEmail(email);
    if (!user) {
      // Mesaj generic care ascunde erorile
      return res.json({ message: 'If the email is registered, a token has been sent' });
    }
    
    // Generez token-ul și îl scriu în DB
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    
    await repo.setResetToken(email, tokenHash, expires);
    
    // Returnez tokenul pentru demo
    res.json({ message: 'Reset token generated', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eror processing your request.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: 'Your new password is not complex enough!' });
  }

  try {
    // Caut user-ul după token-ul de reset
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await repo.findUserByResetToken(tokenHash);
    
    if (!user) {
      return res.status(400).json({ error: 'Your token is invalid or expired.' });
    }
    
    // Stochez parola nouă hash-uită și invalidez token-ul de reset
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await repo.updatePasswordAndInvalidateToken(user.id, newPasswordHash);
    
    res.json({ message: 'Your password was succesfully updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error resetting the password.' });
  }
});

app.post('/api/logout', async (req, res) => {
  
  // Obțin sesiunea și o pun în log-urile de audit
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (session) {
    await req.auditLogger.logout(session.userId);
  }
  // Invalidez sesiunea la log-out și șterg cookie-ul asociat
  delete sessions[sessionId];
  res.clearCookie('sessionId');
  res.json({ message: 'Logged out' });
});

app.get('/api/me', (req, res) => {
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];

  // Dacă sesiunea a expirat, se scoate automat
  if (!session || (Date.now() - session.createdAt > SESSION_EXPIRY)) {
    if (session) delete sessions[sessionId];
    return res.status(401).json({ error: 'Sesiune expirată sau invalidă.' });
  }
  res.json({ user: session });
});

// --- RUTE PENTRU TICKETS ---

app.post('/api/tickets', async (req, res) => {

  // Verific validitatea sesiunii înainte să trimit procesez request-ul
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Unauthorised' });

  const { title, description, severity } = req.body;
  try {
    // Protecție XSS: Verific input-ul de la user
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    
    // Creez ticket-ul și înregistrez acțiunea în log-urile de audit
    const ticket = await repo.createTicket(safeTitle, safeDescription, severity, session.userId);
    await req.auditLogger.ticketCreate(session.userId, ticket.id);
    res.json(ticket);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la crearea tichetului.' });
  }
});

app.get('/api/tickets', async (req, res) => {

  // Verific validitatea sesiunii înainte să trimit procesez request-ul
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Unauthorised' });

  try {
    // Determin rolul user-ului și aplic filtrele
    const { status, severity } = req.query;
    const ownerId = session.role === 'ANALYST' ? session.userId : null;
    const tickets = await repo.listTickets(status, severity, ownerId);
    
    // Adaug acțiunea la log-urile de audit
    await req.auditLogger.ticketList(session.userId);

    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error while listing the tickets.' });
  }
});

app.get('/api/tickets/:id', async (req, res) => {
  
  // Verific validitatea sesiunii înainte să trimit procesez request-ul
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Unauthorised' });

  try {

    // Verific dacă ticket-ul există și dacă user-ul îl poate vedea
    const ticket = await repo.getTicketById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (session.role === 'ANALYST' && ticket.owner_id !== session.userId) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Adaug acțiunea la log-urile de audit
    await req.auditLogger.ticketRead(session.userId, ticket.id);

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error while fetching the ticket.' });
  }
});

app.put('/api/tickets/:id', async (req, res) => {

  // Verific validitatea sesiunii înainte să trimit procesez request-ul
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { title, description, severity, status } = req.body;
    
    // Verific dacă ticket-ul există și dacă user-ul îl poate edita
    const existingTicket = await repo.getTicketById(req.params.id);
    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (session.role === 'ANALYST' && existingTicket.owner_id !== session.userId) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Protecție XSS: Verific input-ul de la user
    const safeFields = {
      title: title ? escapeHtml(title) : undefined,
      description: description ? escapeHtml(description) : undefined,
      severity,
      status
    };

    // Salvez ticket-ul și adaug acțiunea la log-urile de audit
    const ticket = await repo.updateTicket(req.params.id, safeFields);
    await req.auditLogger.ticketUpdate(session.userId, ticket.id);

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Eroare la actualizarea tichetului.' });
  }
});

// --- MANAGER ROUTES ---

app.get('/api/logs', async (req, res) => {
  
  // Verific validitatea sesiunii și rolul user-ului
  const sessionId = req.cookies.sessionId;
  const session = sessions[sessionId];
  
  if (!session || session.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Access forbidden' });
  }

  try {
    const logs = await repo.listAuditLogs();
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error while listing the audit logs.' });
  }
});

app.listen(port, () => {
  console.log(`AuthX server (v2) running at http://localhost:${port}`);
});

