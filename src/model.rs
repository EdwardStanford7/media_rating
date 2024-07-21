use calamine::{open_workbook, DataType, Reader, Xlsx};
use image::RgbaImage;
use rand::Rng;
use std::collections::HashMap;
use xlsxwriter::{Format, Workbook};

#[derive(Debug)]
pub struct Model {
    // Name of category mapped to vector of all entries in it.
    categories: HashMap<String, Vec<Entry>>,
}

#[derive(Debug)]
pub struct Entry {
    title: String,
    rating: f64,
    icon: RgbaImage,
}

impl Model {
    // Create a new Model object.
    pub fn new(path: &str) -> Model {
        let mut model = Model {
            categories: HashMap::new(),
        };

        // Open a new workbook.
        let mut workbook: Xlsx<_> = open_workbook(path).expect("Cannot open file");

        let sheet = workbook
            .worksheet_range_at(0)
            .expect("xlsx file has no sheets in it.")
            .unwrap(); // Instead of printing error, probably want to send message to view that spreadsheet was invalid and to try again.

        let (height, width) = sheet.get_size();

        // Iterate over all the columns to check which ones hold category rankings.
        for column in 0..width {
            let current_category: String;

            // Get the name of the category or skip if this column does not hold a category.
            match sheet.get_value((0, column as u32)).unwrap().get_string() {
                Some(category_name) => {
                    current_category = category_name.to_string();
                    model
                        .categories
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
                                model
                                    .categories
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

        model
    }

    // Return all categories that are currently in the Model.
    pub fn get_categories(&self) -> Vec<String> {
        self.categories.keys().cloned().collect()
    }

    // Reset and rank all categories.
    pub fn rerank_all_categories(&mut self) {
        // Collect the keys into a separate vector
        let categories: Vec<String> = self.categories.keys().cloned().collect();
        for category in categories {
            self.rerank_category(category);
        }
    }

    // Reset the ranking of all entries in a category and perform matches to rank them all.
    pub fn rerank_category(&mut self, category: String) {
        let mut rng = rand::thread_rng();
        let entries = self.categories.get_mut(&category).unwrap();
        let length = entries.len();

        // Average number of matches required to get accurate rankings is nlogn so do a bit more than that.
        let num_matches: usize = length * ((f64::log2(length as f64) * 1.5) as usize);

        for _i in 0..num_matches {
            let entry1 = rng.gen_range(0..length);
            let mut entry2;

            // Make sure we don't match something against itself.
            loop {
                entry2 = rng.gen_range(0..length);
                if entry2 != entry1 {
                    break;
                }
            }

            let (left, right) = entries.split_at_mut(std::cmp::max(entry1, entry2));
            let entry1_ref = &mut left[std::cmp::min(entry1, entry2)];
            let entry2_ref = &mut right[0];

            perform_match(entry1_ref, entry2_ref);
        }
    }

    // Add and rank a new entry.
    pub fn add_new_entry(&mut self, title_: String, category: String) {
        let mut entry = Entry {
            title: title_.clone(),
            rating: 400.0,
            icon: get_icon(category.clone(), title_),
        };

        let mut rng = rand::thread_rng();
        let entries = self.categories.get_mut(&category).unwrap();
        let length = entries.len();

        // Perform 15 random matches to place the new item.
        for _i in 0..15 {
            let random_opponent = &mut entries[rng.gen_range(0..length)];

            perform_match(&mut entry, random_opponent);
        }

        self.categories.get_mut(&category).unwrap().push(entry);
    }

    // Write the contents of the model to a spreadsheet.
    pub fn save_to_spreadsheet(self, path: &str) {
        // Open the workbook for writing
        let workbook = Workbook::new(path).expect("Could not open spreadsheet for saving."); // Again send to GUI not print.

        // Create a new worksheet
        let mut sheet = workbook
            .add_worksheet(Some("Ranked"))
            .expect("Could not add a new worksheet to save results in."); // Same thing with GUI as above.

        let mut format = Format::new(); // Expand on this to really format everything the way I like it.
        format.set_font_size(24.0);
        format.set_bold();

        let mut column: u16 = 0;

        // Write the data
        for (name, entries) in self.categories {
            // Write Header
            let _ = sheet.write_string(0, column, &name, Some(&format));

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

// Perform one random match. Not sure yet how this will interact with GUI.
fn perform_match(entry1: &mut Entry, entry2: &mut Entry) {
    // Tell GUI what the match is and get the response back what the winner is.
    // Which item wins the matchup.
    let s_a: f64 = 0.0;
    let s_b: f64 = 0.0;

    // Expected gained/lost rating from the matchup.
    let e_a = 1.0 / (1.0 + f64::powf(10.0, (entry2.rating - entry1.rating) / 400.0));
    let e_b = 1.0 / (1.0 + f64::powf(10.0, (entry1.rating - entry2.rating) / 400.0));

    // Sensitivity factor.
    let k = 64.0;

    // Gain/lose elo.
    entry1.rating += k * (s_a - e_a);
    entry2.rating += k * (s_b - e_b);
}

fn get_icon(mut category: String, mut title: String) -> RgbaImage {
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

    RgbaImage::default()
}
