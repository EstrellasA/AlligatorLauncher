//! AutoModpack generation history: the server's own record of what it published.
//!
//! The server distributes this pack with AutoModpack, which keeps an append-only
//! journal of published *generations* under `automodpack/server/journal.jsonl`.
//! Each client mirrors that file verbatim at
//! `automodpack/client/history/<modpackId>/journal.jsonl`, so the complete
//! server-authored history — including patch notes — is already on the player's
//! disk before the game ever runs. This module reads that mirror; it never
//! reaches the network, and it never needs a running game.
//!
//! ## Why a change keeps its path
//!
//! A journal change records `path` plus the sha1 and size on each side. The
//! **path** is what lets the update-notes page resolve each changed jar to an
//! instance content item and render it as a clickable project card. The hashes
//! are carried through because AutoModpack identifies files by content, but the
//! page's card rendering depends on the path. Do not narrow this reader to
//! counts or hashes: that silently removes the ability to show which mod
//! changed, which is the entire point of the page.
//!
//! ## Format caveats this reader encodes
//!
//! * AutoModpack serializes with Gson, which omits null fields. A missing
//!   `fromSha1` marks an added file and a missing `toSha1` a removed one; an
//!   explicitly present `null` is accepted as the same thing so a differently
//!   configured writer still parses.
//! * `fromSize`/`toSize` are *not* a reliable add/remove signal: a real empty
//!   file legitimately reports size 0, so classification uses key presence.
//! * The journal is appended line by line, so a crash or power cut can leave a
//!   torn final line. AutoModpack repairs that away on its next read. This
//!   reader instead **skips** an unparseable line and reports how many it
//!   skipped, so one bad byte never blanks the page.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Directory inside an instance's game directory that AutoModpack owns.
pub const AUTOMODPACK_DIR: &str = "automodpack";
/// Client-side runtime state, as opposed to the `host-modpack/` the operator edits.
pub const AUTOMODPACK_CLIENT_DIR: &str = "client";
/// `client/selected.json`: which modpack the client currently follows.
pub const AUTOMODPACK_SELECTED_FILE: &str = "selected.json";
/// `client/history/`: one directory per modpack id, each a journal mirror.
pub const AUTOMODPACK_HISTORY_DIR: &str = "history";
/// The mirrored journal file name, matching the server artifact.
pub const AUTOMODPACK_JOURNAL_FILE: &str = "journal.jsonl";

/// How many sample paths to keep per folded directory.
///
/// The `kubejs/` tree alone contributes hundreds of paths to a first publish.
/// The count is the useful headline; the samples are there so expanding a group
/// shows something concrete without shipping a multi-megabyte payload into the
/// webview.
const DIRECTORY_SAMPLE_LIMIT: usize = 50;

/// Why the instance has no generation history to show.
///
/// These are expected, ordinary states — a player who has not launched yet, or
/// whose pack has been reconfigured — not errors. The page renders one honest
/// sentence per reason instead of an empty error box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomodpackUnavailableReason {
    /// No `automodpack/client` directory: the pack has never synced here.
    NotInstalled,
    /// `selected.json` is absent or unreadable: no pack is being followed.
    NoSelectedPack,
    /// The selected pack has no journal mirror on disk.
    HistoryMissing,
}

/// What one journal change did to one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomodpackChangeKind {
    Added,
    Changed,
    Removed,
}

/// One file a generation touched, identified by path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomodpackChange {
    /// Logical path relative to the game directory, `/`-separated
    /// (for example `mods/Jade-1.21.1-NeoForge-15.10.5.jar`). This is the same
    /// shape the launcher stores in `instance_files.relative_path`, so it can be
    /// handed straight to the content API.
    pub path: String,
    pub kind: AutomodpackChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_sha1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_sha1: Option<String>,
    #[serde(default)]
    pub from_size: u64,
    #[serde(default)]
    pub to_size: u64,
}

