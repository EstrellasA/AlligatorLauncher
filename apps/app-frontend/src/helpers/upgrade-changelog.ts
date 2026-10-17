export interface UpgradeChangelogPopoverOwnership {
    triggerHovered: boolean
    triggerFocused: boolean
    popupHovered: boolean
    popupFocused: boolean
}

export function shouldUpgradeChangelogStayOpen(state: UpgradeChangelogPopoverOwnership): boolean {
    return state.triggerHovered || state.triggerFocused || state.popupHovered || state.popupFocused
}

export function upgradeExternalChangelogUrl(href: string): string | null {
    try {
        const url = new URL(href.replace(/[),.;!?]+$/u, ''))
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
    } catch {
        return null
    }
}
