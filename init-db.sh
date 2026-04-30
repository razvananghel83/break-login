#!/bin/bash
set -e

# Citește parola pentru user-ul aplicației
APP_PASSWORD=$(cat /run/secrets/app_password)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE TYPE user_role AS ENUM ('ANALYST', 'MANAGER');
    CREATE TYPE ticket_severity AS ENUM ('LOW', 'MED', 'HIGH');
    CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role user_role DEFAULT 'ANALYST',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        locked BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        severity ticket_severity,
        status ticket_status DEFAULT 'OPEN',
        owner_id UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        action VARCHAR(255) NOT NULL,
        resource VARCHAR(255),
        resource_id VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
    );

    -- Crearea unui utilizator cu drepturi limitate asupra DB-ului
    CREATE USER authx_app WITH PASSWORD '$APP_PASSWORD';

    -- Restricționarea permisiunilor (Principle of Least Privilege):
    -- Tai accesul oricărui nou user la schema publică
    REVOKE ALL ON SCHEMA public FROM PUBLIC;

    -- Permit să folosească schema publică
    GRANT USAGE ON SCHEMA public TO authx_app;

    -- Permit CRUD strict pe tabelele din appplicație
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users, tickets, audit_logs TO authx_app;

    INSERT INTO users (email, password_hash, role) VALUES ('admin@authx.com', 'password123', 'MANAGER');
EOSQL
