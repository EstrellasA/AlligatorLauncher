use crate::api::Result;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::Manager;
use theseus::instance::{
    BundledModAsset, BundledModsStatusReport, BundledSetDependency,
    InstallBundledModsReport, bundled_mods_status, install_bundled_mods,
};

/// One set of jars shipped with the launcher, and the instance folder those
/// jars belong in.
///
/// The launcher ships **two** sets, and they are deliberately kept apart
/// instead of being merged into one list: the server set belongs in `mods/`,
/// the folder AutoModpack owns, while the client set belongs in `clientmods/`,
/// a folder the loader only knows about because `alligatorzone-core` registers
/// it. A client-only jar dropped into `mods/` would be fought over by
/// AutoModpack, and a server jar dropped into `clientmods/` would never be
/// synced — so the target folder is part of the set, not a parameter.
///
/// Adding a third set later is a data change: one more entry here, plus the
/// folder name in `apps/app-frontend/src/server-config.ts`, which is where the
/// frontend keeps the folders it asks for.
///
/// Whether a set may be installed yet is part of the set for the same reason the
/// folder is: it is a property of those jars, not of the caller, and the backend
/// is what enforces it.
struct BundledModSet {
    /// Directory inside the Tauri resource directory that holds this set's
    /// jars. Mirrors `bundle.resources` in `tauri.conf.json`.
    resource_dir: &'static str,
    /// Mods folder, relative to the instance's game directory, this set
    /// belongs in. The frontend names this folder when it asks for the set, and
    /// a request naming any other folder is rejected rather than answered with
    /// an empty install.
    mods_folder: &'static str,
    /// What this set needs before it may be installed at all.
    dependency: BundledSetDependency,
    /// The jars stored in `resource_dir`. Keep in sync with that directory: a
    /// name that is listed but not shipped is a hard error, which is what turns
    /// a packaging mistake into a visible failure instead of a silent skip.
    files: &'static [&'static str],
}

/// Every bundled set, in install order.
///
/// The server set is what makes the game start and sync the pack:
/// - `automodpack-*` is what syncs the server pack (`sync-automodpack-version`
///   is enabled server-side, so it also self-corrects its own version)
/// - `alligatorzone-core-*` registers the `clientmods/` discovery directory
///
/// The client set is the rendering stack the server pack does not ship, and
/// which AutoModpack therefore never distributes (Colorwheel, Iris, …).
/// Without it Flywheel comes up as `flywheel:off` and Create: Steam 'n' Rails
/// dies during startup in `PhantomSpriteManager.renderTick` with an
/// `ArrayIndexOutOfBoundsException` from `SpriteContents.upload`.
///
/// A jar belongs to the **server** set, not the client set, whenever it is a
/// Sinytra Connector build of a Fabric mod. Connector is only handed such a jar
/// by NeoForge's own `mods/` scanning; discovered instead by our `clientmods/`
/// locator it registers as a *library*, its version resolves to `[MISSING]`,
/// and every dependent fails with "<mod> is not installed". Sodium is exactly
/// that case, which is why it sits in `mods/` despite being client-only.
///
/// The client set also declares [`BundledSetDependency::ServerPack`], because
/// `sablemassview` requires `sable` and both `create_cyber_goggles` and
/// `smart_bounds` require `create`, and those live only in the server pack.
/// Installing the client set on a brand-new instance would make NeoForge's
/// dependency check fail before AutoModpack ever downloads anything, so the
/// launcher leaves it deferred until the pack is on disk and installs it on the
/// following start. `mods/` is never deferred: it carries AutoModpack itself.
const BUNDLED_MOD_SETS: &[BundledModSet] = &[
    BundledModSet {
        resource_dir: "resources/bundled-mods",
        mods_folder: "mods",
        dependency: BundledSetDependency::Standalone,
        files: &[
            "automodpack-5.0.0-rc.4.jar",
            "alligatorzone-core-1.0.0.jar",
            "[钠] sodium-neoforge-0.8.13+mc1.21.1.jar",
        ],
    },
    BundledModSet {
        resource_dir: "resources/bundled-client-mods",
        mods_folder: "clientmods",
        dependency: BundledSetDependency::ServerPack,
        files: &[
            "aeronauticshotairfix-1.1.1.jar",
            "BetterAdvancements-NeoForge-1.21.1-0.4.3.21.jar",
            "colorwheel-neoforge-1.3.0+mc1.21.1.jar",
            "colorwheel_patcher-neoforge-1.0.5+mc1.21.1.jar",
            "Controlling-neoforge-1.21.1-19.0.5.jar",
            "createbetterfps-1.21.1-1.1.5.jar",
            "create_ez_stock_ticker-1.0.4.jar",
            "flerovium-neoforge-1.21.1-1.0.18-all.jar",
            "fwa+1.21.1-neoforge-1.2.31.jar",
            "ImmediatelyFast-NeoForge-1.6.10+1.21.1.jar",
            "iris-neoforge-1.8.14-beta.1+mc1.21.1.jar",
            "iris_shader_folder-1.4.2-neoforge.jar",
            "jecharacters-1.21.1-neoforge-4.5.27.jar",
            "lootlog-neoforge-1.0.0.jar",
            "MouseTweaks-neoforge-mc1.21-2.26.1.jar",
            "neo-voxy-0.5.0-alpha.4-mc1.21.1-neoforge.jar",
            "particular-1.21.1-NeoForge-1.1.7.jar",
            "sablemassview-1.0.0.jar",
            "Searchables-neoforge-1.21.1-1.0.2.jar",
            "smart_bounds-1.0.0.jar",
            "[机械动力：赛博护目镜] CreateCyberGoggles-1.21.1-8.3.12-NeoForge.jar",
        ],
    },
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
    /// Identifies which bundled set to use, so it has to be one of the folders
    /// in [`BUNDLED_MOD_SETS`].
    pub mods_folder: String,
}

