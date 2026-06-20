# Data Models Documentation

## Overview

The `shift_planner.models` module provides Pydantic-based data validation for shift scheduling input. All data structures are validated at load time to ensure data integrity.

## Models

### PlanningPeriod
- **start_date**: date (YYYY-MM-DD format)
- **end_date**: date (YYYY-MM-DD format)
- **Validation**: end_date must be after start_date

### Shift
- **id**: str (required, min_length=1)
- **name**: str (required, min_length=1)
- **start_time**: time (HH:MM format)
- **end_time**: time (HH:MM format)
- **weekdays**: list[str] (valid values: "0"-"6")
- **is_night_shift**: bool (default: False)
- **Validation**: weekdays must be valid day codes

### Workstation
- **id**: str (required, min_length=1)
- **name**: str (required, min_length=1)
- **required_skills**: list[str] (default: [])
- **priority**: str (valid: "low", "medium", "high", default: "medium")
- **operating_shifts**: list[str] (required, min_items=1)
- **Validation**: priority must be one of allowed values

### Employee
- **id**: str (required, min_length=1)
- **name**: str (required, min_length=1)
- **skills**: list[str] (default: [])
- **available_shifts**: list[str] (required, min_items=1)
- **unavailability**: list[date] (default: [])

### SchedulingInput (Root Model)
- **planning_period**: PlanningPeriod (required)
- **shifts**: list[Shift] (required, min_items=1)
- **workstations**: list[Workstation] (required, min_items=1)
- **employees**: list[Employee] (required, min_items=1)
- **Validation**: All IDs must be unique within their respective lists

## Usage

### Load and Validate JSON File
```python
from shift_planner.models import load_and_validate

# Load and validate input
data = load_and_validate("input.json")

# Access data
print(data.planning_period.start_date)
print(len(data.employees))
```

### Create Models Programmatically
```python
from shift_planner.models import Shift, Employee, SchedulingInput

shift = Shift(
    id="morning",
    name="Morning Shift",
    start_time="06:00",
    end_time="14:00",
    weekdays=["0", "1", "2"],
    is_night_shift=False
)

employee = Employee(
    id="E1",
    name="Alice",
    skills=["assembly", "packaging"],
    available_shifts=["morning", "afternoon"],
    unavailability=[]
)
```

### Serialize to Dictionary
```python
# Convert model to dictionary (JSON-serializable)
data_dict = data.model_dump()

# Convert to JSON string
import json
json_str = json.dumps(data_dict)
```

## Error Handling

All validation errors are raised as `pydantic.ValidationError`. Example:

```python
from pydantic import ValidationError

try:
    data = load_and_validate("input.json")
except ValidationError as e:
    print(f"Validation error: {e}")
```

## Validation Rules

1. **Dates**: Must be valid YYYY-MM-DD format
2. **Times**: Must be valid HH:MM format
3. **Weekdays**: Must be one of: "0" (Monday) through "6" (Sunday)
4. **Priority**: Must be one of: "low", "medium", "high"
5. **Unique IDs**: All shift IDs, workstation IDs, and employee IDs must be unique
6. **Period**: end_date must be after start_date
7. **Non-empty lists**: shifts, workstations, employees must have at least one item

## Integration with Scheduler

The CLI and server modules automatically use validation:

```python
from shift_planner.models import load_and_validate
from shift_planner.optimizer import solve

# Load and validate input
data = load_and_validate("input.json")

# Solve with validated data
result = solve(data.model_dump())
```

Invalid inputs are caught before processing and reported with clear error messages.
