#!/usr/bin/env node
/**
 * Every Tauri plugin command has to be declared three times, and missing any
 * one of them makes the command silently uncallable at runtime while `cargo
 * check` stays green:
 *
 *   1. `tauri::generate_handler![...]` in `apps/app/src/api/<plugin>.rs`
 *      (the dispatch table),
 *   2. `InlinedPlugin::new().commands(&[...])` in `apps/app/build.rs`
 *      (generates the ACL manifest entry for the plugin),
 *   3. `"<plugin>:default"` in `apps/app/capabilities/plugins.json`
 *      (grants that permission to the main window).
 *
 * A release build with (1) but not (2)/(3) rejects the frontend's `invoke` with
 * exactly `Command plugin:<name>|<command> not allowed by ACL`. That happened
 * to `bootstrap_install_bundled_mods`, which left a first-run instance without
 * the mods it cannot start without. This guard turns the next occurrence into a
 * build-time failure instead of a player-visible one.
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const API_DIR = 'apps/app/src/api'
const BUILD_RS = 'apps/app/build.rs'
const CAPABILITIES = 'apps/app/capabilities/plugins.json'

const failures = []
const notes = []

/** `Builder::new("name")` + the plugin's `generate_handler![...]` list. */
function parseRegisteredCommands(source, file) {
	const plugins = []
	const builderPattern = /Builder::new\((?:\s*)["']([^"']+)["'](?:\s*)\)([\s\S]*?)(?=\n\}|$)/g
	for (const match of source.matchAll(builderPattern)) {
		const [, name, body] = match
		const handler = /generate_handler!\[([\s\S]*?)\]/.exec(body)
		if (!handler) continue
		const commands = handler[1]
			.split(',')
			.map((entry) => entry.replace(/\/\/[^\n]*/g, '').trim())
			.filter((entry) => entry.length > 0)
		plugins.push({ name, commands, file })
	}
	return plugins
}

/** `InlinedPlugin::new().commands(&[...])` per `.plugin("<name>", ...)` block. */
function parseDeclaredCommands(source) {
	const declared = new Map()
	const pluginCalls = [...source.matchAll(/\.plugin\(\s*["']([^"']+)["']\s*,/g)]
	for (let index = 0; index < pluginCalls.length; index++) {
		const name = pluginCalls[index][1]
		const start = pluginCalls[index].index
		const end =
			index + 1 < pluginCalls.length ? pluginCalls[index + 1].index : source.length
		const block = source.slice(start, end)
		const commands = /\.commands\(&\[([\s\S]*?)\]\)/.exec(block)
		declared.set(
			name,
			commands
				? commands[1]
						.split(',')
						.map((entry) =>
							entry
								.replace(/\/\/[^\n]*/g, '')
								.trim()
								.replace(/^["']|["']$/g, ''),
						)
						.filter((entry) => entry.length > 0)
				: [],
		)
	}
	return declared
}

/** Every `.rs` file under a directory (plugin modules may live in a folder). */
async function rustFiles(directory) {
	const found = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) found.push(...(await rustFiles(entryPath)))
		else if (entry.name.endsWith('.rs')) found.push(entryPath)
	}
	return found
}

const apiFiles = await rustFiles(API_DIR)

const registered = []
for (const file of apiFiles) {
	registered.push(...parseRegisteredCommands(await readFile(file, 'utf8'), file))
}

const buildSource = await readFile(BUILD_RS, 'utf8')
const declared = parseDeclaredCommands(buildSource)
const capabilities = JSON.parse(await readFile(CAPABILITIES, 'utf8'))
const granted = new Set(
	(capabilities.permissions ?? []).map((entry) =>
		typeof entry === 'string' ? entry : entry.identifier,
	),
)

if (registered.length === 0) {
	failures.push(`no plugin command lists found under ${API_DIR}`)
}

for (const plugin of registered) {
	if (!declared.has(plugin.name)) {
		failures.push(
			`${plugin.file}: plugin "${plugin.name}" is registered in Rust but missing from ${BUILD_RS} (add an InlinedPlugin block)`,
		)
	} else {
		const missing = plugin.commands.filter(
			(command) => !declared.get(plugin.name).includes(command),
		)
		if (missing.length > 0) {
			failures.push(
				`${BUILD_RS}: plugin "${plugin.name}" does not declare ${missing.join(', ')}`,
			)
		}
	}

	if (!granted.has(`${plugin.name}:default`)) {
		failures.push(
			`${CAPABILITIES}: plugin "${plugin.name}" is not granted ("${plugin.name}:default" is missing)`,
		)
	}

	notes.push(`${plugin.name}: ${plugin.commands.length} command(s)`)
}

if (failures.length > 0) {
	console.error(
		`Axolotl Tauri command check failed: ${failures.length} problem(s).\n` +
			'A command that is registered but not declared and granted is rejected at runtime with\n' +
			'"Command plugin:<plugin>|<command> not allowed by ACL", even though cargo check passes.\n' +
			failures.join('\n'),
	)
	process.exit(1)
}

console.log(
	`Axolotl Tauri command check passed (${registered.length} plugin(s): ${notes.join('; ')}).`,
)
