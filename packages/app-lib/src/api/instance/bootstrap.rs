//! First-run bootstrap support.
//!
//! The launcher ships mod jars inside its own bundle (see
//! `apps/app/tauri.conf.json` → `bundle.resources`). A freshly created instance
//! has an empty `mods/` folder, so the game cannot start (AutoModpack is what
//! pulls the server pack) until those jars are on disk.
//!
//! A launcher bundle can hold more than one *set* of jars, each with its own
//! destination folder, so nothing here is hardcoded to `mods/`: every function
//! takes the target folder and the assets that belong in it. The fork this
//! module belongs to ships two sets — the AutoModpack entry point in `mods/`
//! and the client-only rendering stack in `clientmods/` — and treats an
//! instance as incomplete when *either* folder is incomplete, because the
//! server pack cannot distribute the client-only jars.
//!
//! This module copies the bundled jars into an instance's mods folder. It is
//! intentionally dumb and idempotent: it never deletes anything, and it only
//! writes a file when the target is missing or its contents differ from the
//! bundled copy.
//!
//! It also answers "is this instance still missing something?" without touching
//! disk ([`bundled_mods_status`]), which is what lets a launcher start finish a
//! half-built instance instead of stranding the player with a game that cannot
//! sync. An instance that is complete is never rewritten.

use crate::util::io;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// A single jar shipped inside the launcher bundle.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledModAsset {
    /// File name to write inside the instance's mods folder.
    pub file_name: String,
    /// Absolute path of the bundled source file.
    pub source_path: PathBuf,
}

/// What happened to one bundled jar.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BundledModStatus {
    /// The target file was missing and has been copied.
    Copied,
    /// The target file existed with different contents and has been replaced.
    Replaced,
    /// The target file already matched the bundled copy byte for byte.
    Unchanged,
}

/// Result for one bundled jar.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledModResult {
    pub file_name: String,
    pub status: BundledModStatus,
    pub bytes: u64,
}

/// Result of installing every bundled jar into one instance.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallBundledModsReport {
    pub instance_id: String,
    /// Absolute path of the mods folder that was written to.
    pub mods_dir: String,
    pub files: Vec<BundledModResult>,
    pub copied: usize,
    pub replaced: usize,
    pub unchanged: usize,
}

/// What one bundled jar looks like inside an instance right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BundledModState {
    /// Present and byte-for-byte identical to the bundled copy.
    UpToDate,
    /// Absent from the instance's mods folder.
    Missing,
    /// Present, but with different contents.
    Outdated,
    /// Not shipped inside this launcher build at all (packaging bug).
    SourceMissing,
}

/// State of one bundled jar inside an instance.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledModStateEntry {
    pub file_name: String,
    pub state: BundledModState,
}

/// Read-only report of how an instance stands against the bundled jars.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledModsStatusReport {
    pub instance_id: String,
    /// Absolute mods folder that was inspected. Nothing is created by a status
    /// check, so this path may not exist yet.
    pub mods_dir: String,
    pub files: Vec<BundledModStateEntry>,
    /// True when the instance cannot sync the server pack: a jar is absent from
    /// the instance, or absent from the launcher bundle itself.
    pub needs_repair: bool,
    /// Jars absent from the instance's mods folder.
    pub missing: Vec<String>,
    /// Jars that are present with different contents.
    pub outdated: Vec<String>,
    /// Jars that should have shipped with this launcher build but did not.
    pub missing_sources: Vec<String>,
}

/// Resolve a user-facing mods folder name against an instance game directory.
///
/// Only a plain relative path made of normal components is accepted, so a
/// malformed or hostile value can never escape the instance directory.
fn resolve_mods_dir(
    game_dir: &Path,
    mods_folder: &str,
) -> crate::Result<PathBuf> {
    let trimmed = mods_folder.trim();
    if trimmed.is_empty() {
        return Err(crate::ErrorKind::InputError(
            "The mods folder name must not be empty".to_string(),
        )
        .into());
    }

    let relative = Path::new(trimmed);
    let is_plain_relative = !relative.is_absolute()
        && relative.components().all(|component| {
            matches!(component, Component::Normal(_))
        });
    if !is_plain_relative {
        return Err(crate::ErrorKind::InputError(format!(
            "The mods folder must be a relative path inside the instance, got {trimmed:?}"
        ))
        .into());
    }

    Ok(game_dir.join(relative))
}

