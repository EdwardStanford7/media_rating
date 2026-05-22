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
    binary_index: Option<usize>,
    comparisons: Vec<RankingComparison>,
}

#[derive(Clone, Copy, Debug)]
struct RankingComparison {
    opponent_index: usize,
    entry_won: bool,
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
            pivot_index: Self::choose_binary_pivot(0, upper_bound),
            binary_index: None,
            comparisons: Vec::new(),
        })
    }

    pub fn menu_bar(&mut self, ui: &mut egui::Ui) -> Vec<AppAction> {
        let mut actions = Vec::new();

        ui.horizontal(|ui| {
            if ui.button("Menu").clicked() || ui.input(|i| i.key_pressed(egui::Key::Escape)) {
                actions.push(AppAction::CancelRanking);
            }

            ui.separator();
            ui.label(self.status_text());
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
        self.comparisons.push(RankingComparison {
            opponent_index: self.pivot_index,
            entry_won,
        });

        if self.binary_index.is_none() {
            if entry_won {
                self.upper_bound = self.pivot_index;
            } else {
                self.lower_bound = self.pivot_index + 1;
            }

            if self.lower_bound < self.upper_bound {
                self.pivot_index = Self::choose_binary_pivot(self.lower_bound, self.upper_bound);
                return None;
            }

            self.binary_index = Some(self.lower_bound);
        }

        Some(self.finish_outcome())
    }

    fn choose_binary_pivot(lower_bound: usize, upper_bound: usize) -> usize {
        let range_len = upper_bound - lower_bound;
        if range_len <= 2 {
            return rand::thread_rng().gen_range(lower_bound..upper_bound);
        }

        let midpoint = lower_bound + range_len / 2;
        let jitter = (range_len / 4).max(1);
        let start = midpoint.saturating_sub(jitter).max(lower_bound);
        let end = (midpoint + jitter + 1).min(upper_bound);
        rand::thread_rng().gen_range(start..end)
    }

    fn final_index(&self) -> usize {
        let binary_index = self.binary_index.unwrap_or(self.lower_bound);
        let mut best_index = binary_index.min(self.entries.len());
        let mut best_score = self.index_score(best_index);
        let mut best_distance = best_index.abs_diff(binary_index);

        for index in 0..=self.entries.len() {
            let score = self.index_score(index);
            let distance = index.abs_diff(binary_index);
            if score > best_score || (score == best_score && distance < best_distance) {
                best_index = index;
                best_score = score;
                best_distance = distance;
            }
        }

        best_index
    }

    fn index_score(&self, index: usize) -> usize {
        self.comparisons
            .iter()
            .filter(|comparison| comparison.agrees_with_index(index))
            .count()
    }

    fn finish_outcome(&self) -> RankingOutcome {
        RankingOutcome {
            category: self.category.clone(),
            entry: self.entry.clone(),
            index: self.final_index(),
            source: self.source.clone(),
        }
    }

    fn status_text(&self) -> String {
        format!(
            "Narrowing placement range {}-{}",
            self.lower_bound + 1,
            self.upper_bound + 1
        )
    }
}

impl RankingComparison {
    fn agrees_with_index(&self, index: usize) -> bool {
        if self.entry_won {
            index <= self.opponent_index
        } else {
            index > self.opponent_index
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranking_with_comparisons(
        binary_index: usize,
        comparisons: Vec<RankingComparison>,
    ) -> RankingScreen {
        RankingScreen {
            category: "Movies:".to_string(),
            entry: "New".to_string(),
            entries: vec![
                "A".to_string(),
                "B".to_string(),
                "C".to_string(),
                "D".to_string(),
                "E".to_string(),
            ],
            source: RankingSource::NewEntry,
            lower_bound: binary_index,
            upper_bound: binary_index,
            pivot_index: 0,
            binary_index: Some(binary_index),
            comparisons,
        }
    }

    #[test]
    fn final_index_uses_comparison_majority() {
        let ranking = ranking_with_comparisons(
            3,
            vec![
                RankingComparison {
                    opponent_index: 3,
                    entry_won: true,
                },
                RankingComparison {
                    opponent_index: 1,
                    entry_won: false,
                },
                RankingComparison {
                    opponent_index: 2,
                    entry_won: true,
                },
            ],
        );

        assert_eq!(ranking.final_index(), 2);
    }

    #[test]
    fn final_index_prefers_binary_result_when_scores_tie() {
        let ranking = ranking_with_comparisons(
            3,
            vec![
                RankingComparison {
                    opponent_index: 1,
                    entry_won: false,
                },
                RankingComparison {
                    opponent_index: 4,
                    entry_won: true,
                },
            ],
        );

        assert_eq!(ranking.final_index(), 3);
    }
}
