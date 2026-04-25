# Hospital Shift Management API Specification

This directory contains the API specifications for the Hospital Shift Management System.

## Files

- **openapi.yaml** - Complete OpenAPI 3.0 specification for all API endpoints

## Overview

The API provides REST endpoints for managing:

- **Employees** - Employee information, capabilities, and available shifts
- **Shifts** - Work shift definitions
- **Capabilities** - Worker skills/qualifications (e.g., MRT, CT, Telefon)
- **Workstations** - Physical or virtual workstation resources
- **Unavailability** - Employee unavailability records for specific dates/shifts

## API Base URL

- Development: `http://localhost:8080/api/v1`
- Production: `https://api.example.com/api/v1`

## Main Resources

### Employees (`/employees`)
- `GET /employees` - List all employees
- `POST /employees` - Create new employee
- `GET /employees/{employeeId}` - Get employee details
- `PUT /employees/{employeeId}` - Update employee
- `GET /employees/email/{email}` - Get employee by email
- `GET /employees/{employeeId}/capabilities` - Get employee capabilities
- `POST /employees/{employeeId}/capabilities` - Add capability to employee
- `GET /employees/{employeeId}/available-shifts` - Get employee available shifts
- `POST /employees/{employeeId}/available-shifts` - Add available shift to employee

### Shifts (`/shifts`)
- `GET /shifts` - List all shifts
- `POST /shifts` - Create new shift
- `GET /shifts/{shiftId}` - Get shift details

### Capabilities (`/capabilities`)
- `GET /capabilities` - List all capabilities
- `POST /capabilities` - Create new capability
- `GET /capabilities/{capabilityId}` - Get capability details

### Workstations (`/workstations`)
- `GET /workstations` - List all workstations (filterable by availability)
- `POST /workstations` - Create new workstation
- `GET /workstations/{workstationId}` - Get workstation details with capabilities
- `PUT /workstations/{workstationId}` - Update workstation
- `PATCH /workstations/{workstationId}/availability` - Set availability status
- `GET /workstations/{workstationId}/required-capabilities` - Get required capabilities
- `POST /workstations/{workstationId}/required-capabilities` - Add required capability

### Unavailability (`/unavailabilities`)
- `GET /unavailabilities` - List unavailabilities (filterable by employee, date range)
- `POST /unavailabilities` - Create new unavailability record
- `GET /unavailabilities/{unavailabilityId}` - Get unavailability details
- `DELETE /unavailabilities/{unavailabilityId}` - Delete unavailability record

## Data Models

### Employee
```json
{
  "id": "uuid",
  "name": "string",
  "email": "string (unique)"
}
```

### Shift
```json
{
  "id": "uuid",
  "name": "string"
}
```

### Capability
```json
{
  "id": "uuid",
  "name": "string"
}
```

### Workstation
```json
{
  "id": "uuid",
  "name": "string",
  "available": "boolean",
  "active_shift_id": "uuid (nullable)"
}
```

### Unavailability
```json
{
  "id": "uuid",
  "employee_id": "uuid",
  "unavailable_date": "date (YYYY-MM-DD)",
  "shift_id": "uuid (nullable)"
}
```

## Response Format

All responses return JSON. Error responses follow this format:

```json
{
  "code": "error_code",
  "message": "Human readable error message",
  "details": "Optional additional details"
}
```

## Common HTTP Status Codes

- `200 OK` - Successful GET, PUT, PATCH request
- `201 Created` - Successful POST request
- `204 No Content` - Successful DELETE request
- `400 Bad Request` - Invalid request parameters or body
- `404 Not Found` - Resource not found
- `409 Conflict` - Duplicate resource or constraint violation
- `500 Internal Server Error` - Server error

## Viewing the Specification

You can view the OpenAPI specification using:

1. **Swagger UI**: Upload `openapi.yaml` to [swagger.io/swagger-ui](https://swagger.io/tools/swagger-ui/)
2. **ReDoc**: Upload `openapi.yaml` to [redoc.ly](https://redoc.ly/)
3. **Local tools**: Use tools like `swagger-ui-express` or similar to host locally

## Notes

- All IDs are UUIDs
- Dates use YYYY-MM-DD format
- Email addresses must be unique across the system
- Unavailability with `shift_id = null` means the entire day is unavailable
- Workstations can be filtered by availability status in list operations
- Unavailabilities can be filtered by employee ID and date range in list operations
