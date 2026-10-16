use crate::api::Result;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::Manager;
use theseus::instance::{
    BundledModAsset, BundledModsStatusReport, InstallBundledModsReport,
    bundled_mods_status, install_bundled_mods,
};

/// Directory inside the Tauri resource directory that holds the jars shipped
/// with the launcher. Mirrors `bundle.resources` in `tauri.conf.json`, the same
/// way `resources/blockbench-skin` is resolved in `main.rs`.
const BUNDLED_MODS_RESOURCE_DIR: &str = "resources/bundled-mods";

/// The mods a freshly created instance needs before the game can start.
///
/// Keep in sync with the files stored in `apps/app/resources/bundled-mods/`:
/// - `automodpack-*` is what syncs the server pack (`sync-automodpack-version`
///   is enabled server-side, so it also self-corrects its own version)
/// - `alligatorzone-core-*` registers the `clientmods/` discovery directory
const BUNDLED_MOD_FILES: [&str; 2] = [
    "automodpack-5.0.0-rc.4.jar",
    "alligatorzone-core-1.0.0.jar",
];

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bootstrap")
        .invoke_handler(tauri::generate_handler![
            bootstrap_install_bundled_mods,
            bootstrap_bundled_mods_status
        ])
        .build()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallBundledModsRequest {
    pub instance_id: String,
    /// Mods folder relative to the instance's game directory, e.g. `mods`.
    pub mods_folder: String,
}

/// Where the packaged jars live.
///
/// Tauri copies `bundle.resources` into the resource directory, so a packaged
/// install resolves to `<resource_dir>/resources/bundled-mods` — verified after
/// a build, where `target/debug/resources/bundled-mods/` holds both jars next
/// to `resources/blockbench-skin`. The fallback covers a build where that copy
/// is absent (plain `cargo run` without the Tauri CLI), and is only reachable
/// then.
fn bundled_mods_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join(BUNDLED_MODS_RESOURCE_DIR);
        if packaged.is_dir() {
            return packaged;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BUNDLED_MODS_RESOURCE_DIR)
}

/// The bundled jars, resolved against the launcher's own installation.
fn bundled_mod_assets<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> (PathBuf, Vec<BundledModAsset>) {
    let mods_dir = bundled_mods_dir(app);
    let assets = BUNDLED_MOD_FILES
        .iter()
        .map(|file_name| BundledModAsset {
            file_name: (*file_name).to_string(),
            source_path: mods_dir.join(file_name),
        })
        .collect::<Vec<_>>();
    (mods_dir, assets)
}

/// Copy the launcher's bundled mod jars into an instance's mods folder.
///
/// Idempotent: files that already match the bundled copy are left untouched,
/// and a missing bundled source fails with an explicit error instead of
/// pretending to succeed.
#[tauri::command]
pub async fn bootstrap_install_bundled_mods<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: InstallBundledModsRequest,
) -> Result<InstallBundledModsReport> {
    let (mods_dir, assets) = bundled_mod_assets(&app);

    tracing::info!(
        instance_id = %request.instance_id,
        mods_folder = %request.mods_folder,
        bundled_mods_dir = %mods_dir.display(),
        "Installing bundled mods for the first-run bootstrap"
    );

    Ok(install_bundled_mods(
        &request.instance_id,
        &request.mods_folder,
        assets,
    )
    .await?)
}

/// Report whether an existing instance is still missing any bundled jar,
/// without changing anything on disk.
///
/// This is what lets a launcher start notice an instance that was left
/// half-built (created, but without the mods the game cannot start without) and
/// repair it, while a complete instance is left completely alone.
#[tauri::command]
pub async fn bootstrap_bundled_mods_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: InstallBundledModsRequest,
) -> Result<BundledModsStatusReport> {
    let (mods_dir, assets) = bundled_mod_assets(&app);

    tracing::debug!(
        instance_id = %request.instance_id,
        mods_folder = %request.mods_folder,
        bundled_mods_dir = %mods_dir.display(),
        "Checking an existing instance for missing bundled mods"
    );

    Ok(bundled_mods_status(
        &request.instance_id,
        &request.mods_folder,
        assets,
    )
    .await?)
}
