const { runIngestion } = require("../src/ingestion/pipeline");

runIngestion()
  .then((result) => {
    const failed = result.providers.filter((provider) => provider.status !== "ok");
    console.log(`Ingested ${result.count} listings from ${result.providers.length} provider(s).`);
    for (const provider of result.providers) {
      const detail = provider.status === "ok" ? `${provider.received} received` : provider.error;
      console.log(`- ${provider.id}: ${provider.status} (${detail})`);
    }

    if (result.rejected.length) {
      console.log(`Rejected ${result.rejected.length} invalid listing(s).`);
    }

    if (failed.length) {
      console.error(`Provider failures: ${failed.map((provider) => provider.id).join(", ")}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
