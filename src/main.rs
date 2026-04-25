use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "backend")]
#[command(about = "backend CLI start", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the server
    Serve {
        /// Port to listen on
        #[arg(long, default_value_t = 8080)]
        port: u16,

        /// Address to bind to
        #[arg(long, default_value = "127.0.0.1")]
        listen: String,

        /// Enable verbose logging
        #[arg(long, short, default_value_t = false)]
        verbose: bool,

        /// Enable development mode
        #[arg(long, default_value_t = false)]
        dev: bool,
    },
}

fn main() {
       let cli = Cli::parse();

    match cli.command {
        Commands::Serve {
            port,
            listen,
            verbose,
            dev,
        } => {
            println!("Starting server...");
            println!("Listen: {}:{}", listen, port);
            println!("Verbose: {}", verbose);
            println!("Dev mode: {}", dev);

            // here you'd start your server
        }
    }
}