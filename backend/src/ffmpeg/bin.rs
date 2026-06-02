use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::{fs, io};
use tracing::info;

static FFMPEG_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static FFPROBE_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn read_env_path(env_var: &str) -> Option<String> {
    let value = std::env::var(env_var).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_with_cache(
    cache: &OnceLock<Mutex<Option<String>>>,
    name: &str,
    env_var: &str,
) -> Result<String, String> {
    let lock = cache.get_or_init(|| Mutex::new(None));
    let mut cached = lock.lock().unwrap();
    if let Some(path) = cached.as_ref() {
        return Ok(path.clone());
    }

    if let Some(path) = read_env_path(env_var) {
        validate_binary(&path, name)?;
        info!("selected {name} binary: {path}");
        *cached = Some(path.clone());
        return Ok(path);
    }

    match Command::new(name).arg("-version").output() {
        Ok(_) => {
            let path = name.to_string();
            info!("selected {name} binary: {path}");
            *cached = Some(path.clone());
            Ok(path)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Err(format!("{name} not found on PATH and {env_var} is not set"))
        }
        Err(error) => Err(format!("failed to run {name}: {error}")),
    }
}

fn validate_binary(path: &str, name: &str) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("{name} binary does not exist at {path}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{name} binary path is not a file: {path}"));
    }
    Command::new(path)
        .arg("-version")
        .output()
        .map_err(|error| format!("failed to execute {name} at {path}: {error}"))?;
    Ok(())
}

pub(crate) fn ffmpeg_path() -> Result<String, String> {
    resolve_with_cache(&FFMPEG_PATH, "ffmpeg", "FRAMESCRIPT_FFMPEG_PATH")
}

pub(crate) fn ffprobe_path() -> Result<String, String> {
    resolve_with_cache(&FFPROBE_PATH, "ffprobe", "FRAMESCRIPT_FFPROBE_PATH")
}
