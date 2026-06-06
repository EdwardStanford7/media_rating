use crate::{home_screen::HomeScreen, ranking_screen::RankingScreen, splash_screen::SplashScreen};

pub enum ScreenState {
    Splash(SplashScreen),
    Home(HomeScreen),
    Ranking {
        ranking: RankingScreen,
        home: Box<HomeScreen>,
    },
}

impl ScreenState {
    pub fn placeholder() -> Self {
        Self::Splash(SplashScreen)
    }
}
