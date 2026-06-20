#!/usr/bin/env bash
# Seed script for shift backend — creates sample data via the REST API
# Usage: ./seed_data.sh [BASE_URL]
# Default base URL: http://127.0.0.1:8080/api/v1

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8080/api/v1}"

echo "=== Seeding data to ${BASE_URL} ==="

# ─── Shifts ───────────────────────────────────────────────────────────────────
echo ""
echo "--- Creating shifts ---"

SHIFT_IDS=()

declare -A SHIFT_TIMES
declare -A SHIFT_SHORT_NAMES
declare -A SHIFT_COLORS
declare -A SHIFT_MIN_EMP
declare -A SHIFT_MAX_EMP
# Frühschicht: Mon-Fri 06:00-14:00
SHIFT_TIMES["Frühschicht"]="0:06:00-14:00 1:06:00-14:00 2:06:00-14:00 3:06:00-14:00 4:06:00-14:00"
SHIFT_SHORT_NAMES["Frühschicht"]="F"
SHIFT_COLORS["Frühschicht"]="#22C55E"
SHIFT_MIN_EMP["Frühschicht"]=2
SHIFT_MAX_EMP["Frühschicht"]=6
# Spätschicht: Mon-Fri 14:00-22:00
SHIFT_TIMES["Spätschicht"]="0:14:00-22:00 1:14:00-22:00 2:14:00-22:00 3:14:00-22:00 4:14:00-22:00"
SHIFT_SHORT_NAMES["Spätschicht"]="S"
SHIFT_COLORS["Spätschicht"]="#F97316"
SHIFT_MIN_EMP["Spätschicht"]=2
SHIFT_MAX_EMP["Spätschicht"]=6
# Nachtschicht: Mon-Fri 22:00-06:00
SHIFT_TIMES["Nachtschicht"]="0:22:00-06:00 1:22:00-06:00 2:22:00-06:00 3:22:00-06:00 4:22:00-06:00"
SHIFT_SHORT_NAMES["Nachtschicht"]="N"
SHIFT_COLORS["Nachtschicht"]="#6366F1"
SHIFT_MIN_EMP["Nachtschicht"]=1
SHIFT_MAX_EMP["Nachtschicht"]=3
# Zwischenschicht: Mon-Fri 10:00-18:00
SHIFT_TIMES["Zwischenschicht"]="0:10:00-18:00 1:10:00-18:00 2:10:00-18:00 3:10:00-18:00 4:10:00-18:00"
SHIFT_SHORT_NAMES["Zwischenschicht"]="Z"
SHIFT_COLORS["Zwischenschicht"]="#EAB308"
SHIFT_MIN_EMP["Zwischenschicht"]=1
SHIFT_MAX_EMP["Zwischenschicht"]=4
# Langdienst: Mon-Fri 08:00-20:00
SHIFT_TIMES["Langdienst"]="0:08:00-20:00 1:08:00-20:00 2:08:00-20:00 3:08:00-20:00 4:08:00-20:00"
SHIFT_SHORT_NAMES["Langdienst"]="L"
SHIFT_COLORS["Langdienst"]="#3B82F6"
SHIFT_MIN_EMP["Langdienst"]=1
SHIFT_MAX_EMP["Langdienst"]=4

for SHIFT_NAME in "Frühschicht" "Spätschicht" "Nachtschicht" "Zwischenschicht" "Langdienst"; do
  SHORT="${SHIFT_SHORT_NAMES[$SHIFT_NAME]}"
  COLOR="${SHIFT_COLORS[$SHIFT_NAME]}"
  RESP=$(curl -s -X POST "${BASE_URL}/shifts" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${SHIFT_NAME}\", \"short_name\": \"${SHORT}\", \"color\": \"${COLOR}\"}")
  ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    SHIFT_IDS+=("$ID")
    echo "  ✓ Shift '${SHIFT_NAME}' → ${ID}"

    # Set weekday times for this shift (with min/max employee counts)
    TIMES="${SHIFT_TIMES[$SHIFT_NAME]}"
    MIN_EMP="${SHIFT_MIN_EMP[$SHIFT_NAME]}"
    MAX_EMP="${SHIFT_MAX_EMP[$SHIFT_NAME]}"
    for ENTRY in $TIMES; do
      WEEKDAY="${ENTRY%%:*}"
      REST="${ENTRY#*:}"
      START="${REST%%-*}"
      END="${REST#*-}"
      curl -s -X POST "${BASE_URL}/shifts/${ID}/weekday-times" \
        -H "Content-Type: application/json" \
        -d "{\"weekday\": ${WEEKDAY}, \"start_time\": \"${START}\", \"end_time\": \"${END}\", \"min_employees\": ${MIN_EMP}, \"max_employees\": ${MAX_EMP}}" > /dev/null
    done
    echo "    → Set weekday times (min=${MIN_EMP}, max=${MAX_EMP})"
  else
    echo "  ✗ Failed to create shift '${SHIFT_NAME}': ${RESP}"
  fi
