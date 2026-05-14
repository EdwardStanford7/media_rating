use eframe::egui;
use rust_xlsxwriter::Workbook;
use std::{fs, path::PathBuf};

use crate::{
    home_screen::HomeScreen,
    image_store::ImageStore,
    main_screen::ScreenState,
    model::Model,
    popup::{self, ConfirmDeleteCategoryPopup, Popup, PopupResponse},
    ranking_screen::{RankingOutcome, RankingScreen, RankingSource},
    splash_screen::SplashScreen,
};

pub struct MediaRatingApp {
    document: Option<DocumentContext>,
    screen: ScreenState,
    popup: Option<Box<dyn Popup>>,
}

struct DocumentContext {
    model: Model,
    images: ImageStore,
}

pub enum AppAction {
    OpenSpreadsheet(PathBuf),
    CreateSpreadsheet(PathBuf),
    ReturnToSplash,
    RequestDeleteCategory {
        category: String,
    },
    DeleteCategory {
        category: String,
    },
    CreateCategory {
        name: String,
    },
    StartAddEntry {
        category: String,
        entry: String,
    },
    StartRerankEntry {
        category: String,
        index: usize,
    },
    StartSwitchCategory {
        from_category: String,
        from_index: usize,
        to_category: String,
        entry: String,
    },
    RenameEntry {
        category: String,
        index: usize,
        new_name: String,
    },
    DeleteEntry {
        category: String,
        index: usize,
    },
    RefreshImage {
        category: String,
        entry: String,
    },
    RankingFinished(RankingOutcome),
    CancelRanking,
}

impl Default for MediaRatingApp {
    fn default() -> Self {
        Self {
            document: None,
            screen: ScreenState::Splash(SplashScreen),
            popup: None,
        }
    }
}

impl eframe::App for MediaRatingApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let mut actions = Vec::new();

        match (&mut self.screen, self.document.as_mut()) {
            (ScreenState::Splash(screen), _) => {
                egui::CentralPanel::default().show(ctx, |ui| {
                    actions.extend(screen.ui(ui));
                });
            }
            (ScreenState::Home(screen), Some(document)) => {
                egui::TopBottomPanel::top("Menu").show(ctx, |ui| {
                    actions.extend(screen.menu_bar(ui, &document.model));
                });

                egui::CentralPanel::default().show(ctx, |ui| {
                    actions.extend(screen.ui(ctx, ui, &document.model, &mut document.images));
                });
            }
            (ScreenState::Ranking { ranking, .. }, Some(document)) => {
                egui::TopBottomPanel::top("Menu").show(ctx, |ui| {
                    actions.extend(ranking.menu_bar(ui));
                });

                egui::CentralPanel::default().show(ctx, |ui| {
                    actions.extend(ranking.ui(ctx, ui, &mut document.images));
                });
            }
            (_, None) => actions.push(AppAction::ReturnToSplash),
        }

        if let Some(active_popup) = self.popup.as_mut() {
            match popup::show_modal(ctx, active_popup.as_mut()) {
                PopupResponse::KeepOpen => {}
                PopupResponse::Close => self.popup = None,
                PopupResponse::Action(action) => {
                    self.popup = None;
                    actions.push(action);
                }
            }
        }

        for action in actions {
            self.handle_action(action, ctx);
        }
    }
}

impl MediaRatingApp {
    fn handle_action(&mut self, action: AppAction, ctx: &egui::Context) {
        match action {
            AppAction::OpenSpreadsheet(path) => self.open_document(path, false),
            AppAction::CreateSpreadsheet(path) => self.open_document(path, true),
            AppAction::ReturnToSplash => self.return_to_splash(),
            AppAction::RequestDeleteCategory { category } => {
                self.popup = Some(Box::new(ConfirmDeleteCategoryPopup::new(category)));
            }
            AppAction::DeleteCategory { category } => self.delete_category(category),
            AppAction::CreateCategory { name } => self.create_category(name),
            AppAction::StartAddEntry { category, entry } => self.start_add_entry(category, entry),
            AppAction::StartRerankEntry { category, index } => {
                self.start_rerank_entry(category, index);
            }
            AppAction::StartSwitchCategory {
                from_category,
                from_index,
                to_category,
                entry,
            } => self.start_switch_category(from_category, from_index, to_category, entry),
            AppAction::RenameEntry {
                category,
                index,
                new_name,
            } => self.rename_entry(category, index, new_name),
            AppAction::DeleteEntry { category, index } => self.delete_entry(category, index),
            AppAction::RefreshImage { category, entry } => {
                if let Some(document) = self.document.as_mut() {
                    document
                        .images
                        .refresh_entry_texture(&entry, &category, ctx);
                }
            }
            AppAction::RankingFinished(outcome) => self.finish_ranking(outcome),
            AppAction::CancelRanking => self.return_to_home(),
        }
    }

    fn open_document(&mut self, path: PathBuf, create_new: bool) {
        if create_new {
            let mut workbook = Workbook::new();
            if let Err(e) = workbook.save(&path) {
                eprintln!("Could not create new spreadsheet: {e}");
                return;
            }
        }

        let Some(parent) = path.parent() else {
            eprintln!("Spreadsheet path has no parent directory");
            return;
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            eprintln!("Spreadsheet path has no file name");
            return;
        };

        let image_directory = parent.join("images");
        if let Err(e) = fs::create_dir_all(&image_directory) {
            eprintln!("Could not create image directory: {e}");
            return;
        }

        let directory = format!("{}/", parent.to_string_lossy());
        let mut model = Model::new();
        if !model.open_spreadsheet(directory.clone(), file_name.to_string()) {
            eprintln!("Could not open spreadsheet");
            return;
        }

        let selected_category = model.get_categories().first().cloned();
        self.document = Some(DocumentContext {
            model,
            images: ImageStore::new(directory),
        });
        self.screen = ScreenState::Home(HomeScreen::new(selected_category));
    }