fn validate_file_name(file_name: &str) -> crate::Result<()> {
    let is_plain_file_name = !file_name.is_empty()
        && Path::new(file_name)
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !is_plain_file_name {
        return Err(crate::ErrorKind::InputError(format!(
            "Bundled mod file names must be plain file names, got {file_name:?}"
        ))
        .into());
    }
    Ok(())
}

/// A jar that should have shipped inside the launcher bundle is not on disk.
/// This is a packaging bug, so it must be reported instead of skipped.
fn missing_bundled_source(asset: &BundledModAsset) -> crate::ErrorKind {
    crate::ErrorKind::FSError(format!(
        "Bundled mod {} is missing from the launcher installation ({})",
        asset.file_name,
        asset.source_path.display()
    ))
}

/// Copy every bundled jar into `mods_dir`, creating it when needed.
///
/// Semantics, per file:
/// - target missing → copy (`Copied`)
/// - target present with different bytes → overwrite with the bundled copy
///   (`Replaced`); the bundled jar is the version this launcher was built
///   against, and AutoModpack self-corrects its version on first sync anyway
/// - target present with identical bytes → leave it alone (`Unchanged`)
///
/// The operation is idempotent, and a missing bundled source is a hard error
/// so that a packaging mistake is reported instead of silently skipped.
pub async fn sync_bundled_mods(
    mods_dir: &Path,
    assets: &[BundledModAsset],
) -> crate::Result<Vec<BundledModResult>> {
    io::create_dir_all(mods_dir).await?;

    let mut results = Vec::with_capacity(assets.len());
    for asset in assets {
        let state = classify_bundled_asset(mods_dir, asset).await?;

        let status = match state {
            // A jar that should have shipped with the launcher is not on disk:
            // report the packaging bug instead of skipping the file.
            BundledModState::SourceMissing => {
                return Err(missing_bundled_source(asset).into());
            }
            BundledModState::UpToDate => BundledModStatus::Unchanged,
            BundledModState::Missing => {
                io::copy(&asset.source_path, mods_dir.join(&asset.file_name))
                    .await?;
                BundledModStatus::Copied
            }
            BundledModState::Outdated => {
                io::copy(&asset.source_path, mods_dir.join(&asset.file_name))
                    .await?;
                BundledModStatus::Replaced
            }
        };

        results.push(BundledModResult {
            file_name: asset.file_name.clone(),
            status,
            bytes: io::metadata(&asset.source_path).await?.len(),
        });
    }

    Ok(results)
}

/// Compare one bundled asset against the instance's mods folder.
///
/// Read-only: nothing is created, copied or removed.
async fn classify_bundled_asset(
    mods_dir: &Path,
    asset: &BundledModAsset,
) -> crate::Result<BundledModState> {
    validate_file_name(&asset.file_name)?;

    let bundled = match io::read(&asset.source_path).await {
        Ok(bundled) => bundled,
        Err(_) => return Ok(BundledModState::SourceMissing),
    };

    let target = mods_dir.join(&asset.file_name);
    match io::read(&target).await {
        Ok(existing) if existing == bundled => Ok(BundledModState::UpToDate),
        Ok(_) => Ok(BundledModState::Outdated),
        Err(_) => Ok(BundledModState::Missing),
    }
}

/// Classify every bundled jar against an instance's mods folder.
///
/// Read-only counterpart of [`sync_bundled_mods`], used to decide whether a
/// launcher start has to complete (repair) an instance or can leave it alone.
pub async fn classify_bundled_mods(
    mods_dir: &Path,
    assets: &[BundledModAsset],
) -> crate::Result<Vec<BundledModStateEntry>> {
    let mut entries = Vec::with_capacity(assets.len());
    for asset in assets {
        entries.push(BundledModStateEntry {
            file_name: asset.file_name.clone(),
            state: classify_bundled_asset(mods_dir, asset).await?,
        });
    }
    Ok(entries)
}

