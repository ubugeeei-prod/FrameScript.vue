use std::{env, error::Error, path::PathBuf};

pub fn resolve_path_to_path_buf(input: &str) -> Result<PathBuf, Box<dyn Error>> {
    let env_expanded = shellexpand::env(input)?; // -> Cow<str>

    let tilde_expanded = shellexpand::tilde(&env_expanded);

    let mut path = PathBuf::from(tilde_expanded.as_ref());

    if !path.is_absolute() {
        let base = env::var("FRAMESCRIPT_PROJECT_ROOT")
            .map(PathBuf::from)
            .unwrap_or(env::current_dir()?);
        path = base.join(path);
    }

    path = match dunce::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => path,
    };

    Ok(path)
}

pub fn resolve_path_to_string(input: &str) -> Result<String, Box<dyn Error>> {
    let path = resolve_path_to_path_buf(input)?;
    Ok(path.to_string_lossy().into_owned())
}
