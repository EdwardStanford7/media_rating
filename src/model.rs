extern crate image_search;

use calamine::{open_workbook, DataType, Reader, Xlsx};
use egui::ColorImage;
use image::{self};
use image_search::{blocking::urls, Arguments};
use rand::Rng;
use rust_xlsxwriter::{Format, Workbook};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug)]
pub struct Model {
    file_directory: String,
    file_name: String,

    // Name of category mapped to vector of all entries in it.
    categories: HashMap<String, Vec<Entry>>,
    // Category and the indexes of the two entries in the match.
    current_match: Option<(String, usize, usize)>,
    // Current new entry being ranked. Used when you want one entry to be in all matches.
    ranking_entry: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub title: String,
    pub rating: f64,
    pub image: ColorImage,
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.rating == other.rating && self.title == other.title
    }
}

impl Eq for Entry {}

impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .rating
            .partial_cmp(&self.rating)
            .unwrap_or(Ordering::Equal)
            .then_with(|| self.title.cmp(&other.title))
    }
}

impl Model {
    // Create a new Model object.
    pub fn new() -> Model {
        Model {
            file_directory: String::new(),
            file_name: String::new(),
            categories: HashMap::new(),
            current_match: None,
            ranking_entry: None,
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
                                        rating,
                                        image: get_image(
                                            current_category.clone(),
                                            title.to_owned(),
                                            file_directory.clone(),
                                        ),
                                    });
                            }
                            None => continue,
                        }
                    }
                    None => continue,
                }
            }
        }

        self.file_directory = file_directory;
        self.file_name = file_name;

        true
    }

    // Make a new category.
    pub fn create_category(&mut self, category: String) {
        self.categories.insert(category, Vec::new());
    }

    // Delete a category.
    pub fn delete_category(&mut self, category: &String) {
        self.categories.remove(category);
    }

    // Return all categories that are currently in the Model.
    pub fn get_categories(&self) -> Vec<String> {
        self.categories.keys().cloned().collect()
    }

    // Get the title of a random category from all the categories.
    pub fn get_rand_category(&mut self) -> String {
        let categories = self.get_categories();
        let mut rng = rand::thread_rng();
        categories[rng.gen_range(0..categories.len())].clone()
    }

    // Get a vector of all entries in a particular category.
    pub fn get_category_entries(&self, category: &String) -> &Vec<Entry> {
        self.categories.get(category).unwrap()
    }

    // Get how many entries there are in a category.
    pub fn get_num_entries(&self, category: &String) -> usize {
        self.categories.get(category).unwrap().len()
    }

    // Set the current match that is being displayed. Choose 1 or 2 random entries depending on whether a new entry is being ranked or not.
    pub fn set_current_match(&mut self, category: &String) {
        let mut rng = rand::thread_rng();
        let entries = self.categories.get_mut(category).unwrap();
        let length = entries.len();

        let entry1;
        let mut entry2;

        if let Some(new_entry) = self.ranking_entry {
            entry1 = new_entry;
        } else {
            entry1 = rng.gen_range(0..length);
        }

        // Match entries against others with similar elo.
        let num_entries = self.get_num_entries(category);
        loop {
            let range = (num_entries / 10) + 1;
            let lower = (entry1 as i32 - range as i32).max(0) as usize; // Prevent unsigned underflow here.
            let upper = (entry1 + range + 1).min(length);
            entry2 = rng.gen_range(lower..upper);
            if entry2 != entry1 {
                break;
            }
        }

        self.current_match = Some((category.to_string(), entry1, entry2));
    }

    // Get the current match.
    pub fn get_current_match(&mut self) -> Option<(&mut Entry, &mut Entry, &String)> {
        match &self.current_match {
            Some((category, entry1_index, entry2_index)) => {
                let category_entries = self.categories.get_mut(category)?;

                // Get 2 mutable references at once.
                let (entry1, entry2) = if entry1_index < entry2_index {
                    let (left, right) = category_entries.split_at_mut(*entry2_index);
                    (&mut left[*entry1_index], &mut right[0])
                } else {
                    let (left, right) = category_entries.split_at_mut(*entry1_index);
                    (&mut right[0], &mut left[*entry2_index])
                };

                Some((entry1, entry2, category))
            }
            None => None,
        }
    }

    // Update the elo of the current match entries based on the winner.
    pub fn calculate_current_match(&mut self, winner: usize) {
        let (category_name, entry1_index, entry2_index) = self.current_match.clone().unwrap();
        let category = self.categories.get_mut(&category_name).unwrap();

        let entry1_rating = category[entry1_index].rating;
        let entry2_rating = category[entry2_index].rating;

        let (s_a, s_b) = if winner == 1 { (1.0, 0.0) } else { (0.0, 1.0) };

        // Expected score for each player
        let e_a = 1.0 / (1.0 + f64::powf(10.0, (entry2_rating - entry1_rating) / 400.0));
        let e_b = 1.0 - e_a;

        // Sensitivity factor.
        let k = 20.0;

        // Update ratings
        category[entry1_index].rating = (entry1_rating + k * (s_a - e_a)).round();
        category[entry2_index].rating = (entry2_rating + k * (s_b - e_b)).round();

        if let Some(original_position) = self.ranking_entry {
            let value = category[original_position].clone();
            category.sort();
            self.ranking_entry = Some(category.binary_search(&value).ok().unwrap());
        } else {
            category.sort();
        }
    }

    // Reset current match to empty.
    pub fn clear_current_match(&mut self) {
        self.current_match = None;
    }

    // Add a new entry to a category.
    pub fn add_entry(&mut self, entry: Entry, category: String) -> usize {
        let category = self.categories.get_mut(&category).unwrap();

        let mut position = 0;

        // Find the position to insert the entry at.
        for (index, existing_entry) in category.iter().enumerate() {
            if entry.rating <= existing_entry.rating {
                position = index + 1;
            }

            // Don't allow duplicates.
            if entry.title == existing_entry.title {
                return index;
            }
        }

        category.insert(position, entry);
        position
    }

    // Get an entry from a category.
    pub fn get_entry(&mut self, category: &String, index: usize) -> &mut Entry {
        &mut self.categories.get_mut(category).unwrap()[index]
    }

    // Delete an entry from a category.
    pub fn delete_entry(&mut self, category: &String, index: usize) {
        self.categories.get_mut(category).unwrap().remove(index);
    }

    // Set what the current entry being ranked is.
    pub fn set_ranking_entry(&mut self, index: usize) {
        self.ranking_entry = Some(index);
    }

    // Reset the index of the new entry being ranked to None.
    pub fn clear_new_entry(&mut self) {
        self.ranking_entry = None;
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
            let _ = sheet.set_column_format(column + 1, &category_format);
            let _ = sheet.set_column_format(column + 2, &separator_format);
            let _ = sheet.set_column_width(column, 50.0);
            let _ = sheet.set_column_width(column + 1, 4);
            let _ = sheet.set_column_width(column + 2, 7.0);

            // Write Header
            let header_format = Format::new()
                .set_font_size(25.0)
                .set_bold()
                .set_background_color(current_color);
            let _ = sheet.write_string_with_format(0, column, name, &header_format);

            // Write the category from best to worst.
            let mut entries_sorted = entries.clone();
            entries_sorted.sort();

            // Write category entries.
            let mut row: u32 = 1;
            for entry in entries_sorted {
                let _ = sheet.write_string_with_format(row, column, &entry.title, &category_format);
                let _ =
                    sheet.write_number_with_format(row, column + 1, entry.rating, &category_format);

                row += 1;
            }

            column += 3;
        }

        // Save the workbook
        match workbook.save(Path::new(&(self.file_directory.clone() + &self.file_name))) {
            Ok(_result) => {}
            Err(e) => eprintln!("Could not save to spreadsheet: {}", e),
        }
    }
}

