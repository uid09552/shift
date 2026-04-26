# Agents — Shift Planning (Rust)

## Architecture
Layered architecture:
Controller → Service → Repository → Data Source

---

## Principles
- Composition over inheritance  
- Explicit dependencies (no globals)  
- Clear separation of concerns  
- Prefer immutability  

---

## Agents

### Controller
- Handles input (HTTP/CLI)
- Calls services
- Maps responses  
**No business or persistence logic**

### Service
- Business logic
- Validation & rules
- Coordinates repositories  
**No transport or DB code**

### Repository
- Data access & persistence
- Maps domain ↔ storage  
**No business logic**

---

## Patterns

### Builder
```rust
let shift = ShiftBuilder::new()
    .employee_id(id)
    .build()?;
```

### Factory
```rust
let service = ServiceFactory::create_shift_service(config);
```

### Options
```rust
pub struct ShiftOptions {
    pub allow_overlap: bool,
}
```

---

## Wiring
```rust
let repo = PostgresRepo::new(db);
let service = ShiftService { repo };
let controller = ShiftController { service };
```

---

## Testing
- Controller → mock service  
- Service → mock repository  
- Repository → integration tests  

---

## Avoid
- Fat controllers  
- God services  
- Hidden dependencies  
- Leaky repositories  