/// Whether the states describe an instance that cannot sync the server pack.
///
/// Only a jar that is *absent* (from the instance or from the launcher build
/// itself) triggers a repair. A file that is merely outdated still lets the game
/// start — AutoModpack corrects its own version on the first sync — so a
/// launcher start never rewrites a file that is already there.
pub fn bundled_mods_need_repair(entries: &[BundledModStateEntry]) -> bool {
    entries.iter().any(|entry| {
        matches!(
            entry.state,
            BundledModState::Missing | BundledModState::SourceMissing
        )
    })
}

/// How an instance stands against the bundled jars, without changing anything.
///
/// This is the check a launcher start makes before touching an instance that
/// already exists, so that a half-built instance (created, but left without its
/// mods by a crash or an earlier failure) repairs itself instead of stranding
/// the player.
#[tracing::instrument(skip(assets))]
pub async fn bundled_mods_status(
    instance_id: &str,
    mods_folder: &str,
    assets: Vec<BundledModAsset>,
) -> crate::Result<BundledModsStatusReport> {
    let game_dir = crate::api::instance::get_full_path(instance_id).await?;
    let mods_dir = resolve_mods_dir(&game_dir, mods_folder)?;

    // Deliberately no `create_dir_all`: a status check must not mutate disk.
    let files = classify_bundled_mods(&mods_dir, &assets).await?;

    let names_in_state = |state: BundledModState| {
        files
            .iter()
            .filter(|entry| entry.state == state)
            .map(|entry| entry.file_name.clone())
            .collect::<Vec<_>>()
    };
    let missing = names_in_state(BundledModState::Missing);
    let outdated = names_in_state(BundledModState::Outdated);
    let missing_sources = names_in_state(BundledModState::SourceMissing);
    let needs_repair = bundled_mods_need_repair(&files);

    if needs_repair {
        tracing::warn!(
            event = "instance_bootstrap_incomplete_instance",
            instance_id,
            mods_dir = %mods_dir.display(),
            missing = ?missing,
            missing_sources = ?missing_sources,
            "Instance is missing bundled mods and needs a repair"
        );
    }

    Ok(BundledModsStatusReport {
        instance_id: instance_id.to_string(),
        mods_dir: mods_dir.to_string_lossy().into_owned(),
        files,
        needs_repair,
        missing,
        outdated,
        missing_sources,
    })
}

