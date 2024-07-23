use calamine::{open_workbook, DataType, Reader, Xlsx};
use egui::{Color32, ColorImage};
use rand::Rng;
use std::collections::HashMap;
use xlsxwriter::{Format, Workbook};

#[derive(Debug)]
pub struct Model {
    filepath: String,
    // Name of category mapped to vector of all entries in it.
    categories: HashMap<String, Vec<Entry>>,
    // Category and the indexes of the two entries in the match.
    current_match: Option<(String, usize, usize)>,
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub title: String,
    pub rating: f64,
    pub icon: ColorImage,
}

impl Model {
    // Create a new Model object.
    pub fn new() -> Model {
        Model {
            filepath: String::new(),
            categories: HashMap::new(),
            current_match: None,
        }
    }

    // Read data from a spreadsheet.
    pub fn open_spreadsheet(&mut self, path: &str) -> bool {
        // Open a new workbook.
        let mut workbook: Xlsx<_> = open_workbook(path).unwrap();

        let sheet;
        if let Some(result) = workbook.worksheet_range_at(0) {
            sheet = result.unwrap();
        } else {
            return false;
        }

        let (height, width) = sheet.get_size();

        // Iterate over all the columns to check which ones hold category rankings.
        for column in 0..width {
            let current_category: String;

            // Get the name of the category or skip if this column does not hold a category.
            match sheet.get_value((0, column as u32)).unwrap().get_string() {
                Some(category_name) => {
                    current_category = category_name.to_string();
                    self.categories
                        .insert(category_name.to_string(), Vec::new());
                }
                None => continue,
            }

            // Iterate over the entries in this category.
            for row in 1..height {
                match sheet
                    .get_value((row as u32, column as u32))
                    .unwrap()
                    .get_string()
                {
                    Some(title) => {
                        match sheet
                            .get_value((row as u32, (column + 1) as u32))
                            .unwrap()
                            .get_float()
                        {
                            Some(rating) => {
                                self.categories
                                    .get_mut(&current_category)
                                    .unwrap()
                                    .push(Entry {
                                        title: title.to_owned(),
                                        rating: rating * 100.0,
                                        icon: get_icon(current_category.clone(), title.to_owned()),
                                    });
                            }
                            None => continue,
                        }
                    }
                    None => continue,
                }
            }
        }

        self.filepath = path.to_string();

        true
    }

    // Return all categories that are currently in the Model.
    pub fn get_categories(&self) -> Vec<String> {
        self.categories.keys().cloned().collect()
    }

    // Get how many entries there are in a category.
    pub fn get_num_entries(&self, category: String) -> usize {
        self.categories.get(&category).unwrap().len()
    }

    // Set the current match that is being displayed. Choose 1 or 2 random entries depending on whether a new entry is being ranked or not.
    pub fn set_current_match(&mut self, category: String, ranking_new_entry: bool) {
        let mut rng = rand::thread_rng();
        let entries = self.categories.get_mut(&category).unwrap();
        let length = entries.len();

        let entry1;
        let mut entry2;

        if ranking_new_entry {
            entry1 = length - 1;
            entry2 = rng.gen_range(0..length - 1);
        } else {
            entry1 = rng.gen_range(0..length);

            // Make sure we don't match something against itself.
            loop {
                entry2 = rng.gen_range(0..length);
                if entry2 != entry1 {
                    break;
                }
            }
        }

        self.current_match = Some((category, entry1, entry2));
    }

    // Get the current match.
    pub fn get_current_match(&self) -> Option<(Entry, Entry)> {
        match &self.current_match {
            Some((category, entry1_index, entry2_index)) => {
                return Some((
                    self.categories.get(category).unwrap()[*entry1_index].clone(),
                    self.categories.get(category).unwrap()[*entry2_index].clone(),
                ));
            }
            None => None,
        }
    }

    // Update the elo of the current match entries based on the winner.
    pub fn calculate_current_match(&mut self, winner: usize) {
        let (category, entry1_index, entry2_index) = self.current_match.clone().unwrap();

        let entry1_rating = self.categories.get(&category).unwrap()[entry1_index].rating;
        let entry2_rating = self.categories.get(&category).unwrap()[entry2_index].rating;

        let (s_a, s_b) = if winner == 1 { (1.0, 0.0) } else { (0.0, 1.0) };

        // Expected score for each player
        let e_a = 1.0 / (1.0 + f64::powf(10.0, (entry1_rating - entry2_rating) / 400.0));
        let e_b = 1.0 - e_a;

        // Sensitivity factor.
        let k = 32.0;

        // Update ratings
        let new_rating1 = (entry1_rating + k * (s_a - e_a)).round();
        let new_rating2 = (entry2_rating + k * (s_b - e_b)).round();

        // Clamp the new ratings between 50 and 750
        self.categories.get_mut(&category).unwrap()[entry1_index].rating =
            new_rating1.clamp(50.0, 750.0);
        self.categories.get_mut(&category).unwrap()[entry2_index].rating =
            new_rating2.clamp(50.0, 750.0);
    }

    // Reset all the rankings in a category.
    pub fn reset_category_rankings(&mut self, category: String) {
        for entry in self.categories.get_mut(&category).unwrap() {
            entry.rating = 400.0;
        }
    }

    // Reset current match to empty.
    pub fn reset_current_match(&mut self) {
        self.current_match = None;
    }

    // Add a new entry to a category.
    pub fn add_entry(&mut self, entry: Entry, category: String) {
        self.categories.get_mut(&category).unwrap().push(entry);
    }

    // Write the contents of the model to a spreadsheet.
    pub fn save_to_spreadsheet(&self) {
        // Open the workbook for writing
        let workbook =
            Workbook::new(&self.filepath).expect("Could not open spreadsheet for saving."); // Again send to GUI not print.

        // Create a new worksheet
        let mut sheet = workbook
            .add_worksheet(Some("Ranked"))
            .expect("Could not add a new worksheet to save results in."); // Same thing with GUI as above.

        let mut format = Format::new(); // Expand on this to really format everything the way I like it.
        format.set_font_size(24.0);
        format.set_bold();

        let mut column: u16 = 0;

        // Write the data
        for (name, entries) in &self.categories {
            // Write Header
            let _ = sheet.write_string(0, column, name, Some(&format));

            let mut row: u32 = 1;
            for entry in entries {
                let _ = sheet.write_string(row, column, &entry.title, None);
                let _ = sheet.write_number(row, column + 1, (entry.rating / 100.0).round(), None);
                row += 1;
            }

            column += 3;
        }

        // Save the workbook
        let _ = workbook.close();
    }
}

pub fn get_icon(mut category: String, mut title: String) -> ColorImage {
    // Remove plural from category for better googling.
    if category.ends_with('s') {
        category.pop();
    }

    // Remove any extra information from the title stored in the spreadsheet.
    // let mut title_ = title.to_string();
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title = title.trim().to_string();

    // Create a temp image
    let pixels = vec![Color32::BLACK.to_array(); 122500];
    ColorImage::from_rgba_unmultiplied([350, 350], &pixels.concat())
}
