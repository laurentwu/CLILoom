import Database from 'better-sqlite3'

/**
 * Minimal in-memory schema covering exactly the tables ProcessRunner reads
 * and writes. It is a test fixture only: real schema and migration contracts
 * live in src/main/database.test.ts.
 */
export function createProcessRunnerTestDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    create table terminal_sessions (
      id text primary key,
      task_id text not null,
      node_id text not null,
      kind text not null,
      command text not null,
      cwd text not null,
      status text not null,
      transcript text not null,
      created_at text not null,
      updated_at text not null,
      request_json text
    );
    create table process_logs (
      id text primary key,
      task_id text not null,
      node_id text,
      stream text not null,
      content text not null,
      created_at text not null
    );
    create table hook_runs (
      id text primary key,
      task_id text not null,
      node_id text not null,
      hook_type text not null,
      status text not null,
      stdout text not null,
      stderr text not null,
      exit_code integer,
      created_at text not null
    );
  `)
  return db
}
