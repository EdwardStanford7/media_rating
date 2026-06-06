use eframe::egui;
use std::{fs, path::PathBuf};

use crate::{
    home_screen::HomeScreen,
    image_picker_popup::ImagePickerPopup,
    image_store::ImageStore,
    main_screen::ScreenState,
    model::Model,
    popup::{self, ConfirmDeleteCategoryPopup, ConfirmDuplicateSwitchPopup, Popup, PopupResponse},
    ranking_screen::{RankingOutcome, RankingScreen, RankingSource},
    splash_screen::SplashScreen,
    spreadsheet,
};

pub struct MediaRatingApp {
    document: Option<DocumentContext>,
    screen: ScreenState,
    popup: Option<Box<dyn Popup>>,
}

struct DocumentContext {
    spreadsheet_path: PathBuf,
    model: Model,
    images: ImageStore,
}

impl DocumentContext {
    fn save(&self) {
        if let Err(e) = spreadsheet::save(&self.spreadsheet_path, &self.model) {
            eprintln!("Could not save to spreadsheet: {e}");
        }
    }
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
    DeleteEntryAndStartRerank {
        delete_category: String,
        delete_index: usize,
        rerank_category: String,
        rerank_index: usize,
    },
    RefreshImage {
        category: String,
        entry: String,
    },
    SetEntryImage {
        category: String,
        entry: String,
        image: image::DynamicImage,
        purpose: ImagePickPurpose,
    },
    RankingFinished(RankingOutcome),
    CancelRanking,
}

