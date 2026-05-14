use eframe::egui;
use native_dialog::FileDialog;
use std::path::PathBuf;

use crate::app::AppAction;

#[derive(Default)]
pub struct SplashScreen;

impl SplashScreen {
    pub fn ui(&mut self, ui: &mut egui::Ui) -> Vec<AppAction> {
        let mut actions = Vec::new();

        ui.vertical_centered(|ui| {
            ui.add_space(200.0);

            if ui.button("Create New Spreadsheet").clicked() {
                if let Some(path) = FileDialog::new()
                    .add_filter("Excel file", &["xlsx"])
                    .set_filename("Media Ratings.xlsx")
                    .show_save_single_file()
                    .ok()
                    .flatten()
                {
                    actions.push(AppAction::CreateSpreadsheet(path_to_buf(path)));
                }
            }

            ui.add_space(50.0);

            if ui.button("Open Spreadsheet").clicked() {
                if let Some(path) = FileDialog::new()
                    .add_filter("Excel file", &["xlsx"])
                    .show_open_single_file()
                    .ok()
                    .flatten()
                {
                    actions.push(AppAction::OpenSpreadsheet(path_to_buf(path)));
                }
            }
        });

        actions
    }
}

fn path_to_buf(path: impl Into<PathBuf>) -> PathBuf {
    path.into()
}
