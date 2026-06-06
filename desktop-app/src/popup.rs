use eframe::egui;

use crate::app::AppAction;

pub enum PopupResponse {
    KeepOpen,
    Close,
    Action(AppAction),
}

pub trait Popup {
    fn title(&self) -> &str;
    fn show_body(&mut self, ui: &mut egui::Ui) -> PopupResponse;
}

pub struct ConfirmDeleteCategoryPopup {
    category: String,
}

impl ConfirmDeleteCategoryPopup {
    pub fn new(category: String) -> Self {
        Self { category }
    }
}

impl Popup for ConfirmDeleteCategoryPopup {
    fn title(&self) -> &str {
        "Warning"
    }

    fn show_body(&mut self, ui: &mut egui::Ui) -> PopupResponse {
        let mut response = PopupResponse::KeepOpen;

        ui.label("This will delete every entry in the category, are you sure?");
        ui.horizontal(|ui| {
            if ui.button("Yes").clicked() {
                response = PopupResponse::Action(AppAction::DeleteCategory {
                    category: self.category.clone(),
                });
            }

            ui.add_space(50.0);

            if ui.button("Cancel").clicked() {
                response = PopupResponse::Close;
            }
        });

        response
    }
}

pub struct ConfirmDuplicateSwitchPopup {
    from_category: String,
    from_index: usize,
    to_category: String,
    target_index: usize,
    entry: String,
}

impl ConfirmDuplicateSwitchPopup {
    pub fn new(
        from_category: String,
        from_index: usize,
        to_category: String,
        target_index: usize,
        entry: String,
    ) -> Self {
        Self {
            from_category,
            from_index,
            to_category,
            target_index,
            entry,
        }
    }
}

impl Popup for ConfirmDuplicateSwitchPopup {
    fn title(&self) -> &str {
        "Entry Already Exists"
    }

    fn show_body(&mut self, ui: &mut egui::Ui) -> PopupResponse {
        let mut response = PopupResponse::KeepOpen;

        ui.label(format!(
            "\"{}\" already exists in {}. What should happen to the copy in {}?",
            self.entry, self.to_category, self.from_category
        ));
        ui.vertical(|ui| {
            if ui.button("Remove Source And Rerank Existing").clicked() {
                response = PopupResponse::Action(AppAction::DeleteEntryAndStartRerank {
                    delete_category: self.from_category.clone(),
                    delete_index: self.from_index,
                    rerank_category: self.to_category.clone(),
                    rerank_index: self.target_index,
                });
            }

            if ui.button("Remove Source Only").clicked() {
                response = PopupResponse::Action(AppAction::DeleteEntry {
                    category: self.from_category.clone(),
                    index: self.from_index,
                });
            }

            ui.add_space(8.0);

            if ui.button("Cancel").clicked() {
                response = PopupResponse::Close;
            }
        });

        response
    }
}

pub fn show_modal(ctx: &egui::Context, popup: &mut dyn Popup) -> PopupResponse {
    egui::Area::new(egui::Id::new("Blocking Overlay"))
        .anchor(egui::Align2::LEFT_TOP, egui::Vec2::ZERO)
        .fixed_pos(egui::pos2(0.0, 0.0))
        .order(egui::Order::Middle)
        .show(ctx, |ui| {
            let screen_rect = ctx.screen_rect();
            ui.painter()
                .rect_filled(screen_rect, 0.0, egui::Color32::from_black_alpha(75));
            ui.allocate_rect(screen_rect, egui::Sense::click());
        });

    let mut response = PopupResponse::KeepOpen;
    egui::Window::new(popup.title())
        .collapsible(false)
        .resizable(false)
        .movable(false)
        .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
        .order(egui::Order::Foreground)
        .show(ctx, |ui| {
            response = popup.show_body(ui);
        });

    response
}
