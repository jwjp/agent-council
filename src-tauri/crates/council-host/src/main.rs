fn main() {
    let result = council_host::run_cli_mode().and_then(|handled| {
        if handled {
            Ok(())
        } else {
            tokio::runtime::Runtime::new()?.block_on(council_host::server::serve())
        }
    });
    if let Err(error) = result {
        eprintln!("Agent Council host: {error}");
        std::process::exit(1);
    }
}
