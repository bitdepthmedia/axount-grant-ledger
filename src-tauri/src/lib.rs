#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    tauri::Builder::default()
        .manage(PendingReconPaths::default())
        .invoke_handler(tauri::generate_handler![
            open_recon_file,
            read_recon_file,
            take_pending_recon_paths,
            save_recon_file,
            save_excel_file
        ])
        .build(context)
        .expect("error while building Reconsile")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                handle_opened_urls(app, urls);
            }
        });
}

#[derive(Default)]
struct PendingReconPaths(std::sync::Mutex<Vec<String>>);

#[derive(serde::Serialize)]
struct NativeFile {
    path: String,
    name: String,
    bytes: Vec<u8>,
}

#[derive(serde::Serialize)]
struct NativeSaveResult {
    path: String,
    name: String,
}

#[tauri::command]
fn open_recon_file() -> Result<Option<NativeFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Reconsile project", &["recon"])
        .pick_file()
    else {
        return Ok(None);
    };

    read_native_file(&path).map(Some)
}

#[tauri::command]
fn read_recon_file(path: String) -> Result<NativeFile, String> {
    read_native_file(&std::path::PathBuf::from(path))
}

#[tauri::command]
fn take_pending_recon_paths(state: tauri::State<'_, PendingReconPaths>) -> Result<Vec<String>, String> {
    let mut paths = state.0.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *paths))
}

#[tauri::command]
fn save_recon_file(
    bytes: Vec<u8>,
    suggested_name: String,
    path: Option<String>,
) -> Result<Option<NativeSaveResult>, String> {
    save_file(
        bytes,
        suggested_name,
        path,
        "Reconsile project",
        &["recon"],
    )
}

#[tauri::command]
fn save_excel_file(bytes: Vec<u8>, suggested_name: String) -> Result<Option<NativeSaveResult>, String> {
    save_file(
        bytes,
        suggested_name,
        None,
        "Excel workbook",
        &["xlsx"],
    )
}

fn save_file(
    bytes: Vec<u8>,
    suggested_name: String,
    path: Option<String>,
    filter_name: &str,
    extensions: &[&str],
) -> Result<Option<NativeSaveResult>, String> {
    let path = match path {
        Some(path) => std::path::PathBuf::from(path),
        None => {
            let Some(path) = rfd::FileDialog::new()
                .set_file_name(&suggested_name)
                .add_filter(filter_name, extensions)
                .save_file()
            else {
                return Ok(None);
            };
            path
        }
    };

    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(NativeSaveResult {
        name: file_name(&path)?,
        path: path_string(&path),
    }))
}

fn read_native_file(path: &std::path::Path) -> Result<NativeFile, String> {
    if path.extension().and_then(|ext| ext.to_str()) != Some("recon") {
        return Err("Selected file is not a .recon project.".to_string());
    }

    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    Ok(NativeFile {
        name: file_name(path)?,
        path: path_string(path),
        bytes,
    })
}

#[cfg(target_os = "macos")]
fn handle_opened_urls(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    use tauri::{Emitter, Manager};

    let paths = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("recon"))
        .map(|path| path_string(&path))
        .collect::<Vec<_>>();

    if paths.is_empty() {
        return;
    }

    if let Ok(mut pending) = app.state::<PendingReconPaths>().0.lock() {
        pending.extend(paths.clone());
    }

    let _ = app.emit("recon-file-opened", paths);
}

fn file_name(path: &std::path::Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Selected file path is invalid.".to_string())
}

fn path_string(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}
