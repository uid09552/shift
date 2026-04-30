use chrono::NaiveDate;
use chrono::NaiveTime;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::errors::AppError;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Employee {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub available_shifts: Vec<Shift>,
    pub capabilities: Vec<Capability>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WeekdayTime {
    pub weekday: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Shift {
    pub id: Uuid,
    pub name: String,
    pub weekday_times: Vec<WeekdayTime>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Capability {
    pub id: Uuid,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Workstation {
    pub id: Uuid,
    pub name: String,
    pub available: bool,
    pub active_shift_ids: Vec<Uuid>,
    pub required_capabilities: Vec<Capability>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Unavailability {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub unavailable_date: NaiveDate,
    pub shift_id: Option<Uuid>,
}

// Repository traits
use async_trait::async_trait;

#[async_trait]
    pub trait EmployeeRepository {
        async fn create_employee(&self, name: &str, email: &str) -> Result<Employee, AppError>;
        async fn get_employee(&self, id: Uuid) -> Result<Option<Employee>, AppError>;
        async fn get_employee_by_email(&self, email: &str) -> Result<Option<Employee>, AppError>;
        async fn list_employees(&self) -> Result<Vec<Employee>, AppError>;
        async fn get_employee_capabilities(&self, employee_id: Uuid) -> Result<Vec<Capability>, AppError>;
        async fn add_employee_capability(&self, employee_id: Uuid, capability_id: Uuid) -> Result<(), AppError>;
        async fn update_employee(&self, employee: Employee) -> Result<(), AppError>;
        async fn delete_employee(&self, id: Uuid) -> Result<(), AppError>;
        async fn get_employee_available_shifts(&self, employee_id: Uuid) -> Result<Vec<Shift>, AppError>;
        async fn add_employee_available_shift(&self, employee_id: Uuid, shift_id: Uuid) -> Result<(), AppError>;
    }

#[async_trait]
    pub trait ShiftRepository {
        async fn create_shift(&self, name: &str) -> Result<Shift, AppError>;
    async fn get_shift(&self, id: Uuid) -> Result<Option<Shift>, Box<dyn std::error::Error + Send + Sync>>;
    async fn list_shifts(&self) -> Result<Vec<Shift>, Box<dyn std::error::Error + Send + Sync>>;
}

#[async_trait]
pub trait CapabilityRepository {
    async fn create_capability(&self, name: &str) -> Result<Capability, Box<dyn std::error::Error + Send + Sync>>;
    async fn get_capability(&self, id: Uuid) -> Result<Option<Capability>, Box<dyn std::error::Error + Send + Sync>>;
    async fn list_capabilities(&self) -> Result<Vec<Capability>, Box<dyn std::error::Error + Send + Sync>>;
}

#[async_trait]
pub trait UnavailabilityRepository {
    async fn create_unavailability(&self, unavailability: Unavailability) -> Result<Unavailability, Box<dyn std::error::Error + Send + Sync>>;
    async fn get_unavailability(&self, id: Uuid) -> Result<Option<Unavailability>, Box<dyn std::error::Error + Send + Sync>>;
    async fn list_unavailabilities(&self) -> Result<Vec<Unavailability>, Box<dyn std::error::Error + Send + Sync>>;
    async fn get_unavailabilities_for_employee(&self, employee_id: Uuid) -> Result<Vec<Unavailability>, Box<dyn std::error::Error + Send + Sync>>;
    async fn delete_unavailability(&self, id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
}

#[async_trait]
pub trait WorkstationRepository {
    async fn create_workstation(&self, name: &str, available: bool, active_shift_ids: Vec<Uuid>) -> Result<Workstation, Box<dyn std::error::Error + Send + Sync>>;
    async fn get_workstation(&self, id: Uuid) -> Result<Option<Workstation>, Box<dyn std::error::Error + Send + Sync>>;
    async fn list_workstations(&self) -> Result<Vec<Workstation>, Box<dyn std::error::Error + Send + Sync>>;
    async fn set_workstation_availability(&self, id: Uuid, available: bool) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    async fn set_workstation_active_shifts(&self, id: Uuid, active_shift_ids: Vec<Uuid>) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    async fn add_required_capability(&self, workstation_id: Uuid, capability_id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    async fn list_required_capabilities(&self, workstation_id: Uuid) -> Result<Vec<Capability>, Box<dyn std::error::Error + Send + Sync>>;
}
