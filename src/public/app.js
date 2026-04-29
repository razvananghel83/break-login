// Stochează datele client-side și informațiile din UI
const state = {
  user: null,
  route: "login",
  lastError: null,
  tickets: [],
  auditLogs: [],
  selectedTicket: null
};

// Metadate despre fiecare rută
const routeMeta = {
  login: {
    title: "Login",
    subtitle: "Authenticate to access internal tickets."
  },
  register: {
    title: "Register",
    subtitle: "Create a user account."
  },
  forgot: {
    title: "Forgot Password",
    subtitle: "Request a reset token for your account."
  },
  reset: {
    title: "Reset Password",
    subtitle: "Use the reset token to change your password."
  },
  logs: {
    title: "Audit Logs",
    subtitle: "Audit trails for app activity."
  },
  dashboard: {
    title: "Dashboard",
    subtitle: "Create tickets and inspect existing ones."
  }
};

// Map dintre elemente și id-urile corespunzătoare din index.html
// Folosite pentru gestionarea interfeței
const views = {
  login: document.getElementById("view-login"),
  register: document.getElementById("view-register"),
  forgot: document.getElementById("view-forgot"),
  reset: document.getElementById("view-reset"),
  logs: document.getElementById("view-logs"),
  dashboard: document.getElementById("view-dashboard")
};

// Elemente constante - folosite pentru a afișa informații importante în aplicație
const userEmailEl = document.getElementById("user-email");
const routeTitleEl = document.getElementById("route-title");
const routeSubtitleEl = document.getElementById("route-subtitle");
const routeMenuEl = document.getElementById("route-menu");
const responseLogEl = document.getElementById("response-log");
const ticketsBodyEl = document.getElementById("tickets-body");
const ticketDetailEl = document.getElementById("ticket-detail");
const ticketEditSectionEl = document.getElementById("ticket-edit-section");
const ticketEditFormEl = document.getElementById("ticket-edit-form");
// Error pane-ul e ascuns până la prima eroare
responseLogEl.parentElement.classList.add('hidden');

// Determină view-ul curent bazat pe URL
function getHashRoute() {
  const raw = window.location.hash.replace("#/", "").trim();
  if (!raw) return "login";
  return routeMeta[raw] ? raw : "login";
}

// Schimbă ruta / view-ul curent
function setRoute(route) {
  window.location.hash = `#/${route}`;
}

// Schimbă interfața în funcție de rută
function renderRoute() {
  state.route = getHashRoute();

  // Afișez elementele asociate cu ruta curentă, le ascund pe restul
  Object.entries(views).forEach(([route, section]) => {
    section.classList.toggle("hidden", route !== state.route);
  });

  // În meniul de navigare, dau highlight la ruta curentă
  Array.from(routeMenuEl.querySelectorAll("a")).forEach((anchor) => {
    anchor.classList.toggle("active", anchor.dataset.route === state.route);
  });

  const meta = routeMeta[state.route];
  routeTitleEl.textContent = meta.title;
  routeSubtitleEl.textContent = meta.subtitle;
}

function printJson(value) {
  return JSON.stringify(value, null, 2);
}

function setLastError(entry) {
  // Voi afișa doar erorile de server ( >= 500 ) . sau erorile de la client.
  const isServerError = Number(entry.status) >= 500;
  const isClientRuntime = entry.method === 'CLIENT' || entry.status === 'ERR';
  if (!isServerError && !isClientRuntime) return;

  const timestamp = new Date().toISOString();
  state.lastError = { timestamp, ...entry };

  // Formatez lastError și fac Error pane-ul vizibil
  const logText = [
    `[${state.lastError.timestamp}] ${state.lastError.method} ${state.lastError.path}`,
    `Status: ${state.lastError.status}`,
    `Response: ${printJson(state.lastError.payload)}`
  ].join("\n");

  responseLogEl.textContent = logText;
  responseLogEl.parentElement.classList.remove('hidden');
}

// Trimite request-uri la server-ul de backend
async function apiRequest(path, options = {}) {
  
  // Metoda default = GET și header-ul JSON  
  const method = options.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "include"
  });

  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = { raw: "No JSON response body." };
  }

  // Afișez o eroare server side dacă răspunsul nu poate fi transformat în JSON
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed");
    error.status = response.status;
    error.payload = payload;
    if (response.status >= 500) {
      setLastError({ method, path, status: response.status, payload });
    }
    throw error;
  }

  return payload;
}

