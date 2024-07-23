use eframe::egui;
use egui::{Image, ImageButton};
use native_dialog::FileDialog;
use std::process::exit;
mod model;
use model::{Entry, Model};

struct MyApp {
    model: Model,
    ranking_category: Option<String>,
    new_entry_category: Option<String>,
    text_entry_box: String,
    ranking_new_entry: bool,
    matches_left: usize,
    waiting_for_match: bool,
}

impl Default for MyApp {
    fn default() -> Self {
        let mut model = Model::new();
        let xlsx_path = FileDialog::new()
            .add_filter("Excel file", &["xlsx"])
            .show_open_single_file()
            .ok()
            .flatten()
            .map(|path| path.to_string_lossy().to_string());

        if let Some(ref path) = xlsx_path {
            if !model.open_spreadsheet(path) {
                exit(1);
            }
        } else {
            exit(1);
        }

        Self {
            model,
            ranking_category: None,
            new_entry_category: None,
            text_entry_box: String::new(),
            ranking_new_entry: false,
            matches_left: 0,
            waiting_for_match: false,
        }
    }
}

impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::TopBottomPanel::top("Menu").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.heading("Media Rating App");

                    if ui.button("Save").clicked() {
                        self.model.save_to_spreadsheet();
                        self.model.save_to_spreadsheet();
                    }
                });

                if self.matches_left == 0 {
                    self.ranking_new_entry = false;
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
                                let num_entries = self.model.get_num_entries(category.to_string());
                                self.model.reset_category_rankings(category.to_string());

                                self.matches_left =
                                    2 * num_entries * f64::log2(num_entries as f64) as usize;
                                self.ranking_new_entry = false;
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
                                    rating: 400.0,
                                    icon: model::get_icon(
                                        _category.to_string(),
                                        self.text_entry_box.clone(),
                                    ),
                                };

                                self.model
                                    .add_entry(new_entry, self.new_entry_category.clone().unwrap());

                                println!("Here");

                                self.matches_left = 15; // However many are needed to get an accurate rating for a new entry.
                                self.ranking_new_entry = true;
                                self.waiting_for_match = true;
                            }
                        }
                    });
                }
            });
        });

        if self.waiting_for_match {
            let category = if self.ranking_new_entry {
                self.new_entry_category.as_ref()
            } else {
                self.ranking_category.as_ref()
            };

            if let Some(category) = category {
                // if let Some(model) = Arc::get_mut(&mut self.model) {
                self.model
                    .set_current_match(category.to_string(), self.ranking_new_entry);
                self.matches_left -= 1;
                self.waiting_for_match = false;
                // }
            }
        }

        // Current match display.
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.horizontal(|ui| {
                if let Some((entry1, entry2)) = self.model.get_current_match() {
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

                    ui.vertical(|ui| {
                        let image1 = Image::new(&texture1);
                        if ui.add(ImageButton::new(image1)).clicked() {
                            self.model.calculate_current_match(1);
                            self.waiting_for_match = true;
                        }
                        ui.label(entry1.title.clone());
                    });
                    ui.vertical(|ui| {
                        let image2 = Image::new(&texture2);
                        if ui.add(ImageButton::new(image2)).clicked() {
                            self.model.calculate_current_match(2);
                            self.waiting_for_match = true;
                        }
                        ui.label(entry2.title.clone());
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
