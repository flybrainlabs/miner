use std::{env, error::Error, process::ExitCode, time::Instant};

use flypow::{
    BlockTemplate, CanonicalDataset, DatasetFlyPowContext, Hash256, UsefulIndex, decode_hash,
    encode_hex, hash::hash_parts, useful::derive_sketch_seed,
};

const DEMO_TIMESTAMP: u64 = 1_789_344_000;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        print_usage();
        return Ok(());
    };

    match command.as_str() {
        "source" => source_info(),
        "dataset-root" => {
            let path = required(&mut args, "canonical dataset path")?;
            ensure_finished(&mut args)?;
            let started = Instant::now();
            println!("Scanning every canonical synapse record...");
            let dataset = CanonicalDataset::inspect(path)?;
            println!("records={}", dataset.record_count());
            println!("bytes={}", dataset.byte_len());
            println!("chunks={}", dataset.chunk_count());
            println!("dataset_root={}", encode_hex(&dataset.merkle_root()));
            println!("elapsed_seconds={:.3}", started.elapsed().as_secs_f64());
            Ok(())
        }
        "build-index" => {
            let dataset_path = required(&mut args, "canonical dataset path")?;
            let dataset_root = parse_hash(&required(&mut args, "dataset root")?)?;
            let epoch_seed = parse_hash(&required(&mut args, "epoch seed")?)?;
            let miner_key = parse_hash(&required(&mut args, "miner key")?)?;
            let output_path = required(&mut args, "new index output path")?;
            ensure_finished(&mut args)?;

            let started = Instant::now();
            println!("Verifying and memory-mapping the complete canonical dataset...");
            let dataset = CanonicalDataset::open_verified(dataset_path, dataset_root)?;
            println!(
                "Building direction-aware sketches and FlyHash fingerprints for every body ID..."
            );
            let index = UsefulIndex::build(&dataset, epoch_seed, miner_key)?;
            index.write_new(output_path)?;
            println!("fingerprints={}", index.len());
            println!("sketch_seed={}", encode_hex(&index.sketch_seed()));
            println!("artifact_root={}", encode_hex(&index.artifact_root()));
            println!("elapsed_seconds={:.3}", started.elapsed().as_secs_f64());
            Ok(())
        }
        "mine" => {
            let dataset_path = required(&mut args, "canonical dataset path")?;
            let dataset_root = parse_hash(&required(&mut args, "dataset root")?)?;
            let index_path = required(&mut args, "useful index path")?;
            let epoch_seed = parse_hash(&required(&mut args, "epoch seed")?)?;
            let miner_key = parse_hash(&required(&mut args, "miner key")?)?;
            let difficulty = parse_u16(&required(&mut args, "difficulty bits")?, "difficulty")?;
            let max_attempts = parse_u64(
                &required(&mut args, "maximum attempts")?,
                "maximum attempts",
            )?;
            let message = collect_message(args);

            let load_started = Instant::now();
            println!("Full-scanning and verifying the synapse dataset before mining...");
            let dataset = CanonicalDataset::open_verified(dataset_path, dataset_root)?;
            let sketch_seed = derive_sketch_seed(dataset_root, epoch_seed, miner_key);
            let index = UsefulIndex::load_verified(index_path, dataset_root, sketch_seed)?;
            println!(
                "ready records={} fingerprints={} load_seconds={:.3}",
                dataset.record_count(),
                index.len(),
                load_started.elapsed().as_secs_f64()
            );

            let template = demo_template(&message, difficulty);
            let context =
                DatasetFlyPowContext::new(template, &dataset, &index, epoch_seed, miner_key)?;
            println!("challenge={}", encode_hex(&context.challenge()));
            let mine_started = Instant::now();
            let outcome = context.mine(0, max_attempts)?;
            let seconds = mine_started.elapsed().as_secs_f64();
            println!("attempts={}", outcome.attempts);
            println!("mine_seconds={seconds:.3}");
            if seconds > 0.0 {
                println!("nonces_per_second={:.3}", outcome.attempts as f64 / seconds);
            }
            if let Some(solution) = outcome.solution {
                println!("status=found");
                println!("nonce={}", solution.nonce);
                println!("work_hash={}", encode_hex(&solution.hash));
                println!("access_trace={}", encode_hex(&solution.access_trace));
                println!("winner_count={}", solution.flyhash.winners.len());
            } else {
                println!("status=not-found");
            }
            Ok(())
        }
        "verify" => {
            let dataset_path = required(&mut args, "canonical dataset path")?;
            let dataset_root = parse_hash(&required(&mut args, "dataset root")?)?;
            let index_path = required(&mut args, "useful index path")?;
            let epoch_seed = parse_hash(&required(&mut args, "epoch seed")?)?;
            let miner_key = parse_hash(&required(&mut args, "miner key")?)?;
            let difficulty = parse_u16(&required(&mut args, "difficulty bits")?, "difficulty")?;
            let nonce = parse_u64(&required(&mut args, "nonce")?, "nonce")?;
            let claimed_hash = parse_hash(&required(&mut args, "claimed work hash")?)?;
            let message = collect_message(args);

            let dataset = CanonicalDataset::open_verified(dataset_path, dataset_root)?;
            let sketch_seed = derive_sketch_seed(dataset_root, epoch_seed, miner_key);
            let index = UsefulIndex::load_verified(index_path, dataset_root, sketch_seed)?;
            let context = DatasetFlyPowContext::new(
                demo_template(&message, difficulty),
                &dataset,
                &index,
                epoch_seed,
                miner_key,
            )?;
            let valid = context.verify_claim(nonce, &claimed_hash)?;
            println!("valid={valid}");
            if valid {
                Ok(())
            } else {
                Err("proof is invalid".into())
            }
        }
        "help" | "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        _ => {
            print_usage();
            Err(format!("unknown command {command:?}").into())
        }
    }
}

