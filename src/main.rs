use calamine::{open_workbook, DataType, Reader, Xlsx};
use console::Term;
use rand::Rng;
use std::{
    collections::HashMap,
    io::{self},
};
use xlsxwriter::*;

#[derive(Debug)]
struct Category {
    name: String,
    items: Vec<String>,
    ratings: Vec<i64>,
}

fn main() {
    println!("Welcome to the Media Rating Machine!.");
    println!("Enter the path to the spreadsheet to load/save data to/from.");
    let mut path = String::new();
    let _ = io::stdin().read_line(&mut path);
    path = path.trim().to_string();

    // Organize the ratings into categories.
    // Index of spreadsheet column where the ratings were mapped to hashmap of media/rating pairs.
    let mut categories = read_spreadsheet(&path);

    println!("Would you like to re-rank everything? (y/n)");
    let answer = Term::stdout().read_char().unwrap();

    if answer == 'y' {
        rerank_categories(&mut categories);
    }

    loop {
        println!("Would you like to add a rating? (y/n)");
        let answer = Term::stdout().read_char().unwrap();

        if answer == 'y' {
            add_rating(&mut categories);
        } else if answer == 'n' {
            break;
        } else {
            println!("Invalid answer");
        }
    }

    save_spreadsheet(&path, &mut categories);
}

fn read_spreadsheet(path: &str) -> HashMap<usize, Category> {
    // opens a new workbook
    let mut workbook: Xlsx<_> = open_workbook(path).expect("Cannot open file");

    // Organize the ratings into categories.
    // Index of spreadsheet column where the ratings were mapped to paired vectors of item/rating pairs.
    let mut categories: HashMap<usize, Category> = HashMap::new();

    let range = workbook
        .worksheet_range_at(0)
        .expect("xlsx file has no sheets in it.")
        .unwrap();

    let mut rows = range.rows();

    if let Some(header_row) = rows.next() {
        for (index, header) in header_row.iter().enumerate() {
            if !header.is_empty() {
                categories.insert(
                    index,
                    Category {
                        name: header.as_string().unwrap(),
                        items: Vec::new(),
                        ratings: Vec::new(),
                    },
                );
            }
        }
    }

    for row in rows {
        let mut item = String::new();

        for (index, cell) in row.iter().enumerate() {
            if let Some(s) = cell.get_string() {
                item = s.to_string();
            } else if !item.is_empty() {
                if let Some(value) = cell
                    .get_int()
                    .or_else(|| cell.get_float().map(|f| f as i64))
                {
                    if let Some(category) = categories.get_mut(&(index - 1)) {
                        category.items.push(item.clone());
                        category.ratings.push(value * 100);
                    } else {
                        eprintln!("Warning: Unexpected column index {}", index - 1);
                    }
                }
            }
        }
    }

    categories
}

fn rerank_categories(categories: &mut HashMap<usize, Category>) {
    let mut rng = rand::thread_rng();

    // Rerank each category separately.
    for category in categories.values_mut() {
        assert!(category.items.len() == category.ratings.len());
        let num_rankings = category.items.len();

        println!("Ranking category {}", category.name);

        // Estimated runtime for accurate rankings is NlogN so instead of coding complicated ending conditions just do that many matchups.
        for _i in 0..category.items.len() * (f64::log2(num_rankings as f64) as usize) {
            let random_item_1 = rng.gen_range(0..num_rankings);
            let mut random_item_2;

            // Make sure we don't match something against itself.
            loop {
                random_item_2 = rng.gen_range(0..num_rankings);
                if random_item_2 != random_item_1 {
                    break;
                }
            }

            perform_match(category, random_item_1, random_item_2);
        }
    }
}

fn perform_match(category: &mut Category, random_item_1: usize, random_item_2: usize) {
    println!(
        "Which item wins? (type 1 or 2)\t{} vs. {}",
        category.items[random_item_1], category.items[random_item_2]
    );

    // Initial start rating of the two items.
    let r_a = category.ratings[random_item_1] as f64;
    let r_b = category.ratings[random_item_2] as f64;

    // Expected gained/lost rating from the matchup.
    let e_a = 1.0 / (1.0 + f64::powf(10.0, (r_b - r_a) / 400.0));
    let e_b = 1.0 / (1.0 + f64::powf(10.0, (r_a - r_b) / 400.0));

    // Which item wins the matchup.
    let s_a: f64;
    let s_b: f64;

    // Sensitivity factor.
    let k = 64.0;

    // Check who wins the matchup.
    loop {
        let result: char = Term::stdout().read_char().unwrap();
        if result == '1' {
            s_a = 1.0;
            s_b = 0.0;
            break;
        } else if result == '2' {
            s_a = 0.0;
            s_b = 1.0;
            break;
        }
    }

    // Gain/lose elo.
    category.ratings[random_item_1] = (r_a + k * (s_a - e_a)) as i64;
    category.ratings[random_item_2] = (r_b + k * (s_b - e_b)) as i64;
}

