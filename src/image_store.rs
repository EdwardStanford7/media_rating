use eframe::egui;
use egui::ColorImage;
use std::{collections::HashMap, fmt::Display, fs, path::Path};

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

pub struct ImageStore {
    directory: String,
    texture_cache: HashMap<String, egui::TextureHandle>,
}

impl ImageStore {
    pub fn new(directory: String) -> Self {
        Self {
            directory,
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

        if let Ok(image) = get_image(category, entry, &self.directory, false) {
            texture = ctx.load_texture(key.clone(), image, egui::TextureOptions::LINEAR);
        }

        self.texture_cache.insert(key, texture.clone());
        texture
    }

    pub fn refresh_entry_texture(&mut self, entry: &str, category: &str, ctx: &egui::Context) {
        match get_image(category, entry, &self.directory, true) {
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
        rename_image_file(category, old_title, new_title, &self.directory);

        let old_key = texture_key(old_title, category);
        if let Some(texture) = self.texture_cache.remove(&old_key) {
            self.texture_cache
                .insert(texture_key(new_title, category), texture);
        }
    }

    pub fn delete_image(&mut self, category: &str, title: &str) {
        delete_image_file(category, title, &self.directory);
        self.texture_cache.remove(&texture_key(title, category));
    }
}

fn texture_key(entry: &str, category: &str) -> String {
    format!("{entry} {category}")
}

fn clean_image_parts(category: &str, title: &str) -> (String, String) {
    let mut title = title.to_string();
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    let title = title.trim().to_string();

    let mut category = category.to_string();
    category.pop();

    (category, title)
}

fn image_path(file_directory: &str, category: &str, title: &str) -> String {
    let (category, title) = clean_image_parts(category, title);
    format!("{file_directory}images/{title} {category}.png")
}

fn get_image(
    category: &str,
    title: &str,
    file_directory: &str,
    force_refresh: bool,
) -> Result<ColorImage, ImageFetchError> {
    let binding = image_path(file_directory, category, title);
    let full_path = Path::new(&binding);

    if !force_refresh {
        if let Ok(image) = image::open(full_path) {
            let img_bytes = if image.width() != IMAGE_WIDTH || image.height() != IMAGE_HEIGHT {
                let resized_image = image.resize_exact(
                    IMAGE_WIDTH,
                    IMAGE_HEIGHT,
                    image::imageops::FilterType::CatmullRom,
                );
                resized_image.save(full_path)?;
                resized_image.to_rgba8().to_vec()
            } else {
                image.to_rgba8().to_vec()
            };
            return Ok(ColorImage::from_rgba_unmultiplied(
                [IMAGE_WIDTH as usize, IMAGE_HEIGHT as usize],
                &img_bytes,
            ));
        }
    }

    let (category, title) = clean_image_parts(category, title);
    let image = image_search::search(&format!("{title} {category}"), IMAGE_WIDTH, IMAGE_HEIGHT)?;
    image.save(full_path)?;
    Ok(ColorImage::from_rgba_unmultiplied(
        [IMAGE_WIDTH as usize, IMAGE_HEIGHT as usize],
        &image.to_rgba8(),
    ))
}

fn delete_image_file(category: &str, title: &str, file_directory: &str) {
    let binding = image_path(file_directory, category, title);
    let full_path = Path::new(&binding);
    fs::remove_file(full_path).ok();
}

fn rename_image_file(category: &str, old_title: &str, new_title: &str, file_directory: &str) {
    let old_path = image_path(file_directory, category, old_title);
    let new_path = image_path(file_directory, category, new_title);

    match fs::rename(Path::new(&old_path), Path::new(&new_path)) {
        Ok(_) => {}
        Err(e) => eprintln!("Error renaming image: {e}"),
    }
}
