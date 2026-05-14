use eframe::egui;
use egui::ColorImage;
use std::{
    collections::HashMap,
    fmt::Display,
    fs, io,
    path::{Path, PathBuf},
};

use crate::image_search;

const IMAGE_WIDTH: u32 = 380;
const IMAGE_HEIGHT: u32 = 475;

#[derive(Debug)]
pub struct ImageFetchError {
    pub details: String,
}

impl Display for ImageFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ImageFetchError: {}", self.details)
    }
}

impl From<image::ImageError> for ImageFetchError {
    fn from(err: image::ImageError) -> ImageFetchError {
        ImageFetchError {
            details: err.to_string(),
        }
    }
}

impl From<reqwest::Error> for ImageFetchError {
    fn from(err: reqwest::Error) -> ImageFetchError {
        ImageFetchError {
            details: err.to_string(),
        }
    }
}

impl From<io::Error> for ImageFetchError {
    fn from(err: io::Error) -> ImageFetchError {
        ImageFetchError {
            details: err.to_string(),
        }
    }
}

pub struct ImageStore {
    image_directory: PathBuf,
    texture_cache: HashMap<String, egui::TextureHandle>,
}

impl ImageStore {
    pub fn new(document_directory: impl Into<PathBuf>) -> Self {
        Self {
            image_directory: document_directory.into().join("images"),
            texture_cache: HashMap::new(),
        }
    }

    pub fn get_entry_texture(
        &mut self,
        entry: &str,
        category: &str,
        ctx: &egui::Context,
    ) -> egui::TextureHandle {
        let key = texture_key(entry, category);
        if let Some(texture) = self.texture_cache.get(&key) {
            return texture.clone();
        }

        let mut texture = ctx.load_texture(
            key.clone(),
            egui::ColorImage::new(
                [IMAGE_WIDTH as usize, IMAGE_HEIGHT as usize],
                egui::Color32::BLACK,
            ),
            egui::TextureOptions::LINEAR,
        );

        if let Ok(image) = get_image(category, entry, &self.image_directory, false) {
            texture = ctx.load_texture(key.clone(), image, egui::TextureOptions::LINEAR);
        }

        self.texture_cache.insert(key, texture.clone());
        texture
    }

    pub fn refresh_entry_texture(&mut self, entry: &str, category: &str, ctx: &egui::Context) {
        match get_image(category, entry, &self.image_directory, true) {
            Err(e) => {
                eprintln!("Error updating image: {e}");
            }
            Ok(image) => {
                let key = texture_key(entry, category);
                self.texture_cache.remove(&key);
                let texture = ctx.load_texture(key.clone(), image, egui::TextureOptions::LINEAR);
                self.texture_cache.insert(key, texture);
            }
        }
    }

    pub fn rename_image(&mut self, category: &str, old_title: &str, new_title: &str) {
        match rename_image_file(category, old_title, new_title, &self.image_directory) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("Error renaming image: {e}"),
        }

        let old_key = texture_key(old_title, category);
        if let Some(texture) = self.texture_cache.remove(&old_key) {
            self.texture_cache
                .insert(texture_key(new_title, category), texture);
        }
    }

    pub fn delete_image(&mut self, category: &str, title: &str) {
        delete_image_file(category, title, &self.image_directory);
        self.texture_cache.remove(&texture_key(title, category));
    }

    pub fn replace_for_category_switch(
        &mut self,
        from_category: &str,
        old_title: &str,
        to_category: &str,
        new_title: &str,
        ctx: &egui::Context,
    ) {
        self.delete_image(from_category, old_title);
        let _ = self.get_entry_texture(new_title, to_category, ctx);
    }
}

fn texture_key(entry: &str, category: &str) -> String {
    format!("{entry} {category}")
}

fn clean_title(title: &str) -> String {
    let mut title = title.to_string();
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title.trim().to_string()
}

fn clean_category(category: &str) -> String {
    category.trim().trim_end_matches(':').trim().to_string()
}

