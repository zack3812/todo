-- NexusDesk D1 初始化表结构
-- 执行：npx wrangler d1 execute nexusdesk-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  employee_id          TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',          -- 'admin' | 'user'
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_employee ON sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS todos (
  employee_id       TEXT NOT NULL,
  todo_id           TEXT NOT NULL,
  text              TEXT NOT NULL DEFAULT '',
  project           TEXT NOT NULL DEFAULT '',
  priority          TEXT NOT NULL DEFAULT 'P3',
  done              INTEGER NOT NULL DEFAULT 0,
  due_time          TEXT,
  status            TEXT NOT NULL DEFAULT '',
  progress_text     TEXT NOT NULL DEFAULT '',
  next_week         TEXT NOT NULL DEFAULT '',
  client_updated_at INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (employee_id, todo_id)
);
CREATE INDEX IF NOT EXISTS idx_todos_employee ON todos(employee_id);