fn reset_ratings(category: &mut Category) {
    sort_category(category);

    // The distribution of ratings
    let distribution = [0.02, 0.07, 0.19, 0.33, 0.23, 0.11, 0.05];
    let total_items = category.items.len();

    // Calculate the number of each rating to assign
    let mut counts = distribution
        .iter()
        .map(|&p| (p * total_items as f64).round() as usize)
        .collect::<Vec<_>>();

    // Adjust counts to ensure the total is correct
    let sum: usize = counts.iter().sum();
    let mut diff = total_items as isize - sum as isize;
    let mut i = 0;

    while diff != 0 {
        if diff > 0 {
            counts[i] += 1;
            diff -= 1;
        } else {
            counts[i] -= 1;
            diff += 1;
        }
        i = (i + 1) % counts.len();
    }

    // Assign the new ratings
    let mut new_ratings = Vec::new();
    for (i, &count) in counts.iter().enumerate() {
        for _ in 0..count {
            new_ratings.push((i + 1) as i64);
        }
    }

    // Replace the old ratings with the new ones
    category.ratings = new_ratings;
}

fn sort_category(category: &mut Category) {
    // Zip the vectors together
    let mut pairs: Vec<_> = category
        .items
        .iter()
        .cloned()
        .zip(category.ratings.iter().copied())
        .collect();

    // Sort the pairs based on the second element (originally from ratings)
    pairs.sort_by(|a, b| a.1.cmp(&b.1));

    // Clear the original vectors
    category.items.clear();
    category.ratings.clear();

    // Unzip the pairs back into the original vectors
    for (item, rating) in pairs {
        category.items.push(item);
        category.ratings.push(rating);
    }
}

fn add_rating(categories: &mut HashMap<usize, Category>) {
    // Get the category from the user.

    // Print out the options.
    let mut mappings: HashMap<char, usize> = HashMap::new();
    println!("What category will you be adding a rating to? (Enter a number)");
    for (index, category) in categories.iter_mut().enumerate() {
        println!("{}. {}", index + 1, category.1.name);
        mappings.insert(((index + 1) as u8 + b'0') as char, *category.0);
    }

    // Get the user's choice.
    let choice: usize;
    loop {
        let result: char = Term::stdout().read_char().unwrap();

        // Try to get the key from mappings.
        match mappings.get(&result) {
            Some(key) => {
                choice = *key;
                break;
            }
            None => {
                println!("That is not a valid option.");
            }
        }
    }
    let category = categories.get_mut(&choice).unwrap();

    // Get item to rank.
    println!("Enter the name of the media you would like to rank:");
    let mut item = String::new();
    let _ = io::stdin().read_line(&mut item);
    item = item.trim().to_string();

    // Add the item to the category.
    category.items.push(item);
    category.ratings.push(400); // Start new item at average rating.
    let new_item = category.items.len() - 1;

    // Perform 15 random matches to place the new item.
    let mut rng = rand::thread_rng();
    for _i in 0..15 {
        let mut random_opponent;

        // Make sure we don't match something against itself.
        loop {
            random_opponent = rng.gen_range(0..category.items.len());
            if random_opponent != new_item {
                break;
            }
        }

        perform_match(category, new_item, random_opponent);
    }
}

fn save_spreadsheet(path: &str, categories: &mut HashMap<usize, Category>) {
    // Open the workbook for writing
    let workbook = Workbook::new(path).expect("Could not open spreadsheet for saving.");

    // Create a new worksheet
    let mut sheet = workbook
        .add_worksheet(Some("Ranked"))
        .expect("Could not add a new worksheet to save results in.");

    let mut format = Format::new();
    format.set_font_size(24.0);
    format.set_bold();

    // Write the data
    for (column, category) in categories {
        reset_ratings(category);

        // Write Header
        let _ = sheet.write_string(0, *column as u16, &category.name, Some(&format));

        for (mut row, (item, rating)) in category.items.iter().zip(&category.ratings).enumerate() {
            row += 1;
            let _ = sheet.write_string(row as u32, *column as u16, item, None);
            let _ = sheet.write_number(row as u32, *column as u16 + 1, *rating as f64, None);
        }
    }

    // Save the workbook
    let _ = workbook.close();
}
