export const NO_IMAGE_KEY = "__media_rating_no_image__";

export function isNoImageKey(imageKey: string | null) {
    return imageKey === NO_IMAGE_KEY;
}

export function hasStoredImage(imageKey: string | null): imageKey is string {
    return Boolean(imageKey && imageKey !== NO_IMAGE_KEY);
}

export function shouldPromptForImage(imageKey: string | null) {
    return imageKey === null;
}
