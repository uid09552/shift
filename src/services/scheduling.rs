use async_nats::Client;
use crate::broker::JetStreamStatus;
use crate::models::{TaskDTO, PlanningPeriod, ShiftTask, WorkstationTask, EmployeeTask, TaskResultDto};
use crate::repository::{AppState, domain::*};
use serde::{Deserialize, Serialize};
use chrono::Local;

/// Global constant for the optimizer REST API path.
pub const OPTIMIZER_API_PATH: &str = "/api/v1/optimize";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacedTask {
    pub id: String,
    pub status: String,
}

/// Service responsible for publishing scheduling tasks to the NATS broker
/// and forwarding the input JSON to the optimizer REST API.
pub struct SchedulingService {
    client: Client,
    jetstream_status: JetStreamStatus,
    state: AppState,
}

impl SchedulingService {
    pub fn new(client: Client, jetstream_status: JetStreamStatus, state: AppState) -> Self {
        Self {
            client,
            jetstream_status,
            state,
        }
    }

    /// Build a `TaskDTO` from the current database state.
    /// This fetches shifts, employees and workstations and converts them into
    /// the optimizer-friendly DTO structure.
    pub async fn build_task_dto(state: &AppState) -> Result<TaskDTO, Box<dyn std::error::Error + Send + Sync>> {
        println!("Fetching scheduling data from database...");

        // Fetch data from repositories
        let shifts = state.shift_repo.list_shifts().await?;
        let employees = state.employee_repo.list_employees(None, None).await?;
        let workstations = state.workstation_repo.list_workstations().await?;

        // Convert domain models to TaskDTO structures
        let shift_tasks = Self::build_shift_tasks(shifts);

        let workstation_tasks: Vec<WorkstationTask> = workstations
            .into_iter()
            .map(|ws| WorkstationTask {
                id: ws.id.to_string(),
                name: ws.name,
                required_skills: ws
                    .required_capabilities
                    .iter()
                    .map(|c| c.name.clone())
                    .collect(),
                priority: "medium".to_string(),
                operating_shifts: ws.active_shift_ids.iter().map(|id| id.to_string()).collect(),
            })
            .collect();

        let employee_tasks: Vec<EmployeeTask> = employees
            .into_iter()
            .map(|emp| EmployeeTask {
                id: emp.id.to_string(),
                name: emp.name,
                skills: emp.capabilities.iter().map(|c| c.name.clone()).collect(),
                available_shifts: emp.available_shifts.iter().map(|s| s.id.to_string()).collect(),
                unavailability: Vec::new(),
                monthly_working_hours: emp.monthly_working_hours,
            })
            .collect();

        // Create TaskDTO
        let today = Local::now().naive_local().date();
        let task_dto = TaskDTO {
            planning_period: PlanningPeriod {
                start_date: today.to_string(),
                end_date: today.checked_add_signed(chrono::Duration::days(30)).unwrap_or(today).to_string(),
            },
            shifts: shift_tasks,
            workstations: workstation_tasks,
            employees: employee_tasks,
        };

        Ok(task_dto)
    }

    /// Publish a scheduling task to the broker. When JetStream is available the
    /// message is published through JetStream and the ack sequence is returned
    /// as the task ID. Otherwise a plain publish is used and a UUID-based task
    /// ID is generated.
    fn build_shift_tasks(shifts: Vec<Shift>) -> Vec<ShiftTask> {
        shifts
            .into_iter()
            .map(|shift| ShiftTask {
                id: shift.id.to_string(),
                name: shift.name,
                start_time: shift
                    .weekday_times
                    .first()
                    .map(|wt| wt.start_time.to_string())
                    .unwrap_or_default(),
                end_time: shift
                    .weekday_times
                    .first()
                    .map(|wt| wt.end_time.to_string())
                    .unwrap_or_default(),
                weekdays: shift
                    .weekday_times
                    .iter()
                    .map(|wt| wt.weekday.to_string())
                    .collect(),
                is_night_shift: false,
            })
            .collect()
    }

