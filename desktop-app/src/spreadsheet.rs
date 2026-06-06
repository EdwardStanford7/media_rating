use calamine::{open_workbook, DataType, Reader, Xlsx};
use rust_xlsxwriter::{Format, Workbook};
use std::{collections::HashMap, path::Path};

use crate::model::Model;

pub fn create_empty(path: &Path) -> Result<(), String> {
    let mut workbook = Workbook::new();
    workbook.save(path).map_err(|e| e.to_string())
}

pub fn load(path: &Path) -> Result<Model, String> {
    let mut workbook: Xlsx<_> = open_workbook::<Xlsx<_>, _>(path).map_err(|e| e.to_string())?;
    let sheet = workbook
        .worksheet_range_at(0)
        .ok_or_else(|| "Spreadsheet has no sheets".to_string())?
        .map_err(|e| e.to_string())?;

    let (height, width) = sheet.get_size();
    let mut categories = HashMap::new();

    for column in 0..width {
        let Some(category_name) = sheet
            .get_value((0, column as u32))
            .and_then(|cell| cell.get_string())
        else {
            continue;
        };

        let mut entries = Vec::new();
        for row in 1..height {
            if let Some(title) = sheet
                .get_value((row as u32, column as u32))
                .and_then(|cell| cell.get_string())
            {
                entries.push(title.to_string());
            }
        }

        categories.insert(category_name.to_string(), entries);
    }

    Ok(Model::from_categories(categories))
}

pub fn save(path: &Path, model: &Model) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("Sorted").map_err(|e| e.to_string())?;

    let colors = [
        rust_xlsxwriter::Color::RGB(0xd8bfd8),
        rust_xlsxwriter::Color::RGB(0x93ccea),
        rust_xlsxwriter::Color::RGB(0x90ee90),
        rust_xlsxwriter::Color::RGB(0xfed8b1),
        rust_xlsxwriter::Color::RGB(0xab0b23),
    ];
    let mut colors = colors.iter();

    let separator_format = Format::new().set_background_color(rust_xlsxwriter::Color::Black);
    sheet.set_row_height(0, 30).map_err(|e| e.to_string())?;

    let mut categories: Vec<_> = model.categories().collect();
    categories.sort_by(|(left, _), (right, _)| left.cmp(right));

    let mut column: u16 = 0;
    for (name, entries) in categories {
        let current_color = *colors.next().unwrap_or(&rust_xlsxwriter::Color::White);

        let category_format = Format::new()
            .set_font_size(12.0)
            .set_background_color(current_color);
        sheet
            .set_column_format(column, &category_format)
            .map_err(|e| e.to_string())?;
        sheet
            .set_column_format(column + 1, &separator_format)
            .map_err(|e| e.to_string())?;
        sheet
            .set_column_width(column, 50.0)
            .map_err(|e| e.to_string())?;
        sheet
            .set_column_width(column + 1, 3.0)
            .map_err(|e| e.to_string())?;

        let header_format = Format::new()
            .set_font_size(25.0)
            .set_bold()
            .set_background_color(current_color);
        sheet
            .write_string_with_format(0, column, name, &header_format)
            .map_err(|e| e.to_string())?;

        for (row, entry) in entries.iter().enumerate() {
            sheet
                .write_string_with_format((row + 1) as u32, column, entry, &category_format)
                .map_err(|e| e.to_string())?;
        }

        column += 2;
    }

    workbook.save(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs};

    #[test]
    fn save_and_load_round_trips_categories() {
        let path = env::temp_dir().join(format!(
            "media-rating-spreadsheet-test-{}.xlsx",
            std::process::id()
        ));

        let mut model = Model::default();
        model.create_category("Movies:".to_string());
        model.insert_entry_at("Movies:", "Arrival".to_string(), 0);
        model.insert_entry_at("Movies:", "Alien".to_string(), 1);

        save(&path, &model).unwrap();
        let loaded = load(&path).unwrap();

        assert_eq!(
            loaded.get_category_entries("Movies:"),
            ["Arrival".to_string(), "Alien".to_string()].as_slice()
        );

        fs::remove_file(path).ok();
    }
}