// Modifică interfața în funcție de rolul user-ului autentificat
function updateSessionUI() {

  // Ascund meniul de audit dacă nu e niciun user logat
  const auditMenuItem = document.querySelector('[data-route="logs"]');
  if (!state.user) {
    userEmailEl.textContent = "Not authenticated";
    if (auditMenuItem) {
      auditMenuItem.classList.add("hidden");
    }
    return;
  }

  // Afișez informațiile user-ului
  userEmailEl.textContent = `${state.user.email} (${state.user.role})`;
  if (auditMenuItem) {
    // Afișez meniul de audit doar pentru manageri
    auditMenuItem.classList.toggle("hidden", state.user.role !== "MANAGER");
  }
}

function isUserAuthenticated() {
  return Boolean(state.user && state.user.email);
}

async function refreshCurrentUser() {
  try {
    const data = await apiRequest("/api/me");
    state.user = data.user;
  } catch (_error) {
    state.user = null;
  }
  updateSessionUI();
  updateTicketEditVisibility();
}

function renderAuditLogs(logs) {
  if (!logs.length) {
    document.getElementById("audit-logs-body").innerHTML = '<tr><td colspan="5">No audit logs found.</td></tr>';
    return;
  }

  document.getElementById("audit-logs-body").innerHTML = logs
    .map((entry) => `
      <tr>
        <td>${escapeHtml(entry.timestamp || "-")}</td>
        <td>${escapeHtml(entry.email || entry.user_email || "unknown")}</td>
        <td>${escapeHtml(entry.action || "-")}</td>
        <td>${escapeHtml(entry.resource || "-")}</td>
        <td>${escapeHtml(entry.ip_address || entry.ip || "-")}</td>
      </tr>
    `)
    .join("");
}

async function fetchAuditLogs() {
  const logs = await apiRequest("/api/logs");
  state.auditLogs = logs;
  renderAuditLogs(logs);
}

