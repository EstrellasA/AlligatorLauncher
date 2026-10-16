import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Fails when a component is neither exported from a barrel nor referenced by
 * any reachable module.
 *
 * Such a file is invisible: nothing imports it, no barrel lists it, and
 * nothing breaks when it rots. Six of them had accumulated in `packages/ui`
 * (a dead Breadcrumbs, LargeRadioButton, PageHeader, TagIcon,
 * ModalLoadingIndicator and an earlier batch), each one reading as supported
 * API while being unreachable.
 *
 * Components deliberately kept out of a barrel but imported by path are fine
 * — this only flags files nothing references at all.
 */

/**
 * Every root whose `.vue` files are enumerated as candidate components.
 *
 * `apps/app-frontend/src/components` used to be searched for references only,
 * never enumerated, so an orphaned app component was structurally invisible to
 * this check — which is exactly how a dead `AddContentButton.vue` survived.
 */
const COMPONENT_ROOTS = ['packages/ui/src/components', 'apps/app-frontend/src/components']
const SEARCH_ROOTS = ['packages/ui/src', 'apps/app-frontend/src', 'apps/website/src']

/**
 * Where a module graph starts. Reachability is measured from here rather than
 * from "is this string mentioned anywhere", because a component that is only
 * imported by another dead component is dead too — counting that as a
 * reference is what let a whole orphaned home-dashboard subtree sit in the tree
 * reporting as referenced.
 */
const ENTRY_POINTS = [
	'apps/app-frontend/src/main.js',
	'apps/app-frontend/src/App.vue',
	'apps/website/src/main.ts',
	'apps/website/src/App.vue',
]

/** The router tables are entries too: they are what mounts a page component. */
for (const root of ['apps/app-frontend/src/routes', 'apps/website/src/routes']) {
	try {
		for (const entry of await readdir(root)) {
			if (/\.(ts|js)$/.test(entry)) ENTRY_POINTS.push(`${root}/${entry}`)
		}
	} catch {
		// A root without a routes directory simply contributes nothing.
	}
}

/**
 * `packages/ui` publishes from its package root, not from `src`, so its barrel
 * is the entry that reaches every component the apps import through
 * `@modrinth/ui`. It is scanned alongside `src` for the same reason: without it
 * the whole UI chain is unreachable and every shared component reads as dead.
 */
const EXTRA_SCAN_FILES = ['packages/ui/index.ts', 'packages/ui/node.ts']
for (const file of EXTRA_SCAN_FILES) {
	try {
		if ((await stat(file)).isFile()) ENTRY_POINTS.push(file)
	} catch {
		// A package without this barrel simply contributes nothing.
	}
}

async function* walk(directory, extensions) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (/node_modules|\.vite$|dist|\.output|__screenshots__/.test(entry.name)) continue
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) yield* walk(entryPath, extensions)
		else if (extensions.test(entry.name)) yield entryPath
	}
}

for (const root of [...COMPONENT_ROOTS, ...SEARCH_ROOTS]) {
	try {
		if (!(await stat(root)).isDirectory()) throw new Error('not a directory')
	} catch {
		console.error(`Axolotl component orphan check failed:\nscanned root is missing: ${root}`)
		process.exit(1)
	}
}

const sources = []
for (const root of SEARCH_ROOTS) {
	for await (const file of walk(root, /\.(vue|ts|js|mjs)$/)) {
		sources.push({ file, text: await readFile(file, 'utf8') })
	}
}
// The package barrels live above their `src`, so they are read separately.
for (const file of EXTRA_SCAN_FILES) {
	try {
		sources.push({ file, text: await readFile(file, 'utf8') })
	} catch {
		// Not every scanned package needs this barrel.
	}
}

/**
 * Every module specifier a file names, static or lazy.
 *
 * The literal is taken from the `from '<spec>'` clause or from `import('<spec>')`
 * rather than from the whole statement: imports here routinely span lines and
 * carry quoted keys inside destructuring, so a line-shaped pattern misses them.
 * That is precisely how a settings registry's
 * `defineAsyncComponent(() => import('./X.vue'))` and a route record's
 * `component: () => import('@/.../X.vue')` went unseen.
 */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"\n]+)['"]|\bimport\s+['"]([^'"\n]+)['"]/g

function specifiersIn(text) {
	const found = []
	for (const match of text.matchAll(SPECIFIER)) {
		const spec = match[1] ?? match[2]
		if (spec) found.push(spec)
	}
	return found
}

const FILE_SUFFIXES = ['', '.ts', '.js', '.vue', '.mjs', '.tsx', '/index.ts', '/index.js', '/index.vue']

const orphans = []

// ── Reachability ────────────────────────────────────────────────────────────
// A module counts only if the entry points can actually get to it. Walking the
// real import edges (rather than asking "is this name mentioned anywhere")
// means a component imported solely by another dead component is still dead.

const posix = (file) => file.replaceAll('\\', '/')

// Keyed by `/`-separated path so the literals in ENTRY_POINTS and the walk's
// platform-native paths agree on every OS.
const byFile = new Map(sources.map((source) => [posix(source.file), source]))

