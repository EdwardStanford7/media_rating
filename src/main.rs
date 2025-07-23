use eframe::egui;
use egui::{vec2, Align, CentralPanel, FontId, Id, Image, ImageButton, ScrollArea, TopBottomPanel};
use native_dialog::FileDialog;
use rust_xlsxwriter::Workbook;
use std::{cell::RefCell, collections::HashMap, ops::ControlFlow, path::Path, process::exit};
mod model;
use egui::ColorImage;
use image::{self};
use image_search::{blocking::urls, Arguments};
use model::Model;
use std::fs;

struct MyApp {
    // State of the rankings.
    model: Model,

    // Is the model initialized. App starts with model uninitialized.
    model_initialized: bool,

    // What file directory are the spreadsheet and images stored in.
    directory: String,

    // What category is currently selected in the rank a category dropdown.
    selected_category: Option<String>,

    // What was the previous category selected. Used for checking when the category changes.
    previous_selected_category: Option<String>,

    // What is the current contents of the new entry text box.
    new_entry_box: String,

    // What entry is currently selected in the homepage rankings display.
    selected_entry: Option<usize>,

    // Elo list search filter text entry.
    search_entry_box: String,

    // Current contents of the new name text entry box.
    rename_entry_box: String,

    // What element is in focus in the leaderboard scroll.
    focus_index: Option<usize>,

    // Warning to the user when they try to delete a category.
    show_delete_warning: bool,

    // What category is the user trying to delete.
    deleting_category: String,

    // Texture cache for images.
    texture_cache: RefCell<HashMap<String, egui::TextureHandle>>,
}

impl Default for MyApp {
    fn default() -> Self {
        // Return new app state struct.
        Self {
            model: Model::new(),
            model_initialized: false,
            directory: String::new(),
            selected_category: None,
            previous_selected_category: None,
            new_entry_box: String::new(),
            selected_entry: None,
            search_entry_box: String::new(),
            rename_entry_box: String::new(),
            focus_index: None,
            show_delete_warning: false,
            deleting_category: String::new(),
            texture_cache: RefCell::new(HashMap::new()),
        }
    }
}

impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let ControlFlow::Break(_) = self.startup_screen(ctx) {
            return;
        }

        self.menu_bar(ctx);

        self.check_delete_overlay(ctx);

        // Central panel.
        CentralPanel::default().show(ctx, |ui| {
            // If app is in ranking mode, display the current match.
            if self.model.is_ranking() {
                self.ranking_screen(ctx, ui);
            }
            // If app is in home menu, display a list of all entries in the selected category.
            else if let Some(ref category) = self.selected_category {
                let category_clone = category.clone();
                self.home_screen(ctx, ui, &category_clone);
            }
        });
    }
}

impl MyApp {
    fn check_delete_overlay(&mut self, ctx: &egui::Context) {
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
                                    self.selected_category = None;
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
    }