    fn return_to_splash(&mut self) {
        self.document = None;
        self.popup = None;
        self.screen = ScreenState::Splash(SplashScreen);
    }

    fn create_category(&mut self, name: String) {
        if let Some(document) = self.document.as_mut() {
            document.model.create_category(name);
            document.model.save_to_spreadsheet();
        }
    }

    fn delete_category(&mut self, category: String) {
        if let Some(document) = self.document.as_mut() {
            document.model.delete_category(&category);
            document.model.save_to_spreadsheet();
        }

        if let Some(home) = self.home_screen_mut() {
            home.category_deleted(&category);
        }
    }

    fn rename_entry(&mut self, category: String, index: usize, new_name: String) {
        if let Some(document) = self.document.as_mut() {
            if let Some(old_name) = document
                .model
                .rename_entry(&category, index, new_name.clone())
            {
                document
                    .images
                    .rename_image(&category, &old_name, &new_name);
                document.model.save_to_spreadsheet();
            }
        }
    }

    fn delete_entry(&mut self, category: String, index: usize) {
        if let Some(document) = self.document.as_mut() {
            if let Some(entry) = document.model.delete_entry(&category, index) {
                document.images.delete_image(&category, &entry);
                document.model.save_to_spreadsheet();
            }
        }
    }

    fn start_add_entry(&mut self, category: String, entry: String) {
        let Some(document) = self.document.as_mut() else {
            return;
        };

        if document.model.contains_entry(&category, &entry) {
            return;
        }

        let entries = document.model.get_category_entries(&category).to_vec();
        if entries.is_empty() {
            document.model.insert_entry_at(&category, entry, 0);
            document.model.save_to_spreadsheet();
            return;
        }

        let source = RankingSource::NewEntry;
        if let Some(ranking) = RankingScreen::new(category, entry, entries, source) {
            self.transition_home_to_ranking(ranking);
        }
    }

    fn start_rerank_entry(&mut self, category: String, index: usize) {
        let Some(document) = self.document.as_ref() else {
            return;
        };
        let Some(entry) = document
            .model
            .get_entry(&category, index)
            .map(str::to_string)
        else {
            return;
        };
        let entries: Vec<String> = document
            .model
            .get_category_entries(&category)
            .iter()
            .enumerate()
            .filter_map(|(entry_index, entry)| {
                if entry_index == index {
                    None
                } else {
                    Some(entry.clone())
                }
            })
            .collect();

        if entries.is_empty() {
            return;
        }

        let source = RankingSource::RerankEntry {
            original_index: index,
        };
        if let Some(ranking) = RankingScreen::new(category, entry, entries, source) {
            self.transition_home_to_ranking(ranking);
        }
    }

    fn start_switch_category(
        &mut self,
        from_category: String,
        from_index: usize,
        to_category: String,
        entry: String,
    ) {
        let Some(document) = self.document.as_ref() else {
            return;
        };
        let Some(original_entry) = document
            .model
            .get_entry(&from_category, from_index)
            .map(str::to_string)
        else {
            return;
        };

        if document.model.contains_entry(&to_category, &entry) {
            if let Some(document) = self.document.as_mut() {
                if let Some(deleted_entry) = document.model.delete_entry(&from_category, from_index)
                {
                    document.images.delete_image(&from_category, &deleted_entry);
                    document.model.save_to_spreadsheet();
                }
            }
            return;
        }

        let entries = document.model.get_category_entries(&to_category).to_vec();
        let source = RankingSource::SwitchCategory {
            from_category,
            from_index,
            original_entry,
        };

        if entries.is_empty() {
            self.finish_ranking(RankingOutcome {
                category: to_category,
                entry,
                index: 0,
                source,
            });
            return;
        }

        if let Some(ranking) = RankingScreen::new(to_category, entry, entries, source) {
            self.transition_home_to_ranking(ranking);
        }
    }

    fn finish_ranking(&mut self, outcome: RankingOutcome) {
        if let Some(document) = self.document.as_mut() {
            match outcome.source {
                RankingSource::NewEntry => {
                    document
                        .model
                        .insert_entry_at(&outcome.category, outcome.entry, outcome.index);
                }
                RankingSource::RerankEntry { original_index } => {
                    document
                        .model
                        .move_entry(&outcome.category, original_index, outcome.index);
                }
                RankingSource::SwitchCategory {
                    from_category,
                    from_index,
                    original_entry,
                } => {
                    document.model.delete_entry(&from_category, from_index);
                    document
                        .images
                        .delete_image(&from_category, &original_entry);
                    document
                        .model
                        .insert_entry_at(&outcome.category, outcome.entry, outcome.index);
                }
            }

            document.model.save_to_spreadsheet();
        }

        self.return_to_home();
    }

    fn transition_home_to_ranking(&mut self, ranking: RankingScreen) {
        let old_screen = std::mem::replace(&mut self.screen, ScreenState::placeholder());
        self.screen = match old_screen {
            ScreenState::Home(home) => ScreenState::Ranking {
                ranking,
                home: Box::new(home),
            },
            other => other,
        };
    }

    fn return_to_home(&mut self) {
        let old_screen = std::mem::replace(&mut self.screen, ScreenState::placeholder());
        self.screen = match old_screen {
            ScreenState::Ranking { home, .. } => ScreenState::Home(*home),
            other => other,
        };
    }

    fn home_screen_mut(&mut self) -> Option<&mut HomeScreen> {
        match &mut self.screen {
            ScreenState::Home(home) => Some(home),
            ScreenState::Ranking { home, .. } => Some(home),
            ScreenState::Splash(_) => None,
        }
    }
}