done

# ─── Capabilities ─────────────────────────────────────────────────────────────
echo ""
echo "--- Creating capabilities ---"

CAP_NAMES=("MRT" "CT" "Röntgen" "Ultraschall" "Mammographie" "Angiographie" "Fluoroskopie" "PET-CT" "Dexa" "Stereotaxie")
CAP_IDS=()

for CAP_NAME in "${CAP_NAMES[@]}"; do
  RESP=$(curl -s -X POST "${BASE_URL}/capabilities" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${CAP_NAME}\"}")
  ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    CAP_IDS+=("$ID")
    echo "  ✓ Capability '${CAP_NAME}' → ${ID}"
  else
    echo "  ✗ Failed to create capability '${CAP_NAME}': ${RESP}"
  fi
done

# ─── Employees (100) ─────────────────────────────────────────────────────────
echo ""
echo "--- Creating 100 employees ---"

FIRST_NAMES=(
  "Anna" "Benjamin" "Clara" "Daniel" "Elena" "Felix" "Gabriela" "Hannes"
  "Ingrid" "Jan" "Katharina" "Lukas" "Maria" "Niklas" "Olivia" "Paul"
  "Quirin" "Rosa" "Stefan" "Theresa" "Ursula" "Viktor" "Waltraud" "Xaver"
  "Yvonne" "Zacharias" "Adelheid" "Bernd" "Christine" "Dietmar" "Elisabeth"
  "Friedrich" "Gertrud" "Heinrich" "Irmgard" "Johannes" "Karin" "Ludwig"
  "Margarethe" "Norbert" "Ottilie" "Peter" "Renate" "Siegfried" "Traudl"
  "Udo" "Veronika" "Werner" "Xenia" "Yvonne"
)

LAST_NAMES=(
  "Müller" "Schmidt" "Schneider" "Fischer" "Weber" "Meyer" "Wagner" "Becker"
  "Schulz" "Hoffmann" "Koch" "Bauer" "Richter" "Klein" "Wolf" "Schröder"
  "Neumann" "Schwarz" "Braun" "Zimmermann" "Krüger" "Hartmann" "Lange"
  "Werner" "Krause" "Meier" "Lehmann" "Schiller" "Schreiber" "Graf"
  "Schulte" "Dietrich" "Ziegler" "Kühn" "Kroll" "Horn" "Vogt" "Engel"
  "Berg" "Herrmann" "Fuchs" "Peters" "Keller" "Günther" "Frank" "Berger"
  "Winkler" "Roth" "Beck"
)

EMPLOYEE_IDS=()
MONTHLY_HOURS=(16 20 35 40)