#[derive(Clone)]
pub enum ImagePickPurpose {
    RefreshOnly,
    AddEntry,
    SwitchCategory {
        from_category: String,
        from_index: usize,
    },
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
            AppAction::DeleteEntryAndStartRerank {
                delete_category,
                delete_index,
                rerank_category,
                rerank_index,
            } => self.delete_entry_and_start_rerank(
                delete_category,
                delete_index,
                rerank_category,
                rerank_index,
            ),
            AppAction::RefreshImage { category, entry } => {
                self.open_image_picker(category, entry, ImagePickPurpose::RefreshOnly);
            }
            AppAction::SetEntryImage {
                category,
                entry,
                image,
                purpose,
            } => {
                self.set_entry_image(category, entry, image, purpose, ctx);
            }
            AppAction::RankingFinished(outcome) => self.finish_ranking(outcome, ctx),
            AppAction::CancelRanking => self.cancel_ranking(),
        }
    }

    fn open_document(&mut self, path: PathBuf, create_new: bool) {
        if create_new {
            if let Err(e) = spreadsheet::create_empty(&path) {
                eprintln!("Could not create new spreadsheet: {e}");
                return;
            }
        }

        let Some(parent) = path.parent() else {
            eprintln!("Spreadsheet path has no parent directory");
            return;
        };
        let document_directory = parent.to_path_buf();
        let image_directory = document_directory.join("images");
        if let Err(e) = fs::create_dir_all(&image_directory) {
            eprintln!("Could not create image directory: {e}");
            return;
        }

        let model = match spreadsheet::load(&path) {
            Ok(model) => model,
            Err(e) => {
                eprintln!("Could not open spreadsheet: {e}");
                return;
            }
        };

        let selected_category = model.get_categories().first().cloned();
        self.document = Some(DocumentContext {
            spreadsheet_path: path,
            model,
            images: ImageStore::new(document_directory),
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
            document.save();
        }
    }

    fn delete_category(&mut self, category: String) {
        if let Some(document) = self.document.as_mut() {
            document.model.delete_category(&category);
            document.save();
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
                document.save();
            }
        }
    }

    fn delete_entry(&mut self, category: String, index: usize) {
        if let Some(document) = self.document.as_mut() {
            if let Some(entry) = document.model.delete_entry(&category, index) {
                document.images.delete_image(&category, &entry);
                document.save();
            }
        }
    }

    fn delete_entry_and_start_rerank(
        &mut self,
        delete_category: String,
        delete_index: usize,
        rerank_category: String,
        rerank_index: usize,
    ) {
        self.delete_entry(delete_category, delete_index);
        self.start_rerank_entry(rerank_category, rerank_index);
    }

    fn open_image_picker(&mut self, category: String, entry: String, purpose: ImagePickPurpose) {
        self.popup = Some(Box::new(ImagePickerPopup::new(category, entry, purpose)));
    }

    fn set_entry_image(
        &mut self,
        category: String,
        entry: String,
        image: image::DynamicImage,
        purpose: ImagePickPurpose,
        ctx: &egui::Context,
    ) {
        let Some(document) = self.document.as_mut() else {
            return;
        };

        if let Err(e) = document
            .images
            .set_entry_image(&category, &entry, image, ctx)
        {
            eprintln!("Could not save selected image: {e}");
            return;
        }

        match purpose {
            ImagePickPurpose::RefreshOnly => {}
            ImagePickPurpose::AddEntry => self.continue_add_entry(category, entry),
            ImagePickPurpose::SwitchCategory {
                from_category,
                from_index,
            } => self.continue_switch_category(from_category, from_index, category, entry, ctx),
        }
    }

    fn start_add_entry(&mut self, category: String, entry: String) {
        let Some(document) = self.document.as_ref() else {
            return;
        };

        if document.model.contains_entry(&category, &entry) {
            return;
        }

        self.open_image_picker(category, entry, ImagePickPurpose::AddEntry);
    }

    fn continue_add_entry(&mut self, category: String, entry: String) {
        let Some(document) = self.document.as_mut() else {
            return;
        };

        let entries = document.model.get_category_entries(&category).to_vec();
        if entries.is_empty() {
            document.model.insert_entry_at(&category, entry, 0);
            document.save();
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
        if document
            .model
            .get_entry(&from_category, from_index)
            .is_none()
        {
            return;
        }

        if let Some(target_index) = document
            .model
            .get_category_entries(&to_category)
            .iter()
            .position(|existing| existing == &entry)
        {
            self.popup = Some(Box::new(ConfirmDuplicateSwitchPopup::new(
                from_category,
                from_index,
                to_category,
                target_index,
                entry,
            )));
            return;
        }

        self.open_image_picker(
            to_category,
            entry,
            ImagePickPurpose::SwitchCategory {
                from_category,
                from_index,
            },
        );
    }

    fn continue_switch_category(
        &mut self,
        from_category: String,
        from_index: usize,
        to_category: String,
        entry: String,
        ctx: &egui::Context,
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

        let entries = document.model.get_category_entries(&to_category).to_vec();
        let source = RankingSource::SwitchCategory {
            from_category,
            from_index,
            original_entry,
        };

        if entries.is_empty() {
            self.finish_ranking(
                RankingOutcome {
                    category: to_category,
                    entry,
                    index: 0,
                    source,
                },
                ctx,
            );
            return;
        }

        if let Some(ranking) = RankingScreen::new(to_category, entry, entries, source) {
            self.transition_home_to_ranking(ranking);
        }
    }

    fn finish_ranking(&mut self, outcome: RankingOutcome, ctx: &egui::Context) {
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
                    document.images.replace_for_category_switch(
                        &from_category,
                        &original_entry,
                        &outcome.category,
                        &outcome.entry,
                        ctx,
                    );
                    document
                        .model
                        .insert_entry_at(&outcome.category, outcome.entry, outcome.index);
                }
            }

            document.save();
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

    fn cancel_ranking(&mut self) {
        if let (ScreenState::Ranking { ranking, .. }, Some(document)) =
            (&self.screen, self.document.as_mut())
        {
            if let Some((category, entry)) = ranking.pending_image_target() {
                document.images.delete_image(category, entry);
            }
        }

        self.return_to_home();
    }

    fn home_screen_mut(&mut self) -> Option<&mut HomeScreen> {
        match &mut self.screen {
            ScreenState::Home(home) => Some(home),
            ScreenState::Ranking { home, .. } => Some(home),
            ScreenState::Splash(_) => None,
        }
    }
}
