extern crate image_search;

use calamine::{open_workbook, DataType, Reader, Xlsx};
use rust_xlsxwriter::{Format, Workbook};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug)]
pub struct Model {
    file_directory: String,
    file_name: String,

    // Name of category mapped to vector of all entries in it.
    categories: HashMap<String, Vec<String>>,

    // Categories can be re-ranked as needed. This happens by iterating through the category and doing pairwise comparisons.
    // If this is Some then it is the category that is being ranked, the index of the entry in the category, and a boolean indicating if it is ascending or descending.
    ranking_category: Option<(String, usize, bool)>,

    // New entries are ranked by binary searching the sorted category and inserting the new entry in the correct position.
    // If this is Some then it is the category name, the new entry, and the current bounds of the binary search.
    ranking_new_entry: Option<(String, String, usize, usize)>,

    reranking_entry: Option<(String, usize, String)>,
}

impl Model {
    // Create a new Model object.
    pub fn new() -> Model {
        Model {
            file_directory: String::new(),
            file_name: String::new(),
            categories: HashMap::new(),
            ranking_category: None,
            ranking_new_entry: None,
            reranking_entry: None,
        }
    }

    // Read data from a spreadsheet.
    pub fn open_spreadsheet(&mut self, file_directory: String, file_name: String) -> bool {
        // Open a new workbook.
        let mut workbook: Xlsx<_> = open_workbook(file_directory.clone() + &file_name).unwrap();

        let sheet;
        if let Some(result) = workbook.worksheet_range_at(0) {
            sheet = result.unwrap();
        } else {
            return false;
        }

        let (height, width) = sheet.get_size();

        // Iterate over all the columns to check which ones hold category rankings.
        for column in 0..width {
            // Get the name of the category or skip if this column does not hold a category.
            let category_name = match sheet.get_value((0, column as u32)).unwrap().get_string() {
                Some(name) => name.to_string(),
                None => continue,
            };

            let mut category = Vec::new();

            // Iterate over the entries in this category.
            for row in 1..height {
                match sheet
                    .get_value((row as u32, column as u32))
                    .unwrap()
                    .get_string()
                {
                    Some(title) => {
                        // Insert the entry into the category.
                        category.push(title.to_string());
                    }
                    None => continue,
                }
            }

            self.categories.insert(category_name, category);
        }

        self.file_directory = file_directory;
        self.file_name = file_name;

        true
    }

    // Write the contents of the model to a spreadsheet.
    pub fn save_to_spreadsheet(&self) {
        // Open a new workbook.
        let mut workbook = Workbook::new();

        // Create a new worksheet
        let sheet = workbook.add_worksheet();
        let _ = sheet.set_name("Sorted".to_string());

        // If the spreadsheet has more than 5 categories, too bad.
        let binding = [
            rust_xlsxwriter::Color::RGB(0xd8bfd8),
            rust_xlsxwriter::Color::RGB(0x93ccea),
            rust_xlsxwriter::Color::RGB(0x90ee90),
            rust_xlsxwriter::Color::RGB(0xfed8b1),
            rust_xlsxwriter::Color::RGB(0xab0b23),
        ];
        let mut colors = (binding).iter();

        let separator_format = Format::new().set_background_color(rust_xlsxwriter::Color::Black);

        let _ = sheet.set_row_height(0, 30);

        let mut column: u16 = 0;
        // Write the data.
        for (name, entries) in &self.categories {
            let current_color = *colors.next().unwrap_or(&rust_xlsxwriter::Color::White);

            // Make entire category columns be one color with black column separator.
            let category_format = Format::new()
                .set_font_size(12.0)
                .set_background_color(current_color);
            let _ = sheet.set_column_format(column, &category_format);
            let _ = sheet.set_column_format(column + 1, &separator_format);
            let _ = sheet.set_column_width(column, 50.0);
            let _ = sheet.set_column_width(column + 1, 3.0);

            // Write Header
            let header_format = Format::new()
                .set_font_size(25.0)
                .set_bold()
                .set_background_color(current_color);
            let _ = sheet.write_string_with_format(0, column, name, &header_format);

            // Write category entries.
            let mut row: u32 = 1;
            for entry in entries {
                let _ = sheet.write_string_with_format(row, column, entry, &category_format);

                row += 1;
            }

            column += 2; // Move to the next category column.
        }

        // Save the workbook
        match workbook.save(Path::new(&(self.file_directory.clone() + &self.file_name))) {
            Ok(_result) => {}
            Err(e) => eprintln!("Could not save to spreadsheet: {}", e),
        }
    }

    // Make a new category.
    pub fn create_category(&mut self, category: String) {
        self.categories.insert(category, Vec::new());
    }

    // Delete a category.
    pub fn delete_category(&mut self, category: &String) {
        self.categories.remove(category);
    }

    // Get a vector of all categories.
    pub fn get_categories(&self) -> Vec<String> {
        self.categories.keys().cloned().collect()
    }

    // Get a vector of all entries in a particular category.
    pub fn get_category_entries(&self, category: &String) -> &Vec<String> {
        self.categories.get(category).unwrap()
    }

