use axum::{
    extract::{Multipart, Path, Query, State},
    response::Response,
    Json,
};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::CapabilityRepository;
use crate::services::audit_log::{self, AuditActor};
use crate::services::employee::PaginationQuery;
use crate::services::tenant::TenantContext;
use crate::services::xlsx_io::{self, ImportResult};

pub struct CapabilityService;

impl CapabilityService {
    pub async fn list_capabilities(
        tenant: TenantContext,
        Query(_q): Query<PaginationQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let capabilities = state
            .capability_repo
            .list_capabilities(&tenant.0)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(capabilities).unwrap()))
    }

    pub async fn create_capability(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;
        // Ordinal skill level (see Capability) and optional skill_group used by the
        // optimizer's skill-downgrade objective. Defaults keep behaviour unchanged
        // for tenants that don't set these.
        let level = body.get("level").and_then(|v| v.as_i64()).unwrap_or(1) as i16;
        let skill_group = body.get("skill_group").and_then(|v| v.as_str());

        let capability = state
            .capability_repo
            .create_capability(&tenant.0, name, level, skill_group)
            .await?;

        audit_log::record(&state, &tenant.0, actor.0, "capability.create", "capability", Some(capability.id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(capability).unwrap()))
    }

    pub async fn get_capability_by_id(
        tenant: TenantContext,
        Path(capability_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let capability = state
            .capability_repo
            .get_capability(&tenant.0, capability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(capability).unwrap()))
    }

    pub async fn update_capability(
        tenant: TenantContext,
        actor: AuditActor,
        Path(capability_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;

        // Fall back to the existing level/skill_group when the request doesn't
        // include them, so a plain rename doesn't silently reset them.
        let existing = state
            .capability_repo
            .get_capability(&tenant.0, capability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        let level = body
            .get("level")
            .and_then(|v| v.as_i64())
            .map(|v| v as i16)
            .unwrap_or(existing.level);
        let skill_group_owned = body
            .get("skill_group")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(existing.skill_group);

        let capability = state
            .capability_repo
            .update_capability(&tenant.0, capability_id, name, level, skill_group_owned.as_deref())
            .await?;

        audit_log::record(&state, &tenant.0, actor.0, "capability.update", "capability", Some(capability_id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(capability).unwrap()))
    }

    pub async fn delete_capability(
        tenant: TenantContext,
        actor: AuditActor,
        Path(capability_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let name = state.capability_repo.get_capability(&tenant.0, capability_id).await.ok().flatten().map(|x| x.name);
        state
            .capability_repo
            .delete_capability(&tenant.0, capability_id)
            .await
            .map_err(|_| AppError::Internal)?;
        audit_log::record(&state, &tenant.0, actor.0, "capability.delete", "capability", Some(capability_id.to_string()), audit_log::deleted_name(name)).await;
        Ok(Json(serde_json::json!({ "message": "Capability deleted successfully" })))
    }

    pub async fn download_template(_tenant: TenantContext) -> Result<Response, AppError> {
        let bytes = xlsx_io::build_template(&["name"])?;
        Ok(xlsx_io::xlsx_download_response(bytes, "capabilities_template.xlsx"))
    }

    pub async fn import_capabilities(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        multipart: Multipart,
    ) -> Result<Json<Value>, AppError> {
        let bytes = xlsx_io::extract_uploaded_file(multipart).await?;
        let rows = xlsx_io::parse_rows(&bytes)?;

        let mut result = ImportResult::default();

        for (idx, row) in rows.iter().enumerate() {
            let row_num = idx + 2;
            let name = row.first().map(String::as_str).unwrap_or("");

            if name.is_empty() {
                result.push_error(row_num, "Missing required 'name'");
                continue;
            }

            match state.capability_repo.create_capability(&tenant.0, name, 1, None).await {
                Ok(_) => result.created += 1,
                Err(AppError::Duplicate) => {
                    result.push_error(row_num, format!("Capability '{name}' already exists"));
                }
                Err(_) => {
                    result.push_error(row_num, "Failed to create capability");
                }
            }
        }

        audit_log::record(
            &state,
            &tenant.0,
            actor.0,
            "capability.import",
            "capability",
            None,
            Some(serde_json::json!({ "created": result.created, "skipped": result.skipped }).to_string()),
        )
        .await;

        Ok(Json(serde_json::to_value(result).unwrap()))
    }
}
