use std::collections::BTreeMap;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use acir::circuit::OpcodeLocation;
use clap::Args;
use color_eyre::eyre::{self, Context};
use fm::codespan_files::Files;
use inferno::flamegraph::{from_lines, Options, TextTruncateDirection};
use noirc_errors::reporter::line_and_column_from_span;
use noirc_errors::{debug_info::DebugInfo, Location};

use crate::flamegraph::FoldedStackItem;
use crate::fs::{read_inputs_from_file, read_program_from_file};
use bn254_blackbox_solver::Bn254BlackBoxSolver;
use nargo::ops::DefaultForeignCallExecutor;
use noirc_abi::input_parser::Format;
use noirc_artifacts::debug::DebugArtifact;

#[derive(Debug, Clone, Args)]
pub(crate) struct ExecutionFlamegraphCommand {
    /// The path to the artifact JSON file
    #[clap(long, short)]
    artifact_path: PathBuf,

    #[clap(long, short)]
    prover_toml_path: PathBuf,

    /// The output folder for the flamegraph svg files
    #[clap(long, short)]
    output: PathBuf,
}

pub(crate) fn run(args: ExecutionFlamegraphCommand) -> eyre::Result<()> {
    run_with_generator(&args.artifact_path, &args.prover_toml_path, &args.output)
}

fn run_with_generator(
    artifact_path: &Path,
    prover_toml_path: &Path,
    output_path: &Path,
) -> eyre::Result<()> {
    let program =
        read_program_from_file(artifact_path).context("Error reading program from file")?;

    let (inputs_map, _) = read_inputs_from_file(prover_toml_path, Format::Toml, &program.abi)?;

    let initial_witness = program.abi.encode(&inputs_map, None)?;

    println!("Executing");
    let (_, profiling_samples) = nargo::ops::execute_program(
        &program.bytecode,
        initial_witness,
        &Bn254BlackBoxSolver,
        &mut DefaultForeignCallExecutor::new(true, None),
    )?;
    println!("Executed");
    let debug_artifact: DebugArtifact = program.into();

    println!("Generating flamegraph");

    generate_flamegraph(
        profiling_samples,
        &debug_artifact.debug_symbols[0],
        &debug_artifact,
        artifact_path.to_str().unwrap(),
        "main",
        &Path::new(&output_path).join(Path::new(&format!("{}.svg", "main"))),
    )?;

    Ok(())
}

fn generate_flamegraph<'files>(
    samples: Vec<(Vec<OpcodeLocation>, usize)>,
    debug_symbols: &DebugInfo,
    files: &'files impl Files<'files, FileId = fm::FileId>,
    artifact_name: &str,
    function_name: &str,
    output_path: &Path,
) -> eyre::Result<()> {
    println!("Folding {} samples", samples.len());

    let folded_lines = generate_folded_sorted_lines(samples, debug_symbols, files);

    let flamegraph_file = std::fs::File::create(output_path)?;
    let flamegraph_writer = BufWriter::new(flamegraph_file);

    let mut options = Options::default();
    options.hash = true;
    options.deterministic = true;
    options.title = format!("{}-{}", artifact_name, function_name);
    options.frame_height = 24;
    options.color_diffusion = true;
    options.min_width = 0.0;
    options.count_name = "samples".to_string();
    options.text_truncate_direction = TextTruncateDirection::Right;

    println!("Rendering flamegraph");
    from_lines(
        &mut options,
        folded_lines.iter().map(|as_string| as_string.as_str()),
        flamegraph_writer,
    )?;

    Ok(())
}

fn generate_folded_sorted_lines<'files>(
    samples: Vec<(Vec<OpcodeLocation>, usize)>,
    debug_symbols: &DebugInfo,
    files: &'files impl Files<'files, FileId = fm::FileId>,
) -> Vec<String> {
    // Create a nested hashmap with the stack items, folding the gates for all the callsites that are equal
    let mut folded_stack_items = BTreeMap::new();

    samples.into_iter().for_each(|(call_stack, samples)| {
        let mut location_names: Vec<String> = call_stack
            .into_iter()
            .flat_map(|location| {
                debug_symbols.locations.get(&location).cloned().unwrap_or_default()
            })
            .map(|location| location_to_callsite_label(location, files))
            .collect();
        if location_names.is_empty() {
            location_names.push("unknown".to_string());
        }
        add_locations_to_folded_stack_items(&mut folded_stack_items, location_names, samples);
    });

    to_folded_sorted_lines(&folded_stack_items, Default::default())
}

fn location_to_callsite_label<'files>(
    location: Location,
    files: &'files impl Files<'files, FileId = fm::FileId>,
) -> String {
    let filename =
        Path::new(&files.name(location.file).expect("should have a file path").to_string())
            .file_name()
            .map(|os_str| os_str.to_string_lossy().to_string())
            .unwrap_or("invalid_path".to_string());
    let source = files.source(location.file).expect("should have a file source");

    let code_slice = source
        .as_ref()
        .chars()
        .skip(location.span.start() as usize)
        .take(location.span.end() as usize - location.span.start() as usize)
        .collect::<String>();

    // ";" is used for frame separation, and is not allowed by inferno
    // Check code slice for ";" and replace it with 'GREEK QUESTION MARK' (U+037E)
    let code_slice = code_slice.replace(';', "\u{037E}");

    let (line, column) = line_and_column_from_span(source.as_ref(), &location.span);

    format!("{}:{}:{}::{}", filename, line, column, code_slice)
}

fn add_locations_to_folded_stack_items(
    stack_items: &mut BTreeMap<String, FoldedStackItem>,
    locations: Vec<String>,
    gates: usize,
) {
    let mut child_map = stack_items;
    for (index, location) in locations.iter().enumerate() {
        let current_item = child_map.entry(location.clone()).or_default();

        child_map = &mut current_item.nested_items;

        if index == locations.len() - 1 {
            current_item.total_samples += gates;
        }
    }
}

/// Creates a vector of lines in the format that inferno expects from a nested hashmap of stack items
/// The lines have to be sorted in the following way, exploring the graph in a depth-first manner:
/// main 100
/// main::foo 0
/// main::foo::bar 200
/// main::baz 27
/// main::baz::qux 800
fn to_folded_sorted_lines(
    folded_stack_items: &BTreeMap<String, FoldedStackItem>,
    parent_stacks: im::Vector<String>,
) -> Vec<String> {
    let mut result_vector = Vec::with_capacity(folded_stack_items.len());

    for (location, folded_stack_item) in folded_stack_items.iter() {
        if folded_stack_item.total_samples > 0 {
            let frame_list: Vec<String> =
                parent_stacks.iter().cloned().chain(std::iter::once(location.clone())).collect();
            let line: String =
                format!("{} {}", frame_list.join(";"), folded_stack_item.total_samples);

            result_vector.push(line);
        };

        let mut new_parent_stacks = parent_stacks.clone();
        new_parent_stacks.push_back(location.clone());
        let child_lines =
            to_folded_sorted_lines(&folded_stack_item.nested_items, new_parent_stacks);

        result_vector.extend(child_lines);
    }

    result_vector
}
