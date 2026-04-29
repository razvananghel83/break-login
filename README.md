# AuthX - Break the Login 

* Project created for the course: **Secure Software Applications Development**.

* **Student name**: Anghel Răzvan-Alexandru

* **Video link**: *Not here yet*


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
   * DB with default super user ( postgres ) and no password.

2. **Secured Version (`v2`)**:
   * Modern hashing using for passwords.
   * Implementation of Rate Limiting and Account Lockout.
   * Generic error messages and uniform response time.
   * Session hardening (HttpOnly, Secure, SameSite).
   * DB uses an overwritten super user with a secret complex password. Another user is created and has only CRUD operations on the database.

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
2. Configure the `.env` file followint the instructions bellow.
3. Start the containers:
   ```bash
   docker compose up --build
   ```

The application will be available at `http://localhost:3000`.

# .env configuration:

A local .env file is required for security reasons on the second branch. It should contain:

- Database superuser credentials (overwrites default 'postgres' user)
* POSTGRES_USER=your_superuser_name
* POSTGRES_PASSWORD=your_secure_password

---
