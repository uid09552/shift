use async_nats::Client;
use crate::config::BrokerConfig;

/// Whether the connected NATS server has JetStream available.
#[derive(Clone, Copy, Debug)]
pub enum JetStreamStatus {
    Available,
    Unavailable,
}

/// Result of a broker connection.
pub struct BrokerConnection {
    pub client: Client,
    pub jetstream_status: JetStreamStatus,
}

/// Connect to the NATS broker using the provided broker configuration.
/// Attempts to set up JetStream streams; records whether JetStream is available
/// so the application can fall back to plain publish when it is not.
pub async fn connect(config: &BrokerConfig) -> Result<BrokerConnection, async_nats::Error> {
    let addr = format!("{}:{}", config.host, config.port);
    println!("Connecting to NATS broker at {}...", addr);
    let client = async_nats::connect(addr).await?;
    println!("Successfully connected to NATS broker");

    let jetstream = async_nats::jetstream::new(client.clone());
    match jetstream
        .get_or_create_stream(async_nats::jetstream::stream::Config {
            name: "SCHEDULING".to_string(),
            subjects: vec!["scheduling".to_string()],
            ..Default::default()
        })
        .await
    {
        Ok(_) => {
            println!("JetStream stream 'SCHEDULING' is ready");
            Ok(BrokerConnection {
                client,
                jetstream_status: JetStreamStatus::Available,
            })
        }
        Err(_) => {
            eprintln!("JetStream unavailable — falling back to plain publish");
            Ok(BrokerConnection {
                client,
                jetstream_status: JetStreamStatus::Unavailable,
            })
        }
    }
}