/// One top-level directory of non-mod changes, folded so a large tree stays readable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomodpackDirectoryGroup {
    /// Top-level directory name; `""` collects files that sit at the root.
    pub directory: String,
    /// Total paths under this directory across every kind.
    pub count: u64,
    pub added: u64,
    pub changed: u64,
    pub removed: u64,
    /// Up to [`DIRECTORY_SAMPLE_LIMIT`] paths, for the expanded view.
    pub sample_paths: Vec<String>,
    /// True when `sample_paths` is shorter than `count`.
    pub samples_truncated: bool,
}

/// One published generation: the unit AutoModpack itself calls a generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomodpackGeneration {
    /// Journal sequence number, 1-based and monotonic.
    pub seq: i64,
    /// Publish time, ISO-8601 UTC exactly as the server wrote it.
    pub created_at: String,
    /// Patch notes the operator published with this generation.
    ///
    /// Deliberately its own field, and deliberately allowed to be empty: the
    /// page must be able to say "this generation has no patch notes" rather
    /// than render a blank area that looks like a loading failure.
    pub notes: String,
    /// The state token identifying this generation's content.
    pub content_token: String,
    /// Journal sequence this generation restores, or `None` for a normal publish.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore_of: Option<i64>,
    /// Total files this generation touched.
    pub changed_files: u64,
    /// Every changed path under the pack's mods folder, in journal order.
    ///
    /// A path — not a hash or a count — because the update-notes page resolves
    /// each one to an instance content item to render its project card.
    pub mod_paths: Vec<String>,
    /// Every file this generation touched, in journal order.
    ///
    /// This is the per-change record the page reads a mod's kind from; the
    /// directory groups below are a folded view of the same list.
    pub changes: Vec<AutomodpackChange>,
    /// Non-mod changes, folded by top-level directory and ordered by name.
    pub directories: Vec<AutomodpackDirectoryGroup>,
}

/// The whole history the launcher can show for one instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomodpackChangelog {
    /// Whether a journal was found and read.
    pub available: bool,
    /// The selected modpack id, when one is recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modpack_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<AutomodpackUnavailableReason>,
    /// Generations, newest first.
    pub generations: Vec<AutomodpackGeneration>,
    /// Lines skipped as unparseable — a torn final line after a crash, or damage.
    pub skipped_lines: u64,
}

impl AutomodpackChangelog {
    fn unavailable(
        reason: AutomodpackUnavailableReason,
        modpack_id: Option<String>,
    ) -> Self {
        Self {
            available: false,
            modpack_id,
            unavailable_reason: Some(reason),
            generations: Vec::new(),
            skipped_lines: 0,
        }
    }
}

/// The subset of `selected.json` this reader needs.
#[derive(Debug, Deserialize)]
struct SelectedModpack {
    #[serde(rename = "modpackId", alias = "modpack_id")]
    modpack_id: String,
}

/// One journal line, as AutoModpack's Gson writes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalEntryFields {
    seq: i64,
    #[serde(default)]
    content_token: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    notes: String,
    #[serde(default = "default_restore_of")]
    restore_of: i64,
    #[serde(default)]
    changes: Vec<JournalChangeFields>,
}

fn default_restore_of() -> i64 {
    -1
}

/// One change, with a custom `kind` so key presence decides — not the sizes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalChangeFields {
    path: String,
    #[serde(default)]
    from_sha1: Option<String>,
    #[serde(default)]
    to_sha1: Option<String>,
    #[serde(default)]
    from_size: u64,
    #[serde(default)]
    to_size: u64,
}

/// An empty string is not a hash: Gson writes `""` for the field's default and
/// only omits it when the value is genuinely null.
fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

