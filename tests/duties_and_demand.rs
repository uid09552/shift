//! End-to-end tests for duty types and call-ins, long-term fairness inputs,
//! staffing demand by hour, what-if scenarios and the capacity forecast.
//!
//! Needs PostgreSQL (`DATABASE_URL`, or the development default); without one
//! the tests print a notice and pass.

mod common;
mod roster_support;

use chrono::NaiveDate;
use diesel::prelude::*;
use diesel::sql_types::{Array, Text, Uuid as SqlUuid};
use serde_json::{json, Value};
use uuid::Uuid;

use roster_support::{day, TestApp};

macro_rules! app {
    ($label:expr) => {
        match TestApp::spawn($label).await {
            Some(app) => app,
            None => return,
        }
    };
}

/// A ward running Early and Late every day; Anna and Ben may work both.
fn ward(app: &TestApp) -> Uuid {
    let mut conn = app.pool.get().unwrap();
    let id = Uuid::new_v4();
    diesel::sql_query(
        "INSERT INTO workstations (id, name, available, active_shift_ids, priority, min_employees, tenant_id)
         VALUES ($1, 'Ward', true, $2, 'medium', 1, $3)",
    )
    .bind::<SqlUuid, _>(id)
    .bind::<Array<SqlUuid>, _>(vec![app.early, app.late])
    .bind::<Text, _>(&app.tenant)
    .execute(&mut conn)
    .unwrap();
    for (shift, start, end) in [(app.early, "06:00", "14:00"), (app.late, "20:00", "06:00")] {
        diesel::sql_query(
            "INSERT INTO shift_weekday_times (shift_id, weekday, start_time, end_time, min_employees, tenant_id)
             SELECT $1, wd, $2::time, $3::time, 1, $4 FROM generate_series(0, 6) AS wd",
        )
        .bind::<SqlUuid, _>(shift)
        .bind::<Text, _>(start)
        .bind::<Text, _>(end)
        .bind::<Text, _>(&app.tenant)
        .execute(&mut conn)
        .unwrap();
        for person in [app.anna.id, app.ben.id] {
            diesel::sql_query("INSERT INTO employee_available_shifts (employee_id, shift_id, tenant_id) VALUES ($1, $2, $3)")
                .bind::<SqlUuid, _>(person)
                .bind::<SqlUuid, _>(shift)
                .bind::<Text, _>(&app.tenant)
                .execute(&mut conn)
                .unwrap();
        }
    }
    id
}

fn cleanup(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    for table in [
        "workstation_demand",
        "on_call_call_ins",
        "optimized_shift_results",
        "planning_tasks",
        "employee_personal_limits",
        "employee_available_shifts",
        "shift_weekday_times",
        "workstations",
    ] {
        let _ = diesel::sql_query(format!("DELETE FROM {table} WHERE tenant_id = $1"))
            .bind::<Text, _>(&app.tenant)
            .execute(&mut conn);
    }
    drop(conn);
    app.cleanup();
}

fn employee<'a>(input: &'a Value, id: Uuid) -> &'a Value {
    input["employees"].as_array().unwrap().iter().find(|e| e["id"] == id.to_string()).unwrap()
}

async fn prepare(app: &TestApp, from: NaiveDate, to: NaiveDate) -> Value {
    let (status, input) = app
        .post("/planner/prepare", &app.planner(), Some(json!({"start_date": from, "end_date": to})), None)
        .await;
    assert_eq!(status, 200, "{input}");
    input
}

