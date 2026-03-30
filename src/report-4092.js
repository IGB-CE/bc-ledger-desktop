const { buildLedgerReport } = require("./ledger-service");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildLedgerReport({
    accountNo: args.account,
    clientSearch: args.client,
    from: args.from,
    to: args.to,
    top: args.top,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.table(report.rows);
  console.log("");
  console.log("Summary");
  console.table([report.summary]);
}

run().catch((error) => {
  console.error("Failed to build 4092 report.");
  console.error(error.message);
  process.exitCode = 1;
});
