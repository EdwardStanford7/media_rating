use eframe::egui;
use native_dialog::FileDialog;
use std::{
    sync::mpsc::{self, Receiver},
    thread,
};

use crate::{
    app::{AppAction, ImagePickPurpose},
    image_search,
    image_store::{dynamic_image_to_color_image, ENTRY_IMAGE_HEIGHT, ENTRY_IMAGE_WIDTH},
    popup::{Popup, PopupResponse},
};

const SEARCH_RESULT_COUNT: usize = 18;

enum SearchState {
    Idle,
    Loading {
        query: String,
        receiver: Receiver<Result<Vec<image::DynamicImage>, String>>,
    },
    Loaded {
        query: String,
        images: Vec<image::DynamicImage>,
        textures: Vec<egui::TextureHandle>,
    },
    Failed {
        query: String,
        message: String,
    },
}

pub struct ImagePickerPopup {
    category: String,
    entry: String,
    query: String,
    purpose: ImagePickPurpose,
    search_state: SearchState,
}

impl ImagePickerPopup {
    pub fn new(category: String, entry: String, purpose: ImagePickPurpose) -> Self {
        let query = default_query(&entry, &category);
        Self {
            category,
            entry,
            query,
            purpose,
            search_state: SearchState::Idle,
        }
    }

    fn ensure_search_started(&mut self, ctx: &egui::Context) {
        if matches!(self.search_state, SearchState::Idle) {
            self.start_search(ctx);
        }
    }

    fn start_search(&mut self, ctx: &egui::Context) {
        let query = self.query.trim().to_string();
        if query.is_empty() {
            self.search_state = SearchState::Failed {
                query,
                message: "Search query cannot be empty.".to_string(),
            };
            return;
        }

        let (sender, receiver) = mpsc::channel();
        let repaint_ctx = ctx.clone();
        let search_query = query.clone();
        thread::spawn(move || {
            let result = image_search::search_many(
                &search_query,
                ENTRY_IMAGE_WIDTH,
                ENTRY_IMAGE_HEIGHT,
                SEARCH_RESULT_COUNT,
            )
            .map_err(|e| e.to_string());
            let _ = sender.send(result);
            repaint_ctx.request_repaint();
        });

        self.search_state = SearchState::Loading { query, receiver };
    }

    fn poll_search(&mut self, ctx: &egui::Context) {
        let result = match &self.search_state {
            SearchState::Loading { receiver, .. } => receiver.try_recv().ok(),
            _ => None,
        };

        let Some(result) = result else {
            return;
        };

        match result {
            Ok(images) if images.is_empty() => {
                let query = self.active_query();
                self.search_state = SearchState::Failed {
                    query,
                    message: "No usable images found.".to_string(),
                };
            }
            Ok(images) => {
                let query = self.active_query();
                let textures = images
                    .iter()
                    .enumerate()
                    .map(|(index, image)| {
                        ctx.load_texture(
                            format!("image-picker-{query}-{index}"),
                            dynamic_image_to_color_image(image),
                            egui::TextureOptions::LINEAR,
                        )
                    })
                    .collect();

                self.search_state = SearchState::Loaded {
                    query,
                    images,
                    textures,
                };
            }
            Err(message) => {
                let query = self.active_query();
                self.search_state = SearchState::Failed { query, message };
            }
        }
    }

    fn active_query(&self) -> String {
        match &self.search_state {
            SearchState::Loading { query, .. }
            | SearchState::Loaded { query, .. }
            | SearchState::Failed { query, .. } => query.clone(),
            SearchState::Idle => self.query.clone(),
        }
    }

    fn pick_local_file(&mut self) -> PopupResponse {
        let Some(path) = FileDialog::new()
            .add_filter("Image", &["png", "jpg", "jpeg", "webp", "bmp", "gif"])
            .show_open_single_file()
            .ok()
            .flatten()
        else {
            return PopupResponse::KeepOpen;
        };

        match image::open(path) {
            Ok(image) => self.select_image(image),
            Err(e) => {
                self.search_state = SearchState::Failed {
                    query: self.active_query(),
                    message: format!("Could not open local image: {e}"),
                };
                PopupResponse::KeepOpen
            }
        }
    }

    fn select_image(&self, image: image::DynamicImage) -> PopupResponse {
        PopupResponse::Action(AppAction::SetEntryImage {
            category: self.category.clone(),
            entry: self.entry.clone(),
            image,
            purpose: self.purpose.clone(),
        })
    }
}

impl Popup for ImagePickerPopup {
    fn title(&self) -> &str {
        "Choose Image"
    }

    fn show_body(&mut self, ui: &mut egui::Ui) -> PopupResponse {
        self.ensure_search_started(ui.ctx());
        self.poll_search(ui.ctx());

        let mut response = PopupResponse::KeepOpen;

        ui.label(format!("{} - {}", self.entry, self.category));

        ui.horizontal(|ui| {
            let query_response =
                ui.add_sized([360.0, 24.0], egui::TextEdit::singleline(&mut self.query));
            let search_clicked = ui.button("Search").clicked();
            let enter_pressed = query_response.lost_focus()
                && ui.input(|input| input.key_pressed(egui::Key::Enter));

            if search_clicked || enter_pressed {
                self.start_search(ui.ctx());
            }

            if ui.button("Default").clicked() {
                self.query = default_query(&self.entry, &self.category);
                self.start_search(ui.ctx());
            }

            if ui.button("Local File").clicked() {
                response = self.pick_local_file();
            }
        });

        ui.add_space(8.0);

        match &self.search_state {
            SearchState::Idle => {}
            SearchState::Loading { query, .. } => {
                ui.label(format!("Searching for \"{query}\"..."));
                ui.spinner();
            }
            SearchState::Failed { message, .. } => {
                ui.label(message);
            }
            SearchState::Loaded {
                images, textures, ..
            } => {
                egui::Grid::new("image-picker-results")
                    .num_columns(4)
                    .spacing([8.0, 8.0])
                    .show(ui, |ui| {
                        for (index, texture) in textures.iter().enumerate() {
                            let image = egui::Image::new(texture)
                                .fit_to_exact_size(egui::vec2(114.0, 142.0));
                            if ui.add(egui::ImageButton::new(image)).clicked() {
                                response = self.select_image(images[index].clone());
                            }

                            if (index + 1) % 4 == 0 {
                                ui.end_row();
                            }
                        }
                    });
            }
        }

        ui.add_space(8.0);
        if ui.button("Cancel").clicked() {
            response = PopupResponse::Close;
        }

        response
    }
}

fn default_query(entry: &str, category: &str) -> String {
    let category = category.trim().trim_end_matches(':').trim();
    format!("{entry} ({category})")
}