/// The bundled set that belongs in `mods_folder`.
///
/// The frontend drives the folders (they live in `server-config.ts`) and the
/// backend says what belongs in each one. A folder this launcher ships no set
/// for is a hard error: answering it with "nothing to do" would turn a typo in
/// the configuration into a first-run instance that silently never gets its
/// mods.
fn bundled_mod_set(mods_folder: &str) -> Result<&'static BundledModSet> {
    let trimmed = mods_folder.trim();
    match BUNDLED_MOD_SETS
        .iter()
        .find(|set| set.mods_folder == trimmed)
    {
        Some(set) => Ok(set),
        None => {
            let known = BUNDLED_MOD_SETS
                .iter()
                .map(|set| format!("{:?}", set.mods_folder))
                .collect::<Vec<_>>()
                .join(", ");
            Err(theseus::ErrorKind::InputError(format!(
                "This launcher ships no bundled mods for the folder {trimmed:?}; expected one of {known}"
            ))
            .as_error()
            .into())
        }
    }
}

/// Where the packaged jars of one set live.
///
/// Tauri copies `bundle.resources` into the resource directory, so a packaged
/// install resolves to `<resource_dir>/resources/bundled-mods` and
/// `<resource_dir>/resources/bundled-client-mods` — verified after a build,
/// where `target/release/resources/` holds both sets next to
/// `resources/blockbench-skin`. The fallback covers a build where that copy is
/// absent (plain `cargo run` without the Tauri CLI), and is only reachable
/// then: in a packaged install without the copy it points at a directory that
/// does not exist, so every jar is reported as a missing bundled source instead
/// of being skipped.
fn bundled_set_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    set: &BundledModSet,
) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join(set.resource_dir);
        if packaged.is_dir() {
            return packaged;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(set.resource_dir)
}

/// The jars of one set, resolved against the launcher's own installation.
fn bundled_set_assets<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    set: &BundledModSet,
) -> (PathBuf, Vec<BundledModAsset>) {
    let set_dir = bundled_set_dir(app, set);
    let assets = set
        .files
        .iter()
        .map(|file_name| BundledModAsset {
            file_name: (*file_name).to_string(),
            source_path: set_dir.join(file_name),
        })
        .collect::<Vec<_>>();
    (set_dir, assets)
}

/// Copy one bundled set into its folder inside an instance.
///
/// The frontend calls this once per folder — `mods` first, then `clientmods` —
/// so each set keeps its own report and one failing set names the folder it
/// belongs to.
///
/// Idempotent: files that already match the bundled copy are left untouched,
/// and a missing bundled source fails with an explicit error instead of
/// pretending to succeed.
///
/// A set whose `dependency` is [`BundledSetDependency::ServerPack`] is not
/// installed while AutoModpack has not installed the server pack; the report then
/// carries `deferred: true` and nothing on disk changes. This is the precondition
/// that keeps the first launch from crashing on jars whose dependencies only
/// arrive with the pack.
#[tauri::command]
pub async fn bootstrap_install_bundled_mods<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: InstallBundledModsRequest,
) -> Result<InstallBundledModsReport> {
    let set = bundled_mod_set(&request.mods_folder)?;
    let (set_dir, assets) = bundled_set_assets(&app, set);

    tracing::info!(
        instance_id = %request.instance_id,
        mods_folder = %request.mods_folder,
        bundled_mods_dir = %set_dir.display(),
        jars = assets.len(),
        requires_server_pack = matches!(
            set.dependency,
            BundledSetDependency::ServerPack
        ),
        "Installing a bundled mod set for the first-run bootstrap"
    );

    Ok(install_bundled_mods(
        &request.instance_id,
        &request.mods_folder,
        assets,
        set.dependency,
    )
    .await?)
}

/// Report whether an existing instance is still missing any jar of one bundled
/// set, without changing anything on disk.
///
/// This is what lets a launcher start notice an instance that was left
/// half-built (created, but without the mods the game cannot start without) and
/// repair it, while a complete instance is left completely alone. The frontend
/// asks this for every folder and repairs the instance when *either* answer
/// says a jar is missing — the server set alone is not enough to start the
/// game.
///
/// A set whose `dependency` is [`BundledSetDependency::ServerPack`] answers
/// `needs_repair: false` with `deferred: true` while the server pack is not on
/// disk: its jars are meant to be absent on a brand-new instance, and reporting
/// them as broken would make the launcher claim something is wrong that is
/// deliberately postponed.
#[tauri::command]
pub async fn bootstrap_bundled_mods_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: InstallBundledModsRequest,
) -> Result<BundledModsStatusReport> {
    let set = bundled_mod_set(&request.mods_folder)?;
    let (set_dir, assets) = bundled_set_assets(&app, set);

    tracing::debug!(
        instance_id = %request.instance_id,
        mods_folder = %request.mods_folder,
        bundled_mods_dir = %set_dir.display(),
        jars = assets.len(),
        "Checking an existing instance for missing bundled mods"
    );

    Ok(bundled_mods_status(
        &request.instance_id,
        &request.mods_folder,
        assets,
        set.dependency,
    )
    .await?)
}
