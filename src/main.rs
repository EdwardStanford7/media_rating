mod model;
use console::Term;
use model::Model;
use std::{collections::HashMap, io};

fn main() {
    println!("Welcome to the Media Rating Machine!.");
    println!("Enter the path to the spreadsheet to load/save data to/from.");
    let mut path = String::new();
    let _ = io::stdin().read_line(&mut path);
    path = path.trim().to_string();

    let mut model = Model::new(&path);

    println!("Would you like to re-rank everything? (y/n)");
    let answer = Term::stdout().read_char().unwrap();

    if answer == 'y' {
        model.rerank_all_categories();
    }

    loop {
        println!("Would you like to add a rating? (y/n)");
        let answer = Term::stdout().read_char().unwrap();

        if answer == 'y' {
            // Get the category from the user.

            // Print out the options.
            let mut mappings: HashMap<char, String> = HashMap::new();
            println!("What category will you be adding a rating to? (Enter a number)");
            for (index, category) in model.get_categories().iter().enumerate() {
                println!("{}. {}", index + 1, category);
                mappings.insert(((index + 1) as u8 + b'0') as char, category.to_string());
            }

            // Get the user's choice.
            let category;
            loop {
                let result: char = Term::stdout().read_char().unwrap();

                // Try to get the key from mappings.
                match mappings.get(&result) {
                    Some(key) => {
                        category = key.clone();
                        break;
                    }
                    None => {
                        println!("That is not a valid option.");
                    }
                }
            }

            // Get item to rank.
            println!("Enter the name of the media you would like to rank:");
            let mut title = String::new();
            let _ = io::stdin().read_line(&mut title);
            title = title.trim().to_string();
            model.add_new_entry(title, category);
        } else if answer == 'n' {
            break;
        } else {
            println!("Invalid answer");
        }
    }

    model.save_to_spreadsheet(&path);
}
