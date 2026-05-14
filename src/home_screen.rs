use eframe::egui;
use rand::{seq::SliceRandom, thread_rng};

use crate::{app::AppAction, image_store::ImageStore, model::Model};

pub struct HomeScreen {
    selected_category: Option<String>,
    selected_switch_category: Option<String>,
    previous_selected_category: Option<String>,
    new_entry_box: String,
    selected_entry: Option<usize>,
    search_entry_box: String,
    rename_entry_box: String,
    focus_index: Option<usize>,
}

impl HomeScreen {
    pub fn new(selected_category: Option<String>) -> Self {
        Self {
            previous_selected_category: selected_category.clone(),
            selected_category,
            selected_switch_category: None,
            new_entry_box: String::new(),
            selected_entry: None,
            search_entry_box: String::new(),
            rename_entry_box: String::new(),
            focus_index: None,
        }
    }

    pub fn category_deleted(&mut self, category: &str) {
        if self.selected_category.as_deref() == Some(category) {
            self.selected_category = None;
            self.previous_selected_category = None;
            self.clear_entry_selection();
        }

        if self.selected_switch_category.as_deref() == Some(category) {
            self.selected_switch_category = None;
        }
    }

    pub fn menu_bar(&mut self, ui: &mut egui::Ui, model: &Model) -> Vec<AppAction> {
        let mut actions = Vec::new();

        ui.horizontal(|ui| {
            ui.add_space(10.0);

            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    egui::ComboBox::from_label("")
                        .selected_text(
                            self.selected_category
                                .clone()
                                .unwrap_or_else(|| "Choose...".to_string()),
                        )
                        .show_ui(ui, |ui| {
                            for category in model.get_categories() {
                                ui.selectable_value(
                                    &mut self.selected_category,
                                    Some(category.clone()),
                                    category,
                                );
                            }
                        });
                });

                if self.selected_category != self.previous_selected_category {
                    self.clear_entry_selection();
                    self.previous_selected_category
                        .clone_from(&self.selected_category);
                }
            });

            ui.add_space(10.0);

            ui.vertical(|ui| {
                ui.text_edit_singleline(&mut self.new_entry_box);

                if ui.button("Add Entry To Current Category").clicked()
                    && self.selected_category.is_some()
                    && !self.new_entry_box.is_empty()
                {
                    actions.push(AppAction::StartAddEntry {
                        category: self.selected_category.clone().unwrap(),
                        entry: self.new_entry_box.clone(),
                    });
                    self.new_entry_box.clear();
                }
            });

            ui.vertical(|ui| {
                if ui.button("Delete Selected Category").clicked()
                    && self.selected_category.is_some()
                {
                    actions.push(AppAction::RequestDeleteCategory {
                        category: self.selected_category.clone().unwrap(),
                    });
                }

                if ui.button("Create New Category").clicked() && !self.new_entry_box.is_empty() {
                    actions.push(AppAction::CreateCategory {
                        name: self.new_entry_box.clone(),
                    });
                    self.new_entry_box.clear();
                }
            });
        });

        ui.add_space(10.0);
        actions
    }

    pub fn ui(
        &mut self,
        ctx: &egui::Context,
        ui: &mut egui::Ui,
        model: &Model,
        images: &mut ImageStore,
    ) -> Vec<AppAction> {
        let mut actions = Vec::new();
        let Some(category) = self.selected_category.clone() else {
            return actions;
        };

        self.handle_keyboard(ctx, model, &category, &mut actions);

        ui.columns(2, |columns| {
            columns[0].set_width(370.0);
            columns[0].vertical(|ui| {
                ui.text_edit_singleline(&mut self.search_entry_box);

                ui.with_layout(egui::Layout::top_down_justified(egui::Align::LEFT), |ui| {
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        for (index, entry) in
                            model.get_category_entries(&category).iter().enumerate()
                        {
                            if entry
                                .to_lowercase()
                                .contains(&self.search_entry_box.to_lowercase())
                            {
                                let label = ui.selectable_label(
                                    self.selected_entry == Some(index),
                                    format!("{:>3}\t\t{}", index + 1, entry),
                                );

                                if Some(index) == self.focus_index {
                                    let rect = label.rect;
                                    ui.scroll_to_rect(rect, Some(egui::Align::Center));
                                    self.focus_index = None;
                                }

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
                let Some(entry_index) = self.selected_entry else {
                    return;
                };
                let Some(entry) = model.get_entry(&category, entry_index).map(str::to_string)
                else {
                    self.clear_entry_selection();
                    return;
                };

                let texture = images.get_entry_texture(&entry, &category, ctx);
                ui.image(&texture);

                ui.horizontal(|ui| {
                    if ui.button("Get New Image").clicked()
                        || ui.input(|i| i.key_pressed(egui::Key::N) && i.modifiers.command)
                    {
                        actions.push(AppAction::RefreshImage {
                            category: category.clone(),
                            entry: entry.clone(),
                        });
                        self.focus_index = self.selected_entry;
                    }

                    if ui.button("Delete Entry").clicked() {
                        actions.push(AppAction::DeleteEntry {
                            category: category.clone(),
                            index: entry_index,
                        });
                        self.clear_entry_selection();
                    }

                    if ui.button("Rerank Entry").clicked() {
                        actions.push(AppAction::StartRerankEntry {
                            category: category.clone(),
                            index: entry_index,
                        });
                        self.clear_entry_selection();
                    }

                    if ui.button("Switch Category").clicked() {
                        if let Some(target_category) = self.selected_switch_category.clone() {
                            if target_category != category {
                                actions.push(AppAction::StartSwitchCategory {
                                    from_category: category.clone(),
                                    from_index: entry_index,
                                    to_category: target_category,
                                    entry: self.rename_entry_box.clone(),
                                });
                                self.clear_entry_selection();
                            }
                        }
                    }
                });

                ui.horizontal(|ui| {
                    ui.text_edit_singleline(&mut self.rename_entry_box);

                    ui.vertical(|ui| {
                        ui.horizontal(|ui| {
                            egui::ComboBox::from_label("")
                                .selected_text(
                                    self.selected_switch_category
                                        .clone()
                                        .unwrap_or_else(|| "Choose...".to_string()),
                                )
                                .show_ui(ui, |ui| {
                                    for category in model.get_categories() {
                                        ui.selectable_value(
                                            &mut self.selected_switch_category,
                                            Some(category.clone()),
                                            category,
                                        );
                                    }
                                });
                        });
                    });
                });
            });
        });

        actions
    }

    fn handle_keyboard(
        &mut self,
        ctx: &egui::Context,
        model: &Model,
        category: &str,
        actions: &mut Vec<AppAction>,
    ) {
        if ctx.input(|i| i.key_pressed(egui::Key::ArrowDown)) {
            let len = model.get_category_entries(category).len();
            if len > 0 {
                let next = match self.selected_entry {
                    Some(i) => (i + 1).min(len - 1),
                    None => 0,
                };
                self.selected_entry = Some(next);
                self.rename_entry_box = model.get_category_entries(category)[next].clone();
                self.focus_index = Some(next);
            }
        }

        if ctx.input(|i| i.key_pressed(egui::Key::ArrowUp)) {
            let len = model.get_category_entries(category).len();
            if len > 0 {
                let prev = match self.selected_entry {
                    Some(i) => i.saturating_sub(1),
                    None => 0,
                };
                self.selected_entry = Some(prev);
                self.rename_entry_box = model.get_category_entries(category)[prev].clone();
                self.focus_index = Some(prev);
            }
        }

        if ctx.input(|i| i.key_pressed(egui::Key::Enter)) {
            if let Some(entry_index) = self.selected_entry {
                actions.push(AppAction::RenameEntry {
                    category: category.to_string(),
                    index: entry_index,
                    new_name: self.rename_entry_box.clone(),
                });
                self.focus_index = self.selected_entry;
            }
        }

        if ctx.input(|i| i.key_pressed(egui::Key::Tab)) {
            let mut rng = thread_rng();
            if let Some(entry) = model.get_category_entries(category).choose(&mut rng) {
                let index = model
                    .get_category_entries(category)
                    .iter()
                    .position(|e| e == entry)
                    .unwrap();
                actions.push(AppAction::StartRerankEntry {
                    category: category.to_string(),
                    index,
                });
                self.clear_entry_selection();
            }
        }
    }

    fn clear_entry_selection(&mut self) {
        self.selected_entry = None;
        self.rename_entry_box.clear();
        self.search_entry_box.clear();
        self.focus_index = None;
    }
}
