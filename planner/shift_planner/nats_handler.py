"""
Shift Planner NATS JetStream handler — processes scheduling requests
from a NATS queue.
"""

import json
import logging

import nats
from pydantic import ValidationError

from shift_planner.models import SchedulingInput
from shift_planner.optimizer import solve

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def handle_request(msg):
    """Handle incoming scheduling requests from NATS JetStream queue."""
    try:
        data = json.loads(msg.data.decode())
        logger.info("Received scheduling request via NATS")

        # Validate input data
        try:
            validated_input = SchedulingInput(**data)
            data = validated_input.model_dump()
        except ValidationError as e:
            logger.warning(f"Input validation failed: {e}")
            if msg.reply:
                error_response = {
                    "status": "validation_error",
                    "message": f"Invalid input: {e.json()}",
                }
                await msg.respond(json.dumps(error_response).encode())
            # Acknowledge the message so it's not redelivered
            await msg.ack()
            return

        result = solve(data)
        logger.info(f"Solved scheduling request - status: {result.status}")

        if msg.reply:
            await msg.respond(result.model_dump_json().encode())

        # Acknowledge successful processing
        await msg.ack()
    except Exception as e:
        logger.error(f"Error processing scheduling request: {e}", exc_info=True)
        if msg.reply:
            error_response = {
                "status": "error",
                "message": str(e),
            }
            await msg.respond(json.dumps(error_response).encode())
        # Negative-acknowledge so the message can be redelivered
        await msg.nak()


async def start_server(queue_name: str, broker_url: str, stream_name: str):
    """Start the scheduler server and subscribe to NATS JetStream queue."""
    nc = None
    try:
        nc = await nats.connect(broker_url)
        logger.info(f"Connected to NATS broker at {broker_url}")

        js = nc.jetstream()
        logger.info("JetStream context acquired")

        # Subscribe via JetStream push consumer bound to the named stream.
        # manual_ack=True gives us explicit control over message acknowledgment.
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
            await handle_request(msg)

    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        raise
    finally:
        if nc is not None:
            await nc.close()