/// Install the launcher's bundled jars into an instance's mods folder.
///
/// Safe to call repeatedly: files that already match are left untouched.
#[tracing::instrument(skip(assets))]
pub async fn install_bundled_mods(
    instance_id: &str,
    mods_folder: &str,
    assets: Vec<BundledModAsset>,
) -> crate::Result<InstallBundledModsReport> {
    let game_dir = crate::api::instance::get_full_path(instance_id).await?;
    let mods_dir = resolve_mods_dir(&game_dir, mods_folder)?;

    let files = sync_bundled_mods(&mods_dir, &assets).await?;

    let report = InstallBundledModsReport {
        instance_id: instance_id.to_string(),
        mods_dir: mods_dir.to_string_lossy().into_owned(),
        copied: files
            .iter()
            .filter(|file| file.status == BundledModStatus::Copied)
            .count(),
        replaced: files
            .iter()
            .filter(|file| file.status == BundledModStatus::Replaced)
            .count(),
        unchanged: files
            .iter()
            .filter(|file| file.status == BundledModStatus::Unchanged)
            .count(),
        files,
    };

    tracing::info!(
        event = "instance_bootstrap_bundled_mods",
        instance_id,
        mods_dir = %report.mods_dir,
        copied = report.copied,
        replaced = report.replaced,
        unchanged = report.unchanged,
        "Installed bundled mods"
    );

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_asset(dir: &Path, name: &str, contents: &[u8]) -> BundledModAsset {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        BundledModAsset {
            file_name: name.to_string(),
            source_path: path,
        }
    }

    fn read_dir_names(dir: &Path) -> Vec<String> {
        let mut names = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[tokio::test]
    async fn copies_missing_files_then_leaves_them_alone() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![
            write_asset(source.path(), "automodpack.jar", b"pack"),
            write_asset(source.path(), "core.jar", b"core"),
        ];

        let first = sync_bundled_mods(mods.path(), &assets).await.unwrap();
        assert_eq!(first.len(), 2);
        assert!(
            first
                .iter()
                .all(|file| file.status == BundledModStatus::Copied)
        );
        assert_eq!(
            std::fs::read(mods.path().join("automodpack.jar")).unwrap(),
            b"pack"
        );

        let second = sync_bundled_mods(mods.path(), &assets).await.unwrap();
        assert!(
            second
                .iter()
                .all(|file| file.status == BundledModStatus::Unchanged)
        );
        assert_eq!(
            read_dir_names(mods.path()),
            vec!["automodpack.jar".to_string(), "core.jar".to_string()],
            "an idempotent run must not add or remove files"
        );
    }

    #[tokio::test]
    async fn replaces_a_file_whose_contents_differ() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![write_asset(source.path(), "automodpack.jar", b"new")];
        std::fs::write(mods.path().join("automodpack.jar"), b"old").unwrap();

        let results = sync_bundled_mods(mods.path(), &assets).await.unwrap();

        assert_eq!(results[0].status, BundledModStatus::Replaced);
        assert_eq!(
            std::fs::read(mods.path().join("automodpack.jar")).unwrap(),
            b"new"
        );
    }

    #[tokio::test]
    async fn creates_the_mods_folder_when_missing() {
        let source = TempDir::new().unwrap();
        let root = TempDir::new().unwrap();
        let mods = root.path().join("nested").join("mods");
        let assets = vec![write_asset(source.path(), "core.jar", b"core")];

        sync_bundled_mods(&mods, &assets).await.unwrap();

        assert_eq!(std::fs::read(mods.join("core.jar")).unwrap(), b"core");
    }

    #[tokio::test]
    async fn a_missing_bundled_source_fails_loudly() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![BundledModAsset {
            file_name: "missing.jar".to_string(),
            source_path: source.path().join("missing.jar"),
        }];

        let error = sync_bundled_mods(mods.path(), &assets)
            .await
            .expect_err("a missing bundled jar must not be skipped silently");

        assert!(
            error.to_string().contains("missing.jar"),
            "the error must name the missing file, got: {error}"
        );
    }

    #[test]
    fn mods_folder_cannot_escape_the_instance_directory() {
        let game_dir = Path::new("C:/instances/demo");

        assert!(resolve_mods_dir(game_dir, "mods").is_ok());
        assert!(resolve_mods_dir(game_dir, "mods/client").is_ok());
        assert!(resolve_mods_dir(game_dir, "").is_err());
        assert!(resolve_mods_dir(game_dir, "  ").is_err());
        assert!(resolve_mods_dir(game_dir, "../outside").is_err());
        assert!(resolve_mods_dir(game_dir, "mods/../../outside").is_err());
        assert!(resolve_mods_dir(game_dir, "C:/somewhere/else").is_err());
    }

    #[tokio::test]
    async fn bundled_file_names_cannot_escape_the_mods_folder() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![BundledModAsset {
            file_name: "../escape.jar".to_string(),
            source_path: source.path().join("escape.jar"),
        }];

        assert!(sync_bundled_mods(mods.path(), &assets).await.is_err());
    }

    #[tokio::test]
    async fn status_flags_a_missing_jar_as_needing_repair() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![
            write_asset(source.path(), "automodpack.jar", b"pack"),
            write_asset(source.path(), "core.jar", b"core"),
        ];

        let entries = classify_bundled_mods(mods.path(), &assets).await.unwrap();

        assert!(bundled_mods_need_repair(&entries));
        assert_eq!(entries[0].state, BundledModState::Missing);
        assert_eq!(entries[1].state, BundledModState::Missing);
    }

    #[tokio::test]
    async fn status_is_clean_for_a_complete_instance() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![
            write_asset(source.path(), "automodpack.jar", b"pack"),
            write_asset(source.path(), "core.jar", b"core"),
        ];
        sync_bundled_mods(mods.path(), &assets).await.unwrap();

        let entries = classify_bundled_mods(mods.path(), &assets).await.unwrap();

        assert!(!bundled_mods_need_repair(&entries));
        assert!(
            entries
                .iter()
                .all(|entry| entry.state == BundledModState::UpToDate)
        );
    }

    #[tokio::test]
    async fn status_does_not_repair_a_merely_outdated_jar() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![write_asset(source.path(), "automodpack.jar", b"new")];
        std::fs::write(mods.path().join("automodpack.jar"), b"old").unwrap();

        let entries = classify_bundled_mods(mods.path(), &assets).await.unwrap();

        assert_eq!(entries[0].state, BundledModState::Outdated);
        assert!(
            !bundled_mods_need_repair(&entries),
            "a present-but-outdated file still starts the game, so a launcher start must not rewrite it"
        );
    }

    #[tokio::test]
    async fn status_reports_a_bundled_source_that_did_not_ship() {
        let source = TempDir::new().unwrap();
        let mods = TempDir::new().unwrap();
        let assets = vec![BundledModAsset {
            file_name: "never-shipped.jar".to_string(),
            source_path: source.path().join("never-shipped.jar"),
        }];

        let entries = classify_bundled_mods(mods.path(), &assets).await.unwrap();

        assert_eq!(entries[0].state, BundledModState::SourceMissing);
        assert!(
            bundled_mods_need_repair(&entries),
            "a packaging bug must surface instead of looking like a healthy instance"
        );
    }

    #[tokio::test]
    async fn status_never_creates_the_mods_folder() {
        let source = TempDir::new().unwrap();
        let root = TempDir::new().unwrap();
        let mods = root.path().join("nested").join("mods");
        let assets = vec![write_asset(source.path(), "core.jar", b"core")];

        classify_bundled_mods(&mods, &assets).await.unwrap();

        assert!(
            !mods.exists(),
            "the status check must not mutate disk; the copy step creates the folder"
        );
    }

    // ---------------------------------------------------------------------
    // The second bundled set: the client-only jars that belong in `clientmods/`
    // ---------------------------------------------------------------------

    /// `clientmods/` is a plain relative folder like `mods/`, and every
    /// rejection that protects `mods/` protects it too.
    #[test]
    fn the_client_mods_folder_cannot_escape_the_instance_directory() {
        let game_dir = Path::new("C:/instances/demo");

        assert_eq!(
            resolve_mods_dir(game_dir, "clientmods").unwrap(),
            game_dir.join("clientmods")
        );
        assert!(resolve_mods_dir(game_dir, "../clientmods").is_err());
        assert!(resolve_mods_dir(game_dir, "clientmods/../../outside").is_err());
        assert!(resolve_mods_dir(game_dir, "C:/somewhere/clientmods").is_err());
        assert!(resolve_mods_dir(game_dir, "").is_err());
    }

    #[tokio::test]
    async fn bundled_file_names_cannot_escape_the_client_mods_folder() {
        let source = TempDir::new().unwrap();
        let clientmods = TempDir::new().unwrap();
        let assets = vec![BundledModAsset {
            file_name: "../escape.jar".to_string(),
            source_path: source.path().join("escape.jar"),
        }];

        assert!(sync_bundled_mods(clientmods.path(), &assets).await.is_err());
    }

    #[tokio::test]
    async fn the_client_set_lands_in_clientmods_and_never_in_mods() {
        let source = TempDir::new().unwrap();
        let game_dir = TempDir::new().unwrap();
        let mods = resolve_mods_dir(game_dir.path(), "mods").unwrap();
        let clientmods = resolve_mods_dir(game_dir.path(), "clientmods").unwrap();

        let server_assets = vec![write_asset(source.path(), "automodpack.jar", b"pack")];
        let client_assets = vec![
            write_asset(source.path(), "sodium.jar", b"sodium"),
            write_asset(source.path(), "colorwheel.jar", b"colorwheel"),
        ];

        sync_bundled_mods(&mods, &server_assets).await.unwrap();
        sync_bundled_mods(&clientmods, &client_assets).await.unwrap();

        assert_eq!(read_dir_names(&mods), vec!["automodpack.jar".to_string()]);
        assert_eq!(
            read_dir_names(&clientmods),
            vec!["colorwheel.jar".to_string(), "sodium.jar".to_string()],
            "the client-only jars must be copied into clientmods/, not into mods/"
        );
    }

    /// The regression that shipped a game which crashed during startup: the
    /// instance had both core jars in `mods/` and nothing at all in
    /// `clientmods/`, so a status check that only looked at `mods/` called it
    /// healthy and Flywheel came up without a backend.
    #[tokio::test]
    async fn a_missing_client_set_needs_repair_even_though_mods_is_complete() {
        let source = TempDir::new().unwrap();
        let game_dir = TempDir::new().unwrap();
        let mods = resolve_mods_dir(game_dir.path(), "mods").unwrap();
        let clientmods = resolve_mods_dir(game_dir.path(), "clientmods").unwrap();

        let server_assets = vec![
            write_asset(source.path(), "automodpack.jar", b"pack"),
            write_asset(source.path(), "core.jar", b"core"),
        ];
        let client_assets = vec![
            write_asset(source.path(), "sodium.jar", b"sodium"),
            write_asset(source.path(), "colorwheel.jar", b"colorwheel"),
        ];

        // The broken instance: `mods/` complete, `clientmods/` never created.
        sync_bundled_mods(&mods, &server_assets).await.unwrap();

        let server_state = classify_bundled_mods(&mods, &server_assets).await.unwrap();
        let client_state = classify_bundled_mods(&clientmods, &client_assets)
            .await
            .unwrap();

        assert!(
            !bundled_mods_need_repair(&server_state),
            "the server set is complete, so `mods/` on its own looks healthy"
        );
        assert!(
            bundled_mods_need_repair(&client_state),
            "the client set is missing, so the instance cannot start and has to be repaired"
        );
        // What a launcher start acts on: a verdict from *either* set. This is
        // `incompleteSets` in `first-run-bootstrap.ts`.
        let verdicts = [
            bundled_mods_need_repair(&server_state),
            bundled_mods_need_repair(&client_state),
        ];
        assert!(
            verdicts.iter().any(|needs_repair| *needs_repair),
            "a status check that only looked at `mods/` would leave this instance untouched"
        );

        // Repairing copies the client set and leaves `mods/` alone.
        sync_bundled_mods(&clientmods, &client_assets).await.unwrap();
        let repaired = classify_bundled_mods(&clientmods, &client_assets)
            .await
            .unwrap();
        assert!(!bundled_mods_need_repair(&repaired));
        assert_eq!(
            read_dir_names(&mods),
            vec!["automodpack.jar".to_string(), "core.jar".to_string()],
            "repairing the client set must not touch the server pack's folder"
        );
    }

    /// The real client set ships `[钠] sodium-neoforge-0.8.13+mc1.21.1.jar` and
    /// `[机械动力：赛博护目镜] CreateCyberGoggles-…jar`. A full-width colon, a
    /// `+` and the brackets must not be read as path syntax.
    #[tokio::test]
    async fn client_jar_names_with_cjk_and_plus_signs_are_plain_file_names() {
        const SODIUM: &str = "[钠] sodium-neoforge-0.8.13+mc1.21.1.jar";
        const GOGGLES: &str =
            "[机械动力：赛博护目镜] CreateCyberGoggles-1.21.1-8.3.12-NeoForge.jar";

        let source = TempDir::new().unwrap();
        let clientmods = TempDir::new().unwrap();
        let assets = vec![
            write_asset(source.path(), SODIUM, b"sodium"),
            write_asset(source.path(), GOGGLES, b"goggles"),
        ];

        let results = sync_bundled_mods(clientmods.path(), &assets).await.unwrap();

        assert!(
            results
                .iter()
                .all(|file| file.status == BundledModStatus::Copied)
        );
        assert_eq!(
            std::fs::read(clientmods.path().join(SODIUM)).unwrap(),
            b"sodium"
        );
        assert_eq!(
            std::fs::read(clientmods.path().join(GOGGLES)).unwrap(),
            b"goggles"
        );
    }
}
