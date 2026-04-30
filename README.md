# AuthX - Break the Login 

* Project created for the course: **Secure Software Applications Development**.

## Project Objective
The purpose of this project is a practical understanding of how authentication systems are attacked and their correct implementation to resist real threats. The project follows a **Secure SDLC** flow (Build-Hack-Fix-Retest).

## Technical Stack
* **Backend:** Node.js with Express.js (manual implementation of auth logic).
* **Database:** PostgreSQL (containerized).
* **Infrastructure:** Docker & Docker Compose.
* **Testing Tools:** Burp Suite Community Edition, Postman, `psql`.

## Project Architecture
The project is divided into two distinct versions, managed via distinct Git branches:

1. **Vulnerable Version (`v1`)**:
   * Password storage in plain text.
   * Lack of rate limiting (allows Brute Force).
   * Active User Enumeration through specific error messages.
   * Unsecured sessions (no HttpOnly/Secure flags).
   * DB with default password for the super user postgres.

2. **Secured Version (`v2`)**:
   * Modern hashing using for passwords.
   * Implementation of Rate Limiting and Account Lockout.
   * Generic error messages and uniform response time.
   * Session hardening (HttpOnly, Secure, SameSite).
   * DB uses a secure password for the super user postgres stored via docker secrets. Another user is created and used by the app. It has  CRUD operations only on the application tables.

## Installation

### Pre-requisites
* Docker & Docker Compose installed.
* Student username configured in environment: `razvan-anghel`.

### Starting the application
1. Clone the repository and access the desired branch:
   ```bash
   git checkout vulnerable  # For v1
   # OR
   git checkout secure      # For v2
   ```
2. For the secured branch, create the Docker Secrets files at the repository root:
   ```bash
   printf 'your_postgres_superuser_password' > db_password.txt
   printf 'your_app_user_password' > app_password.txt
   ```
   These files are mounted by Docker Compose as secrets, so they must exist before starting the containers.
3. Start the containers:
   ```bash
   docker compose up --build
   ```

The application will be available at `http://localhost:3000`.

# Docker secrets configuration:

The secured version no longer uses those two docker secret files in the project root:

- `db_password.txt`: password for the PostgreSQL superuser `postgres`.
- `app_password.txt`: password for the limited application user `authx_app`.

Each file should contain only the password value, with no extra quotes or surrounding text.

Example:

```bash
echo 'your_postgres_superuser_password' > db_password.txt
echo 'your_app_user_password' > app_password.txt
```

---
