use eframe::egui;
use egui::{vec2, Align, FontId, Image, ImageButton};
use rand::Rng;

use crate::{app::AppAction, image_store::ImageStore};

#[derive(Clone, Debug)]
pub enum RankingSource {
    NewEntry,
    RerankEntry {
        original_index: usize,
    },
    SwitchCategory {
        from_category: String,
        from_index: usize,
        original_entry: String,
    },
}

#[derive(Clone, Debug)]
pub struct RankingOutcome {
    pub category: String,
    pub entry: String,
    pub index: usize,
    pub source: RankingSource,
}

pub struct RankingScreen {
    category: String,
    entry: String,
    entries: Vec<String>,
    source: RankingSource,
    lower_bound: usize,
    upper_bound: usize,
    pivot_index: usize,
}

impl RankingScreen {
    pub fn new(
        category: String,
        entry: String,
        entries: Vec<String>,
        source: RankingSource,
    ) -> Option<Self> {
        if entries.is_empty() {
            return None;
        }

        let upper_bound = entries.len();
        Some(Self {
            category,
            entry,
            entries,
            source,
            lower_bound: 0,
            upper_bound,
            pivot_index: rand::thread_rng().gen_range(0..upper_bound),
        })
    }

    pub fn menu_bar(&mut self, ui: &mut egui::Ui) -> Vec<AppAction> {
        let mut actions = Vec::new();

        ui.horizontal(|ui| {
            if ui.button("Menu").clicked() || ui.input(|i| i.key_pressed(egui::Key::Escape)) {
                actions.push(AppAction::CancelRanking);
            }
        });

        ui.add_space(10.0);
        actions
    }

    pub fn pending_image_target(&self) -> Option<(&str, &str)> {
        match self.source {
            RankingSource::NewEntry | RankingSource::SwitchCategory { .. } => {
                Some((&self.category, &self.entry))
            }
            RankingSource::RerankEntry { .. } => None,
        }
    }

    pub fn ui(
        &mut self,
        ctx: &egui::Context,
        ui: &mut egui::Ui,
        images: &mut ImageStore,
    ) -> Vec<AppAction> {
        let mut actions = Vec::new();
        let category = self.category.clone();
        let entry = self.entry.clone();
        let opponent = self.entries[self.pivot_index].clone();
        let opponent_index = self.pivot_index;

        let left_texture = images.get_entry_texture(&entry, &category, ctx);
        let right_texture = images.get_entry_texture(&opponent, &category, ctx);

        ui.horizontal(|ui| {
            let mut entry_won = false;
            let mut opponent_won = false;

            ui.vertical(|ui| {
                let image = Image::new(&left_texture);
                let width = image.size().unwrap().x;

                if ui.add(ImageButton::new(image)).clicked() {
                    entry_won = true;
                }

                let rect = ui.allocate_space(vec2(width, 55.0)).1;
                ui.allocate_ui_at_rect(rect, |ui| {
                    ui.with_layout(egui::Layout::top_down(Align::LEFT), |ui| {
                        ui.label(
                            egui::RichText::new(format!("{} (#{})", entry, self.entries.len() + 1))
                                .font(FontId::proportional(23.0)),
                        );
                    });
                });
            });

            ui.vertical(|ui| {
                let image = Image::new(&right_texture);
                let width = image.size().unwrap().x;

                if ui.add(ImageButton::new(image)).clicked() {
                    opponent_won = true;
                }

                let rect = ui.allocate_space(vec2(width, 55.0)).1;
                ui.allocate_ui_at_rect(rect, |ui| {
                    ui.with_layout(egui::Layout::top_down(Align::LEFT), |ui| {
                        ui.label(
                            egui::RichText::new(format!("{} (#{})", opponent, opponent_index + 1))
                                .font(FontId::proportional(23.0)),
                        );
                    });
                });
            });

            if entry_won && !opponent_won {
                if let Some(outcome) = self.report_match_winner(true) {
                    actions.push(AppAction::RankingFinished(outcome));
                }
            } else if !entry_won && opponent_won {
                if let Some(outcome) = self.report_match_winner(false) {
                    actions.push(AppAction::RankingFinished(outcome));
                }
            }
        });

        actions
    }

    fn report_match_winner(&mut self, entry_won: bool) -> Option<RankingOutcome> {
        if entry_won {
            self.upper_bound = self.pivot_index;
        } else {
            self.lower_bound = self.pivot_index + 1;
        }

        if self.lower_bound >= self.upper_bound {
            Some(RankingOutcome {
                category: self.category.clone(),
                entry: self.entry.clone(),
                index: self.lower_bound,
                source: self.source.clone(),
            })
        } else {
            self.pivot_index = rand::thread_rng().gen_range(self.lower_bound..self.upper_bound);
            None
        }
    }
}