/**
 * Each app aliases `@/` and `~/` to its own `src`. Resolving them against the
 * importing file's app (not against the repo root) is what makes a route
 * record's `import('@/components/...')` and a registry's `import('./X.vue')`
 * both land on the same real file.
 */
const APP_SRC = [
	['apps/app-frontend/src/', 'apps/app-frontend/src'],
	['apps/website/src/', 'apps/website/src'],
]

function aliasBase(clean, fromFile) {
	for (const [prefix, base] of APP_SRC) {
		if (fromFile.startsWith(prefix)) return clean.replace(/^[@~]\//, base + '/')
	}
	return clean.replace(/^[@~]\//, '')
}

/** Resolve one specifier to a scanned file, following local paths only. */
function resolveSpecifier(spec, fromFile) {
	if (/^[a-z]+:/i.test(spec)) return null
	const clean = spec.split('?')[0].split('#')[0]
	if (!clean.startsWith('.') && !clean.startsWith('@/') && !clean.startsWith('~/')) return null

	// `path.dirname` wants the platform separator, while the keys are always
	// `/`-separated, so the importing path is converted in and back out.
	const joined = posix(
		clean.startsWith('.')
			? path.join(path.dirname(fromFile.replaceAll('/', path.sep)), clean)
			: aliasBase(clean, fromFile),
	)
	for (const suffix of FILE_SUFFIXES) {
		const candidate = joined + suffix
		if (byFile.has(candidate)) return candidate
	}
	return null
}

const reachable = new Set()
const pending = []
for (const entry of ENTRY_POINTS) {
	if (byFile.has(entry)) {
		reachable.add(entry)
		pending.push(entry)
	}
}
while (pending.length > 0) {
	const file = pending.pop()
	for (const spec of specifiersIn(byFile.get(file).text)) {
		const target = resolveSpecifier(spec, file)
		if (target && !reachable.has(target)) {
			reachable.add(target)
			pending.push(target)
		}
	}
}

// ── Reference detection ─────────────────────────────────────────────────────

/**
 * Reachability, not text coincidence: a component counts as referenced when a
 * reachable module imports its file, imports it by name, or uses it as a tag or
 * dynamic binding. A bare word match would be satisfied by a comment, a string,
 * or an unrelated identifier of the same name, which would let a dead component
 * evade the check.
 */
function isReferenced(name, text, fromFile, selfKey) {
	// The strongest and only fully reliable signal: a real import edge, resolved
	// by the same resolver the reachability walk uses. It is what catches
	// `component: () => import('@/.../X.vue')` in a route table and
	// `defineAsyncComponent(() => import('./X.vue'))` in a registry, neither of
	// which binds a local identifier for the rules below to match.
	if (specifiersIn(text).some((spec) => resolveSpecifier(spec, fromFile) === selfKey)) return true

	const importStatement = new RegExp(
		`import\\s[^;]*\\b${name}\\b[^;]*from\\s*['"][^'"]+['"]`,
	)
	const namedImport = new RegExp(`\\b${name}\\b\\s*[,}]`)
	const elementTag = new RegExp(`<${name}[\\s/>]`)
	// A component map or `<component :is>`/`is=` binding names the component
	// without importing it at the use site.
	const dynamicBinding = new RegExp(`\\b(?:is|component)\\s*[:=]\\s*['"]?${name}\\b`)

	return (
		importStatement.test(text) ||
		(namedImport.test(text) && /import\s/.test(text)) ||
		elementTag.test(text) ||
		dynamicBinding.test(text)
	)
}

for (const root of COMPONENT_ROOTS) {
	for await (const component of walk(root, /\.vue$/)) {
		const componentKey = posix(component)
		const name = path.basename(component, '.vue')
		const componentDirectory = path.dirname(component)

		// Each component is accountable to its own barrel; one that is not exported
		// there is only suspicious, not dead, unless nothing else reaches it.
		// `packages/ui` keeps public components in per-directory barrels; the app
		// frontend has none, so this is a no-op there rather than a blind spot.
		const barrelPath = path.join(componentDirectory, 'index.ts')
		let exported = false
		try {
			exported = (await readFile(barrelPath, 'utf8')).includes(`./${name}.vue`)
		} catch {
			exported = false
		}
		if (exported) continue

		// Only a reachable module can keep this component alive, and the
		// comparison is on `/`-separated keys so it holds on every OS.
		const referenced = sources.some(({ file, text }) => {
			const key = posix(file)
			if (key === componentKey) return false
			if (!reachable.has(key)) return false
			return isReferenced(name, text, key, componentKey)
		})

		if (!referenced) orphans.push(component)
	}
}

if (orphans.length > 0) {
	console.error(
		`Axolotl component orphan check failed: ${orphans.length} component(s) are neither exported nor referenced.\n` +
			'Delete them, or export them from their barrel if they are meant to be public.\n' +
			orphans.join('\n'),
	)
	process.exit(1)
}

console.log('Axolotl component orphan check passed.')