for I in $(seq 1 100); do
  FI=$(( (I - 1) % ${#FIRST_NAMES[@]} ))
  LI=$(( (I - 1) % ${#LAST_NAMES[@]} ))
  FIRST="${FIRST_NAMES[$FI]}"
  LAST="${LAST_NAMES[$LI]}"
  if [ "$I" -gt 50 ]; then
    SUFFIX="$I"
  else
    SUFFIX=""
  fi
  NAME="${FIRST}${SUFFIX} ${LAST}"
  EMAIL="$(echo "${FIRST}${SUFFIX}.${LAST}" | tr '[:upper:]' '[:lower:]')@klinik.de"
  MH_IDX=$(( (I - 1) % ${#MONTHLY_HOURS[@]} ))
  MH="${MONTHLY_HOURS[$MH_IDX]}"

  RESP=$(curl -s -X POST "${BASE_URL}/employees" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${NAME}\", \"email\": \"${EMAIL}\", \"monthly_working_hours\": ${MH}.0}")
  ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    EMPLOYEE_IDS+=("$ID")
    echo "  ✓ Employee #${I} '${NAME}' <${EMAIL}> → ${ID}"
  else
    echo "  ✗ Failed to create employee #${I}: ${RESP}"
  fi
done

# ─── Assign capabilities to employees ────────────────────────────────────────
echo ""
echo "--- Assigning capabilities to employees ---"

ASSIGNED=0
for I in "${!EMPLOYEE_IDS[@]}"; do
  EMP_ID="${EMPLOYEE_IDS[$I]}"
  NUM_CAPS=$(( (I % 3) + 1 ))
  for J in $(seq 1 "$NUM_CAPS"); do
    CAP_IDX=$(( (I + J) % ${#CAP_IDS[@]} ))
    CAP_ID="${CAP_IDS[$CAP_IDX]}"
    RESP=$(curl -s -X POST "${BASE_URL}/employees/${EMP_ID}/capabilities" \
      -H "Content-Type: application/json" \
      -d "{\"capability_id\": \"${CAP_ID}\"}")
    if echo "$RESP" | grep -qi "error"; then
      echo "  ✗ Failed to assign cap '${CAP_ID}' to employee '${EMP_ID}': ${RESP}"
    else
      ASSIGNED=$((ASSIGNED + 1))
    fi
  done
done
echo "  ✓ Assigned ${ASSIGNED} capability links total"

# ─── Assign available shifts to employees ─────────────────────────────────────
echo ""
echo "--- Assigning available shifts to employees ---"

SHIFT_ASSIGNED=0
for I in "${!EMPLOYEE_IDS[@]}"; do
  EMP_ID="${EMPLOYEE_IDS[$I]}"
  # Each employee gets 2–3 shifts they are available for
  NUM_SHIFTS=$(( (I % 2) + 2 ))
  for J in $(seq 1 "$NUM_SHIFTS"); do
    SHIFT_IDX=$(( (I + J) % ${#SHIFT_IDS[@]} ))
    SHIFT_ID="${SHIFT_IDS[$SHIFT_IDX]}"
    RESP=$(curl -s -X POST "${BASE_URL}/employees/${EMP_ID}/available-shifts" \
      -H "Content-Type: application/json" \
      -d "{\"shift_id\": \"${SHIFT_ID}\"}")
    if echo "$RESP" | grep -qi "error"; then
      echo "  ✗ Failed to assign shift '${SHIFT_ID}' to employee '${EMP_ID}': ${RESP}"
    else
      SHIFT_ASSIGNED=$((SHIFT_ASSIGNED + 1))
    fi
  done
done
echo "  ✓ Assigned ${SHIFT_ASSIGNED} available-shift links total"

# ─── Workstations ─────────────────────────────────────────────────────────────
echo ""
echo "--- Creating workstations ---"

WS_NAMES=(
  "MRT-1" "MRT-2" "MRT-3" "CT-1" "CT-2" "CT-3" "CT-4"
  "Röntgen-1" "Röntgen-2" "Ultraschall-1" "Ultraschall-2"
  "Mammographie-1" "Angiographie-1" "Fluoroskopie-1" "PET-CT-1"
)

# Workstation prefixes that operate 24/7 (Früh, Spät, Nacht)
WS_24H_PREFIXES=("MRT" "CT" "PET-CT")
# Others operate daytime only (Früh, Spät)

WS_IDS=()

for WS_NAME in "${WS_NAMES[@]}"; do
  PREFIX="${WS_NAME%%-*}"

  # Determine active shifts based on workstation type
  ACTIVE_SHIFT_IDS=()
  IS_24H=false
  for P in "${WS_24H_PREFIXES[@]}"; do
    if [ "$PREFIX" = "$P" ]; then
      IS_24H=true
      break
    fi
  done

  if [ "$IS_24H" = true ]; then
    # 24/7 workstations: all shifts (Frühschicht, Spätschicht, Nachtschicht, Zwischenschicht, Langdienst)
    for SI in 0 1 2 3 4; do
      if [ -n "${SHIFT_IDS[$SI]:-}" ]; then
        ACTIVE_SHIFT_IDS+=("\"${SHIFT_IDS[$SI]}\"")
      fi
    done
  else
    # Daytime workstations: daytime shifts only (Frühschicht, Spätschicht, Zwischenschicht, Langdienst)
    for SI in 0 1 3 4; do
      if [ -n "${SHIFT_IDS[$SI]:-}" ]; then
        ACTIVE_SHIFT_IDS+=("\"${SHIFT_IDS[$SI]}\"")
      fi
    done
  fi

  # Build JSON array string for active_shift_ids
  ACTIVE_SHIFTS_JSON=$(IFS=,; echo "[${ACTIVE_SHIFT_IDS[*]}]")

  RESP=$(curl -s -X POST "${BASE_URL}/workstations" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${WS_NAME}\", \"available\": true, \"active_shift_ids\": ${ACTIVE_SHIFTS_JSON}}")
  ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    WS_IDS+=("$ID")
    echo "  ✓ Workstation '${WS_NAME}' → ${ID} (active_shifts: ${ACTIVE_SHIFTS_JSON})"
  else
    echo "  ✗ Failed to create workstation '${WS_NAME}': ${RESP}"
  fi
done

# ─── Assign required capabilities to workstations ────────────────────────────
echo ""
echo "--- Assigning required capabilities to workstations ---"

declare -A WS_CAP_MAP
WS_CAP_MAP["MRT"]="MRT"
WS_CAP_MAP["CT"]="CT"
WS_CAP_MAP["Röntgen"]="Röntgen"
WS_CAP_MAP["Ultraschall"]="Ultraschall"
WS_CAP_MAP["Mammographie"]="Mammographie"
WS_CAP_MAP["Angiographie"]="Angiographie"
WS_CAP_MAP["Fluoroskopie"]="Fluoroskopie"
WS_CAP_MAP["PET-CT"]="PET-CT"

WS_ASSIGNED=0
for WI in "${!WS_NAMES[@]}"; do
  WS_NAME="${WS_NAMES[$WI]}"
  PREFIX="${WS_NAME%%-*}"
  CAP_NAME="${WS_CAP_MAP[$PREFIX]:-}"

  if [ -n "$CAP_NAME" ]; then
    for CI in "${!CAP_NAMES[@]}"; do
      if [ "${CAP_NAMES[$CI]}" = "$CAP_NAME" ] && [ -n "${CAP_IDS[$CI]:-}" ]; then
        CAP_ID="${CAP_IDS[$CI]}"
        WS_ID="${WS_IDS[$WI]}"
        if [ -n "$WS_ID" ]; then
          RESP=$(curl -s -X POST "${BASE_URL}/workstations/${WS_ID}/required-capabilities" \
            -H "Content-Type: application/json" \
            -d "{\"capability_id\": \"${CAP_ID}\"}")
          if echo "$RESP" | grep -qi "error"; then
            echo "  ✗ Failed to assign cap '${CAP_NAME}' to WS '${WS_NAME}': ${RESP}"
          else
            WS_ASSIGNED=$((WS_ASSIGNED + 1))
          fi
        fi
        break
      fi
    done
  fi
done
echo "  ✓ Assigned ${WS_ASSIGNED} workstation capability links total"

# ─── Unavailabilities ─────────────────────────────────────────────────────────
echo ""
echo "--- Creating random unavailabilities ---"

UNAV_CREATED=0
# Generate unavailabilities for the next 30 days
for I in "${!EMPLOYEE_IDS[@]}"; do
  EMP_ID="${EMPLOYEE_IDS[$I]}"
  # ~30% of employees get 1-3 unavailability entries
  if [ $(( I % 10 )) -lt 3 ]; then
    NUM_UNAV=$(( (I % 3) + 1 ))
    for J in $(seq 1 "$NUM_UNAV"); do
      # Random day offset 1-30
      DAY_OFFSET=$(( (I * 7 + J * 3) % 30 + 1 ))
      UNAV_DATE=$(date -d "+${DAY_OFFSET} days" +%Y-%m-%d 2>/dev/null || date -v+${DAY_OFFSET}d +%Y-%m-%d 2>/dev/null || echo "2026-06-0$(( DAY_OFFSET % 9 + 1 ))")

      # 50% chance of being whole-day (no shift_id), 50% with a specific shift
      if [ $(( (I + J) % 2 )) -eq 0 ]; then
        # Whole day unavailability
        RESP=$(curl -s -X POST "${BASE_URL}/unavailabilities" \
          -H "Content-Type: application/json" \
          -d "{\"employee_id\": \"${EMP_ID}\", \"unavailable_date\": \"${UNAV_DATE}\"}")
      else
        # Shift-specific unavailability
        SHIFT_IDX=$(( (I + J) % ${#SHIFT_IDS[@]} ))
        SHIFT_ID="${SHIFT_IDS[$SHIFT_IDX]}"
        RESP=$(curl -s -X POST "${BASE_URL}/unavailabilities" \
          -H "Content-Type: application/json" \
          -d "{\"employee_id\": \"${EMP_ID}\", \"unavailable_date\": \"${UNAV_DATE}\", \"shift_id\": \"${SHIFT_ID}\"}")
      fi

      if echo "$RESP" | grep -qi "error"; then
        echo "  ✗ Failed to create unavailability for employee '${EMP_ID}': ${RESP}"
      else
        UNAV_CREATED=$((UNAV_CREATED + 1))
      fi
    done
  fi
done
echo "  ✓ Created ${UNAV_CREATED} unavailability entries"

# ─── Confirmed Shift Plans ────────────────────────────────────────────────────
echo ""
echo "--- Creating confirmed shift plans ---"

CSP_CREATED=0
ABSENCE_TYPES=("sick" "day_off" "holiday" "unknown")

for I in "${!EMPLOYEE_IDS[@]}"; do
  EMP_ID="${EMPLOYEE_IDS[$I]}"
  # Create 5-10 confirmed shift plan entries per employee for the next 14 days
  NUM_PLANS=$(( (I % 6) + 5 ))
  for J in $(seq 1 "$NUM_PLANS"); do
    DAY_OFFSET=$(( J ))
    PLAN_DATE=$(date -d "+${DAY_OFFSET} days" +%Y-%m-%d 2>/dev/null || date -v+${DAY_OFFSET}d +%Y-%m-%d 2>/dev/null || echo "2026-06-$(( J % 30 + 1 ))")

    # Pick a shift for this employee (rotate through available shifts)
    SHIFT_IDX=$(( (I + J) % ${#SHIFT_IDS[@]} ))
    SHIFT_ID="${SHIFT_IDS[$SHIFT_IDX]}"

    # Pick a workstation (rotate through workstations)
    WS_IDX=$(( (I + J) % ${#WS_IDS[@]} ))
    WS_ID="${WS_IDS[$WS_IDX]}"

    # ~15% chance the employee was absent
    if [ $(( (I * 13 + J * 7) % 100 )) -lt 15 ]; then
      IS_PRESENT=false
      ABS_IDX=$(( (I + J) % ${#ABSENCE_TYPES[@]} ))
      ABS_TYPE="${ABSENCE_TYPES[$ABS_IDX]}"
      # For automated entries, use creation_type "automated" ~30% of the time
      if [ $(( (I * 3 + J * 11) % 10 )) -lt 3 ]; then
        CREATION_TYPE="automated"
      else
        CREATION_TYPE="manual"
      fi
      RESP=$(curl -s -X POST "${BASE_URL}/employees/${EMP_ID}/confirmed-shift-plans" \
        -H "Content-Type: application/json" \
        -d "{\"shift_id\": \"${SHIFT_ID}\", \"workstation_id\": \"${WS_ID}\", \"date\": \"${PLAN_DATE}\", \"is_present\": false, \"absence_type\": \"${ABS_TYPE}\", \"creation_type\": \"${CREATION_TYPE}\"}")
    else
      IS_PRESENT=true
      # For automated entries, use creation_type "automated" ~20% of the time
      if [ $(( (I * 5 + J * 9) % 10 )) -lt 2 ]; then
        CREATION_TYPE="automated"
      else
        CREATION_TYPE="manual"
      fi
      RESP=$(curl -s -X POST "${BASE_URL}/employees/${EMP_ID}/confirmed-shift-plans" \
        -H "Content-Type: application/json" \
        -d "{\"shift_id\": \"${SHIFT_ID}\", \"workstation_id\": \"${WS_ID}\", \"date\": \"${PLAN_DATE}\", \"is_present\": true, \"creation_type\": \"${CREATION_TYPE}\"}")
    fi

    if echo "$RESP" | grep -qi "error"; then
      echo "  ✗ Failed to create confirmed shift plan for employee '${EMP_ID}': ${RESP}"
    else
      CSP_CREATED=$((CSP_CREATED + 1))
    fi
  done
done
echo "  ✓ Created ${CSP_CREATED} confirmed shift plan entries"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Seeding complete ==="
echo "  Shifts:               ${#SHIFT_IDS[@]} (with weekday times)"
echo "  Capabilities:         ${#CAP_IDS[@]}"
echo "  Employees:            ${#EMPLOYEE_IDS[@]}"
echo "  Workstations:         ${#WS_IDS[@]}"
echo "  Unavailabilities:     ${UNAV_CREATED}"
echo "  Confirmed Shift Plans: ${CSP_CREATED}"