    // Get how many entries there are in a category.
    pub fn get_num_entries(&self, category: &String) -> usize {
        self.categories.get(category).unwrap().len()
    }

    // Check if the model is currently in a ranking mode.
    pub fn is_ranking(&self) -> bool {
        self.ranking_category.is_some() || self.ranking_new_entry.is_some()
    }

    // End the current ranking session.
    pub fn end_ranking(&mut self) {
        self.ranking_category = None;
        self.ranking_new_entry = None;

        if let Some((entry, position, category)) = &self.reranking_entry {
            self.categories
                .get_mut(category)
                .unwrap()
                .insert(*position, entry.clone());
        }
    }

    // UI calls this function to get the current match for ranking.
    pub fn get_current_match(&self) -> Option<(&str, usize, &str, usize)> {
        if let Some((category, index, _)) = &self.ranking_category {
            let entries = self.categories.get(category)?;
            if *index < entries.len() - 1 {
                let left_entry = &entries[*index];
                let right_entry = &entries[*index + 1];
                Some((left_entry, *index, right_entry, *index + 1))
            } else {
                None
            }
        } else if let Some((category, entry, lower, upper)) = &self.ranking_new_entry {
            let entries = self.categories.get(category)?;
            if lower < upper {
                let index = (lower + upper) / 2;
                let right_entry = &entries[index];
                Some((entry, entries.len(), right_entry, index))
            } else {
                None
            }
        } else {
            None
        }
    }

    // UI calls this function to report the winner of a match.
    pub fn report_match_winner(&mut self, left_won: bool) {
        // If ranking within a category, adjust the index of the current match.
        if let Some((category, index, is_ascending)) = &self.ranking_category {
            if !left_won {
                // Swap the two entries
                let entries = self.categories.get_mut(category).unwrap();
                entries.swap(*index, *index + 1);
            }

            if *is_ascending && *index < self.get_num_entries(category) - 1 {
                self.ranking_category = Some((category.clone(), index + 1, *is_ascending));
            } else if !*is_ascending && *index > 0 {
                self.ranking_category = Some((category.clone(), index - 1, *is_ascending));
            } else {
                self.ranking_category = None;
            }
        }
        // If ranking a new entry, adjust the bounds of the binary search. If the binary search is complete, add the new entry to the category and set ranking_new_entry to None.
        else if let Some((category, entry, lower, upper)) = &mut self.ranking_new_entry {
            if left_won {
                // If the left entry won, the new entry is less than the right entry.
                *upper = (*lower + *upper) / 2;
            } else {
                // If the right entry won, the new entry is greater than the left entry.
                *lower = (*lower + *upper) / 2 + 1;
            }

            // Check if the binary search is complete.
            if *lower >= *upper {
                let entries = self.categories.get_mut(category).unwrap();
                entries.insert(*lower, entry.clone());
                self.ranking_new_entry = None;
            }
        }
    }

    // Add a new entry to a category.
    pub fn add_entry(&mut self, entry: String, category: &String) {
        let entries = self.categories.get_mut(category).unwrap();
        if entries.is_empty() {
            // If the category is empty, only add the entry if it's not already present.
            entries.push(entry);
            return;
        }

        if entries.contains(&entry) {
            return;
        }

        self.ranking_new_entry = Some((category.clone(), entry, 0, self.get_num_entries(category)));
        self.ranking_category = None; // Safety.
    }

    // Re rank an entry in a category (delete and re add).
    pub fn rerank_entry(&mut self, entry: String, position: usize, category: &String) {
        // Store entry and remove it from the list.
        self.reranking_entry = Some((entry.clone(), position, category.clone()));
        self.categories.get_mut(category).unwrap().remove(position);

        // Re add entry through normal process.
        self.add_entry(entry, category);
    }

    // Rerank a random entry.
    pub fn rerank_random_entry(&mut self) {
        // Get random category
        // Query google for a star rating of entries to find some entry that is theoretically out of place according to the public.
        // Entries could be books, video games, movies, or tv shows. Not sure if there is a uniform way to get the google rating for everything.
        // Theoretically google just displays a star rating for just searching the entry.

        // Rerank that entry.
    }

    // Get an entry from a category by index.
    pub fn get_entry(&self, category: &String, index: usize) -> String {
        self.categories
            .get(category)
            .unwrap()
            .get(index)
            .unwrap()
            .clone()
    }

    // Rename an entry in a category.
    pub fn rename_entry(&mut self, category: &String, index: usize, new_name: String) {
        if let Some(entries) = self.categories.get_mut(category) {
            if index < entries.len() {
                entries[index] = new_name;
            }
        }
    }

    // Delete an entry from a category.
    pub fn delete_entry(&mut self, category: &String, index: usize) {
        self.categories.get_mut(category).unwrap().remove(index);
    }

    // Rank a category.
    pub fn rank_category(&mut self, category: String, is_ascending: bool) {
        self.ranking_category = Some((
            category.clone(),
            if is_ascending {
                0
            } else {
                self.get_num_entries(&category) - 2
            },
            is_ascending,
        ));
        self.ranking_new_entry = None; // Safety.
    }
}