fn source_info() -> Result<(), Box<dyn Error>> {
    use flypow::dataset::*;
    println!("dataset={OFFICIAL_DATASET_NAME}");
    println!("official_page={OFFICIAL_DATASET_PAGE}");
    println!("official_object={OFFICIAL_SOURCE_OBJECT}");
    println!("official_https={OFFICIAL_SOURCE_URL}");
    println!("official_bytes={OFFICIAL_SOURCE_SIZE}");
    println!("official_md5={OFFICIAL_SOURCE_MD5_HEX}");
    println!("official_crc32c={OFFICIAL_SOURCE_CRC32C_HEX}");
    println!("official_generation={OFFICIAL_SOURCE_GENERATION}");
    println!("reported_synapses={REPORTED_SYNAPSE_COUNT}");
    println!("license={OFFICIAL_LICENSE}");
    println!("download_policy=FlyPoW does not mirror or automatically download this dataset");
    Ok(())
}

fn demo_template(message: &str, difficulty: u16) -> BlockTemplate {
    let merkle_root = hash_parts(b"FlyPoW/demo-merkle/v1", &[message.as_bytes()]);
    BlockTemplate::new([0; 32], merkle_root, 0, DEMO_TIMESTAMP, difficulty)
}

fn required(args: &mut impl Iterator<Item = String>, name: &str) -> Result<String, Box<dyn Error>> {
    args.next().ok_or_else(|| format!("missing {name}").into())
}

fn ensure_finished(args: &mut impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    if let Some(extra) = args.next() {
        Err(format!("unexpected argument {extra:?}").into())
    } else {
        Ok(())
    }
}

fn parse_hash(value: &str) -> Result<Hash256, Box<dyn Error>> {
    decode_hash(value).map_err(Into::into)
}

fn parse_u16(value: &str, name: &str) -> Result<u16, Box<dyn Error>> {
    value
        .parse::<u16>()
        .map_err(|error| format!("invalid {name} {value:?}: {error}").into())
}

fn parse_u64(value: &str, name: &str) -> Result<u64, Box<dyn Error>> {
    value
        .parse::<u64>()
        .map_err(|error| format!("invalid {name} {value:?}: {error}").into())
}

fn collect_message(args: impl Iterator<Item = String>) -> String {
    let message = args.collect::<Vec<_>>().join(" ");
    if message.is_empty() {
        "FlyPoW genesis research prototype".to_owned()
    } else {
        message
    }
}

fn print_usage() {
    eprintln!(
        "FlyPoW dataset-bound research miner\n\
         \n\
         Usage:\n\
           flypow source\n\
           flypow dataset-root <canonical.bin>\n\
           flypow build-index <canonical.bin> <dataset-root> <epoch-seed> <miner-key> <new-index.bin>\n\
           flypow mine <canonical.bin> <dataset-root> <index.bin> <epoch-seed> <miner-key> <difficulty-bits> <max-attempts> [message]\n\
           flypow verify <canonical.bin> <dataset-root> <index.bin> <epoch-seed> <miner-key> <difficulty-bits> <nonce> <work-hash> [message]\n\
         \n\
         All hashes/seeds/keys are 64 hexadecimal characters. See README.md before use."
    );
}