#[tokio::test]
async fn on_call_duties_limits_and_call_ins_reach_the_planner() {
    let app = app!("duties");
    ward(&app);

    // Late becomes an on-call duty.
    let (status, shift) = app.put(&format!("/shifts/{}", app.late), &app.planner(), json!({"duty_type": "on_call"}), None).await;
    assert_eq!((status, shift["duty_type"].as_str()), (200, Some("on_call")), "{shift}");
    let (status, _) = app.put(&format!("/shifts/{}", app.late), &app.planner(), json!({"duty_type": "nap"}), None).await;
    assert_eq!(status, 400);

    let (status, limits) = app
        .put(&format!("/employees/{}/personal-limits", app.anna.id), &app.planner(), json!({"max_on_call_per_month": 3}), None)
        .await;
    assert_eq!((status, limits["max_on_call_per_month"].as_i64()), (200, Some(3)), "{limits}");

    // Anna was on call yesterday and was called in for 90 minutes; Ben worked Early.
    let yesterday = day(-1);
    app.roster(app.anna.id, yesterday, Some(app.late));
    app.roster(app.ben.id, yesterday, Some(app.early));
    let call_in = json!({"employee_id": app.anna.id, "date": yesterday, "minutes": 90, "note": "ER"});
    let (status, _) = app.put("/call-ins", &app.viewer(&app.anna), call_in.clone(), None).await;
    assert_eq!(status, 403);
    let (status, saved) = app.put("/call-ins", &app.planner(), call_in, None).await;
    assert_eq!((status, saved["minutes"].as_i64()), (200, Some(90)), "{saved}");
    let (status, _) = app
        .put("/call-ins", &app.planner(), json!({"employee_id": app.ben.id, "date": yesterday, "minutes": 30}), None)
        .await;
    assert_eq!(status, 400, "only on an on-call duty");
    let (_, mine) = app.get(&format!("/call-ins?from_date={yesterday}&to_date={yesterday}"), &app.viewer(&app.ben)).await;
    assert_eq!(mine, json!([]), "a viewer sees their own call-ins only");

    let input = prepare(&app, day(0), day(6)).await;
    let late = input["shifts"].as_array().unwrap().iter().find(|s| s["id"] == app.late.to_string()).unwrap();
    assert_eq!(late["duty_type"], "on_call");
    let history = input["history"].as_array().unwrap();
    let row = history.iter().find(|h| h["employee_id"] == app.anna.id.to_string()).unwrap();
    assert_eq!(row["called_in_minutes"], 90);
    assert!(history.iter().all(|h| h["employee_id"] != app.ben.id.to_string() || h.get("called_in_minutes").is_none()));
    let anna = employee(&input, app.anna.id);
    assert_eq!(anna["max_on_call_per_month"], 3);
    assert_eq!(anna["fairness_balance"]["on_call"], 1, "the duty balance looks back six months by default");
    assert_eq!(anna["fairness_balance"]["nights"], 0, "an on-call night is not a night shift");
    assert_eq!(input["constraints"]["fairness_weight"], 2000);

    // The fairness report counts on-call duties on their own.
    let (_, report) = app
        .get(&format!("/analysis/fairness?from_date={yesterday}&to_date={yesterday}"), &app.planner())
        .await;
    let anna_row = report["employees"].as_array().unwrap().iter().find(|e| e["employee_id"] == app.anna.id.to_string()).unwrap();
    assert_eq!((anna_row["on_call_duties"].as_i64(), anna_row["shifts"].as_i64()), (Some(1), Some(0)));

    let (status, _) = app.delete(&format!("/call-ins/{}/{yesterday}", app.anna.id), &app.planner(), None).await;
    assert_eq!(status, 200);
    cleanup(&app);
}