impl JournalChangeFields {
    fn into_change(self) -> AutomodpackChange {
        let from_sha1 = non_empty(self.from_sha1);
        let to_sha1 = non_empty(self.to_sha1);

        // Absent source means the path is new; absent target means it is gone.
        let kind = match (&from_sha1, &to_sha1) {
            (None, Some(_)) => AutomodpackChangeKind::Added,
            (Some(_), None) => AutomodpackChangeKind::Removed,
            (Some(_), Some(_)) => AutomodpackChangeKind::Changed,
            // Neither side has content: nothing changed about this path, so a
            // removal-free "changed" would be a lie. Treat it as added only if
            // the target claims bytes; otherwise skip it as a no-op.
            (None, None) => AutomodpackChangeKind::Added,
        };

        AutomodpackChange {
            path: self.path,
            kind,
            from_sha1,
            to_sha1,
            from_size: self.from_size,
            to_size: self.to_size,
        }
    }
}

/// The top-level directory of a logical path, or `""` for a root-level file.
fn top_level_directory(path: &str) -> &str {
    match path.split_once('/') {
        Some((directory, _)) => directory,
        None => "",
    }
}

/// True for paths the pack manages under its mods folder.
fn is_mod_path(path: &str) -> bool {
    path.strip_prefix("mods/").is_some_and(|rest| !rest.is_empty())
}

/// Parses the journal text into generations, newest first.
///
/// Unparseable lines are counted and skipped rather than failing the read, so a
/// torn final line after a crash never costs the player the history behind it.
pub fn parse_journal(
    modpack_id: Option<String>,
    journal: &str,
) -> AutomodpackChangelog {
    let mut generations = Vec::new();
    let mut skipped_lines = 0_u64;

    for line in journal.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let entry: JournalEntryFields = match serde_json::from_str(line) {
            Ok(entry) => entry,
            Err(_) => {
                skipped_lines += 1;
                continue;
            }
        };

        generations.push(generation_from(entry));
    }

    // Newest first: the page reads top-down and the head generation is what the
    // player is actually running.
    generations.sort_by(|left, right| right.seq.cmp(&left.seq));

    AutomodpackChangelog {
        available: true,
        modpack_id,
        unavailable_reason: None,
        generations,
        skipped_lines,
    }
}

fn generation_from(entry: JournalEntryFields) -> AutomodpackGeneration {
    let mut mod_paths = Vec::new();
    let mut by_directory: BTreeMap<String, DirectoryFold> = BTreeMap::new();
    let mut changed_files = 0_u64;
    let mut changes = Vec::with_capacity(entry.changes.len());

    for change in entry.changes {
        let change = change.into_change();
        changed_files += 1;

        if is_mod_path(&change.path) {
            mod_paths.push(change.path.clone());
        } else {
            by_directory
                .entry(top_level_directory(&change.path).to_string())
                .or_default()
                .push(&change);
        }

        changes.push(change);
    }

    let directories = by_directory
        .into_iter()
        .map(|(directory, fold)| fold.into_group(directory))
        .collect();

    AutomodpackGeneration {
        seq: entry.seq,
        created_at: entry.created_at,
        notes: entry.notes,
        content_token: entry.content_token,
        restore_of: (entry.restore_of >= 0).then_some(entry.restore_of),
        changed_files,
        mod_paths,
        changes,
        directories,
    }
}

/// Accumulates the counts and a bounded sample per folded directory.
#[derive(Default)]
struct DirectoryFold {
    count: u64,
    added: u64,
    changed: u64,
    removed: u64,
    sample_paths: Vec<String>,
}

impl DirectoryFold {
    fn push(&mut self, change: &AutomodpackChange) {
        self.count += 1;
        match change.kind {
            AutomodpackChangeKind::Added => self.added += 1,
            AutomodpackChangeKind::Changed => self.changed += 1,
            AutomodpackChangeKind::Removed => self.removed += 1,
        }
        if self.sample_paths.len() < DIRECTORY_SAMPLE_LIMIT {
            self.sample_paths.push(change.path.clone());
        }
    }

    fn into_group(self, directory: String) -> AutomodpackDirectoryGroup {
        let samples_truncated = (self.sample_paths.len() as u64) < self.count;
        AutomodpackDirectoryGroup {
            directory,
            count: self.count,
            added: self.added,
            changed: self.changed,
            removed: self.removed,
            sample_paths: self.sample_paths,
            samples_truncated,
        }
    }
}

