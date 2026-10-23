import type { DatabaseSync } from 'node:sqlite';

/**
 * 非破坏性迁移：只新建表与追加列，不 DROP、不清空、不改写既有记录。
 * 回退：新增表与列不被旧代码读取，回退到旧版本代码即可；如需清理可手工删除新增表。
 */
function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>).map((row) => row.version));

  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS external_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        environment TEXT NOT NULL,
        appid TEXT NOT NULL,
        un TEXT NOT NULL,
        dis TEXT,
        user_id INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        UNIQUE (provider, environment, appid, un)
      );

      CREATE TABLE IF NOT EXISTS ilab_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id INTEGER NOT NULL,
        environment TEXT NOT NULL,
        appid TEXT NOT NULL,
        un TEXT NOT NULL,
        original_token_enc TEXT NOT NULL,
        current_token_enc TEXT NOT NULL,
        create_time_ms INTEGER,
        expires_time_ms INTEGER,
        refresh_count INTEGER NOT NULL DEFAULT 0,
        synthetic INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ilab_handoffs (
        code_hash TEXT PRIMARY KEY,
        context_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        expires_ms INTEGER NOT NULL,
        used_at_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS ilab_ticket_digests (
        digest TEXT PRIMARY KEY,
        seen_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ilab_call_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        context_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        outcome TEXT NOT NULL,
        at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS step_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        type TEXT NOT NULL,
        server_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_step_events_session ON step_events (session_id, step_id, id);

      CREATE TABLE IF NOT EXISTS step_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        attempt_no INTEGER NOT NULL,
        request_id TEXT,
        observed_start_ms INTEGER,
        observed_end_ms INTEGER NOT NULL,
        active_ms INTEGER,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        input_hash TEXT NOT NULL,
        raw_score REAL NOT NULL,
        raw_max_score REAL NOT NULL,
        evidence_quality TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS idx_step_attempts_session ON step_attempts (session_id, step_id, attempt_no);

      CREATE TABLE IF NOT EXISTS ai_invocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invocation_id TEXT NOT NULL,
        attempt_no INTEGER NOT NULL,
        session_id INTEGER,
        user_id INTEGER,
        step_id TEXT,
        scenario TEXT,
        dispatch_state TEXT NOT NULL,
        upstream_http_status INTEGER,
        provider_response_received INTEGER NOT NULL DEFAULT 0,
        configured_model TEXT,
        provider_model TEXT,
        configured_version TEXT,
        deployment TEXT,
        provider TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        usage_complete INTEGER NOT NULL DEFAULT 0,
        parse_ok INTEGER,
        final_source TEXT,
        failure_class TEXT,
        prompt_sha256 TEXT,
        started_ms INTEGER NOT NULL,
        ended_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ai_invocations_session ON ai_invocations (session_id);

      CREATE TABLE IF NOT EXISTS ilab_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes BLOB NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ilab_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        context_id INTEGER NOT NULL,
        environment TEXT NOT NULL,
        appid TEXT NOT NULL,
        username TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        status_value INTEGER NOT NULL,
        payload_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        export_audit_json TEXT NOT NULL,
        state TEXT NOT NULL,
        attachment_state TEXT NOT NULL DEFAULT 'none',
        report_id INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        last_error_summary TEXT,
        synthetic INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ilab_outbox_session ON ilab_outbox (session_id, id);
    `);

    addColumn(db, 'users', 'display_name', 'TEXT');
    addColumn(db, 'users', 'external', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'sessions', 'source', "TEXT NOT NULL DEFAULT 'local'");
    addColumn(db, 'sessions', 'ilab_context_id', 'INTEGER');
    addColumn(db, 'sessions', 'origin_id', 'TEXT');
    addColumn(db, 'sessions', 'started_ms', 'INTEGER');
    addColumn(db, 'sessions', 'completed_ms', 'INTEGER');
    addColumn(db, 'sessions', 'locked', 'INTEGER NOT NULL DEFAULT 0');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_origin ON sessions (origin_id) WHERE origin_id IS NOT NULL');
    addColumn(db, 'ai_logs', 'invocation_id', 'TEXT');
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
  }

  if (!applied.has(2)) {
    // AI 实验导师生成的指导/反思（用于报告与成长档案）
    db.exec(`
      CREATE TABLE IF NOT EXISTS tutor_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        user_id INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tutor_notes_session ON tutor_notes (session_id, phase, id);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
  }

  if (!applied.has(3)) {
    // 管理员配置（大模型等，密钥加密保存）、导入的师生信息、题库版本
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_by INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    addColumn(db, 'users', 'class_name', 'TEXT');
    addColumn(db, 'users', 'major', 'TEXT');
    addColumn(db, 'users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'users', 'last_login_at', 'TEXT');
    // 旧记录为 NULL，即 2026-10-23 产业规程修正之前的题库
    addColumn(db, 'step_records', 'bank_version', 'TEXT');
    addColumn(db, 'step_attempts', 'bank_version', 'TEXT');
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(3, new Date().toISOString());
  }

  if (!applied.has(4)) {
    // 预习成绩与教师评价（申报书“成绩类型”）；均不改变 24 步的 100 分制成绩
    db.exec(`
      CREATE TABLE IF NOT EXISTS prelab_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        answers_json TEXT NOT NULL,
        correct INTEGER NOT NULL,
        total INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prelab_user ON prelab_attempts (user_id, id);
      CREATE TABLE IF NOT EXISTS teacher_reviews (
        session_id INTEGER PRIMARY KEY,
        teacher_id INTEGER NOT NULL,
        grade TEXT NOT NULL,
        comment TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(4, new Date().toISOString());
  }

  if (!applied.has(5)) {
    // 课程（按学期）与教师、教学班的关联；学生通过所在班级关联到课程
    db.exec(`
      CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        term_start_year INTEGER NOT NULL,
        term_no INTEGER NOT NULL,
        total_hours INTEGER,
        credits REAL,
        created_at TEXT NOT NULL,
        UNIQUE (code, term_start_year, term_no)
      );
      CREATE TABLE IF NOT EXISTS course_teachers (
        course_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (course_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS course_classes (
        course_id INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        PRIMARY KEY (course_id, class_name)
      );
    `);
    addColumn(db, 'users', 'title', 'TEXT');
    addColumn(db, 'users', 'department', 'TEXT');
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(5, new Date().toISOString());
  }

  if (!applied.has(6)) {
    // 研究探索：试验参数与仿真指标、假设与结论（不计分）
    db.exec(`
      CREATE TABLE IF NOT EXISTS explore_trials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id INTEGER,
        exp_id TEXT NOT NULL,
        params_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_explore_trials_user ON explore_trials (user_id, exp_id, id);
      CREATE TABLE IF NOT EXISTS explore_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id INTEGER,
        exp_id TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        conclusion TEXT NOT NULL,
        feedback TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(6, new Date().toISOString());
  }
}
