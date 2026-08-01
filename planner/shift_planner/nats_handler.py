"""
Shift Planner NATS JetStream handler — processes scheduling requests
from a NATS queue and publishes results back on 'scheduling.results'.
"""

import json
import logging

import nats
from pydantic import ValidationError

from shift_planner import telemetry
from shift_planner.models import SchedulingInput
from shift_planner.optimizer import solve

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RESULTS_SUBJECT = "scheduling.results"


async def handle_request(msg, nc):
    """Handle incoming scheduling requests from NATS JetStream queue.

    The whole job runs inside a consumer span continuing the trace the backend
    started (it puts a ``traceparent`` in the payload, since NATS carries no
    headers), and the result is published with this planner's own traceparent
    so the backend can attach storing the result to the same trace.
    """
    job_id = None
    try:
        data = json.loads(msg.data.decode())
        job_id = data.get("job_id")
        logger.info(f"Received scheduling request via NATS (job_id={job_id})")

        if job_id is None:
            logger.warning("Message has no job_id — skipping (legacy message)")
            await msg.ack()
            return

        subject = getattr(msg, "subject", "scheduling")
        with telemetry.consumer_span(
            f"process {subject}",
            data.get("traceparent"),
            **{
                "messaging.operation.name": "process",
                "messaging.destination.name": subject,
                "messaging.message.id": job_id,
            },
        ) as span:
            # Validate input data
            try:
                validated_input = SchedulingInput(**data)
                data = validated_input.model_dump()
            except ValidationError as e:
                logger.warning(f"Input validation failed: {e}")
                telemetry.set_attributes(span, **{"planner.status": "validation_error"})
                error_response = {
                    "job_id": job_id,
                    "status": "validation_error",
                    "message": f"Invalid input: {e.json()}",
                    "traceparent": telemetry.current_traceparent(),
                }
                await nc.publish(RESULTS_SUBJECT, json.dumps(error_response).encode())
                await msg.ack()
                return

            result = solve(data)
            logger.info(f"Solved scheduling request (job_id={job_id}) - status: {result.status}")

            result_payload = result.model_dump()
            result_payload["job_id"] = job_id
            result_payload["traceparent"] = telemetry.current_traceparent()
            await nc.publish(RESULTS_SUBJECT, json.dumps(result_payload, default=str).encode())
            logger.info(f"Published result for job_id={job_id} to '{RESULTS_SUBJECT}'")

            await msg.ack()
    except Exception as e:
        logger.error(f"Error processing scheduling request (job_id={job_id}): {e}", exc_info=True)
        error_response = {
            "job_id": job_id,
            "status": "error",
            "message": str(e),
        }
        await nc.publish(RESULTS_SUBJECT, json.dumps(error_response).encode())
        await msg.nak()


async def start_server(queue_name: str, broker_url: str, stream_name: str):
    """Start the scheduler server and subscribe to NATS JetStream queue."""
    nc = None
    try:
        nc = await nats.connect(broker_url)
        logger.info(f"Connected to NATS broker at {broker_url}")

        js = nc.jetstream()
        logger.info("JetStream context acquired")

        sub = await js.subscribe(
            subject=queue_name,
            stream=stream_name,
            manual_ack=True,
        )
        logger.info(
            f"Subscribed to JetStream subject '{queue_name}' on stream '{stream_name}'"
        )

        logger.info("Scheduler server running. Waiting for requests...")

        async for msg in sub.messages:
            await handle_request(msg, nc)

    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        raise
    finally:
        if nc is not None:
            await nc.close()