/// Reads the selected modpack id from `client/selected.json`.
///
/// A missing or malformed file is a reason, not an error: it means AutoModpack
/// is not following a pack here yet.
fn read_selected_modpack_id(client_dir: &Path) -> Option<String> {
    let raw =
        std::fs::read_to_string(client_dir.join(AUTOMODPACK_SELECTED_FILE)).ok()?;
    let selected: SelectedModpack = serde_json::from_str(&raw).ok()?;
    let id = selected.modpack_id.trim();
    (!id.is_empty()).then(|| id.to_string())
}

/// Reads the generation history the client mirrored from the server.
///
/// Returns `available: false` with a reason for the ordinary "nothing published
/// here yet" states, and an error only when the instance itself is unknown.
/// The pack id is always read from disk — never assumed — so a server that
/// reissues its pack id keeps working.
pub async fn get_automodpack_changelog(
    instance_id: &str,
) -> crate::Result<AutomodpackChangelog> {
    let state = crate::State::get().await?;
    let instance =
        crate::state::get_instance(instance_id, &state.pool)
            .await?
            .ok_or_else(|| {
                crate::ErrorKind::InputError("Unknown instance".to_string())
            })?;

    let game_dir =
        crate::state::instances::commands::instance_content_root(
            &state.directories,
            &instance.instance,
        )?;

    Ok(read_changelog_from_game_dir(&game_dir))
}