    fn startup_screen(&mut self, ctx: &egui::Context) -> ControlFlow<()> {
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
                                if let Some(category) = self.model.get_categories().first().cloned()
                                {
                                    self.selected_category = Some(category.clone());
                                } else {
                                    self.selected_category = None;
                                }
                            }
                        }
                    }
                });
            });

            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn menu_bar(&mut self, ctx: &egui::Context) {
        // Menu bar.
        TopBottomPanel::top("Menu").show(ctx, |ui| {
            // Menu is horizontal at top of app.
            ui.horizontal(|ui| {
                // Only display back to menu button if ranking is happening.
                if self.model.is_ranking() && ui.button("Menu").clicked() {
                    self.selected_entry = None;
                    self.rename_entry_box.clear();
                    self.search_entry_box.clear();
                    self.model.end_ranking();
                    self.model.save_to_spreadsheet();
                }

                // Should app display menu items or not (if ranking is happening).
                if !self.model.is_ranking() {
                    ui.add_space(10.0);

                    // Select category dropdown.
                    ui.vertical(|ui| {
                        egui::ComboBox::from_label("Select a category")
                            .selected_text(
                                self.selected_category
                                    .clone()
                                    .unwrap_or_else(|| "Choose...".to_string()),
                            )
                            .show_ui(ui, |ui| {
                                for category in self.model.get_categories() {
                                    ui.selectable_value(
                                        &mut self.selected_category,
                                        Some(category.clone()),
                                        category,
                                    );
                                }
                            });

                        // Check if category has changed.
                        if self.selected_category != self.previous_selected_category {
                            self.selected_entry = None;
                            // Update the previous ranking category
                            self.previous_selected_category
                                .clone_from(&self.selected_category);
                        }

                        // Rerank category button.
                        ui.horizontal(|ui| {
                            if ui.button("Rank Selected Category").clicked()
                                && self.selected_category.is_some()
                                && self
                                    .model
                                    .get_num_entries(&(self.selected_category.clone().unwrap()))
                                    >= 2
                            {
                                self.model
                                    .rank_category(self.selected_category.clone().unwrap());
                            }

                            if ui.button("Delete Category").clicked()
                                && self.selected_category.is_some()
                            {
                                self.deleting_category = self.selected_category.clone().unwrap();
                                self.show_delete_warning = true;
                            }
                        });
                    });

                    ui.add_space(10.0);

                    // Add entries or categories.
                    ui.vertical(|ui| {
                        ui.text_edit_singleline(&mut self.new_entry_box);

                        ui.horizontal(|ui| {
                            // Add new entry button
                            if ui.button("Add Entry To Current Category").clicked()
                                && self.selected_category.is_some()
                                && !self.new_entry_box.is_empty()
                            {
                                self.model.add_entry(
                                    self.new_entry_box.clone(),
                                    self.selected_category.clone().unwrap(),
                                );
                                self.new_entry_box.clear();
                            }

                            // Create new category button.
                            if ui.button("Create New Category").clicked()
                                && !self.new_entry_box.is_empty()
                            {
                                self.model.create_category(self.new_entry_box.to_string());
                                self.new_entry_box.clear();
                            }
                        });
                    });
                }
            });

            // Add a space between the menu bar and the content.
            ui.add_space(10.0);
        });
    }

    fn ranking_screen(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if let Some((entry1, entry2)) = self.model.get_current_match() {
                // This again cuz mutable references nested in ui elements are annoying.
                let mut entry1_won = false;
                let mut entry2_won = false;

                // Entry 1.
                ui.vertical(|ui| {
                    let image1 = Image::new(&self.get_entry_texture(
                        entry1,
                        self.selected_category.as_ref().unwrap(),
                        ctx,
                    ));
                    let width1: f32 = image1.size().unwrap().x;

                    if ui.add(ImageButton::new(image1)).clicked() {
                        entry1_won = true;
                    }

                    // Define the rectangle for the label area
                    let rect1 = ui.allocate_space(vec2(width1, 55.0)).1;

                    // Create a top-down layout for the label
                    ui.allocate_ui_at_rect(rect1, |ui| {
                        ui.with_layout(egui::Layout::top_down(Align::LEFT), |ui| {
                            ui.label(egui::RichText::new(entry1).font(FontId::proportional(23.0)));
                        });
                    });
                });

                // Entry 2.
                ui.vertical(|ui| {
                    let image2 = Image::new(&self.get_entry_texture(
                        entry2,
                        self.selected_category.as_ref().unwrap(),
                        ctx,
                    ));
                    let width2: f32 = image2.size().unwrap().x;

                    if ui.add(ImageButton::new(image2)).clicked() {
                        entry2_won = true;
                    }

                    // Define the rectangle for the label area
                    let rect2 = ui.allocate_space(vec2(width2, 55.0)).1;

                    // Create a top-down layout for the label
                    ui.allocate_ui_at_rect(rect2, |ui| {
                        ui.with_layout(egui::Layout::top_down(Align::LEFT), |ui| {
                            ui.label(egui::RichText::new(entry2).font(FontId::proportional(23.0)));
                        });
                    });
                });

                // Calculate match outcome if user selected.
                if entry1_won && !entry2_won {
                    self.model.report_match_winner(true);
                } else if !entry1_won && entry2_won {
                    self.model.report_match_winner(false);
                }

                // Autosave everything.
                self.model.save_to_spreadsheet();
            }
        });
    }

    fn home_screen(&mut self, ctx: &egui::Context, ui: &mut egui::Ui, category: &String) {
        ui.columns(2, |columns| {
            // Category list.
            columns[0].set_width(370.0);
            columns[0].vertical(|ui| {
                ui.text_edit_singleline(&mut self.search_entry_box);

                ui.with_layout(egui::Layout::top_down_justified(egui::Align::LEFT), |ui| {
                    ScrollArea::vertical().show(ui, |ui| {
                        for (index, entry) in
                            self.model.get_category_entries(category).iter().enumerate()
                        {
                            if entry
                                .to_lowercase()
                                .contains(&self.search_entry_box.to_lowercase())
                            {
                                // Display the entry as a clickable label.
                                let label = ui.selectable_label(
                                    false,
                                    format!("{} \t\t{}", index + 1, entry),
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
                                    self.rename_entry_box.clone_from(entry);
                                }
                            }
                        }
                    });
                });
            });

            columns[1].vertical(|ui| {
                // Image of currently selected entry.
                if let Some(entry_index) = &self.selected_entry {
                    let mut rename_entry = false;
                    let mut new_icon = false;
                    let mut delete_entry = false;

                    let entry = self.model.get_entry(category, *entry_index);
                    ui.image(&self.get_entry_texture(&entry.clone(), category, ctx));

                    ui.horizontal(|ui| {
                        if ui.button("Update Name").clicked() {
                            rename_entry = true;
                        }

                        if ui.button("Get New Icon").clicked() {
                            new_icon = true;
                        }

                        if (ui.button("Delete Entry")).clicked() {
                            delete_entry = true;
                        }
                    });

                    if rename_entry {
                        rename_image(
                            category.to_string(),
                            entry.clone(),
                            self.rename_entry_box.clone(),
                            &self.directory,
                        );

                        self.model.rename_entry(
                            category,
                            *entry_index,
                            self.rename_entry_box.clone(),
                        );
                        self.focus_index = self.selected_entry;
                        self.model.save_to_spreadsheet();
                    }

                    if new_icon {
                        delete_image(category.to_string(), entry.clone(), &self.directory);
                        self.update_entry_texture(&entry, category, ctx);
                        self.focus_index = self.selected_entry;
                    }

                    if delete_entry {
                        self.model.delete_entry(category, *entry_index);
                        delete_image(category.to_string(), entry, &self.directory);
                        self.selected_entry = None;
                        self.model.save_to_spreadsheet();
                    }

                    ui.text_edit_singleline(&mut self.rename_entry_box);
                }
            });
        });
    }

    fn get_entry_texture(
        &self,
        entry: &str,
        category: &str,
        ctx: &egui::Context,
    ) -> egui::TextureHandle {
        // Check if the texture is already cached.
        if let Some(texture) = self
            .texture_cache
            .borrow()
            .get(&format!("{} {}", entry, category))
        {
            return texture.clone();
        }

        // If not cached, get the image and create a new texture.
        let image = get_image(
            category.to_string(),
            entry.to_string(),
            self.directory.clone(),
        );
        let texture = ctx.load_texture(
            format!("{} {}", entry, category),
            image,
            egui::TextureOptions::LINEAR,
        );

        // Cache the texture.
        self.texture_cache
            .borrow_mut()
            .insert(format!("{} {}", entry, category), texture.clone());

        texture
    }

    fn update_entry_texture(&self, entry: &str, category: &str, ctx: &egui::Context) {
        // Remove the old texture from the cache.
        self.texture_cache
            .borrow_mut()
            .remove(&format!("{} {}", entry, category));

        // Get the new image and create a new texture.
        let image = get_image(
            category.to_string(),
            entry.to_string(),
            self.directory.clone(),
        );
        let texture = ctx.load_texture(
            format!("{} {}", entry, category),
            image,
            egui::TextureOptions::LINEAR,
        );

        // Cache the new texture.
        self.texture_cache
            .borrow_mut()
            .insert(format!("{} {}", entry, category), texture.clone());
    }
}

