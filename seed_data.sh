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
# Frühschicht: Mon-Fri 06:00-14:00
SHIFT_TIMES["Frühschicht"]="0:06:00-14:00 1:06:00-14:00 2:06:00-14:00 3:06:00-14:00 4:06:00-14:00"
# Spätschicht: Mon-Fri 14:00-22:00
SHIFT_TIMES["Spätschicht"]="0:14:00-22:00 1:14:00-22:00 2:14:00-22:00 3:14:00-22:00 4:14:00-22:00"
# Nachtschicht: Mon-Fri 22:00-06:00
SHIFT_TIMES["Nachtschicht"]="0:22:00-06:00 1:22:00-06:00 2:22:00-06:00 3:22:00-06:00 4:22:00-06:00"
# Zwischenschicht: Mon-Fri 10:00-18:00
SHIFT_TIMES["Zwischenschicht"]="0:10:00-18:00 1:10:00-18:00 2:10:00-18:00 3:10:00-18:00 4:10:00-18:00"
# Langdienst: Mon-Fri 08:00-20:00
SHIFT_TIMES["Langdienst"]="0:08:00-20:00 1:08:00-20:00 2:08:00-20:00 3:08:00-20:00 4:08:00-20:00"

for SHIFT_NAME in "Frühschicht" "Spätschicht" "Nachtschicht" "Zwischenschicht" "Langdienst"; do
  RESP=$(curl -s -X POST "${BASE_URL}/shifts" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${SHIFT_NAME}\"}")
  ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    SHIFT_IDS+=("$ID")
    echo "  ✓ Shift '${SHIFT_NAME}' → ${ID}"

    # Set weekday times for this shift
    TIMES="${SHIFT_TIMES[$SHIFT_NAME]}"
    for ENTRY in $TIMES; do
      WEEKDAY="${ENTRY%%:*}"
      REST="${ENTRY#*:}"
      START="${REST%%-*}"
      END="${REST#*-}"
      curl -s -X POST "${BASE_URL}/shifts/${ID}/weekday-times" \
        -H "Content-Type: application/json" \
        -d "{\"weekday\": ${WEEKDAY}, \"start_time\": \"${START}\", \"end_time\": \"${END}\"}" > /dev/null
    done
    echo "    → Set weekday times"
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

  RESP=$(curl -s -X POST "${BASE_URL}/employees" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${NAME}\", \"email\": \"${EMAIL}\"}")
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

WS_IDS=()

for WS_NAME in "${WS_NAMES[@]}"; do
  RESP=$(curl -s -X POST "${BASE_URL}/workstations" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${WS_NAME}\", \"available\": true}")
  ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    WS_IDS+=("$ID")
    echo "  ✓ Workstation '${WS_NAME}' → ${ID}"
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

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Seeding complete ==="
echo "  Shifts:          ${#SHIFT_IDS[@]} (with weekday times)"
echo "  Capabilities:    ${#CAP_IDS[@]}"
echo "  Employees:       ${#EMPLOYEE_IDS[@]}"
echo "  Workstations:    ${#WS_IDS[@]}"
echo "  Unavailabilities: ${UNAV_CREATED}"
