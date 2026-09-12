"""
Shift Planner NATS JetStream handler — processes scheduling requests
from a NATS queue and publishes results back on 'scheduling.results'.
"""

import asyncio
import json
import logging

import nats
from nats.js.api import ConsumerConfig
from nats.js.errors import NotFoundError
from pydantic import ValidationError

from shift_planner import telemetry
from shift_planner.models import SchedulingInput
from shift_planner.optimizer import solve

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RESULTS_SUBJECT = "scheduling.results"

# Durable, so the consumer remembers what it has acked across restarts. The
# stream keeps messages after they are acked (limits retention), and an
# ephemeral consumer starts from the first one every time — each restart
# re-solved every job ever queued.
DURABLE_NAME = "shift-planner"

# A failing job is retried this often, then dropped. Unlimited (the default)
# turns one job that always fails into a solver running forever.
MAX_DELIVER = 3

# How often a job still being solved tells JetStream it is alive. The ack wait
# is 30s and a solve runs up to solver_time_limit_seconds (120 by default), so
# without this the job is redelivered mid-solve and solved again.
PROGRESS_INTERVAL_SECONDS = 10


async def _solve(msg, data: dict):
    """Run the solver off the event loop, reporting progress while it runs.

    solve() blocks for as long as the solve takes. On the event loop that
    starves the NATS client — no PONGs, no reading the socket, no ack — and the
    server drops the connection (broken pipe) and redelivers the job.
    """
    solving = asyncio.ensure_future(asyncio.to_thread(solve, data))
    while True:
        done, _ = await asyncio.wait({solving}, timeout=PROGRESS_INTERVAL_SECONDS)
        if done:
            return solving.result()
        try:
            await msg.in_progress()
        except Exception as e:
            logger.warning(f"Could not report progress to JetStream: {e}")


async def _ensure_stream(js, stream_name: str, subject: str):
    """Create the stream if the backend has not yet.

    Both sides create it (the backend in src/broker.rs), with the same config,
    so whichever starts first wins. Without this the planner raced the backend
    on startup and died with "stream not found".
    """
    try:
        await js.stream_info(stream_name)
    except NotFoundError:
        await js.add_stream(name=stream_name, subjects=[subject])
        logger.info(f"Created JetStream stream '{stream_name}' for subject '{subject}'")


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

            result = await _solve(msg, data)
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

        await _ensure_stream(js, stream_name, queue_name)

        sub = await js.subscribe(
            subject=queue_name,
            stream=stream_name,
            durable=DURABLE_NAME,
            config=ConsumerConfig(max_deliver=MAX_DELIVER),
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