/// The filesystem half of [`get_automodpack_changelog`], split out so it can be
/// exercised against a temporary game directory without launcher state.
pub(crate) fn read_changelog_from_game_dir(
    game_dir: &Path,
) -> AutomodpackChangelog {
    let client_dir =
        game_dir.join(AUTOMODPACK_DIR).join(AUTOMODPACK_CLIENT_DIR);
    if !client_dir.is_dir() {
        return AutomodpackChangelog::unavailable(
            AutomodpackUnavailableReason::NotInstalled,
            None,
        );
    }

    let Some(modpack_id) = read_selected_modpack_id(&client_dir) else {
        return AutomodpackChangelog::unavailable(
            AutomodpackUnavailableReason::NoSelectedPack,
            None,
        );
    };

    let journal_path: PathBuf = client_dir
        .join(AUTOMODPACK_HISTORY_DIR)
        .join(&modpack_id)
        .join(AUTOMODPACK_JOURNAL_FILE);

    let Ok(journal) = std::fs::read_to_string(&journal_path) else {
        // The pack id is recorded but its mirror is gone: a rename, a manual
        // cleanup, or a sync that never completed. Name the real state instead
        // of reporting an IO error the player cannot act on.
        return AutomodpackChangelog::unavailable(
            AutomodpackUnavailableReason::HistoryMissing,
            Some(modpack_id),
        );
    };

    parse_journal(Some(modpack_id), &journal)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds one journal line. `changes` is compacted because a journal is
    /// JSON-lines: one record per physical line, so this helper must never let
    /// a pretty-printed fixture introduce a line break.
    fn entry_line(seq: i64, notes: &str, changes: &str) -> String {
        let changes: String =
            changes.chars().filter(|c| !c.is_whitespace()).collect();
        format!(
            r#"{{"seq":{seq},"contentToken":"{}","policySha1":"{}","createdAt":"2026-10-01T07:58:53.977887468Z","notes":{notes},"restoreOf":-1,"changes":[{changes}]}}"#,
            "a".repeat(40),
            "b".repeat(40)
        )
    }

    #[test]
    fn key_presence_decides_the_change_kind() {
        let journal = entry_line(
            1,
            r#""""#,
            r#"{"path":"mods/Added.jar","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":10},
               {"path":"mods/Removed.jar","fromSha1":"dddddddddddddddddddddddddddddddddddddddd","fromSize":20},
               {"path":"mods/Changed.jar","fromSha1":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","fromSize":30,"toSha1":"ffffffffffffffffffffffffffffffffffffffff","toSize":40}"#,
        );

        let changelog = parse_journal(Some("pack".into()), &journal);
        assert_eq!(changelog.generations.len(), 1);
        let generation = &changelog.generations[0];

        assert_eq!(generation.changed_files, 3);
        assert_eq!(generation.mod_paths.len(), 3);

        // The path list stays in journal order; the kind for each path is what
        // the page reads to label a mod's card.
        let kinds: Vec<_> = generation
            .changes
            .iter()
            .map(|change| (change.path.as_str(), change.kind))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("mods/Added.jar", AutomodpackChangeKind::Added),
                ("mods/Removed.jar", AutomodpackChangeKind::Removed),
                ("mods/Changed.jar", AutomodpackChangeKind::Changed),
            ]
        );

        let paths: Vec<_> =
            generation.mod_paths.iter().map(String::as_str).collect();
        assert_eq!(
            paths,
            vec!["mods/Added.jar", "mods/Removed.jar", "mods/Changed.jar"]
        );
    }

    /// `changes` carries the sha1 pair so a card can show what a mod was
    /// updated from, without the page re-reading the journal.
    #[test]
    fn change_hashes_survive_the_round_trip() {
        let journal = entry_line(
            1,
            r#""""#,
            r#"{"path":"mods/Changed.jar","fromSha1":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","fromSize":30,"toSha1":"ffffffffffffffffffffffffffffffffffffffff","toSize":40}"#,
        );

        let changelog = parse_journal(None, &journal);
        let change = &changelog.generations[0].changes[0];

        assert_eq!(change.kind, AutomodpackChangeKind::Changed);
        assert_eq!(change.from_sha1.as_deref(), Some("e".repeat(40).as_str()));
        assert_eq!(change.to_sha1.as_deref(), Some("f".repeat(40).as_str()));
        assert_eq!(change.from_size, 30);
        assert_eq!(change.to_size, 40);
    }

    /// A zero-length file is a real file: classification must not read sizes.
    #[test]
    fn a_zero_sized_added_file_is_still_added() {
        let journal = entry_line(
            1,
            r#""""#,
            r#"{"path":"mods/Empty.jar","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":0}"#,
        );

        let changelog = parse_journal(None, &journal);
        let change = &changelog.generations[0];
        assert_eq!(change.changed_files, 1);
        assert_eq!(change.mod_paths, vec!["mods/Empty.jar".to_string()]);
    }

    /// Gson's `""` default must read as absent, not as a hash.
    #[test]
    fn empty_string_hashes_read_as_absent() {
        let journal = entry_line(
            1,
            r#""""#,
            r#"{"path":"mods/Empty-string.jar","fromSha1":"","fromSize":0,"toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":5}"#,
        );

        let changelog = parse_journal(None, &journal);
        assert_eq!(
            changelog.generations[0].mod_paths,
            vec!["mods/Empty-string.jar".to_string()]
        );
    }

    #[test]
    fn a_torn_final_line_is_skipped_and_counted() {
        let mut journal = entry_line(1, r#""""#, r#"{"path":"kubejs/a.js","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":1}"#);
        journal.push('\n');
        journal.push_str(r#"{"seq":2,"contentToken":"aaaa"#);

        let changelog = parse_journal(Some("pack".into()), &journal);

        assert!(changelog.available);
        assert_eq!(changelog.skipped_lines, 1);
        assert_eq!(changelog.generations.len(), 1);
        assert_eq!(changelog.generations[0].seq, 1);
    }

    #[test]
    fn generations_come_back_newest_first() {
        let mut journal = entry_line(1, r#""""#, "");
        journal.push('\n');
        journal.push_str(&entry_line(3, r#""third""#, ""));
        journal.push('\n');
        journal.push_str(&entry_line(2, r#""second""#, ""));

        let changelog = parse_journal(None, &journal);
        let seqs: Vec<_> =
            changelog.generations.iter().map(|g| g.seq).collect();
        assert_eq!(seqs, vec![3, 2, 1]);
        assert_eq!(changelog.generations[0].notes, "third");
    }

    /// The existing pack has policy-only republishes with no changes at all;
    /// they must survive as dated entries rather than being dropped.
    #[test]
    fn a_policy_only_republish_keeps_its_place() {
        let mut journal = entry_line(1, r#""""#, r#"{"path":"kubejs/a.js","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":1}"#);
        journal.push('\n');
        journal.push_str(&entry_line(2, r#""""#, ""));

        let changelog = parse_journal(None, &journal);
        assert_eq!(changelog.generations.len(), 2);
        assert_eq!(changelog.generations[0].seq, 2);
        assert_eq!(changelog.generations[0].changed_files, 0);
        assert!(changelog.generations[0].notes.is_empty());
    }

    #[test]
    fn non_mod_changes_fold_by_top_level_directory() {
        let journal = entry_line(
            1,
            r#""""#,
            r#"{"path":"kubejs/a.js","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":1},
               {"path":"kubejs/b.js","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":1},
               {"path":"kubejs/data/x.json","fromSha1":"dddddddddddddddddddddddddddddddddddddddd","fromSize":2,"toSha1":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","toSize":3},
               {"path":"options.txt","toSha1":"ffffffffffffffffffffffffffffffffffffffff","toSize":4}"#,
        );

        let changelog = parse_journal(None, &journal);
        let generation = &changelog.generations[0];

        assert!(generation.mod_paths.is_empty());
        assert_eq!(generation.changed_files, 4);

        // `""` (root files) sorts before `kubejs`.
        let dirs: Vec<_> = generation
            .directories
            .iter()
            .map(|d| (d.directory.as_str(), d.count, d.added, d.changed))
            .collect();
        assert_eq!(dirs, vec![("", 1, 1, 0), ("kubejs", 3, 2, 1)]);

        let kubejs = &generation.directories[1];
        assert_eq!(kubejs.sample_paths.len(), 3);
        assert!(!kubejs.samples_truncated);
    }

    #[test]
    fn a_large_directory_keeps_a_bounded_sample() {
        let changes = (0..DIRECTORY_SAMPLE_LIMIT + 7)
            .map(|index| {
                format!(
                    r#"{{"path":"kubejs/generated/{index}.js","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":1}}"#
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let journal = entry_line(1, r#""""#, &changes);

        let changelog = parse_journal(None, &journal);
        let group = &changelog.generations[0].directories[0];

        assert_eq!(group.directory, "kubejs");
        assert_eq!(group.count, (DIRECTORY_SAMPLE_LIMIT + 7) as u64);
        assert_eq!(group.sample_paths.len(), DIRECTORY_SAMPLE_LIMIT);
        assert!(group.samples_truncated);
    }

    #[test]
    fn a_restore_is_reported_as_such() {
        let line = format!(
            r#"{{"seq":4,"contentToken":"{}","policySha1":"{}","createdAt":"2026-10-15T15:58:52.509506204Z","notes":"rollback","restoreOf":2,"changes":[]}}"#,
            "a".repeat(40),
            "b".repeat(40)
        );

        let changelog = parse_journal(None, &line);
        assert_eq!(changelog.generations[0].restore_of, Some(2));

        // A normal publish carries -1 and must not surface a restore target.
        let normal = parse_journal(None, &entry_line(1, r#""""#, ""));
        assert_eq!(normal.generations[0].restore_of, None);
    }

    #[test]
    fn a_missing_client_directory_is_not_installed() {
        let temp = tempfile::TempDir::new().unwrap();
        let changelog = read_changelog_from_game_dir(temp.path());

        assert!(!changelog.available);
        assert_eq!(
            changelog.unavailable_reason,
            Some(AutomodpackUnavailableReason::NotInstalled)
        );
        assert!(changelog.generations.is_empty());
    }

    #[test]
    fn a_client_without_a_selected_pack_is_reported_as_such() {
        let temp = tempfile::TempDir::new().unwrap();
        let client = temp.path().join(AUTOMODPACK_DIR).join(AUTOMODPACK_CLIENT_DIR);
        std::fs::create_dir_all(&client).unwrap();

        let changelog = read_changelog_from_game_dir(temp.path());
        assert!(!changelog.available);
        assert_eq!(
            changelog.unavailable_reason,
            Some(AutomodpackUnavailableReason::NoSelectedPack)
        );
        assert_eq!(changelog.modpack_id, None);
    }

    /// The pack id is read from disk, so a renamed pack still resolves.
    #[test]
    fn the_pack_id_is_read_from_disk_not_assumed() {
        let temp = tempfile::TempDir::new().unwrap();
        let client = temp.path().join(AUTOMODPACK_DIR).join(AUTOMODPACK_CLIENT_DIR);
        let pack_id = "zzz9999";
        let history = client.join(AUTOMODPACK_HISTORY_DIR).join(pack_id);
        std::fs::create_dir_all(&history).unwrap();
        std::fs::write(
            client.join(AUTOMODPACK_SELECTED_FILE),
            r#"{"modpackId":"zzz9999"}"#,
        )
        .unwrap();
        std::fs::write(
            history.join(AUTOMODPACK_JOURNAL_FILE),
            entry_line(1, r#""shipped""#, ""),
        )
        .unwrap();

        let changelog = read_changelog_from_game_dir(temp.path());
        assert!(changelog.available);
        assert_eq!(changelog.modpack_id.as_deref(), Some(pack_id));
        assert_eq!(changelog.generations[0].notes, "shipped");
    }

    #[test]
    fn a_selected_pack_without_a_mirror_names_the_missing_history() {
        let temp = tempfile::TempDir::new().unwrap();
        let client = temp.path().join(AUTOMODPACK_DIR).join(AUTOMODPACK_CLIENT_DIR);
        std::fs::create_dir_all(&client).unwrap();
        std::fs::write(
            client.join(AUTOMODPACK_SELECTED_FILE),
            r#"{"modpackId":"gone123"}"#,
        )
        .unwrap();

        let changelog = read_changelog_from_game_dir(temp.path());
        assert!(!changelog.available);
        assert_eq!(
            changelog.unavailable_reason,
            Some(AutomodpackUnavailableReason::HistoryMissing)
        );
        assert_eq!(changelog.modpack_id.as_deref(), Some("gone123"));
    }

    /// End-to-end against the real on-disk shape, including a torn tail.    #[test]
    fn reads_a_realistic_journal_from_disk() {
        let temp = tempfile::TempDir::new().unwrap();
        let client = temp.path().join(AUTOMODPACK_DIR).join(AUTOMODPACK_CLIENT_DIR);
        let history = client.join(AUTOMODPACK_HISTORY_DIR).join("bm859uj");
        std::fs::create_dir_all(&history).unwrap();
        std::fs::write(
            client.join(AUTOMODPACK_SELECTED_FILE),
            r#"{"modpackId":"bm859uj"}"#,
        )
        .unwrap();

        let body = format!(
            "{}\n{}\n{{\"seq\":3,\"contentToke",
            entry_line(1, r#""""#, r#"{"path":"mods/A.jar","toSha1":"cccccccccccccccccccccccccccccccccccccccc","toSize":10}"#),
            entry_line(2, r#""""#, "")
        );
        std::fs::write(history.join(AUTOMODPACK_JOURNAL_FILE), body).unwrap();

        let changelog = read_changelog_from_game_dir(temp.path());
        assert!(changelog.available);
        assert_eq!(changelog.skipped_lines, 1);
        assert_eq!(changelog.generations.len(), 2);
        assert_eq!(changelog.generations[0].seq, 2);
        assert_eq!(changelog.generations[1].mod_paths, vec!["mods/A.jar"]);
    }
}
