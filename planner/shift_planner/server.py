"""
Shift Planner REST API - Flask-based HTTP interface for the scheduling solver.

Provides a POST /schedule endpoint that accepts the same JSON input format
as the NATS JetStream subscriber, making it easy to integrate with HTTP-based
clients and services.
"""

import json
import logging

from flask import Flask, jsonify, request
from pydantic import ValidationError

from shift_planner import telemetry
from shift_planner.models import SchedulingInput
from shift_planner.optimizer import solve

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Flask application factory
# ---------------------------------------------------------------------------

def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    # One server span per request, named after the route. No-op unless an OTLP
    # endpoint is configured (see telemetry.init_telemetry, called at startup).
    telemetry.instrument_flask(app)

    @app.route("/api/v1/optimize", methods=["POST"])
    def schedule():
        """Run the shift scheduler on the provided input data.

        Expects a JSON body matching the SchedulingInput schema:
        - planning_period: { start_date, end_date }
        - shifts: list of shift definitions
        - workstations: list of workstation definitions
        - employees: list of employee definitions
        - constraints: (optional) configurable constraint overrides:
            - night_shift_recovery_days: int (default 2, 0=disabled)
            - min_rest_hours: float (default 11.0, 0=disabled)
            - max_consecutive_days: int (default 6, 0=disabled)
            - max_working_days_per_week: int (default 5, 0=disabled)
            - equality_weight: int (default 50000, 0=disabled)
            - priority_weights: dict (default {"high":10000,"medium":1000,"low":100})
            - solver_time_limit_seconds: float (default 120.0)
            - solver_num_workers: int (default 8)

        Returns the scheduling result as JSON with status, objective_value,
        schedule, and employee_summary.
        """
        if not request.is_json:
            logger.warning("Request rejected: Content-Type is not application/json")
            return jsonify({
                "status": "error",
                "message": "Content-Type must be application/json",
            }), 415

        data = request.get_json(silent=True)
        if data is None:
            logger.warning("Request rejected: malformed JSON body")
            return jsonify({
                "status": "error",
                "message": "Request body must be valid JSON",
            }), 400

        # Validate input data using the same Pydantic model as NATS handler
        try:
            validated_input = SchedulingInput(**data)
            data = validated_input.model_dump()
        except ValidationError as e:
            logger.warning(f"Input validation failed: {e}")
            return jsonify({
                "status": "validation_error",
                "message": f"Invalid input: {json.loads(e.json())}",
            }), 422

        # Run the solver
        try:
            result = solve(data)
            logger.info(f"Schedule solved - status: {result.status}")

            status_code = 200 if result.status in ("optimal", "feasible") else 422
            return jsonify(result.model_dump(mode="json")), status_code

        except Exception as e:
            logger.error(f"Error processing scheduling request: {e}", exc_info=True)
            return jsonify({
                "status": "error",
                "message": str(e),
            }), 500

    @app.route("/api/v1/health", methods=["GET"])
    def health():
        """Health check endpoint."""
        return jsonify({"status": "healthy"}), 200

    @app.route("/api/v1/", methods=["GET"])
    def index():
        """API information endpoint."""
        return jsonify({
            "service": "shift-planner",
            "version": "1.0.0",
            "endpoints": {
                "POST /api/v1/optimize": "Submit scheduling input and receive a plan",
                "GET /api/v1/health": "Health check",
                "GET /api/v1/": "This information",
            },
        }), 200

    return app