    pub async fn request_scheduling(&self) -> Result<OptimizedShiftResultDomain, Box<dyn std::error::Error + Send + Sync>> {
        let task_dto = Self::build_task_dto(&self.state).await?;

        // Serialize to JSON
        let payload = serde_json::to_string(&task_dto)?;
        println!("Publishing scheduling task with payload: {}", payload);

        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                let ack = jetstream
                    .publish("scheduling".to_string(), payload.clone().into())
                    .await?
                    .await?;
                println!("Published scheduling task with ack id: {}", ack.sequence);
            }
            JetStreamStatus::Unavailable => {
                self.client
                    .publish("scheduling".to_string(), payload.clone().into())
                    .await?;
                self.client.flush().await?;
                println!("Published scheduling task (plain)");
            }
        };

        // Publish the input JSON to the optimizer REST API and deserialize the response
        let optimizer_url = format!("{}{}", self.state.optimizer_url, OPTIMIZER_API_PATH);
        println!("Publishing scheduling payload to optimizer at: {}", optimizer_url);
        let response = reqwest::Client::new()
            .post(&optimizer_url)
            .header("Content-Type", "application/json")
            .body(payload.clone())
            .send()
            .await
            .map_err(|e| {
                eprintln!("Failed to publish to optimizer service: {}", e);
                e
            })?;

        let status = response.status();
        let result: TaskResultDto = response.json().await.map_err(|e| {
            eprintln!("Failed to deserialize optimizer response into TaskResultDto: {}", e);
            e
        })?;
        println!("Optimizer service responded with status: {}", status);

        // Store the result in the database
        let result_json = serde_json::to_value(&result)?;
        let stored = self.state
            .optimized_shift_result_repo
            .create_optimized_shift_result(result_json)
            .await
 .map_err(|e| {
                eprintln!("Failed to store optimized shift result: {}", e);
                e
            })?;
        println!("Stored optimized shift result with id: {}", stored.id);

        // Fetch it back from the database for the response
        let from_db = self.state
            .optimized_shift_result_repo
            .get_optimized_shift_result_by_id(stored.id)
            .await
            .map_err(|e| {
                eprintln!("Failed to fetch stored optimized shift result: {}", e);
                e
            })?
            .ok_or("Stored result not found in database")?;

        Ok(from_db)
    }

    /// List all tasks currently in the queue from NATS JetStream
    pub async fn list_tasks(&self) -> Result<Vec<PlacedTask>, String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                match jetstream.get_stream("SCHEDULING").await {
                    Ok(mut stream) => {
                        match stream.info().await {
                            Ok(info) => {
                                let mut tasks = Vec::new();
                                for i in 1..=info.state.messages {
                                    if let Ok(_message) = stream.get_raw_message(i).await {
                                        let task = PlacedTask {
                                            id: i.to_string(),
                                            status: "queued".to_string(),
                                        };
                                        tasks.push(task);
                                    }
                                }
                                Ok(tasks)
                            }
                            Err(e) => Err(format!("Failed to get stream info: {}", e)),
                        }
                    }
                    Err(e) => Err(format!("Failed to get SCHEDULING stream: {}", e)),
                }
            }
            JetStreamStatus::Unavailable => {
                Err("JetStream is unavailable".to_string())
            }
        }
    }

    /// Get a single task by ID from NATS JetStream and return the raw message body
    pub async fn get_task(&self, task_id: u64) -> Result<Vec<u8>, String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                match jetstream.get_stream("SCHEDULING").await {
                    Ok(stream) => {
                        match stream.get_raw_message(task_id).await {
                            Ok(message) => Ok(message.payload.to_vec()),
                            Err(e) => Err(format!("Failed to get message: {}", e)),
                        }
                    }
                    Err(e) => Err(format!("Failed to get SCHEDULING stream: {}", e)),
                }
            }
            JetStreamStatus::Unavailable => {
                Err("JetStream is unavailable".to_string())
            }
        }
    }

    /// Delete all tasks from the queue in NATS JetStream
    pub async fn delete_all_tasks(&self) -> Result<(), String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                
                if let Err(e) = jetstream.delete_stream("SCHEDULING").await {
                    return Err(format!("Failed to delete stream: {}", e));
                }
                
                if let Err(e) = jetstream
                    .get_or_create_stream(async_nats::jetstream::stream::Config {
                        name: "SCHEDULING".to_string(),
                        subjects: vec!["scheduling".to_string()],
                        ..Default::default()
                    })
                    .await
                {
                    return Err(format!("Failed to recreate stream: {}", e));
                }
                
                Ok(())
            }
            JetStreamStatus::Unavailable => {
                Err("JetStream is unavailable".to_string())
            }
        }
    }
}
