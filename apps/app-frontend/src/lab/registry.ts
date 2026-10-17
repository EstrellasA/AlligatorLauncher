import { BlocksIcon, BoxIcon, PaletteIcon, PencilIcon, WorldIcon } from '@modrinth/assets'
import type { Component } from 'vue'

export type LabToolDefinition = {
    id: string
    category: 'creation' | 'world'
    route: string
    icon: Component
    title: string
    description: string
}

export const labTools: readonly LabToolDefinition[] = [
    {
        id: 'skin-editor',
        category: 'creation',
        route: '/lab/skin-editor',
        icon: PencilIcon,
        title: 'Skin editor',
        description: 'Create and edit Minecraft player skins locally.',
    },
    {
        id: 'gradient-text',
        category: 'creation',
        route: '/lab/gradient-text',
        icon: PaletteIcon,
        title: 'Gradient text generator',
        description: 'Create Minecraft-ready gradient text without a browser.',
    },
    {
        id: 'seed-map',
        category: 'world',
        route: '/lab/seed-map',
        icon: WorldIcon,
        title: 'Seed map',
        description: 'Explore a Minecraft seed locally with biomes, structures, and saved markers.',
    },
    {
        id: 'schematic-preview',
        category: 'creation',
        route: '/lab/schematic-preview',
        icon: BoxIcon,
        title: 'Schematic workshop',
        description: 'Quickly preview and edit your schematics.',
    },
    {
        id: 'recipe-generator',
        category: 'creation',
        route: '/lab/recipe-generator',
        icon: BlocksIcon,
        title: 'Recipe generator',
        description: 'Create Minecraft Java data pack recipes from local item and tag data.',
    },
]

export function getLabTool(id: string): LabToolDefinition | undefined {
    return labTools.find((tool) => tool.id === id)
}