pub fn get_image(mut category: String, mut title: String, file_directory: String) -> ColorImage {
    // Remove any extra information from the title and category stored in the spreadsheet.
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title = title.trim().to_string();
    category.pop();

    // Default to placeholder image.
    let mut img_bytes = vec![0u8; 380 * 475 * 4]; //     380x475, RGBA placeholder, all black

    // Construct the file path.
    let binding = format!("{}images/{} {}.png", file_directory, title, category);
    let full_path = Path::new(&binding);

    // Check local files first for saved image.
    if let Ok(image) = image::open(full_path) {
        img_bytes = image.to_rgba8().to_vec();
        return ColorImage::from_rgba_unmultiplied([380, 475], &img_bytes);
    }

    // Image was not cached locally, build query request.
    let args =
        Arguments::new(&format!("{} {}", title, category), 4).ratio(image_search::Ratio::Tall);
    let url_result = urls(args);

    // Attempt to download image from urls.
    if let Ok(urls) = url_result {
        for url in urls {
            match reqwest::blocking::get(url) {
                Ok(response) => match response.bytes() {
                    Ok(bytes) => {
                        // Decode image and resize to 380x475
                        if let Ok(image) = image::load_from_memory(&bytes) {
                            let resized_image = image.resize_exact(
                                380,
                                475,
                                image::imageops::FilterType::CatmullRom,
                            );
                            img_bytes = resized_image.to_rgba8().to_vec();

                            // Cache the resized image locally.
                            if let Err(e) = resized_image.save(full_path) {
                                eprintln!("Error saving image locally: {}", e);
                            }
                            break;
                        } else {
                            eprintln!("Error decoding image data");
                        }
                    }
                    Err(e) => eprintln!("Error reading bytes from response: {}", e),
                },
                Err(e) => eprintln!("Error fetching URL: {}", e),
            }
        }
    } else {
        eprintln!("Error fetching URLs: {}", url_result.err().unwrap());
    }

    ColorImage::from_rgba_unmultiplied([380, 475], &img_bytes)
}

pub fn delete_image(mut category: String, mut title: String, file_directory: String) {
    // Remove any extra information from the title and category stored in the spreadsheet.
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title = title.trim().to_string();
    category.pop();

    // Construct the file path.
    let binding = format!("{}images/{} {}.png", file_directory, title, category);
    let full_path = Path::new(&binding);

    match fs::remove_file(full_path) {
        Ok(_) => eprintln!("Image deleted successfully."),
        Err(e) => eprintln!("Error deleting image: {}", e),
    }
}
