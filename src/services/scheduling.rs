use async_nats::Client;
use crate::broker::JetStreamStatus;

/// Service responsible for publishing scheduling tasks to the NATS broker.
pub struct SchedulingService {
    client: Client,
    jetstream_status: JetStreamStatus,
}

impl SchedulingService {
    pub fn new(client: Client, jetstream_status: JetStreamStatus) -> Self {
        Self {
            client,
            jetstream_status,
        }
    }

    /// Publish a scheduling task to the broker. When JetStream is available the
    /// message is published through JetStream and the ack sequence is returned
    /// as the task ID. Otherwise a plain publish is used and a UUID-based task
    /// ID is generated.
    pub async fn request_scheduling(&self) -> Result<String, async_nats::Error> {
        println!("please calculate");

        let payload = b"schedule request".as_slice();

        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                let ack = jetstream
                    .publish("scheduling".to_string(), payload.into())
                    .await?
                    .await?;
                let task_id = ack.sequence.to_string();
                println!("Published scheduling task with ack id: {}", task_id);
                Ok(task_id)
            }
            JetStreamStatus::Unavailable => {
                self.client
                    .publish("scheduling".to_string(), payload.into())
                    .await?;
                self.client.flush().await?;
                let task_id = uuid::Uuid::new_v4().to_string();
                println!("Published scheduling task (plain) with id: {}", task_id);
                Ok(task_id)
            }
        }
    }
}
