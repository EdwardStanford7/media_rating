mod app;
mod home_screen;
mod image_search;
mod image_store;
mod main_screen;
mod model;
mod popup;
mod ranking_screen;
mod splash_screen;

fn main() {
    let mut options = eframe::NativeOptions::default();
    options.viewport.resizable = Some(false);

    let _ = eframe::run_native(
        "Media Rating",
        options,
        Box::new(|_cc| Ok(Box::new(app::MediaRatingApp::default()))),
    );
}
