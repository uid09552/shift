use async_nats::Client;
use crate::broker::JetStreamStatus;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacedTask {
    pub id: String,
    pub status: String,
}

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

        let task_id = match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                let ack = jetstream
                    .publish("scheduling".to_string(), payload.into())
                    .await?
                    .await?;
                let task_id = ack.sequence.to_string();
                println!("Published scheduling task with ack id: {}", task_id);
                task_id
            }
            JetStreamStatus::Unavailable => {
                self.client
                    .publish("scheduling".to_string(), payload.into())
                    .await?;
                self.client.flush().await?;
                let task_id = uuid::Uuid::new_v4().to_string();
                println!("Published scheduling task (plain) with id: {}", task_id);
                task_id
            }
        };

        Ok(task_id)
    }

    /// List all tasks currently in the queue from NATS JetStream
    pub async fn list_tasks(&self) -> Result<Vec<PlacedTask>, String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                match jetstream.get_stream("SCHEDULING").await {
                    Ok(mut stream) => {
                        match stream.info().await {
                            Ok(info) => {
                                let mut tasks = Vec::new();
                                for i in 1..=info.state.messages {
                                    if let Ok(_message) = stream.get_raw_message(i).await {
                                        let task = PlacedTask {
                                            id: i.to_string(),
                                            status: "queued".to_string(),
                                        };
                                        tasks.push(task);
                                    }
                                }
                                Ok(tasks)
                            }
                            Err(e) => Err(format!("Failed to get stream info: {}", e)),
                        }
                    }
                    Err(e) => Err(format!("Failed to get SCHEDULING stream: {}", e)),
                }
            }
            JetStreamStatus::Unavailable => {
                Err("JetStream is unavailable".to_string())
            }
        }
    }

    /// Delete all tasks from the queue in NATS JetStream
    pub async fn delete_all_tasks(&self) -> Result<(), String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                
                if let Err(e) = jetstream.delete_stream("SCHEDULING").await {
                    return Err(format!("Failed to delete stream: {}", e));
                }
                
                if let Err(e) = jetstream
                    .get_or_create_stream(async_nats::jetstream::stream::Config {
                        name: "SCHEDULING".to_string(),
                        subjects: vec!["scheduling".to_string()],
                        ..Default::default()
                    })
                    .await
                {
                    return Err(format!("Failed to recreate stream: {}", e));
                }
                
                Ok(())
            }
            JetStreamStatus::Unavailable => {
                Err("JetStream is unavailable".to_string())
            }
        }
    }
}
