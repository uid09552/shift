use std::time::Duration;

use chrono::{NaiveDateTime, Utc};

use crate::repository::domain::WishSettingsRepository;
use crate::repository::AppState;
use crate::services::audit_log;

/// Who the audit log names for changes made by the schedule.
const ACTOR: &str = "wish-schedule";

/// Checks every tenant's wish schedule once a minute and opens or closes the
/// window when a boundary has passed.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            run_once(&state, Utc::now().naive_utc()).await;
        }
    });
}

pub async fn run_once(state: &AppState, now: NaiveDateTime) {
    let scheduled = match state.wish_settings_repo.list_scheduled_wish_settings().await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Wish schedule: could not list tenants: {}", e);
            return;
        }
    };

    for (tenant_id, settings) in scheduled {
        let open = settings.schedule.is_open_at(now);
        if settings.schedule.applied_open == Some(open) {
            continue;
        }
        match state.wish_settings_repo.apply_scheduled_wish_state(&tenant_id, open).await {
            Ok(true) => {
                let mode = if open { "enabled" } else { "disabled" };
                let changes = serde_json::json!({ "mode": mode }).to_string();
                audit_log::record(
                    state,
                    &tenant_id,
                    Some(ACTOR.to_string()),
                    "wish_settings.schedule_apply",
                    "wish_settings",
                    Some(tenant_id.clone()),
                    Some(changes),
                )
                .await;
            }
            Ok(false) => {}
            Err(e) => eprintln!("Wish schedule: tenant {} failed: {}", tenant_id, e),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};

    use crate::repository::domain::{ScheduleUnit, WishScheduleDomain};

    fn at(date: &str, time: &str) -> NaiveDateTime {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap()
            .and_time(NaiveTime::parse_from_str(time, "%H:%M").unwrap())
    }

    fn schedule(unit: ScheduleUnit, interval: i32, open_days: i32, start: &str) -> WishScheduleDomain {
        WishScheduleDomain {
            enabled: true,
            unit,
            interval,
            open_days,
            start_date: NaiveDate::parse_from_str(start, "%Y-%m-%d").ok(),
            ..WishScheduleDomain::default()
        }
    }

    #[test]
    fn weekly_opens_on_the_weekday_for_open_days() {
        // Monday, every 2nd week from 2026-10-05, open 3 days.
        let s = schedule(ScheduleUnit::Weeks, 2, 3, "2026-10-05");
        assert!(!s.is_open_at(at("2026-10-04", "23:00")));
        assert!(s.is_open_at(at("2026-10-05", "00:00")));
        assert!(s.is_open_at(at("2026-10-07", "23:59")));
        assert!(!s.is_open_at(at("2026-10-08", "00:00")));
        assert!(!s.is_open_at(at("2026-10-12", "12:00")));
        assert!(s.is_open_at(at("2026-10-19", "12:00")));
    }

    #[test]
    fn monthly_day_is_clamped_to_the_month_end() {
        let mut s = schedule(ScheduleUnit::Months, 1, 1, "2026-01-01");
        s.day_of_month = 31;
        assert!(s.is_open_at(at("2026-02-28", "10:00")));
        assert!(!s.is_open_at(at("2026-02-27", "10:00")));
        assert!(s.is_open_at(at("2026-03-31", "10:00")));
    }

    #[test]
    fn daily_interval_counts_from_the_start_date() {
        let s = schedule(ScheduleUnit::Days, 3, 1, "2026-10-01");
        assert!(s.is_open_at(at("2026-10-01", "08:00")));
        assert!(!s.is_open_at(at("2026-10-02", "08:00")));
        assert!(s.is_open_at(at("2026-10-04", "08:00")));
    }

    #[test]
    fn nothing_opens_before_the_start_date_or_without_one() {
        assert!(!schedule(ScheduleUnit::Days, 1, 1, "2026-10-10").is_open_at(at("2026-10-09", "12:00")));
        assert!(!WishScheduleDomain::default().is_open_at(at("2026-10-09", "12:00")));
    }

    #[test]
    fn next_change_finds_the_following_boundary() {
        let s = schedule(ScheduleUnit::Weeks, 1, 3, "2026-10-05");
        assert_eq!(s.next_change(at("2026-10-06", "12:00")), Some((at("2026-10-08", "00:00"), false)));
        assert_eq!(s.next_change(at("2026-10-09", "12:00")), Some((at("2026-10-12", "00:00"), true)));
    }
}