#[tokio::test]
async fn the_fairness_horizon_and_last_years_christmas_reach_the_planner() {
    let app = app!("fairness-history");
    ward(&app);
    app.roster(app.anna.id, NaiveDate::from_ymd_opt(2025, 12, 25).unwrap(), Some(app.early));
    app.roster(app.ben.id, NaiveDate::from_ymd_opt(2025, 12, 31).unwrap(), Some(app.early));

    let input = prepare(&app, NaiveDate::from_ymd_opt(2026, 12, 20).unwrap(), NaiveDate::from_ymd_opt(2027, 1, 2).unwrap()).await;
    let off = |id: Uuid| -> Vec<String> {
        employee(&input, id)["preferred_off"].as_array().cloned().unwrap_or_default().iter().map(|p| p["date"].as_str().unwrap().to_string()).collect()
    };
    assert_eq!(off(app.anna.id), ["2026-12-24", "2026-12-25", "2026-12-26"], "Christmas last year");
    assert_eq!(off(app.ben.id), ["2026-12-31", "2027-01-01"], "New Year last year");

    // A horizon of 0 switches both off.
    let (_, mut settings) = app.get("/planner-settings", &app.planner()).await;
    settings["fairness_horizon_months"] = json!(0);
    let (status, saved) = app.put("/planner-settings", &app.planner(), settings, None).await;
    assert_eq!(status, 200, "{saved}");
    let input = prepare(&app, NaiveDate::from_ymd_opt(2026, 12, 20).unwrap(), NaiveDate::from_ymd_opt(2027, 1, 2).unwrap()).await;
    assert!(employee(&input, app.anna.id).get("fairness_balance").is_none());
    assert!(employee(&input, app.anna.id).get("preferred_off").is_none());
    assert_eq!(input["constraints"]["fairness_weight"], 0);

    let (_, mut settings) = app.get("/planner-settings", &app.planner()).await;
    settings["fairness_horizon_months"] = json!(30);
    let (status, _) = app.put("/planner-settings", &app.planner(), settings, None).await;
    assert_eq!(status, 400);
    cleanup(&app);
}

#[tokio::test]
async fn a_demand_curve_is_kept_per_workstation_and_weekday_and_sent_to_the_planner() {
    let app = app!("demand");
    let ws = ward(&app);
    let mut hours = vec![0; 24];
    for h in 6..22 {
        hours[h] = 1;
    }
    hours[10] = 2;
    let body = json!({"weekdays": [{"weekday": 0, "hours": hours}, {"weekday": 6, "hours": vec![0; 24]}]});
    let (status, _) = app.put(&format!("/workstations/{ws}/demand"), &app.viewer(&app.anna), body.clone(), None).await;
    assert_eq!(status, 403);
    let (status, _) = app
        .put(&format!("/workstations/{ws}/demand"), &app.planner(), json!({"weekdays": [{"weekday": 0, "hours": [1, 2]}]}), None)
        .await;
    assert_eq!(status, 400);
    let (status, saved) = app.put(&format!("/workstations/{ws}/demand"), &app.planner(), body, None).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["weekdays"].as_array().unwrap().len(), 1, "an all-zero day is no curve");

    let (_, read) = app.get(&format!("/workstations/{ws}/demand"), &app.viewer(&app.anna)).await;
    assert_eq!(read["weekdays"][0]["hours"][10], 2);
    let (_, all) = app.get("/workstation-demand", &app.planner()).await;
    assert_eq!(all.as_array().unwrap().len(), 1);

    let input = prepare(&app, day(0), day(6)).await;
    let w = input["workstations"].as_array().unwrap().iter().find(|w| w["id"] == ws.to_string()).unwrap();
    assert_eq!(w["demand"], json!([{"weekday": "0", "hours": read["weekdays"][0]["hours"]}]));

    // The forecast reads the curve for Mondays: 17 person-hours.
    let (status, forecast) = app.get("/analysis/capacity-forecast?from=2026-09&months=1", &app.planner()).await;
    assert_eq!(status, 200, "{forecast}");
    let month = &forecast["months"][0];
    let station = month["workstations"].as_array().unwrap().iter().find(|s| s["id"] == ws.to_string()).unwrap();
    // September 2026: 4 Mondays x 17 h by the curve, 26 other days x (8 h Early; Late's 10 h)
    assert_eq!(station["required_hours"], 4.0 * 17.0 + 26.0 * 18.0);

    let (status, _) = app.put(&format!("/workstations/{ws}/demand"), &app.planner(), json!({"weekdays": []}), None).await;
    assert_eq!(status, 200);
    let (_, read) = app.get(&format!("/workstations/{ws}/demand"), &app.planner()).await;
    assert_eq!(read["weekdays"], json!([]));
    cleanup(&app);
}

