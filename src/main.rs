use eframe::egui;
use egui::{FontId, Image, ImageButton};
use native_dialog::FileDialog;
use std::{path::Path, process::exit};
mod model;
use model::{Entry, Model};
use std::fs;

struct MyApp {
    model: Model,
    directory: String,
    ranking_category: Option<String>,
    new_entry_category: Option<String>,
    text_entry_box: String,
    matches_left: usize,
    waiting_for_match: bool,
}

impl Default for MyApp {
    fn default() -> Self {
        // Get what xlsx file to read from the user.
        let mut model = Model::new();
        let xlsx_path = FileDialog::new()
            .add_filter("Excel file", &["xlsx"])
            .show_open_single_file()
            .ok()
            .flatten()
            .map(|path| path.to_string_lossy().to_string());

        let file_path;
        let directory;
        if let Some(ref path) = xlsx_path {
            file_path = Path::new(path);
            directory = file_path.parent().unwrap().to_str().unwrap().to_string() + "/";

            // Create a directory to store all the images in.
            let binding = directory.clone() + "images";
            let image_directory = Path::new(&binding);
            if !image_directory.exists() {
                match fs::create_dir(image_directory) {
                    Ok(_result) => {}
                    Err(e) => {
                        eprintln!("Could not create image directory: {}", e);
                        exit(1)
                    }
                }
            }

            // Open the xlsx file and create the model.
            if !model.open_spreadsheet(
                directory.clone(),
                file_path.file_name().unwrap().to_str().unwrap().to_string(),
            ) {
                exit(1);
            }
        } else {
            exit(1);
        }

        // Return new app state struct.
        Self {
            model,
            directory,
            ranking_category: None,
            new_entry_category: None,
            text_entry_box: String::new(),
            matches_left: 0,
            waiting_for_match: false,
        }
    }
}

impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Menu bar.
        egui::TopBottomPanel::top("Menu").show(ctx, |ui| {
            // Menu is horizontal at top of app.
            ui.horizontal(|ui| {
                // App name and save button.
                ui.vertical(|ui| {
                    ui.heading("Media Rating App");

                    if ui.button("Save").clicked() {
                        self.model.save_to_spreadsheet();
                        self.model.save_to_spreadsheet();
                    }
                });

                // Should app display menu items or not (if ranking is happening).
                if self.matches_left == 0 {
                    self.model.reset_new_entry();
                    self.model.reset_current_match();

                    // Rerank category dropdown.
                    ui.vertical(|ui| {
                        ui.label("Rerank a category:");
                        egui::ComboBox::from_label("Select a category to rerank")
                            .selected_text(
                                self.ranking_category
                                    .clone()
                                    .unwrap_or_else(|| "Choose...".to_string()),
                            )
                            .show_ui(ui, |ui| {
                                for category in self.model.get_categories() {
                                    ui.selectable_value(
                                        &mut self.ranking_category,
                                        Some(category.clone()),
                                        category,
                                    );
                                }
                            });
                        // Rerank category button.
                        if ui.button("Rerank").clicked() {
                            if let Some(ref category) = self.ranking_category {
                                let num_entries = self.model.get_num_entries(category);
                                self.model.reset_category_rankings(category);

                                self.matches_left =
                                    2 * num_entries * f64::log2(num_entries as f64) as usize;
                                // self.ranking_new_entry = false;
                                self.model.reset_new_entry();
                                self.waiting_for_match = true;
                            }
                        }
                    });

                    // Add new entry dropdown
                    ui.vertical(|ui| {
                        ui.label("Add a new entry to a category:");
                        egui::ComboBox::from_label("Select a category to add an entry to")
                            .selected_text(
                                self.new_entry_category
                                    .clone()
                                    .unwrap_or_else(|| "Choose...".to_string()),
                            )
                            .show_ui(ui, |ui| {
                                for category in self.model.get_categories() {
                                    ui.selectable_value(
                                        &mut self.new_entry_category,
                                        Some(category.clone()),
                                        category,
                                    );
                                }
                            });
                        // Add new entry button
                        if let Some(ref _category) = self.new_entry_category {
                            ui.text_edit_singleline(&mut self.text_entry_box);

                            if ui.button("Add Entry").clicked() {
                                let new_entry = Entry {
                                    title: self.text_entry_box.clone(),
                                    rating: 700.0,
                                    icon: model::get_icon(
                                        _category.to_string(),
                                        self.text_entry_box.clone(),
                                        self.directory.clone(),
                                    ),
                                };

                                self.model
                                    .add_entry(new_entry, self.new_entry_category.clone().unwrap());
                                self.matches_left = 15;
                                self.waiting_for_match = true;
                            }
                        }
                    });
                }
            });
        });

        // Does model need to send a new matchup.
        if self.waiting_for_match {
            let category = if self.model.ranking_new_entry() {
                self.new_entry_category.as_ref()
            } else {
                self.ranking_category.as_ref()
            };

            if let Some(category) = category {
                self.model.set_current_match(category);
                self.matches_left -= 1;
                self.waiting_for_match = false;
            }
        }

        // Current match display.
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.horizontal(|ui| {
                if let Some((entry1, entry2)) = self.model.get_current_match() {
                    // Images for the two entries.
                    let texture1 = ctx.load_texture(
                        entry1.title.clone(),
                        entry1.icon.clone(),
                        egui::TextureOptions::LINEAR,
                    );
                    let texture2 = ctx.load_texture(
                        entry2.title.clone(),
                        entry2.icon.clone(),
                        egui::TextureOptions::LINEAR,
                    );

                    // Entry 1.
                    ui.vertical(|ui| {
                        let image1 = Image::new(&texture1);
                        let width1: f32 = image1.size().unwrap().x;

                        if ui.add(ImageButton::new(image1)).clicked() {
                            self.model.calculate_current_match(1);
                            self.waiting_for_match = true;
                        }

                        // Set the maximum width for the label to enable wrapping
                        ui.allocate_ui_with_layout(
                            egui::vec2(width1, 0.0),
                            egui::Layout::top_down(egui::Align::LEFT),
                            |ui| {
                                ui.label(
                                    egui::RichText::new(entry1.title.clone())
                                        .font(FontId::proportional(25.0)),
                                );
                            },
                        );
                    });

                    // Entry 2.
                    ui.vertical(|ui| {
                        let image2 = Image::new(&texture2);
                        let width2: f32 = image2.size().unwrap().x;

                        if ui.add(ImageButton::new(image2)).clicked() {
                            self.model.calculate_current_match(2);
                            self.waiting_for_match = true;
                        }

                        // Set the maximum width for the label to enable wrapping
                        ui.allocate_ui_with_layout(
                            egui::vec2(width2, 0.0),
                            egui::Layout::top_down(egui::Align::LEFT),
                            |ui| {
                                ui.label(
                                    egui::RichText::new(entry2.title.clone())
                                        .font(FontId::proportional(25.0)),
                                );
                            },
                        );
                    });
                }
            });
        });
    }
}

fn main() {
    let options = eframe::NativeOptions::default();
    let _ = eframe::run_native(
        "Media Rating",
        options,
        Box::new(|_cc| Ok(Box::new(MyApp::default()))),
    );
}
