use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

#[derive(Clone, Copy)]
pub enum Sweep { Images, Results }

#[derive(Clone)]
enum Operation { Remove, AcknowledgedResult, Sweep(Sweep) }

struct Job { operation: Operation, attempts: u32, next_attempt: Instant, generation: u64 }
#[derive(Default)]
struct State { jobs: HashMap<PathBuf, Job>, protected: HashSet<PathBuf> }
struct Worker { state: Mutex<State>, wake: Notify }
static WORKER: OnceLock<Arc<Worker>> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

fn log(app: &AppHandle, message: &str) {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let line = format!("[{timestamp}] [screenshot-cleanup] {message}\n");
    eprint!("{line}");
    let write = || -> io::Result<()> {
        let directory = app.path().app_log_dir().map_err(|error| io::Error::other(error.to_string()))?;
        fs::create_dir_all(&directory)?;
        let path = directory.join("screenshot-cleanup.log");
        if fs::metadata(&path).is_ok_and(|metadata| metadata.len() >= 1024 * 1024) {
            let previous = directory.join("screenshot-cleanup.previous.log");
            match fs::remove_file(&previous) {
                Ok(()) => {},
                Err(error) if error.kind() == io::ErrorKind::NotFound => {},
                Err(error) => return Err(error),
            }
            fs::rename(&path, previous)?;
        }
        OpenOptions::new().create(true).append(true).open(path)?.write_all(line.as_bytes())
    };
    if let Err(error) = write() { eprintln!("[screenshot-cleanup] Unable to write cleanup log: {error}"); }
}

fn worker(app: &AppHandle) -> Arc<Worker> {
    WORKER.get_or_init(|| {
        let worker = Arc::new(Worker { state: Mutex::new(State::default()), wake: Notify::new() });
        let background = worker.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let next = {
                    let state = background.state.lock().unwrap_or_else(|error| error.into_inner());
                    state.jobs.iter().min_by_key(|(_, job)| job.next_attempt)
                        .map(|(path, job)| (path.clone(), job.operation.clone(), job.attempts, job.next_attempt, job.generation))
                };
                let Some((path, operation, attempts, due, generation)) = next else {
                    background.wake.notified().await;
                    continue;
                };
                let delay = due.saturating_duration_since(Instant::now());
                if !delay.is_zero() {
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {},
                        _ = background.wake.notified() => {},
                    }
                    continue;
                }
                let task_worker = background.clone();
                let task_path = path.clone();
                let result = tauri::async_runtime::spawn_blocking(move || {
                    execute(&task_worker, &task_path, operation)
                }).await.unwrap_or_else(|error| Err(io::Error::other(error.to_string())));
                match result {
                    Ok(removed) => {
                        let mut state = background.state.lock().unwrap_or_else(|error| error.into_inner());
                        if state.jobs.get(&path).is_some_and(|job| job.generation == generation) { state.jobs.remove(&path); }
                        drop(state);
                        log(&app, &format!("{} path={} attempts={}", if removed { "completed" } else { "retained active image" }, path.display(), attempts.saturating_add(1)));
                    }
                    Err(error) => {
                        let attempt = attempts.saturating_add(1);
                        let seconds = match attempt { 1 => 1, 2 => 2, 3 => 5, 4 => 30, _ => 300 };
                        if let Some(job) = background.state.lock().unwrap_or_else(|error| error.into_inner()).jobs.get_mut(&path) {
                            job.attempts = attempt;
                            job.next_attempt = Instant::now() + Duration::from_secs(seconds);
                        }
                        log(&app, &format!("failed path={} attempt={attempt} retry_in={seconds}s error={error}", path.display()));
                    }
                }
            }
        });
        worker
    }).clone()
}

fn enqueue(worker: &Worker, path: PathBuf, operation: Operation) {
    let mut state = worker.state.lock().unwrap_or_else(|error| error.into_inner());
    state.jobs.entry(path).and_modify(|job| {
        job.generation = job.generation.wrapping_add(1);
    }).or_insert(Job { operation, attempts: 0, next_attempt: Instant::now() + Duration::from_millis(200), generation: 0 });
    drop(state);
    worker.wake.notify_one();
}

// Only native code constructs these paths. Active generations are protected
// from startup sweeps, including a sweep retried after an initial permission error.
pub fn protect(app: &AppHandle, path: &Path) {
    worker(app).state.lock().unwrap_or_else(|error| error.into_inner()).protected.insert(path.to_path_buf());
}

pub fn release(app: &AppHandle, path: &Path) {
    worker(app).state.lock().unwrap_or_else(|error| error.into_inner()).protected.remove(path);
}

pub fn remove(app: &AppHandle, path: PathBuf) {
    let worker = worker(app);
    worker.state.lock().unwrap_or_else(|error| error.into_inner()).protected.remove(&path);
    enqueue(&worker, path, Operation::Remove);
}

pub fn sweep(app: &AppHandle, directory: PathBuf, mode: Sweep) {
    let worker = worker(app);
    // Retire only images that existed when cleanup was requested. Captures
    // created afterwards register their own protection before writing bytes.
    if matches!(mode, Sweep::Images) {
        worker.state.lock().unwrap_or_else(|error| error.into_inner()).protected.retain(|path| !path.starts_with(&directory));
    }
    enqueue(&worker, directory, Operation::Sweep(mode));
}