function renderTickets(tickets) {
  if (!tickets.length) {
    ticketsBodyEl.innerHTML = '<tr><td colspan="5">No tickets found.</td></tr>';
    return;
  }

  ticketsBodyEl.innerHTML = tickets
    .map((ticket) => {
      return `
        <tr>
          <td>${escapeHtml(ticket.title)}</td>
          <td>${escapeHtml(ticket.owner_email || "unknown")}</td>
          <td>${escapeHtml(ticket.severity || "-")}</td>
          <td>${escapeHtml(ticket.status || "-")}</td>
          <td>
            <button class="btn-secondary" type="button" data-copy-ticket-id="${ticket.id}">Copy ID</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function canEditTicket(ticket) {
  if (!state.user || !ticket) return false;
  if (state.user.role === "MANAGER") return true;
  return ticket.owner_id === state.user.userId || ticket.owner_id === state.user.id;
}

// Helper pentru a determina dacă un ticket poate fi editat de user-ul curent
function updateTicketEditVisibility() {
  const editable = canEditTicket(state.selectedTicket);
  ticketEditSectionEl.classList.toggle("hidden", !editable || !state.selectedTicket);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Face request la backend cu filtrele selectate pentru tickete
async function fetchTickets() {
  const status = document.getElementById("filter-status").value;
  const severity = document.getElementById("filter-severity").value;
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (severity) params.set("severity", severity);

  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await apiRequest(`/api/tickets${query}`);

  state.tickets = data;
  renderTickets(data);
}

async function fetchTicketById(id) {
  const ticket = await apiRequest(`/api/tickets/${id}`);
  state.selectedTicket = ticket;
  ticketDetailEl.textContent = printJson(ticket);
  ticketEditFormEl.elements["ticket-id"].value = ticket.id || "";
  ticketEditFormEl.elements["edit-title"].value = ticket.title || "";
  ticketEditFormEl.elements["edit-description"].value = ticket.description || "";
  ticketEditFormEl.elements["edit-severity"].value = ticket.severity || "LOW";
  ticketEditFormEl.elements["edit-status"].value = ticket.status || "OPEN";
  updateTicketEditVisibility();
}

// Determină ce rute pot fi accesate de user-ul curent
async function handleRouteProtection() {
  
  // Dacă e manager, fac request cu audit logs, altfel redirect la login / dashboard
  if (state.route === "logs") {
    if (state.user && state.user.role === "MANAGER") {
      await fetchAuditLogs();
      return;
    }

    setRoute(state.user ? "dashboard" : "login");
    return;
  }

  if (state.route !== "dashboard") return;

  // Dacă e analyst și e logat, fac request cu tickets
  if (isUserAuthenticated()) {
    await fetchTickets();
    return;
  }

  setRoute("login");
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  await apiRequest("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  await refreshCurrentUser();
  setRoute("dashboard");
  await fetchTickets();
}

async function onRegisterSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;

  await apiRequest("/api/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  setRoute("login");
}

async function onForgotSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("forgot-email").value.trim();

  const data = await apiRequest("/api/request-reset", {
    method: "POST",
    body: JSON.stringify({ email })
  });

  if (data.token) {
    document.getElementById("reset-token").value = data.token;
    setRoute("reset");
  }
}

async function onResetSubmit(event) {
  event.preventDefault();
  const token = document.getElementById("reset-token").value.trim();
  const newPassword = document.getElementById("reset-password").value;

  await apiRequest("/api/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword })
  });

  setRoute("login");
}

async function onTicketSubmit(event) {
  event.preventDefault();
  const title = document.getElementById("ticket-title").value.trim();
  const description = document.getElementById("ticket-description").value.trim();
  const severity = document.getElementById("ticket-severity").value;

  await apiRequest("/api/tickets", {
    method: "POST",
    body: JSON.stringify({ title, description, severity })
  });

  event.target.reset();
  await fetchTickets();
}

async function onTicketEditSubmit(event) {
  event.preventDefault();

  const ticketId = ticketEditFormEl.elements["ticket-id"].value.trim();
  if (!ticketId) return;

  const payload = {
    title: ticketEditFormEl.elements["edit-title"].value.trim(),
    description: ticketEditFormEl.elements["edit-description"].value.trim(),
    severity: ticketEditFormEl.elements["edit-severity"].value,
    status: ticketEditFormEl.elements["edit-status"].value
  };

  const updated = await apiRequest(`/api/tickets/${ticketId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  state.selectedTicket = updated;
  ticketDetailEl.textContent = printJson(updated);
  await fetchTickets();
  updateTicketEditVisibility();
}

// Curăță state-ul pentru UI
async function onLogout() {
  try {
    await apiRequest("/api/logout", { method: "POST" });
  } finally {
    state.user = null;
    state.tickets = [];
    state.auditLogs = [];
    state.selectedTicket = null;
    ticketsBodyEl.innerHTML = "";
    ticketDetailEl.textContent = "No detail loaded.";
    ticketEditSectionEl.classList.add("hidden");
    updateSessionUI();
    setRoute("login");
  }
}

// Adaugă câte un event listener la toate butoanele
function wireEvents() {
  document.getElementById("login-form").addEventListener("submit", (event) => {
    onLoginSubmit(event).catch(handleUiError);
  });

  document.getElementById("register-form").addEventListener("submit", (event) => {
    onRegisterSubmit(event).catch(handleUiError);
  });

  document.getElementById("forgot-form").addEventListener("submit", (event) => {
    onForgotSubmit(event).catch(handleUiError);
  });

  document.getElementById("reset-form").addEventListener("submit", (event) => {
    onResetSubmit(event).catch(handleUiError);
  });

  document.getElementById("ticket-form").addEventListener("submit", (event) => {
    onTicketSubmit(event).catch(handleUiError);
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    onLogout().catch(handleUiError);
  });

  document.getElementById("refresh-tickets").addEventListener("click", () => {
    fetchTickets().catch(handleUiError);
  });

  document.getElementById("ticket-id-btn").addEventListener("click", () => {
    const id = document.getElementById("ticket-id-input").value.trim();
    if (!id) return;
    fetchTicketById(id).catch(handleUiError);
  });

  ticketEditFormEl.addEventListener("submit", (event) => {
    onTicketEditSubmit(event).catch(handleUiError);
  });

  ticketsBodyEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const ticketId = target.dataset.copyTicketId;
    if (!ticketId) return;

    const copyText = async () => {
      try {
        await navigator.clipboard.writeText(ticketId);
      } catch (_error) {
        const temp = document.createElement("input");
        temp.value = ticketId;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
      }
    };

    copyText().catch(handleUiError);
  });

  const auditLogsLink = document.querySelector('[data-route="logs"]');
  if (auditLogsLink) {
    auditLogsLink.addEventListener("click", () => {
      if (state.user && state.user.role === "MANAGER") {
        fetchAuditLogs().catch(handleUiError);
      }
    });
  }

  document.getElementById("clear-log").addEventListener("click", () => {
    state.lastError = null;
    responseLogEl.textContent = "No errors.";
    responseLogEl.parentElement.classList.add('hidden');
  });

  window.addEventListener("hashchange", () => {
    renderRoute();
    handleRouteProtection().catch(handleUiError);
  });
}

function handleUiError(error) {
  setLastError({
    method: "CLIENT",
    path: "runtime",
    status: error.status || "ERR",
    payload: {
      message: error.message,
      details: error.payload || null
    }
  });
}

async function bootstrap() {

  wireEvents();     // adaugă event listeners
  renderRoute();    // încarcă UI-ul
  await refreshCurrentUser();   // autentifică user-ul

  if (!window.location.hash) {
    setRoute(isUserAuthenticated() ? "dashboard" : "login");
  }

  renderRoute();    // încarcă noul UI dacă user-ul e autentificat sau nu
  await handleRouteProtection();    // gestionează permisiunile
}

bootstrap().catch(handleUiError);   // Orice eroare din execuție este gestionată
