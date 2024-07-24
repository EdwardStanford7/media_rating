extern crate image_search;

use calamine::{open_workbook, DataType, Reader, Xlsx};
use egui::ColorImage;
use image::{self};
use image_search::{blocking::urls, Arguments};
use rand::Rng;
use rust_xlsxwriter::{Format, Workbook};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;

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
        let k = 64.0;

        // Update ratings
        let new_rating1 = (entry1_rating + k * (s_a - e_a)).round();
        let new_rating2 = (entry2_rating + k * (s_b - e_b)).round();

        // Clamp the new ratings between 50 and 750
        self.categories.get_mut(&category).unwrap()[entry1_index].rating =
            new_rating1.clamp(50.0, 749.0);
        self.categories.get_mut(&category).unwrap()[entry2_index].rating =
            new_rating2.clamp(50.0, 749.0);
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
            let _ = sheet.set_column_width(column, 40.0);
            let _ = sheet.set_column_width(column + 1, 1.5);
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
                let _ = sheet.write_number_with_format(
                    row,
                    column + 1,
                    (entry.rating / 100.0).round(),
                    &category_format,
                );

                row += 1;
            }

            column += 3;
        }

        // Save the workbook
        let _ = workbook.save(Path::new(&self.filepath));
    }
}

pub fn get_icon(category: String, mut title: String) -> ColorImage {
    // Remove any extra information from the title stored in the spreadsheet.
    if let Some(index) = title.find('(') {
        title.truncate(index);
    }
    title = title.trim().to_string();

    // Default to placeholder image.
    let mut img_bytes = vec![0u8; 380 * 400 * 4]; //     380x400, RGBA placeholder, all black

    // Construct the local file path.
    let file_name = format!("./images/{} {}.png", title, category);
    let file_path = Path::new(&file_name);

    // Check local files first for saved image.
    if file_path.exists() {
        println!("Image found locally: {}", file_name);
        if let Ok(image) = image::open(file_path) {
            img_bytes = image.to_rgba8().to_vec();
            return ColorImage::from_rgba_unmultiplied([380, 400], &img_bytes);
        } else {
            eprintln!("Error loading local image");
        }
    }

    // Image was not cached locally, build query request.
    let args =
        Arguments::new(&format!("{} {}", title, category), 4).ratio(image_search::Ratio::Tall);
    let url_result = urls(args);

    // Attempt to download image from urls.
    if let Ok(urls) = url_result {
        for url in urls {
            println!("Attempting url...");
            match reqwest::blocking::get(url) {
                Ok(response) => match response.bytes() {
                    Ok(bytes) => {
                        // Decode image and resize to 380x400
                        if let Ok(image) = image::load_from_memory(&bytes) {
                            let resized_image = image.resize_exact(
                                380,
                                400,
                                image::imageops::FilterType::CatmullRom,
                            );
                            img_bytes = resized_image.to_rgba8().to_vec();

                            // Cache the resized image locally.
                            if let Err(e) = resized_image.save(file_path) {
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

    ColorImage::from_rgba_unmultiplied([380, 400], &img_bytes)
}
