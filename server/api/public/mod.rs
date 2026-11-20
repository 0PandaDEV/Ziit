pub mod badge_get;
pub mod leaderboard_get;
pub mod stats_get;

pub fn keep_warm() {
    leaderboard_get::LEADERBOARD.keep_warm();
    stats_get::STATS.keep_warm();
}