pub fn get_image(mut category: String, mut title: String, file_directory: String) -> ColorImage {
    // Remove any extra information from the title and category stored in the spreadsheet.
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title = title.trim().to_string();
    category.pop();

    // Default to placeholder image.
    let mut img_bytes = vec![0u8; 380 * 475 * 4]; //     380x475, RGBA placeholder, all black

    // Construct the file path.
    let binding = format!("{}images/{} {}.png", file_directory, title, category);
    let full_path = Path::new(&binding);

    // Check local files first for saved image.
    if let Ok(image) = image::open(full_path) {
        img_bytes = image.to_rgba8().to_vec();
        return ColorImage::from_rgba_unmultiplied([380, 475], &img_bytes);
    }

    // Image was not cached locally, build query request.
    let args =
        Arguments::new(&format!("{} {}", title, category), 4).ratio(image_search::Ratio::Tall);
    let url_result = urls(args);

    // Attempt to download image from urls.
    if let Ok(urls) = url_result {
        for url in urls {
            match reqwest::blocking::get(url) {
                Ok(response) => match response.bytes() {
                    Ok(bytes) => {
                        // Decode image and resize to 380x475
                        if let Ok(image) = image::load_from_memory(&bytes) {
                            let resized_image = image.resize_exact(
                                380,
                                475,
                                image::imageops::FilterType::CatmullRom,
                            );
                            img_bytes = resized_image.to_rgba8().to_vec();

                            // Cache the resized image locally.
                            if let Err(e) = resized_image.save(full_path) {
                                eprintln!("Error saving image locally: {}", e);
                            }
                            break;
                        } else {
                            eprintln!("Error decoding image data");
                        }
                    }
                    Err(e) => eprintln!("Error reading bytes from response: {}", e),
                },
                Err(e) => eprintln!("Error fetching URL: {}", e),
            }
        }
    } else {
        eprintln!("Error fetching URLs: {}", url_result.err().unwrap());
    }

    ColorImage::from_rgba_unmultiplied([380, 475], &img_bytes)
}

pub fn delete_image(mut category: String, mut title: String, file_directory: &str) {
    // Remove any extra information from the title and category stored in the spreadsheet.
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title = title.trim().to_string();
    category.pop();

    // Construct the file path.
    let binding = format!("{}images/{} {}.png", file_directory, title, category);
    let full_path = Path::new(&binding);

    fs::remove_file(full_path).ok();
}

pub fn rename_image(
    mut category: String,
    mut old_title: String,
    mut new_title: String,
    file_directory: &str,
) {
    // Remove any extra information from the title and category stored in the spreadsheet.
    if let Some(index) = old_title.find('(') {
        old_title.truncate(index);
    }
    old_title = old_title.trim().to_string();

    if let Some(index) = new_title.find('(') {
        new_title.truncate(index);
    }
    new_title = new_title.trim().to_string();

    category.pop();

    // Construct the file paths.
    let binding = format!("{}images/{} {}.png", file_directory, old_title, category);
    let old_path = Path::new(&binding);

    let binding = format!("{}images/{} {}.png", file_directory, new_title, category);
    let new_path = Path::new(&binding);

    match fs::rename(old_path, new_path) {
        Ok(_) => {}
        Err(e) => eprintln!("Error renaming image: {}", e),
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