fn safe_file_component(value: &str) -> String {
    let mut safe: String = value
        .chars()
        .map(|ch| {
            if ch == '/' || ch == '\\' || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect();

    safe = safe.trim().to_string();
    if safe.is_empty() {
        "untitled".to_string()
    } else {
        safe
    }
}

fn image_file_name(category: &str, title: &str) -> String {
    let category = safe_file_component(&clean_category(category));
    let title = safe_file_component(&clean_title(title));
    format!("{title} {category}.png")
}

fn image_path(image_directory: &Path, category: &str, title: &str) -> PathBuf {
    image_directory.join(image_file_name(category, title))
}

fn legacy_image_path(image_directory: &Path, category: &str, title: &str) -> PathBuf {
    let mut title = title.to_string();
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    let title = title.trim();

    let mut category = category.to_string();
    category.pop();

    image_directory.join(format!("{title} {}.png", category.trim()))
}

fn image_path_candidates(image_directory: &Path, category: &str, title: &str) -> Vec<PathBuf> {
    let primary = image_path(image_directory, category, title);
    let legacy = legacy_image_path(image_directory, category, title);
    if primary == legacy {
        vec![primary]
    } else {
        vec![primary, legacy]
    }
}

fn get_image(
    category: &str,
    title: &str,
    image_directory: &Path,
    force_refresh: bool,
) -> Result<ColorImage, ImageFetchError> {
    let full_path = image_path(image_directory, category, title);

    if !force_refresh {
        for candidate in image_path_candidates(image_directory, category, title) {
            if let Ok(image) = image::open(&candidate) {
                let img_bytes = if image.width() != IMAGE_WIDTH || image.height() != IMAGE_HEIGHT {
                    let resized_image = image.resize_exact(
                        IMAGE_WIDTH,
                        IMAGE_HEIGHT,
                        image::imageops::FilterType::CatmullRom,
                    );
                    resized_image.save(&full_path)?;
                    resized_image.to_rgba8().to_vec()
                } else {
                    if candidate != full_path {
                        fs::copy(&candidate, &full_path)?;
                    }
                    image.to_rgba8().to_vec()
                };
                return Ok(ColorImage::from_rgba_unmultiplied(
                    [IMAGE_WIDTH as usize, IMAGE_HEIGHT as usize],
                    &img_bytes,
                ));
            }
        }
    }

    let category = clean_category(category);
    let title = clean_title(title);
    let image = image_search::search(&format!("{title} {category}"), IMAGE_WIDTH, IMAGE_HEIGHT)?;
    image.save(&full_path)?;
    Ok(ColorImage::from_rgba_unmultiplied(
        [IMAGE_WIDTH as usize, IMAGE_HEIGHT as usize],
        &image.to_rgba8(),
    ))
}

fn delete_image_file(category: &str, title: &str, image_directory: &Path) {
    for path in image_path_candidates(image_directory, category, title) {
        fs::remove_file(path).ok();
    }
}

fn rename_image_file(
    category: &str,
    old_title: &str,
    new_title: &str,
    image_directory: &Path,
) -> io::Result<()> {
    let new_path = image_path(image_directory, category, new_title);
    let Some(old_path) = image_path_candidates(image_directory, category, old_title)
        .into_iter()
        .find(|path| path.exists())
    else {
        return Err(io::Error::from(io::ErrorKind::NotFound));
    };

    if old_path == new_path {
        return Ok(());
    }

    fs::rename(old_path, new_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs};

    #[test]
    fn image_file_name_trims_category_without_chopping_last_character() {
        assert_eq!(image_file_name("Movies:", "Alien"), "Alien Movies.png");
        assert_eq!(image_file_name("Movies", "Alien"), "Alien Movies.png");
        assert_eq!(
            image_file_name("Sci/Fi:", "Alien/Predator"),
            "Alien_Predator Sci_Fi.png"
        );
    }

    #[test]
    fn rename_image_file_handles_sanitized_paths_and_missing_files() {
        let root = env::temp_dir().join(format!(
            "media-rating-image-store-test-{}",
            std::process::id()
        ));
        let image_directory = root.join("images");
        fs::create_dir_all(&image_directory).unwrap();

        let old_path = image_path(&image_directory, "Movies:", "Old/Name");
        fs::write(&old_path, b"fake image bytes").unwrap();

        rename_image_file("Movies:", "Old/Name", "New/Name", &image_directory).unwrap();

        assert!(!old_path.exists());
        assert!(image_path(&image_directory, "Movies:", "New/Name").exists());
        assert_eq!(
            rename_image_file("Movies:", "Missing", "Other", &image_directory)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );

        fs::remove_dir_all(root).ok();
    }
}