fn marker(path: &Path) -> PathBuf { path.with_extension("delete") }

fn write_marker(path: &Path) -> io::Result<()> {
    let marker = marker(path);
    if let Some(parent) = marker.parent() { fs::create_dir_all(parent)?; }
    match OpenOptions::new().create_new(true).write(true).open(&marker) {
        Ok(file) => file.sync_all(),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if fs::symlink_metadata(marker)?.file_type().is_file() { Ok(()) }
            else { Err(io::Error::new(io::ErrorKind::InvalidData, "Acknowledgement marker is not a regular file")) }
        }
        Err(error) => Err(error),
    }
}

pub fn acknowledge_result(app: &AppHandle, path: PathBuf) {
    // Persist acknowledgement before deletion. On restart only marked results
    // may be discarded; unmarked PNGs still need to become records.
    if let Err(error) = write_marker(&path) {
        log(app, &format!("acknowledgement marker failed path={} error={error}; queued for retry", path.display()));
    }
    enqueue(&worker(app), path, Operation::AcknowledgedResult);
}

pub fn result_acknowledged(path: &Path) -> io::Result<bool> { marker(path).try_exists() }

pub fn report_error(app: &AppHandle, operation: &str, error: impl std::fmt::Display) {
    log(app, &format!("{operation}: {error}"));
}

fn remove_path(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let result = if metadata.is_dir() && !metadata.file_type().is_symlink() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    match result {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

pub fn flush_on_exit(app: &AppHandle) {
    let Some(worker) = WORKER.get() else { return; };
    let deadline = Instant::now() + Duration::from_millis(300);
    let mut failed = HashSet::new();
    // Sweep jobs produce individual deletion jobs. Run both stages without
    // sleeping on shutdown; failures remain discoverable on the next launch.
    for _ in 0..3 {
        let jobs: Vec<_> = worker.state.lock().unwrap_or_else(|error| error.into_inner()).jobs.iter()
            .filter(|(path, _)| !failed.contains(*path))
            .map(|(path, job)| (path.clone(), job.operation.clone(), job.generation)).collect();
        if jobs.is_empty() { break; }
        for (path, operation, generation) in jobs {
            if Instant::now() >= deadline { break; }
            match execute(worker, &path, operation) {
                Ok(removed) => {
                    let mut state = worker.state.lock().unwrap_or_else(|error| error.into_inner());
                    if state.jobs.get(&path).is_some_and(|job| job.generation == generation) { state.jobs.remove(&path); }
                    drop(state);
                    log(app, &format!("shutdown {} path={}", if removed { "cleanup completed" } else { "retained active image" }, path.display()));
                }
                Err(error) => {
                    log(app, &format!("shutdown cleanup deferred path={} error={error}; retry on next launch", path.display()));
                    failed.insert(path);
                }
            }
        }
        if Instant::now() >= deadline { break; }
    }
    let remaining = worker.state.lock().unwrap_or_else(|error| error.into_inner()).jobs.len();
    if remaining > 0 { log(app, &format!("shutdown pending_jobs={remaining}; startup sweeps will resume cleanup")); }
}

fn execute(worker: &Worker, path: &Path, operation: Operation) -> io::Result<bool> {
    if !matches!(&operation, Operation::Sweep(_)) && worker.state.lock().unwrap_or_else(|error| error.into_inner()).protected.iter().any(|active| path.starts_with(active) || active.starts_with(path)) {
        // A stale sweep must never remove a newly active image. A later close
        // schedules its own removal, and all generations are swept on restart.
        return Ok(false);
    }
    match operation {
        Operation::Remove => { remove_path(path)?; Ok(true) },
        Operation::AcknowledgedResult => {
            write_marker(path)?;
            remove_path(path)?;
            remove_path(&marker(path))?;
            Ok(true)
        }
        Operation::Sweep(mode) => {
            match fs::symlink_metadata(path) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(io::Error::new(io::ErrorKind::InvalidInput, "Refusing to sweep a symbolic-link cache directory"));
                }
                Ok(_) => {},
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(true),
                Err(error) => return Err(error),
            }
            let entries = match fs::read_dir(path) {
                Ok(entries) => entries,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(true),
                Err(error) => return Err(error),
            };
            for entry in entries {
                let path = entry?.path();
                match mode {
                    Sweep::Images => enqueue(worker, path, Operation::Remove),
                    Sweep::Results => match path.extension().and_then(|extension| extension.to_str()) {
                        Some("tmp") => enqueue(worker, path, Operation::Remove),
                        Some("delete") if path.file_stem().and_then(|stem| stem.to_str()).is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()) => {
                            enqueue(worker, path.with_extension("png"), Operation::AcknowledgedResult);
                        }
                        _ => {},
                    },
                }
            }
            // The parent directories are deliberately kept: deleting a shared
            // parent during a retry could delete a newer screenshot generation.
            Ok(true)
        }
    }
}
