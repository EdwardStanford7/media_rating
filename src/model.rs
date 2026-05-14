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
}

impl Model {
    // Create a new Model object.
    pub fn new() -> Model {
        Model {
            file_directory: String::new(),
            file_name: String::new(),
            categories: HashMap::new(),
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
            Err(e) => eprintln!("Could not save to spreadsheet: {e}"),
        }
    }

    // Make a new category.
    pub fn create_category(&mut self, category: String) {
        self.categories.insert(category, Vec::new());
    }

    // Delete a category.
    pub fn delete_category(&mut self, category: &str) {
        self.categories.remove(category);
    }

    // Get a vector of all categories.
    pub fn get_categories(&self) -> Vec<String> {
        let mut categories: Vec<String> = self.categories.keys().cloned().collect();
        categories.sort();
        categories
    }

    // Get a vector of all entries in a particular category.
    pub fn get_category_entries(&self, category: &str) -> &[String] {
        self.categories
            .get(category)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn contains_entry(&self, category: &str, entry: &str) -> bool {
        self.categories
            .get(category)
            .is_some_and(|entries| entries.iter().any(|existing| existing == entry))
    }

    pub fn insert_entry_at(&mut self, category: &str, entry: String, index: usize) {
        let entries = self.categories.get_mut(category).unwrap();
        if entries.contains(&entry) {
            return;
        }

        entries.insert(index.min(entries.len()), entry);
    }

    pub fn move_entry(&mut self, category: &str, from_index: usize, to_index: usize) {
        let entries = self.categories.get_mut(category).unwrap();
        if from_index >= entries.len() {
            return;
        }

        let entry = entries.remove(from_index);
        entries.insert(to_index.min(entries.len()), entry);
    }

    // Get an entry from a category by index.
    pub fn get_entry(&self, category: &str, index: usize) -> Option<&str> {
        self.categories
            .get(category)?
            .get(index)
            .map(String::as_str)
    }

    // Rename an entry in a category.
    pub fn rename_entry(
        &mut self,
        category: &str,
        index: usize,
        new_name: String,
    ) -> Option<String> {
        if let Some(entries) = self.categories.get_mut(category) {
            if index < entries.len() {
                let old_title = entries[index].clone();
                entries[index] = new_name;
                return Some(old_title);
            }
        }

        None
    }

    // Delete an entry from a category.
    pub fn delete_entry(&mut self, category: &str, index: usize) -> Option<String> {
        let entries = self.categories.get_mut(category)?;
        if index >= entries.len() {
            return None;
        }

        Some(entries.remove(index))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn category_entries(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|entry| entry.to_string()).collect()
    }

    #[test]
    fn insert_entry_at_clamps_to_category_bounds() {
        let mut model = Model::new();
        model.create_category("Movies:".to_string());

        model.insert_entry_at("Movies:", "A".to_string(), 99);
        model.insert_entry_at("Movies:", "B".to_string(), 0);

        assert_eq!(
            model.get_category_entries("Movies:"),
            category_entries(&["B", "A"]).as_slice()
        );
    }

    #[test]
    fn move_entry_uses_index_from_list_after_removal() {
        let mut model = Model::new();
        model.create_category("Movies:".to_string());
        model.insert_entry_at("Movies:", "A".to_string(), 0);
        model.insert_entry_at("Movies:", "B".to_string(), 1);
        model.insert_entry_at("Movies:", "C".to_string(), 2);

        model.move_entry("Movies:", 1, 2);

        assert_eq!(
            model.get_category_entries("Movies:"),
            category_entries(&["A", "C", "B"]).as_slice()
        );
    }
}
