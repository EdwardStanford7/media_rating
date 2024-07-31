use eframe::egui;
use egui::{
    pos2, vec2, Align, CentralPanel, FontId, Id, Image, ImageButton, Rect, ScrollArea,
    TopBottomPanel,
};
use native_dialog::FileDialog;
use rust_xlsxwriter::Workbook;
use std::{path::Path, process::exit};
mod model;
use model::{delete_image, get_image, Entry, Model};
use std::fs;

struct MyApp {
    // State of the rankings.
    model: Model,

    // Is the model initialized. App starts with model uninitialized.
    model_initialized: bool,

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

    // What mode the app is in, is it category ranking, free ranking, or leaderboard menu if both false.
    ranking: bool,
    free_rank: bool,

    // Used for while ranking to tell the model to get a new match.
    waiting_for_match: bool,

    // Warning to the user when they try to delete a category.
    show_delete_warning: bool,

    // What category is the user trying to delete.
    deleting_category: String,
}

impl Default for MyApp {
    fn default() -> Self {
        // Return new app state struct.
        Self {
            model: Model::new(),
            model_initialized: false,
            directory: String::new(),
            ranking_category: None,
            previous_ranking_category: None,
            text_entry_box: String::new(),
            selected_entry: None,
            new_name_box: String::new(),
            focus_index: None,
            ranking: false,
            free_rank: false,
            waiting_for_match: false,
            show_delete_warning: false,
            deleting_category: String::new(),
        }
    }
}

impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Home menu on startup.
        if !self.model_initialized {
            // Display home menu.
            CentralPanel::default().show(ctx, |ui| {
                // Center the buttons in the middle of the window.
                ui.vertical_centered(|ui| {
                    ui.add_space(200.0);

                    let mut xlsx_path = None;

                    // Create a new model from scratch.
                    if ui.button("Create New Spreadsheet").clicked() {
                        xlsx_path = FileDialog::new()
                            .add_filter("Excel file", &["xlsx"])
                            .set_filename("Media Ratings.xlsx") // Optional: Suggests a default file name
                            .show_save_single_file()
                            .ok()
                            .flatten()
                            .map(|path| path.to_string_lossy().to_string());

                        // Create empty spreadsheet.
                        let mut workbook = Workbook::new();

                        match workbook.save(Path::new(&xlsx_path.clone().unwrap())) {
                            Ok(_result) => {}
                            Err(e) => {
                                eprintln!("Could not create new spreadsheet: {}", e);
                                exit(1)
                            }
                        }
                    }

                    ui.add_space(50.0);

                    // Load a model from an existing spreadsheet.
                    if ui.button("Open Spreadsheet").clicked() {
                        // Get what xlsx file to read from the user.
                        xlsx_path = FileDialog::new()
                            .add_filter("Excel file", &["xlsx"])
                            .show_open_single_file()
                            .ok()
                            .flatten()
                            .map(|path| path.to_string_lossy().to_string());
                    }

                    if xlsx_path.is_some() {
                        let file_path;
                        if let Some(ref path) = xlsx_path {
                            file_path = Path::new(path);
                            self.directory =
                                file_path.parent().unwrap().to_str().unwrap().to_string() + "/";

                            // Create a directory to store all the images in.
                            let binding = self.directory.clone() + "images";
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

                            // Open the xlsx file and initialize the model.
                            if self.model.open_spreadsheet(
                                self.directory.clone(),
                                file_path.file_name().unwrap().to_str().unwrap().to_string(),
                            ) {
                                self.model_initialized = true;
                            }
                        }
                    }
                });
            });

            return;
        }

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
                        } else if ui.button("Rank All Categories").clicked()
                            && !self.model.get_categories().is_empty()
                        {
                            // Only allow ranking if there are actually entries to rank.
                            if self
                                .model
                                .get_categories()
                                .iter()
                                .all(|category| self.model.get_num_entries(category) >= 2)
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

                    // Select category dropdown.
                    ui.vertical(|ui| {
                        ui.label("Select a category:");
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
                        ui.horizontal(|ui| {
                            if ui.button("Rank Selected Cateogory").clicked()
                                && self.ranking_category.is_some()
                                && self
                                    .model
                                    .get_num_entries(&(self.ranking_category.clone().unwrap()))
                                    >= 2
                            {
                                self.ranking = true;
                                self.waiting_for_match = true;
                            }

                            if ui.button("Delete Category").clicked()
                                && self.ranking_category.is_some()
                            {
                                self.deleting_category = self.ranking_category.clone().unwrap();
                                self.show_delete_warning = true;
                            }
                        });
                    });

                    ui.add_space(10.0);

                    // Add entries or categories.
                    ui.vertical(|ui| {
                        ui.text_edit_singleline(&mut self.text_entry_box);

                        ui.horizontal(|ui| {
                            // Add new entry button
                            if ui.button("Add Entry To Current Category").clicked()
                                && self.ranking_category.is_some()
                                && !self.text_entry_box.is_empty()
                            {
                                let new_entry = Entry {
                                    title: self.text_entry_box.clone(),
                                    rating: 500.0,
                                    image: model::get_image(
                                        self.ranking_category.clone().unwrap().to_string(),
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

                            // Create new category button.
                            if ui.button("Create New Category").clicked()
                                && !self.text_entry_box.is_empty()
                            {
                                self.model.create_category(self.text_entry_box.to_string());
                                self.text_entry_box.clear();
                            }
                        });
                    });
                }
            });
        });

        if self.show_delete_warning {
            // Create a dimming overlay that blocks interactions
            egui::Area::new(Id::new("Blocking Overlay"))
                .anchor(egui::Align2::LEFT_TOP, egui::Vec2::ZERO)
                .fixed_pos(egui::pos2(0.0, 0.0))
                .order(egui::Order::Background)
                .show(ctx, |ui| {
                    // Fill the entire screen
                    let screen_rect = ctx.screen_rect();
                    ui.painter()
                        .rect_filled(screen_rect, 0.0, egui::Color32::from_black_alpha(75));

                    // Block interactions by creating a full-screen interactive element
                    ui.allocate_rect(screen_rect, egui::Sense::click());
                });

            // Show the warning popup in a separate Area
            egui::Area::new(Id::new("Warning Popup"))
                .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
                .order(egui::Order::Foreground)
                .show(ctx, |ui| {
                    egui::Window::new("Warning")
                        .collapsible(false)
                        .resizable(false)
                        .movable(false)
                        .show(ui.ctx(), |ui| {
                            ui.label("This will delete every entry in the category, are you sure?");
                            ui.horizontal(|ui| {
                                if ui.button("Yes").clicked() {
                                    self.model.delete_category(&self.deleting_category);
                                    self.ranking_category = None;
                                    self.show_delete_warning = false;
                                }

                                ui.add_space(50.0);

                                if ui.button("Cancel").clicked() {
                                    self.show_delete_warning = false;
                                }
                            });
                        });
                });
        }

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
                    if let Some((entry1, entry2, category)) = self.model.get_current_match() {
                        let title1 = entry1.title.clone();
                        let title2 = entry2.title.clone();

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

                        // This again cuz mutable references nested in ui elements are annoying.
                        let mut entry1_won = false;
                        let mut entry2_won = false;
                        let mut entry1_replace_image = false;
                        let mut entry2_replace_image = false;

                        // Entry 1.
                        ui.vertical(|ui| {
                            let image1 = Image::new(&texture1);
                            let width1: f32 = image1.size().unwrap().x;

                            if ui.add(ImageButton::new(image1)).clicked() {
                                entry1_won = true;
                            }

                            // Define the rectangle for the label area
                            let rect1 = ui.allocate_space(vec2(width1, 55.0)).1;

                            // Create a top-down layout for the label
                            ui.allocate_ui_at_rect(rect1, |ui| {
                                ui.with_layout(egui::Layout::top_down(Align::LEFT), |ui| {
                                    ui.label(
                                        egui::RichText::new(format!(
                                            "{} ({})",
                                            entry1.title, entry1.rating
                                        ))
                                        .font(FontId::proportional(23.0)),
                                    );
                                });
                            });

                            // Define the position for the button in the lower right corner
                            let button_size = vec2(100.0, 10.0);
                            let button_pos = pos2(
                                rect1.right() - button_size.x + 15.0,
                                rect1.bottom() - button_size.y - 10.0,
                            );

                            // Create the button at the specified position
                            ui.allocate_ui_at_rect(
                                Rect::from_min_size(button_pos, button_size),
                                |ui| {
                                    if ui.button("Get New Image").clicked() {
                                        entry1_replace_image = true;
                                    }
                                },
                            );
                        });

                        // Entry 2.
                        ui.vertical(|ui| {
                            let image2 = Image::new(&texture2);
                            let width2: f32 = image2.size().unwrap().x;

                            if ui.add(ImageButton::new(image2)).clicked() {
                                entry2_won = true;
                            }

                            // Define the rectangle for the label area
                            let rect2 = ui.allocate_space(vec2(width2, 55.0)).1;

                            // Create a top-down layout for the label
                            ui.allocate_ui_at_rect(rect2, |ui| {
                                ui.with_layout(egui::Layout::top_down(Align::LEFT), |ui| {
                                    ui.label(
                                        egui::RichText::new(format!(
                                            "{} ({})",
                                            entry2.title, entry2.rating
                                        ))
                                        .font(FontId::proportional(23.0)),
                                    );
                                });
                            });

                            // Define the position for the button in the lower right corner
                            let button_size = vec2(100.0, 10.0);
                            let button_pos = pos2(
                                rect2.right() - button_size.x + 15.0,
                                rect2.bottom() - button_size.y - 10.0,
                            );

                            // Create the button at the specified position
                            ui.allocate_ui_at_rect(
                                Rect::from_min_size(button_pos, button_size),
                                |ui| {
                                    if ui.button("Get New Image").clicked() {
                                        entry2_replace_image = true;
                                    }
                                },
                            );
                        });

                        // Update images if user requested.
                        if entry1_replace_image {
                            delete_image(
                                category.to_string(),
                                title1.clone(),
                                self.directory.clone(),
                            );
                            entry1.image =
                                get_image(category.to_string(), title1, self.directory.clone());
                        }
                        if entry2_replace_image {
                            delete_image(
                                category.to_string(),
                                title2.clone(),
                                self.directory.clone(),
                            );
                            entry2.image =
                                get_image(category.to_string(), title2, self.directory.clone());
                        }

                        // Calculate match outcome if user selected.
                        if entry1_won && !entry2_won {
                            self.model.calculate_current_match(1);
                            self.waiting_for_match = true;
                        } else if !entry1_won && entry2_won {
                            self.model.calculate_current_match(2);
                            self.waiting_for_match = true;
                        }
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
                                        self.new_name_box.clone_from(&entry.title);
                                    }
                                }
                            });
                        });
                    });

                    columns[1].vertical(|ui| {
                        // Image of currently selected entry.
                        if let Some(entry_index) = &self.selected_entry {
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
    let mut options = eframe::NativeOptions::default();
    options.viewport.resizable = Some(false);

    let _ = eframe::run_native(
        "Media Rating",
        options,
        Box::new(|_cc| Ok(Box::new(MyApp::default()))),
    );
}
