export const MC_SERVER_BANNER_NAME = '__mc_server_banner__'

export interface ProjectGalleryImage {
    title?: string
    description?: string
}

export interface ProjectGalleryEntry<T extends ProjectGalleryImage> {
    image: T
    index: number
}

export type ProjectGalleryCaptionField = 'title' | 'description'

export function visibleProjectGallery<T extends ProjectGalleryImage>(
    gallery: T[] | undefined,
): ProjectGalleryEntry<T>[] {
    return (gallery ?? [])
        .map((image, index) => ({ image, index }))
        .filter(({ image }) => image.title !== MC_SERVER_BANNER_NAME)
}
