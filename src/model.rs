use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct Model {
    // Name of category mapped to vector of all entries in it.
    categories: HashMap<String, Vec<String>>,
}

impl Model {
    pub(crate) fn from_categories(categories: HashMap<String, Vec<String>>) -> Self {
        Self { categories }
    }

    pub fn categories(&self) -> impl Iterator<Item = (&str, &[String])> {
        self.categories
            .iter()
            .map(|(name, entries)| (name.as_str(), entries.as_slice()))
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
        let mut model = Model::default();
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
        let mut model = Model::default();
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
