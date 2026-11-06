use crate::model::*;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Mutex};

pub struct Store(pub Mutex<Connection>);
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        let db = Connection::open(root.join("council.sqlite3"))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,folder TEXT NOT NULL,value TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS message_folder ON messages(folder,id);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,folder TEXT NOT NULL,request_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS event_job ON events(json_extract(value,'$.job'),id);
            CREATE INDEX IF NOT EXISTS event_companion ON events(json_extract(value,'$.job'),json_extract(value,'$.kind'),json_extract(value,'$.agent'),id);")?;
        let store = Self(Mutex::new(db));
        if store.get("settings")?.is_none() {
            let old: Value = std::fs::read(root.join("settings.json"))
                .ok()
                .and_then(|s| serde_json::from_slice(&s).ok())
                .unwrap_or(json!({}));
            let mut settings: Settings = serde_json::from_value(old.clone()).unwrap_or_default();
            if old.get("permissions").is_none() && old["full_access"] == true {
                settings.permissions = "coder".into();
            }
            if !std::path::Path::new(&settings.folder).is_dir() {
                settings.folder = home();
                settings.permissions = "restricted".into();
            }
            settings
                .references
                .retain(|r| std::path::Path::new(r).is_dir());
            settings.reviewers.retain(|a| AGENTS.contains(&a.as_str()));
            if settings
                .coder
                .as_deref()
                .is_some_and(|a| !AGENTS.contains(&a))
            {
                settings.coder = None;
            }
            if !["English", "한국어"].contains(&settings.language.as_str()) {
                settings.language = "English".into();
            }
            if !["light", "dark", "system"].contains(&settings.appearance.as_str()) {
                settings.appearance = "light".into();
            }
            if !["restricted", "coder", "all"].contains(&settings.permissions.as_str()) {
                settings.permissions = "restricted".into();
            }
            settings.validate()?;
            store.put(
                &format!("draft:{}", folder_key(&settings.folder)),
                &json!(settings.draft),
            )?;
            settings.draft.clear();
            store.put("settings", &serde_json::to_value(&settings)?)?;
        }
        // A lost process is interrupted, never silently relaunched after a crash.
        let mut jobs = store.jobs()?;
        for job in &mut jobs {
            if job.status == "running" {
                job.status = "interrupted".into();
                store.update_job(job)?;
            }
        }
        Ok(store)
    }
    pub fn get(&self, key: &str) -> Result<Option<Value>> {
        let value: Option<String> = self
            .0
            .lock()
            .unwrap()
            .query_row("SELECT value FROM kv WHERE key=?", [key], |r| r.get(0))
            .optional()?;
        Ok(value.map(|v| serde_json::from_str(&v)).transpose()?)
    }
    pub fn put(&self, key: &str, value: &Value) -> Result<()> {
        self.0.lock().unwrap().execute(
            "INSERT OR REPLACE INTO kv VALUES(?,?)",
            params![key, value.to_string()],
        )?;
        Ok(())
    }
    pub fn import_chat(&self, root: &Path, folder: &str) -> Result<()> {
        let marker = format!("import:{}", folder_key(folder));
        if self.get(&marker)?.is_some() {
            return Ok(());
        }
        // v2 used SHA-256 of the casefolded Windows path.
        let hash = format!("{:x}", Sha256::digest(folder.to_lowercase().as_bytes()));
        let old: Value = std::fs::read(root.join("chats").join(format!("{hash}.json")))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(json!({}));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        if let Some(messages) = old["messages"].as_array() {
            for message in messages {
                if let Ok(message) = serde_json::from_value::<Message>(message.clone()) {
                    tx.execute(
                        "INSERT INTO messages(folder,value) VALUES(?,?)",
                        params![folder_key(folder), serde_json::to_string(&message)?],
                    )?;
                }
            }
        }
        for (key, value) in [
            (marker, json!(true)),
            (
                format!("usage:{}", folder_key(folder)),
                old["usage"].clone(),
            ),
        ] {
            tx.execute(
                "INSERT OR IGNORE INTO kv VALUES(?,?)",
                params![key, value.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn messages(&self, folder: &str) -> Result<Vec<Message>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT value FROM messages WHERE folder=? ORDER BY id")?;
        let strings = s
            .query_map([folder_key(folder)], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        strings
            .into_iter()
            .map(|s| Ok(serde_json::from_str(&s)?))
            .collect()
    }
    pub fn message(&self, folder: &str, message: &Message) -> Result<()> {
        self.0.lock().unwrap().execute(
            "INSERT INTO messages(folder,value) VALUES(?,?)",
            params![folder_key(folder), serde_json::to_string(message)?],
        )?;
        Ok(())
    }
    pub fn accept(&self, job: &Job) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO jobs VALUES(?,?,?,?,?)",
            params![
                job.id,
                folder_key(&job.folder),
                job.request_id,
                job.status,
                serde_json::to_string(job)?
            ],
        )?;
        let message = Message {
            role: "You".into(),
            text: job.request.clone(),
            stage: String::new(),
            time: job.time.clone(),
        };
        tx.execute(
            "INSERT INTO messages(folder,value) VALUES(?,?)",
            params![folder_key(&job.folder), serde_json::to_string(&message)?],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn update_job(&self, job: &Job) -> Result<()> {
        self.0.lock().unwrap().execute(
            "UPDATE jobs SET status=?,value=? WHERE id=?",
            params![job.status, serde_json::to_string(job)?, job.id],
        )?;
        Ok(())
    }
    pub fn jobs(&self) -> Result<Vec<Job>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT value FROM jobs ORDER BY rowid DESC")?;
        let rows = s
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|s| Ok(serde_json::from_str(&s)?))
            .collect()
    }
    pub fn event(&self, mut e: Event) -> Result<Event> {
        let db = self.0.lock().unwrap();
        db.execute(
            "INSERT INTO events(value) VALUES(?)",
            [serde_json::to_string(&e)?],
        )?;
        e.id = db.last_insert_rowid();
        Ok(e)
    }
    pub fn events(&self, after: i64) -> Result<Vec<Event>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id,value FROM events WHERE id>? ORDER BY id LIMIT 250")?;
        let rows = s
            .query_map([after], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(id, s)| {
                let mut e: Event = serde_json::from_str(&s)?;
                e.id = id;
                Ok(e)
            })
            .collect()
    }
    pub fn cursor(&self) -> Result<i64> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .query_row("SELECT COALESCE(MAX(id),0) FROM events", [], |r| r.get(0))?)
    }
    pub fn job_events(&self, job: &str) -> Result<Vec<Event>> {
        let db = self.0.lock().unwrap();
        let mut s=db.prepare("SELECT id,value FROM events WHERE json_extract(value,'$.job')=? ORDER BY id DESC LIMIT 1000")?;
        let rows = s
            .query_map([job], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut result = rows
            .into_iter()
            .map(|(id, s)| {
                let mut e: Event = serde_json::from_str(&s)?;
                e.id = id;
                Ok(e)
            })
            .collect::<Result<Vec<_>>>()?;
        result.reverse();
        Ok(result)
    }
    pub fn companion_job_events(&self, job: &str) -> Result<Vec<Event>> {
        let db = self.0.lock().unwrap();
        let mut rows = Vec::new();
        let mut notes=db.prepare("SELECT id,value FROM events WHERE json_extract(value,'$.job')=? AND json_extract(value,'$.kind')='note' AND json_extract(value,'$.agent')=? ORDER BY id DESC LIMIT 1")?;
        for agent in AGENTS {
            rows.extend(
                notes
                    .query_map(params![job, agent], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        }
        let mut activity=db.prepare("SELECT id,value FROM events WHERE json_extract(value,'$.job')=? AND json_extract(value,'$.kind')=? ORDER BY id DESC LIMIT 40")?;
        for kind in ["phase", "tool", "error", "done"] {
            rows.extend(
                activity
                    .query_map(params![job, kind], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        }
        rows.sort_by_key(|(id, _)| *id);
        rows.into_iter()
            .map(|(id, value)| {
                let mut event: Event = serde_json::from_str(&value)?;
                event.id = id;
                Ok(event)
            })
            .collect()
    }
    pub fn usage(&self, folder: &str, agent: &str, input: u64, output: u64) -> Result<()> {
        let key = format!("usage:{}", folder_key(folder));
        // Parallel agents must merge under one lock or one agent's totals can
        // overwrite another's read-modify-write.
        let db = self.0.lock().unwrap();
        let saved: Option<String> = db
            .query_row("SELECT value FROM kv WHERE key=?", [&key], |r| r.get(0))
            .optional()?;
        let mut value = saved
            .map(|s| serde_json::from_str::<Value>(&s))
            .transpose()?
            .filter(Value::is_object)
            .unwrap_or(json!({}));
        value[agent] = json!({"input_tokens":value[agent]["input_tokens"].as_u64().unwrap_or(0).saturating_add(input),"output_tokens":value[agent]["output_tokens"].as_u64().unwrap_or(0).saturating_add(output)});
        db.execute(
            "INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, serde_json::to_string(&value)?],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn companion_snapshots_keep_latest_complete_notes_without_erasing_history() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let store = Store::open(&root).unwrap();
        for text in ["old note", "new note with [file](main.rs:2)"] {
            store
                .event(Event {
                    id: 0,
                    job: "job".into(),
                    folder: "project".into(),
                    agent: "codex".into(),
                    kind: "note".into(),
                    text: text.into(),
                    stage: "work".into(),
                    time: now(),
                    data: Value::Null,
                })
                .unwrap();
        }
        let compact = store.companion_job_events("job").unwrap();
        assert_eq!(compact.len(), 1);
        assert!(compact[0].text.ends_with("[file](main.rs:2)"));
        assert_eq!(store.job_events("job").unwrap().len(), 2);
        drop(store);
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn concurrent_agents_keep_every_usage_increment() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let store = Store::open(&root).unwrap();
        std::thread::scope(|scope| {
            for agent in ["claude", "codex", "grok", "agy"] {
                let s = &store;
                scope.spawn(move || {
                    for _ in 0..50 {
                        s.usage("project", agent, 3, 2).unwrap();
                    }
                });
            }
        });
        let totals = store
            .get(&format!("usage:{}", folder_key("project")))
            .unwrap()
            .unwrap();
        for agent in ["claude", "codex", "grok", "agy"] {
            assert_eq!(totals[agent]["input_tokens"], 150);
            assert_eq!(totals[agent]["output_tokens"], 100);
        }
        drop(store);
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn interrupted_jobs_and_cursor_survive_restart() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        {
            let s = Store::open(&root).unwrap();
            let job = Job {
                id: "a".into(),
                folder: home(),
                request: "hello".into(),
                request_id: "req1".into(),
                status: "running".into(),
                time: now(),
            };
            s.accept(&job).unwrap();
            assert!(s.accept(&job).is_err());
            assert_eq!(s.messages(&home()).unwrap().len(), 1);
            s.event(Event {
                id: 0,
                job: "a".into(),
                folder: home(),
                agent: "codex".into(),
                kind: "phase".into(),
                text: "Working".into(),
                stage: String::new(),
                time: now(),
                data: Value::Null,
            })
            .unwrap();
        }
        let s = Store::open(&root).unwrap();
        assert_eq!(s.jobs().unwrap()[0].status, "interrupted");
        assert_eq!(s.events(0).unwrap()[0].id, 1);
        assert!(s.events(1).unwrap().is_empty());
        drop(s);
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_settings_chat_and_draft_import_only_once() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir(root.join("chats")).unwrap();
        let folder = canonical(project.to_str().unwrap()).unwrap();
        std::fs::write(root.join("settings.json"),json!({"folder":folder,"coder":"claude","reviewers":["codex"],"full_access":true,"draft":"이어서 입력","references":[root.join("missing")] }).to_string()).unwrap();
        let hash = format!("{:x}", Sha256::digest(folder.to_lowercase().as_bytes()));
        let original = root.join("chats").join(format!("{hash}.json"));
        std::fs::write(&original,json!({"messages":[{"role":"You","text":"기존 대화"}],"usage":{"codex":{"input_tokens":23,"output_tokens":7}}}).to_string()).unwrap();
        let store = Store::open(&root).unwrap();
        let settings: Settings =
            serde_json::from_value(store.get("settings").unwrap().unwrap()).unwrap();
        assert_eq!(settings.permissions, "coder");
        assert!(settings.references.is_empty());
        store.import_chat(&root, &folder).unwrap();
        store.import_chat(&root, &folder).unwrap();
        assert_eq!(store.messages(&folder).unwrap().len(), 1);
        assert_eq!(
            store
                .get(&format!("draft:{}", folder_key(&folder)))
                .unwrap()
                .unwrap(),
            json!("이어서 입력")
        );
        assert!(original.is_file());
        assert_eq!(
            store
                .get(&format!("usage:{}", folder_key(&folder)))
                .unwrap()
                .unwrap()["codex"]["input_tokens"],
            23
        );
        drop(store);
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