#[tokio::test]
async fn the_capacity_forecast_is_for_planners_and_sets_hours_against_needs() {
    let app = app!("forecast");
    ward(&app);
    let (status, _) = app.get("/analysis/capacity-forecast", &app.viewer(&app.anna)).await;
    assert_eq!(status, 403);
    let (status, _) = app.get("/analysis/capacity-forecast?months=13", &app.planner()).await;
    assert_eq!(status, 400);
    let (status, forecast) = app.get("/analysis/capacity-forecast?from=2026-09&months=2", &app.planner()).await;
    assert_eq!(status, 200, "{forecast}");
    let months = forecast["months"].as_array().unwrap();
    assert_eq!(months.iter().map(|m| m["month"].as_str().unwrap()).collect::<Vec<_>>(), ["2026-09", "2026-10"]);
    // Anna and Ben, 40 h each: 2 x 40 x 30 / 7.
    assert_eq!(months[0]["contracted_hours"], 342.9);
    assert_eq!(months[0]["required_hours"], 30.0 * 18.0);
    assert!(months[0]["gap_hours"].as_f64().unwrap() > 0.0, "two people cannot cover 540 h");
    cleanup(&app);
}

#[tokio::test]
async fn scenario_results_are_kept_apart_and_never_taken_as_the_roster() {
    let app = app!("scenarios");
    let result = |source: &str| {
        json!({
            "status": "feasible",
            "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-07"},
            "employee_plans": [{"employee_id": app.anna.id.to_string(), "employee_name": "Anna", "daily_plan": []}],
            "source": source,
            "scenario": if source == "scenario" { json!({"name": "Sick wave"}) } else { Value::Null },
        })
    };
    let mut ids = vec![];
    {
        let mut conn = app.pool.get().unwrap();
        for source in ["manual", "scenario"] {
            let id = Uuid::new_v4();
            diesel::sql_query("INSERT INTO optimized_shift_results (id, result, tenant_id) VALUES ($1, $2, $3)")
                .bind::<SqlUuid, _>(id)
                .bind::<diesel::sql_types::Jsonb, _>(result(source))
                .bind::<Text, _>(&app.tenant)
                .execute(&mut conn)
                .unwrap();
            ids.push(id);
        }
    }
    let (_, real) = app.get("/planner/optimized-shifts", &app.planner()).await;
    assert_eq!(real["data"].as_array().unwrap().len(), 1);
    assert_eq!(real["data"][0]["id"], ids[0].to_string());
    assert_eq!(real["total"], 1);
    let (_, latest) = app.get("/planner/optimized-shifts?latest=true", &app.planner()).await;
    assert_eq!(latest["data"][0]["id"], ids[0].to_string(), "a scenario is never the latest proposal");
    let (_, scenarios) = app.get("/planner/optimized-shifts?scenarios=true", &app.planner()).await;
    assert_eq!(scenarios["data"][0]["id"], ids[1].to_string());
    assert_eq!(scenarios["data"][0]["result"]["scenario"]["name"], "Sick wave");

    let (status, body) = app
        .post(&format!("/planner/optimized-shifts/{}/take-as-plan", ids[1]), &app.planner(), Some(json!({})), None)
        .await;
    assert_eq!(status, 409, "{body}");

    let (status, _) = app
        .post("/planner/scenarios", &app.planner(), Some(json!({"name": " ", "start_date": "2026-09-01", "end_date": "2026-09-07"})), None)
        .await;
    assert_eq!(status, 400);
    let (status, _) = app
        .post("/planner/scenarios", &app.planner(), Some(json!({"name": "Sick wave", "start_date": "2026-09-01", "end_date": "2026-09-07"})), None)
        .await;
    assert_eq!(status, 503, "no planner queue in tests");
    let (status, _) = app
        .post("/planner/scenarios", &app.viewer(&app.anna), Some(json!({"name": "x", "start_date": "2026-09-01", "end_date": "2026-09-07"})), None)
        .await;
    assert_eq!(status, 403);
    cleanup(&app);
}
