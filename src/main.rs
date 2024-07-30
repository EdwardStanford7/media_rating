use eframe::egui;
use egui::{CentralPanel, FontId, Image, ImageButton, ScrollArea, TopBottomPanel};
use native_dialog::FileDialog;
use std::{path::Path, process::exit};
mod model;
use model::{delete_image, get_image, Entry, Model};
use std::fs;

struct MyApp {
    // State of the rankings.
    model: Model,

    // What file directory are the spreadsheet and images stored in.
    directory: String,

    // What category is currently selected in the rank a category dropdown.
    ranking_category: Option<String>,

    // What was the previous category selected. Used for checking when the category changes.
    previous_ranking_category: Option<String>,

    // What is the current contents of the new entry text box.
    text_entry_box: String,

    // What entry is currently selected in the homepage rankings display.
    selected_entry: Option<usize>,

    // Current contents of the new name text entry box.
    new_name_box: String,

    // What element is in focus in the leaderboard scroll.
    focus_index: Option<usize>,

    // put this in an enum maybe. What mode the app is in, is it category ranking, free ranking, or homepage if both false.
    ranking: bool,
    free_rank: bool,

    // Used for while ranking to tell the model to get a new match.
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
            previous_ranking_category: None,
            text_entry_box: String::new(),
            selected_entry: None,
            new_name_box: String::new(),
            focus_index: None,
            ranking: false,
            free_rank: false,
            waiting_for_match: false,
        }
    }
}

impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Menu bar.
        TopBottomPanel::top("Menu").show(ctx, |ui| {
            // Menu is horizontal at top of app.
            ui.horizontal(|ui| {
                // App name, save, menu buttons.
                ui.vertical(|ui| {
                    ui.heading("Media Rating App");
                    ui.horizontal(|ui| {
                        if ui.button("Save").clicked() {
                            self.model.save_to_spreadsheet();
                        }
                        // Only display back to menu button if ranking is happening.
                        if self.ranking {
                            if ui.button("Menu").clicked() {
                                self.ranking = false;
                                self.free_rank = false;
                                self.model.clear_current_match();
                                self.model.clear_new_entry();
                                self.model.save_to_spreadsheet();
                            }
                        } else if ui.button("Free Rank").clicked() {
                            {
                                self.ranking = true;
                                self.free_rank = true;
                                self.waiting_for_match = true;
                            }
                        }
                    });
                });

                // Should app display menu items or not (if ranking is happening).
                if !self.ranking {
                    ui.add_space(10.0);

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

                        // Check if category has changed.
                        if self.ranking_category != self.previous_ranking_category {
                            self.selected_entry = None;
                            // Update the previous ranking category
                            self.previous_ranking_category
                                .clone_from(&self.ranking_category);
                        }

                        // Rerank category button.
                        if ui.button("Rank").clicked() && self.ranking_category.is_some() {
                            self.ranking = true;
                            self.waiting_for_match = true;
                        }
                    });

                    ui.add_space(10.0);

                    // Add new entry dropdown
                    ui.vertical(|ui| {
                        ui.label("Add a new entry to this category:");

                        // Add new entry button
                        if let Some(ref category) = self.ranking_category {
                            ui.text_edit_singleline(&mut self.text_entry_box);

                            if ui.button("Add Entry").clicked() && !self.text_entry_box.is_empty() {
                                let new_entry = Entry {
                                    title: self.text_entry_box.clone(),
                                    rating: 500.0,
                                    image: model::get_image(
                                        category.to_string(),
                                        self.text_entry_box.clone(),
                                        self.directory.clone(),
                                    ),
                                };
                                self.selected_entry =
                                    Some(self.model.add_entry(
                                        new_entry,
                                        self.ranking_category.clone().unwrap(),
                                    ));
                                self.focus_index = self.selected_entry;
                                self.text_entry_box.clear();
                            }
                        }
                    });
                }
            });
        });

        // Does model need to choose a new match.
        if self.ranking && self.waiting_for_match {
            let category = if self.free_rank {
                self.model.get_rand_category()
            } else {
                self.ranking_category.as_ref().unwrap().to_owned()
            };

            self.model.set_current_match(&category);
            self.waiting_for_match = false;
        }

        // Central panel.
        CentralPanel::default().show(ctx, |ui| {
            // If app is in ranking mode, display the current match.
            if self.ranking || self.free_rank {
                ui.horizontal(|ui| {
                    if let Some((entry1, entry2)) = self.model.get_current_match() {
                        // Images for the two entries.
                        let texture1 = ctx.load_texture(
                            entry1.title.clone(),
                            entry1.image.clone(),
                            egui::TextureOptions::LINEAR,
                        );
                        let texture2 = ctx.load_texture(
                            entry2.title.clone(),
                            entry2.image.clone(),
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
                                        egui::RichText::new(format!(
                                            "{} ({})",
                                            entry1.title, entry1.rating
                                        ))
                                        .font(FontId::proportional(23.0)),
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
                                        egui::RichText::new(format!(
                                            "{} ({})",
                                            entry2.title, entry2.rating
                                        ))
                                        .font(FontId::proportional(23.0)),
                                    );
                                },
                            );
                        });
                    }
                });
            }
            // If app is in home menu, display a list of all entries in the selected category.
            else if let Some(category) = &self.ranking_category {
                ui.columns(2, |columns| {
                    // Category list.
                    columns[0].set_width(370.0);
                    columns[0].vertical(|ui| {
                        ui.with_layout(egui::Layout::top_down_justified(egui::Align::LEFT), |ui| {
                            ScrollArea::vertical().show(ui, |ui| {
                                for (index, entry) in
                                    self.model.get_category_entries(category).iter().enumerate()
                                {
                                    // Display the entry as a clickable label.
                                    let label = ui.selectable_label(
                                        false,
                                        format!("{:04}\t\t{}", entry.rating, entry.title),
                                    );

                                    // Check if scroll area is focused on something.
                                    if Some(index) == self.focus_index {
                                        let rect = label.rect;
                                        ui.scroll_to_rect(rect, Some(egui::Align::Center));
                                        self.focus_index = None; // Reset focus after scrolling
                                    }

                                    // Check if the entry was clicked.
                                    if label.clicked() {
                                        self.selected_entry = Some(index);
                                        self.new_name_box.clear();
                                    }
                                }
                            });
                        });
                    });

                    columns[1].vertical(|ui| {
                        // Image of currently selected entry.
                        if let Some(entry_index) = &self.selected_entry {
                            // let mut getting_new_image = false;
                            let mut ranking_entry = false;
                            let mut delete_entry = false;

                            let entry = self.model.get_entry(category, *entry_index);
                            let texture = ctx.load_texture(
                                entry.title.clone(),
                                entry.image.clone(),
                                egui::TextureOptions::LINEAR,
                            );
                            ui.image(&texture);

                            ui.horizontal(|ui| {
                                if ui.button("Update Name").clicked() {
                                    entry.title.clone_from(&self.new_name_box);
                                    self.new_name_box.clear();
                                }

                                if ui.button("Get New Icon").clicked() {
                                    // getting_new_image = true;
                                    delete_image(
                                        category.to_string(),
                                        entry.title.clone(),
                                        self.directory.clone(),
                                    );
                                    entry.image = get_image(
                                        category.to_string(),
                                        entry.title.clone(),
                                        self.directory.clone(),
                                    );
                                }

                                if ui.button("Rank This Entry").clicked() {
                                    ranking_entry = true;
                                }

                                if (ui.button("Delete Entry")).clicked() {
                                    delete_entry = true;
                                }
                            });

                            // Sometimes I hate the borrow checker.
                            // if getting_new_image {
                            //     delete_image(
                            //         category.to_string(),
                            //         entry.title.clone(),
                            //         self.directory.clone(),
                            //     );
                            //     entry.image = get_image(
                            //         category.to_string(),
                            //         entry.title.clone(),
                            //         self.directory.clone(),
                            //     );
                            // }
                            if ranking_entry {
                                self.model.set_ranking_entry(*entry_index);
                                self.ranking = true;
                                self.waiting_for_match = true;
                            }
                            if delete_entry {
                                self.model.delete_entry(category, *entry_index);
                                self.selected_entry = None;
                            }

                            ui.text_edit_singleline(&mut self.new_name_box);
                        }
                    });
                });
            }
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
